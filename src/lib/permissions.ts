/**
 * AnchorTransport TMS - Strict Owner-Only Access Control Permissions
 * Only the authenticated company OWNER is authorized for all TMS operations.
 * Employee, staff, and team-management permission sets are intentionally denied.
 */

import { UserRole } from '../types/tms';

export interface RolePermissionSet {
  canManageCompany: boolean;
  canManageUsers: boolean;
  canDispatchTrips: boolean;
  canSettleTrips: boolean;
  canGenerateInvoices: boolean;
  canRecordPayments: boolean;
  canLogExpenses: boolean;
  canDisburseAdvances: boolean;
  canViewReports: boolean;
  canViewSensitiveDriverInfo: boolean;
  canManageFleet: boolean;
}

export const OWNER_PERMISSIONS: RolePermissionSet = {
  canManageCompany: true,
  canManageUsers: false,
  canDispatchTrips: true,
  canSettleTrips: true,
  canGenerateInvoices: true,
  canRecordPayments: true,
  canLogExpenses: true,
  canDisburseAdvances: true,
  canViewReports: true,
  canViewSensitiveDriverInfo: true,
  canManageFleet: true,
};

const DENIED_PERMISSIONS: RolePermissionSet = {
  canManageCompany: false,
  canManageUsers: false,
  canDispatchTrips: false,
  canSettleTrips: false,
  canGenerateInvoices: false,
  canRecordPayments: false,
  canLogExpenses: false,
  canDisburseAdvances: false,
  canViewReports: false,
  canViewSensitiveDriverInfo: false,
  canManageFleet: false,
};

export const ROLE_PERMISSIONS: Record<UserRole, RolePermissionSet> = {
  OWNER: OWNER_PERMISSIONS,
  ADMIN: DENIED_PERMISSIONS,
  MANAGER: DENIED_PERMISSIONS,
  ACCOUNTANT: DENIED_PERMISSIONS,
  OPERATIONS: DENIED_PERMISSIONS,
};

export function hasPermission(role: UserRole | undefined | null, permission: keyof RolePermissionSet): boolean {
  if (role !== 'OWNER') return false;
  return Boolean(OWNER_PERMISSIONS[permission]);
}

export function canViewSensitiveDriverInfo(role: UserRole | undefined | null): boolean {
  return hasPermission(role, 'canViewSensitiveDriverInfo');
}

export function canManageFleet(role: UserRole | undefined | null): boolean {
  return hasPermission(role, 'canManageFleet');
}
