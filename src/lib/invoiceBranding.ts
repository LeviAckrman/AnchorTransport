/**
 * AnchorTransport TMS - Invoice Company Branding & Snapshot Utilities
 *
 * Ensures every invoice generated, previewed, printed, or exported to PDF
 * reflects the authenticated owner's company profile & uploaded logo,
 * captures immutable per-invoice company snapshots upon finalization,
 * preserves aspect ratio when embedding logos in PDFs, and enforces
 * completeness checks before finalizing an invoice.
 */

import { ref, getBlob, getDownloadURL } from 'firebase/storage';
import { auth, storage } from './firebase/client';
import { extractStoragePathFromUrl } from './firebase/storageService';
import type { Company, CompanyInvoiceSnapshot, Invoice } from '../types/tms';

export interface CompanyProfileCompletenessResult {
  complete: boolean;
  missingFields: string[];
  message: string;
}

export interface ResolvedInvoiceCompanyBranding {
  companyId?: string;
  legalName: string;
  tradeName?: string;
  address?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  pincode?: string;
  country: string;
  locationLine: string;
  gstin?: string;
  pan?: string;
  phone?: string;
  email?: string;
  logoUrl?: string;
  logoStoragePath?: string;
  bankName?: string;
  accountNumber?: string;
  ifscCode?: string;
  branch?: string;
  hasBankDetails: boolean;
  isSnapshotLocked: boolean;
  capturedAt?: string;
  source: 'snapshot' | 'live_company' | 'none';
}

export interface LoadedPdfLogo {
  dataUrl: string;
  format: 'PNG' | 'JPEG';
  width: number;
  height: number;
}

function cleanStr(val: unknown, maxLen: number): string | undefined {
  if (typeof val !== 'string') return undefined;
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLen);
}

/**
 * Validates that core company branding details exist before finalizing (ISSUED) an invoice.
 * Draft invoices can still be saved while the profile is being completed.
 */
export function validateCompanyProfileForInvoicing(
  company: Partial<Company> | null | undefined
): CompanyProfileCompletenessResult {
  if (!company || !company.id) {
    return {
      complete: false,
      missingFields: ['Company Profile'],
      message: 'Please set up your Company Profile under Settings before finalizing an invoice.',
    };
  }

  const missingFields: string[] = [];
  if (!company.name?.trim()) missingFields.push('Company Legal Name');
  if (!company.address?.trim()) missingFields.push('Registered Office Address');
  if (!company.city?.trim()) missingFields.push('City');
  if (!company.state?.trim()) missingFields.push('State');
  if (!company.phone?.trim() && !company.email?.trim()) {
    missingFields.push('Company Phone Number or Email');
  }

  if (missingFields.length > 0) {
    return {
      complete: false,
      missingFields,
      message: `Complete your Company Profile before finalizing this invoice. Missing: ${missingFields.join(', ')}.`,
    };
  }

  return {
    complete: true,
    missingFields: [],
    message: '',
  };
}

/**
 * Builds an immutable, rule-compliant company branding snapshot to embed inside finalized invoices.
 */
export function buildCompanyInvoiceSnapshot(
  company: Company,
  capturedAt?: string
): CompanyInvoiceSnapshot {
  const legalName = cleanStr(company.name, 150) || cleanStr(company.tradeName, 150) || 'Transport Company';
  const tradeName = cleanStr(company.tradeName, 150);

  const snapshot: CompanyInvoiceSnapshot = {
    companyId: company.id,
    name: legalName,
    legalName,
    country: cleanStr(company.country, 80) || 'India',
    capturedAt: (capturedAt || new Date().toISOString()).slice(0, 40),
  };

  if (tradeName) snapshot.tradeName = tradeName;
  const gstin = cleanStr(company.gstin, 20);
  if (gstin) snapshot.gstin = gstin;
  const pan = cleanStr(company.pan, 15);
  if (pan) snapshot.pan = pan;
  const phone = cleanStr(company.phone, 25);
  if (phone) snapshot.phone = phone;
  const email = cleanStr(company.email, 200);
  if (email) snapshot.email = email;
  const address = cleanStr(company.address, 300);
  if (address) snapshot.address = address;
  const city = cleanStr(company.city, 80);
  if (city) snapshot.city = city;
  const state = cleanStr(company.state, 60);
  if (state) snapshot.state = state;
  const stateCode = cleanStr(company.stateCode, 5);
  if (stateCode) snapshot.stateCode = stateCode;
  const pincode = cleanStr(company.pincode, 15);
  if (pincode) snapshot.pincode = pincode;
  const logoUrl = cleanStr(company.logoUrl, 2000);
  if (logoUrl) snapshot.logoUrl = logoUrl;
  const logoStoragePath = cleanStr(company.logoStoragePath, 500);
  if (logoStoragePath) snapshot.logoStoragePath = logoStoragePath;
  const bankName = cleanStr(company.bankName, 100);
  if (bankName) snapshot.bankName = bankName;
  const accountNumber = cleanStr(company.accountNumber, 40);
  if (accountNumber) snapshot.accountNumber = accountNumber;
  const ifscCode = cleanStr(company.ifscCode, 15);
  if (ifscCode) snapshot.ifscCode = ifscCode;
  const branch = cleanStr(company.branch, 100);
  if (branch) snapshot.branch = branch;

  return snapshot;
}

/**
 * Resolves the authoritative company branding for an invoice.
 * - Cross-tenant safe: rejects liveCompany if companyId does not match invoice.companyId.
 * - Historical immutability: finalized invoices (!= 'DRAFT') strictly prefer their saved companySnapshot.
 * - Draft invoices & legacy pre-snapshot invoices cleanly fall back to liveCompany.
 */
export function resolveInvoiceCompanyBranding(
  invoice: Partial<Invoice> | null | undefined,
  liveCompany: Partial<Company> | null | undefined
): ResolvedInvoiceCompanyBranding {
  const safeLiveCompany =
    liveCompany && (!invoice?.companyId || !liveCompany.id || liveCompany.id === invoice.companyId)
      ? liveCompany
      : null;

  const validSnapshot =
    invoice?.companySnapshot &&
    (!invoice.companyId || invoice.companySnapshot.companyId === invoice.companyId)
      ? invoice.companySnapshot
      : null;

  const isDraft = invoice?.status === 'DRAFT';
  const useSnapshot = Boolean(validSnapshot && (!isDraft || !safeLiveCompany));

  const src = useSnapshot ? validSnapshot! : safeLiveCompany;
  const source: ResolvedInvoiceCompanyBranding['source'] = useSnapshot
    ? 'snapshot'
    : safeLiveCompany
    ? 'live_company'
    : 'none';

  const legalName =
    cleanStr((src as any)?.legalName, 150) ||
    cleanStr(src?.name, 150) ||
    cleanStr(src?.tradeName, 150) ||
    'Transport Company';
  const rawTradeName = cleanStr(src?.tradeName, 150);
  const tradeName =
    rawTradeName && rawTradeName.toLowerCase() !== legalName.toLowerCase()
      ? rawTradeName
      : undefined;

  const address = cleanStr(src?.address, 300);
  const city = cleanStr(src?.city, 80);
  const state = cleanStr(src?.state, 60);
  const stateCode = cleanStr(src?.stateCode, 5);
  const pincode = cleanStr(src?.pincode, 15);
  const country = cleanStr(src?.country, 80) || 'India';

  const locationLine = [city, state, pincode, country].filter(Boolean).join(', ');

  const bankName = cleanStr(src?.bankName, 100);
  const accountNumber = cleanStr(src?.accountNumber, 40);
  const ifscCode = cleanStr(src?.ifscCode, 15);
  const branch = cleanStr(src?.branch, 100);

  return {
    companyId: (src as any)?.companyId || (src as any)?.id || invoice?.companyId,
    legalName,
    tradeName,
    address,
    city,
    state,
    stateCode,
    pincode,
    country,
    locationLine,
    gstin: cleanStr(src?.gstin, 20),
    pan: cleanStr(src?.pan, 15),
    phone: cleanStr(src?.phone, 25),
    email: cleanStr(src?.email, 200),
    logoUrl: cleanStr(src?.logoUrl, 2000),
    logoStoragePath: cleanStr(src?.logoStoragePath, 500),
    bankName,
    accountNumber,
    ifscCode,
    branch,
    hasBankDetails: Boolean(bankName || accountNumber || ifscCode || branch),
    isSnapshotLocked: Boolean(useSnapshot && invoice?.status !== 'DRAFT'),
    capturedAt: useSnapshot ? validSnapshot?.capturedAt : undefined,
    source,
  };
}

/**
 * Scales natural image dimensions proportionally within maxWidth x maxHeight
 * so logos never distort or stretch in PDF exports.
 */
export function fitLogoDimensions(
  naturalWidth: number,
  naturalHeight: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const safeW = Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : maxWidth;
  const safeH = Number.isFinite(naturalHeight) && naturalHeight > 0 ? naturalHeight : maxHeight;
  const scale = Math.min(maxWidth / safeW, maxHeight / safeH);
  return {
    width: Math.max(1, Math.round(safeW * scale * 100) / 100),
    height: Math.max(1, Math.round(safeH * scale * 100) / 100),
  };
}

/**
 * Extracts basic image dimensions from PNG/JPEG data URLs when running in headless Node tests.
 */
function parseDataUrlDimensionsFallback(dataUrl: string): { width: number; height: number } {
  try {
    const base64 = dataUrl.split(',')[1] || '';
    if (typeof atob === 'function' && base64.length >= 32) {
      const raw = atob(base64.slice(0, 64));
      // PNG signature + IHDR width/height at bytes 16..23
      if (raw.charCodeAt(0) === 0x89 && raw.charCodeAt(1) === 0x50 && raw.length >= 24) {
        const w =
          (raw.charCodeAt(16) << 24) |
          (raw.charCodeAt(17) << 16) |
          (raw.charCodeAt(18) << 8) |
          raw.charCodeAt(19);
        const h =
          (raw.charCodeAt(20) << 24) |
          (raw.charCodeAt(21) << 16) |
          (raw.charCodeAt(22) << 8) |
          raw.charCodeAt(23);
        if (w > 0 && h > 0) return { width: w, height: h };
      }
    }
  } catch {
    // Ignore parse error
  }
  return { width: 120, height: 48 };
}

async function renderBlobToPngDataUrlInBrowser(blob: Blob): Promise<LoadedPdfLogo | null> {
  if (typeof window === 'undefined' || typeof Image === 'undefined' || typeof document === 'undefined') {
    const fallbackDataUrl = await new Promise<string | null>((resolve) => {
      if (typeof FileReader === 'undefined') return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
    if (!fallbackDataUrl) return null;
    const dims = parseDataUrlDimensionsFallback(fallbackDataUrl);
    return {
      dataUrl: fallbackDataUrl,
      format: fallbackDataUrl.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG',
      width: dims.width,
      height: dims.height,
    };
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise<LoadedPdfLogo | null>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const w = img.naturalWidth || 120;
        const h = img.naturalHeight || 48;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          const pngDataUrl = canvas.toDataURL('image/png');
          resolve({ dataUrl: pngDataUrl, format: 'PNG', width: w, height: h });
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function renderImageUrlToPngDataUrlInBrowser(url: string): Promise<LoadedPdfLogo | null> {
  if (typeof window === 'undefined' || typeof Image === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  return await new Promise<LoadedPdfLogo | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      const w = img.naturalWidth || 120;
      const h = img.naturalHeight || 48;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const pngDataUrl = canvas.toDataURL('image/png');
        resolve({ dataUrl: pngDataUrl, format: 'PNG', width: w, height: h });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Resolves a fresh Firebase Storage download URL when logoStoragePath belongs to the active user.
 */
export async function resolveDisplayLogoUrl(
  logoUrl?: string,
  logoStoragePath?: string
): Promise<string | undefined> {
  const cleanUrl = cleanStr(logoUrl, 2000);
  if (cleanUrl) return cleanUrl;

  const cleanPath = cleanStr(logoStoragePath, 500);
  if (!cleanPath || !auth.currentUser?.uid) return undefined;
  if (!cleanPath.startsWith(`users/${auth.currentUser.uid}/`)) return undefined;

  try {
    return await getDownloadURL(ref(storage, cleanPath));
  } catch {
    return undefined;
  }
}

/**
 * Loads the company's uploaded logo (from data URL, Firebase Storage path, or HTTPS URL)
 * into a normalized PNG/JPEG Data URL with natural dimensions for aspect-ratio-safe PDF rendering.
 * Never throws; returns null cleanly if unavailable so PDF generation always succeeds.
 */
export async function loadCompanyLogoForPdf(
  logoUrl?: string,
  logoStoragePath?: string
): Promise<LoadedPdfLogo | null> {
  const cleanUrl = cleanStr(logoUrl, 2000);
  const cleanPath =
    cleanStr(logoStoragePath, 500) || extractStoragePathFromUrl(cleanUrl || undefined) || undefined;

  // 1. Direct data URL
  if (cleanUrl && cleanUrl.startsWith('data:image/')) {
    if (typeof Image !== 'undefined' && typeof document !== 'undefined') {
      const rendered = await renderImageUrlToPngDataUrlInBrowser(cleanUrl);
      if (rendered) return rendered;
    }
    const dims = parseDataUrlDimensionsFallback(cleanUrl);
    return {
      dataUrl: cleanUrl,
      format: cleanUrl.startsWith('data:image/jpeg') || cleanUrl.startsWith('data:image/jpg') ? 'JPEG' : 'PNG',
      width: dims.width,
      height: dims.height,
    };
  }

  // 2. Authenticated Firebase Storage SDK blob fetch (bypasses CORS issues for UID-owned objects)
  if (
    cleanPath &&
    auth.currentUser?.uid &&
    auth.currentUser.emailVerified &&
    cleanPath.startsWith(`users/${auth.currentUser.uid}/`)
  ) {
    try {
      const blob = await getBlob(ref(storage, cleanPath));
      const rendered = await renderBlobToPngDataUrlInBrowser(blob);
      if (rendered) return rendered;
    } catch {
      // Fall through to URL fetch
    }
  }

  // 3. Direct CORS fetch on logoUrl
  if (cleanUrl && typeof fetch !== 'undefined') {
    try {
      const resp = await fetch(cleanUrl, { mode: 'cors' });
      if (resp.ok) {
        const blob = await resp.blob();
        const rendered = await renderBlobToPngDataUrlInBrowser(blob);
        if (rendered) return rendered;
      }
    } catch {
      // Fall through to browser <img> canvas conversion
    }
  }

  // 4. Browser Image -> Canvas fallback
  if (cleanUrl) {
    const rendered = await renderImageUrlToPngDataUrlInBrowser(cleanUrl);
    if (rendered) return rendered;
  }

  return null;
}
