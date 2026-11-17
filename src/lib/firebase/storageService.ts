/**
 * AnchorTransport TMS - Firebase Storage Document Upload Service
 * Enforces verified email + size/MIME checks and uploads into /companies/{companyId}/{folder}/{fileName}
 */

import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage, auth } from './client';
import { recordFileUploadInFirestore } from './firestoreService';

export type StorageDocumentFolder =
  | 'trips'
  | 'dispatches'
  | 'pod'
  | 'expenses'
  | 'fuel'
  | 'documents'
  | 'company';

const MAX_FILE_SIZE_BYTES = 15 * 1024 * 1024; // 15 MB

function isAllowedMimeType(mimeType: string): boolean {
  const clean = (mimeType || '').toLowerCase();
  return clean.startsWith('image/') || clean === 'application/pdf';
}

export async function uploadCompanyDocument(
  companyId: string,
  folder: StorageDocumentFolder,
  file: File,
  meta?: { entityType?: string; entityId?: string }
): Promise<string> {
  if (!auth.currentUser) {
    throw new Error('Authentication required before uploading documents.');
  }
  if (!auth.currentUser.emailVerified) {
    throw new Error('Please verify your email address before uploading documents.');
  }
  if (!companyId || !/^[a-zA-Z0-9_-]{1,128}$/.test(companyId.trim())) {
    throw new Error('Valid company ID is required for document upload.');
  }
  if (!file) {
    throw new Error('No file selected for upload.');
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('File size exceeds the 15 MB upload limit.');
  }
  if (!isAllowedMimeType(file.type)) {
    throw new Error('Only PDF and image files (PNG, JPG, WEBP) are supported.');
  }

  const cleanCompanyId = companyId.trim();
  const safeName = (file.name || 'document')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80);
  const objectPath = `companies/${cleanCompanyId}/${folder}/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, objectPath);

  await uploadBytes(storageRef, file, {
    contentType: file.type || 'application/octet-stream',
    customMetadata: {
      companyId: cleanCompanyId,
      uploadedByUid: auth.currentUser.uid,
      folder,
    },
  });

  const downloadUrl = await getDownloadURL(storageRef);

  // Best-effort Firestore fileRecords metadata tracking (non-blocking if offline)
  try {
    const fileId = `fil_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await recordFileUploadInFirestore(cleanCompanyId, {
      id: fileId,
      companyId: cleanCompanyId,
      uploadedByUid: auth.currentUser.uid,
      uploadedByName: auth.currentUser.displayName || auth.currentUser.email || undefined,
      folder,
      fileName: file.name || safeName,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      storagePath: objectPath,
      downloadUrl,
      entityType: meta?.entityType,
      entityId: meta?.entityId,
    });
  } catch (err) {
    console.warn('File metadata index write notice:', err);
  }

  return downloadUrl;
}
