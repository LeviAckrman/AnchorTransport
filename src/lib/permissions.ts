/**
 * AnchorTransport TMS - Role-Based Access Control Permissions
 * Supports Company Owner full governance plus company-scoped employee RBAC
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
  canManageUsers: true,
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

export const ROLE_PERMISSIONS: Record<UserRole, RolePermissionSet> = {
  OWNER: OWNER_PERMISSIONS,
  ADMIN: {
    canManageCompany: true,
    canManageUsers: true,
    canDispatchTrips: true,
    canSettleTrips: true,
    canGenerateInvoices: true,
    canRecordPayments: true,
    canLogExpenses: true,
    canDisburseAdvances: true,
    canViewReports: true,
    canViewSensitiveDriverInfo: true,
    canManageFleet: true,
  },
  MANAGER: {
    canManageCompany: false,
    canManageUsers: false,
    canDispatchTrips: true,
    canSettleTrips: false,
    canGenerateInvoices: false,
    canRecordPayments: false,
    canLogExpenses: true,
    canDisburseAdvances: true,
    canViewReports: true,
    canViewSensitiveDriverInfo: false,
    canManageFleet: true,
  },
  ACCOUNTANT: {
    canManageCompany: false,
    canManageUsers: false,
    canDispatchTrips: false,
    canSettleTrips: true,
    canGenerateInvoices: true,
    canRecordPayments: true,
    canLogExpenses: true,
    canDisburseAdvances: true,
    canViewReports: true,
    canViewSensitiveDriverInfo: true,
    canManageFleet: false,
  },
  OPERATIONS: {
    canManageCompany: false,
    canManageUsers: false,
    canDispatchTrips: true,
    canSettleTrips: false,
    canGenerateInvoices: false,
    canRecordPayments: false,
    canLogExpenses: true,
    canDisburseAdvances: false,
    canViewReports: false,
    canViewSensitiveDriverInfo: false,
    canManageFleet: false,
  },
};

export function hasPermission(role: UserRole | undefined | null, permission: keyof RolePermissionSet): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return Boolean(perms[permission]);
}

export function canViewSensitiveDriverInfo(role: UserRole | undefined | null): boolean {
  return hasPermission(role, 'canViewSensitiveDriverInfo');
}

export function canManageFleet(role: UserRole | undefined | null): boolean {
  return hasPermission(role, 'canManageFleet');
}
