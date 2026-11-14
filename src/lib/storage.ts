/**
 * AnchorTransport TMS - Client Cache & Empty Company Defaults
 * Operational data is stored exclusively in Firebase Firestore.
 * Local storage is used strictly for ephemeral UI/auth metadata cleanup on logout.
 */

import type { Company } from '../types/tms';

export const TMS_STORAGE_KEY = 'anchortransport_tms_store_v1';
export const LEGACY_TMS_STORAGE_KEY = 'fleetgati_tms_store_v1';
export const AUTH_SESSION_STORAGE_KEY = 'anchortransport_auth_session_v2';

export const EMPTY_COMPANY: Company = {
  id: '',
  name: '',
  tradeName: '',
  gstin: '',
  pan: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  state: '',
  stateCode: '',
  pincode: '',
  bankName: '',
  accountNumber: '',
  ifscCode: '',
  branch: '',
  lrPrefix: 'AT/25-26/',
  invoicePrefix: 'INV/25-26/',
  tripPrefix: 'TR-',
  createdAt: '',
};

/**
 * Clears all client-side TMS and auth session caches on logout.
 * Never deletes or resets any Firestore documents or company records.
 */
export function clearClientTmsCaches(): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.removeItem(TMS_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_TMS_STORAGE_KEY);
    window.localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    window.localStorage.removeItem('token');
    window.localStorage.removeItem('onboarding_token');
  } catch {
    // Ignore storage access errors in restricted contexts
  }
}
