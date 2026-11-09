/**
 * AnchorTransport TMS - Role-Based Access Control (RBAC) Permissions Matrix
 * Client-safe definitions without any Node.js dependencies
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

export const ROLE_PERMISSIONS: Record<UserRole, RolePermissionSet> = {
  OWNER: {
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
    canDisburseAdvances: false,
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
    canDisburseAdvances: true,
    canViewReports: false,
    canViewSensitiveDriverInfo: false,
    canManageFleet: false,
  },
};

export function hasPermission(role: UserRole, permission: keyof RolePermissionSet): boolean {
  return ROLE_PERMISSIONS[role]?.[permission] ?? false;
}

export function canViewSensitiveDriverInfo(role: UserRole): boolean {
  return hasPermission(role, 'canViewSensitiveDriverInfo');
}

export function canManageFleet(role: UserRole): boolean {
  return hasPermission(role, 'canManageFleet');
}
