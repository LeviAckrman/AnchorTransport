/**
 * AnchorTransport TMS - Firebase Cloud Storage Service
 * Strict Verified-Email & Firebase Auth UID-Isolated File Storage:
 *   Storage path: users/{userId}/{category}/{fileName}
 *   (and users/{userId}/trips/journal_{journalTripId}/{fileName} for Trips Journal)
 *
 * Enforces:
 * - Verified Firebase Authentication required (uid strictly derived from auth.currentUser.uid)
 * - Client-side MIME type & < 20 MB size validation matching storage.rules
 * - Resumable upload with real-time 0-100% progress callbacks
 * - Persistent Firestore file metadata under /users/{uid}/files/{fileId} (+ company fileRecords index)
 * - Safe Delete Ordering: deletes Firebase Storage object FIRST; only deletes Firestore metadata
 *   after Storage deletion succeeds or returns `storage/object-not-found`.
 */

import {
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage';
import { storage, auth } from './client';
import {
  recordUserFileMetadataInFirestore,
  deleteUserFileMetadataInFirestore,
} from './firestoreService';
import { isValidJournalAttachmentFile } from '../journalTripsHelpers';
import type { StorageFileCategory, UserFileMetadata } from '../../types/tms';

export type StorageDocumentFolder = StorageFileCategory;

export const MAX_STORAGE_FILE_SIZE_BYTES = 20 * 1024 * 1024; // Strictly < 20 MB

export const ALLOWED_STORAGE_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
] as const;

const EXTENSION_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
};

const VALID_CATEGORIES = new Set<StorageFileCategory>([
  'company',
  'documents',
  'invoices',
  'receipts',
  'trips',
  'drivers',
  'vehicles',
  'expenses',
  'fuel',
  'settlements',
  'customer-documents',
  'profile',
  'other',
  'dispatches',
  'pod',
]);

export const STORAGE_CATEGORY_LABELS: Record<StorageFileCategory, string> = {
  company: 'Company',
  documents: 'Vehicle Documents',
  invoices: 'Invoices',
  receipts: 'Receipts',
  trips: 'Trips & POD',
  drivers: 'Drivers',
  vehicles: 'Vehicles',
  expenses: 'Expenses',
  fuel: 'Fuel Slips',
  settlements: 'Settlements',
  'customer-documents': 'Customer Docs',
  profile: 'Profile',
  other: 'Other',
  dispatches: 'Dispatches',
  pod: 'Proof of Delivery',
};

export const STORAGE_ACCEPT_ATTR =
  '.pdf,.jpg,.jpeg,.png,.webp,.gif,.doc,.docx,.xls,.xlsx,.csv,image/jpeg,image/png,image/webp,image/gif,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv';

export function formatFileSize(bytes?: number): string {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function resolveFileContentType(file: File): string {
  const rawType = (file.type || '').trim().toLowerCase();
  if (ALLOWED_STORAGE_MIME_TYPES.includes(rawType as any)) {
    return rawType;
  }
  const ext = (file.name || '').split('.').pop()?.toLowerCase() || '';
  return EXTENSION_MIME_MAP[ext] || rawType;
}

export function validateStorageUploadFile(file: File | null | undefined): {
  valid: boolean;
  contentType?: string;
  error?: string;
} {
  if (!file) {
    return { valid: false, error: 'No file selected for upload.' };
  }
  if (file.size <= 0) {
    return { valid: false, error: 'Cannot upload an empty file (0 bytes).' };
  }
  if (file.size >= MAX_STORAGE_FILE_SIZE_BYTES) {
    return { valid: false, error: 'File size must be less than 20 MB.' };
  }
  const contentType = resolveFileContentType(file);
  if (!contentType || !ALLOWED_STORAGE_MIME_TYPES.includes(contentType as any)) {
    return {
      valid: false,
      error:
        'Unsupported file type. Allowed formats: JPG, PNG, WebP, GIF, PDF, Word (DOC/DOCX), Excel (XLS/XLSX), and CSV.',
    };
  }
  return { valid: true, contentType };
}

function assertVerifiedAuthUid(): string {
  if (!auth.currentUser) {
    throw new Error('Authentication required before accessing file storage.');
  }
  if (!auth.currentUser.emailVerified) {
    throw new Error('Please verify your email address before accessing file storage.');
  }
  const uid = (auth.currentUser.uid || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(uid)) {
    throw new Error('Invalid authenticated user identifier.');
  }
  return uid;
}

function sanitizeStorageCategory(category: StorageFileCategory): StorageFileCategory {
  return VALID_CATEGORIES.has(category) ? category : 'other';
}

function sanitizeOriginalFilename(name: string): string {
  const safe = (name || 'document')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.+/g, '.')
    .slice(0, 100);
  return safe || 'document';
}

/**
 * Extracts a Firebase Storage object path from either a raw storage path
 * or a Firebase Storage download URL (`https://firebasestorage.googleapis.com/.../o/<encodedPath>?...`).
 */
export function extractStoragePathFromUrl(urlOrPath?: string | null): string | null {
  if (!urlOrPath || typeof urlOrPath !== 'string') return null;
  const trimmed = urlOrPath.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    const oMarker = '/o/';
    const idx = parsed.pathname.indexOf(oMarker);
    if (idx !== -1) {
      return decodeURIComponent(parsed.pathname.slice(idx + oMarker.length));
    }
  } catch {
    return null;
  }
  return null;
}

export interface UploadUserFileParams {
  file: File;
  category: StorageFileCategory;
  companyId?: string;
  relatedRecordId?: string;
  entityType?: string;
  entityId?: string;
  onProgress?: (percent: number) => void;
}

/**
 * Uploads a file strictly into users/{auth.currentUser.uid}/{category}/{timestamp}_{fileName},
 * tracks progress via uploadBytesResumable, resolves the authenticated downloadURL,
 * and saves persistent metadata to /users/{uid}/files/{fileId} (+ company fileRecords if companyId provided).
 */
export async function uploadUserFile(params: UploadUserFileParams): Promise<UserFileMetadata> {
  const uid = assertVerifiedAuthUid();
  const check = validateStorageUploadFile(params.file);
  if (!check.valid || !check.contentType) {
    throw new Error(check.error || 'Invalid upload file.');
  }

  const category = sanitizeStorageCategory(params.category);
  const safeName = sanitizeOriginalFilename(params.file.name);
  const storedFileName = `${Date.now()}_${safeName}`;
  const storagePath = `users/${uid}/${category}/${storedFileName}`;
  const fileId = `fil_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const storageRef = ref(storage, storagePath);

  const customMetadata: Record<string, string> = {
    uploadedBy: uid,
    category,
    originalFileName: (params.file.name || safeName).slice(0, 200),
  };
  if (params.companyId) {
    customMetadata.companyId = params.companyId.trim();
  }
  if (params.relatedRecordId || params.entityId) {
    customMetadata.relatedRecordId = (params.relatedRecordId || params.entityId || '').trim();
  }

  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, params.file, {
      contentType: check.contentType,
      customMetadata,
    });

    task.on(
      'state_changed',
      (snapshot) => {
        if (params.onProgress && snapshot.totalBytes > 0) {
          const pct = Math.min(100, Math.max(0, Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)));
          params.onProgress(pct);
        }
      },
      (error) => {
        reject(error);
      },
      () => {
        if (params.onProgress) params.onProgress(100);
        resolve();
      }
    );
  });

  let downloadURL: string;
  try {
    downloadURL = await getDownloadURL(storageRef);
  } catch (err) {
    await deleteObject(storageRef).catch(() => null);
    throw err;
  }

  try {
    const metadata = await recordUserFileMetadataInFirestore({
      fileId,
      fileName: storedFileName,
      originalFileName: params.file.name || safeName,
      storagePath,
      downloadURL,
      contentType: check.contentType,
      fileSize: params.file.size,
      category,
      relatedRecordId: params.relatedRecordId || params.entityId,
      companyId: params.companyId,
      entityType: params.entityType,
      entityId: params.entityId || params.relatedRecordId,
      uploadedByName: auth.currentUser?.displayName || auth.currentUser?.email || undefined,
    });
    return metadata;
  } catch (err) {
    // Roll back Storage object cleanly if Firestore metadata write fails
    await deleteObject(storageRef).catch(() => null);
    throw err;
  }
}

export interface DeleteUserFileParams {
  fileId?: string;
  storagePath?: string;
  downloadUrl?: string;
  companyId?: string;
  fileName?: string;
}

/**
 * Safe Delete Ordering:
 * 1. Verifies authenticated & email-verified owner UID.
 * 2. Deletes Firebase Storage object FIRST.
 *    - If Storage returns `storage/object-not-found`, proceeds safely to clean up metadata.
 *    - If Storage fails with any other error (permission/network), aborts WITHOUT deleting Firestore metadata.
 * 3. Deletes Firestore metadata only after Storage deletion succeeds or object was already missing.
 */
export async function deleteUserFile(params: DeleteUserFileParams): Promise<void> {
  const uid = assertVerifiedAuthUid();
  const resolvedPath =
    (params.storagePath && params.storagePath.trim()) ||
    extractStoragePathFromUrl(params.downloadUrl);

  if (resolvedPath) {
    if (resolvedPath.startsWith('users/') && !resolvedPath.startsWith(`users/${uid}/`)) {
      throw new Error('Access denied: you cannot delete files belonging to another user.');
    }
    if (
      resolvedPath.startsWith('companies/') &&
      (!params.companyId || !resolvedPath.startsWith(`companies/${params.companyId.trim()}/`))
    ) {
      throw new Error('Access denied: file path does not match your workspace.');
    }

    const storageRef = ref(storage, resolvedPath);
    try {
      await deleteObject(storageRef);
    } catch (err: any) {
      const code = String(err?.code || '').toLowerCase();
      if (!code.includes('object-not-found')) {
        throw err;
      }
    }
  }

  if (params.fileId) {
    await deleteUserFileMetadataInFirestore({
      fileId: params.fileId,
      companyId: params.companyId,
      fileName: params.fileName,
    });
  }
}

/**
 * Uploads the replacement file first, then safely deletes the previous file.
 */
export async function replaceUserFile(
  params: UploadUserFileParams & {
    previousFile?: DeleteUserFileParams;
  }
): Promise<UserFileMetadata> {
  const nextFile = await uploadUserFile(params);
  if (
    params.previousFile &&
    (params.previousFile.storagePath ||
      params.previousFile.downloadUrl ||
      params.previousFile.fileId)
  ) {
    try {
      await deleteUserFile(params.previousFile);
    } catch (cleanupErr) {
      console.warn('Previous file cleanup notice after replacement:', cleanupErr);
    }
  }
  return nextFile;
}

/**
 * Resolves a fresh authenticated Firebase Storage download URL for any owned storagePath.
 */
export async function getUserFileDownloadUrl(storagePath: string): Promise<string> {
  const uid = assertVerifiedAuthUid();
  const cleanPath = (storagePath || '').trim();
  if (!cleanPath.startsWith(`users/${uid}/`)) {
    throw new Error('Access denied: file path does not belong to the authenticated user.');
  }
  return getDownloadURL(ref(storage, cleanPath));
}

/**
 * Compatibility wrapper used across TMS modules; uploads into
 * users/{uid}/{category}/{timestamp}_{fileName} and returns downloadURL.
 */
export async function uploadCompanyDocument(
  companyId: string,
  folder: StorageDocumentFolder,
  file: File,
  meta?: { entityType?: string; entityId?: string; relatedRecordId?: string },
  onProgress?: (percent: number) => void
): Promise<string> {
  const result = await uploadUserFile({
    file,
    category: folder,
    companyId: companyId && /^[a-zA-Z0-9_-]{1,128}$/.test(companyId.trim()) ? companyId.trim() : undefined,
    entityType: meta?.entityType,
    entityId: meta?.entityId,
    relatedRecordId: meta?.relatedRecordId || meta?.entityId,
    onProgress,
  });
  return result.downloadURL;
}

/**
 * Uploads a Trips Journal attachment to UID-isolated private Storage:
 * users/{uid}/trips/journal_{journalTripId}/{timestamp}_{fileName}
 * Returns the private storagePath.
 */
export async function uploadJournalTripAttachment(
  companyId: string,
  journalTripId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> {
  const uid = assertVerifiedAuthUid();
  const cleanCompanyId = (companyId || '').trim();
  const cleanJournalTripId = (journalTripId || '').trim();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanCompanyId)) {
    throw new Error('Valid company ID is required for attachment upload.');
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cleanJournalTripId)) {
    throw new Error('Valid journal trip ID is required for attachment upload.');
  }
  if (!file) {
    throw new Error('No attachment file selected.');
  }

  const check = isValidJournalAttachmentFile(file);
  if (!check.valid) {
    throw new Error(check.error || 'Invalid attachment file.');
  }

  const safeName = sanitizeOriginalFilename(file.name || 'attachment').slice(0, 80);
  const storedFileName = `${Date.now()}_${safeName}`;
  const objectPath = `users/${uid}/trips/journal_${cleanJournalTripId}/${storedFileName}`;
  const storageRef = ref(storage, objectPath);

  const normalizedContentType =
    file.type && ['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'].includes(file.type.toLowerCase())
      ? file.type.toLowerCase()
      : safeName.toLowerCase().endsWith('.pdf')
      ? 'application/pdf'
      : safeName.toLowerCase().endsWith('.png')
      ? 'image/png'
      : 'image/jpeg';

  await new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, {
      contentType: normalizedContentType,
      customMetadata: {
        uploadedBy: uid,
        companyId: cleanCompanyId,
        journalTripId: cleanJournalTripId,
        category: 'trips',
        originalFileName: (file.name || safeName).slice(0, 200),
      },
    });
    task.on(
      'state_changed',
      (snapshot) => {
        if (onProgress && snapshot.totalBytes > 0) {
          const pct = Math.min(100, Math.max(0, Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)));
          onProgress(pct);
        }
      },
      reject,
      () => {
        if (onProgress) onProgress(100);
        resolve();
      }
    );
  });

  try {
    const downloadURL = await getDownloadURL(storageRef);
    const fileId = `fil_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await recordUserFileMetadataInFirestore({
      fileId,
      fileName: storedFileName,
      originalFileName: file.name || safeName,
      storagePath: objectPath,
      downloadURL,
      contentType: normalizedContentType,
      fileSize: file.size,
      category: 'trips',
      relatedRecordId: cleanJournalTripId,
      companyId: cleanCompanyId,
      entityType: 'JOURNAL_TRIP',
      entityId: cleanJournalTripId,
    });
  } catch (err) {
    console.warn('Journal attachment metadata index notice:', err);
  }

  return objectPath;
}

/**
 * Resolves an authenticated Firebase Storage download URL for a UID-scoped (or legacy company-scoped) journal attachment.
 */
export async function getJournalAttachmentDownloadUrl(
  companyId: string,
  storagePath: string
): Promise<string> {
  const uid = assertVerifiedAuthUid();
  const cleanPath = (storagePath || '').trim();
  const isUserOwned = cleanPath.startsWith(`users/${uid}/`);
  const isLegacyCompanyOwned =
    Boolean(companyId?.trim()) && cleanPath.startsWith(`companies/${companyId.trim()}/journalTrips/`);
  if (!isUserOwned && !isLegacyCompanyOwned) {
    throw new Error('Access denied: attachment path does not belong to your account.');
  }
  const storageRef = ref(storage, cleanPath);
  return getDownloadURL(storageRef);
}

/**
 * Deletes a Trips Journal attachment from Firebase Storage (Storage first; ignores object-not-found).
 */
export async function deleteJournalAttachment(
  companyId: string,
  storagePath: string
): Promise<void> {
  const uid = assertVerifiedAuthUid();
  const cleanPath = (storagePath || '').trim();
  const isUserOwned = cleanPath.startsWith(`users/${uid}/`);
  const isLegacyCompanyOwned =
    Boolean(companyId?.trim()) && cleanPath.startsWith(`companies/${companyId.trim()}/journalTrips/`);
  if (!isUserOwned && !isLegacyCompanyOwned) {
    throw new Error('Access denied: attachment path does not belong to your account.');
  }
  const storageRef = ref(storage, cleanPath);
  try {
    await deleteObject(storageRef);
  } catch (err: any) {
    const code = String(err?.code || '').toLowerCase();
    if (!code.includes('object-not-found')) {
      throw err;
    }
  }
}
