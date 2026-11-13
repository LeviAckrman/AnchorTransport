/**
 * AnchorTransport TMS - Server-side Audit Logging & Security Service
 * 
 * Records immutable, tenant-isolated audit logs for critical operations:
 * - Entity creation, updates, and deletions
 * - Trip dispatch, delivery, and cancellation
 * - Driver settlements and advance disbursements
 * - Invoice creation, payment recording, and cancellations
 * - Security events (unauthorized access attempts, role modifications)
 */

import { serverFleetStore } from './store';
import { runAdminFirestore } from '../lib/firebase/admin';

export interface ServerAuditLog {
  id: string;
  companyId: string;
  userId: string;
  userName: string;
  action: 'CREATE' | 'UPDATE' | 'DELETE' | 'DISPATCH' | 'DELIVER' | 'SETTLE' | 'INVOICE' | 'PAYMENT' | 'CANCEL' | 'SECURITY';
  entityType: 'TRIP' | 'VEHICLE' | 'DRIVER' | 'CUSTOMER' | 'SETTLEMENT' | 'INVOICE' | 'PAYMENT' | 'EXPENSE' | 'ADVANCE' | 'COMPANY' | 'USER';
  entityId: string;
  summary: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
  timestamp: string;
}

export const serverAuditLogs: ServerAuditLog[] = [];

/**
 * Record an audit log entry in memory and persist to Firestore if available
 */
export async function logAuditEvent(params: {
  companyId: string;
  userId: string;
  userName: string;
  action: ServerAuditLog['action'];
  entityType: ServerAuditLog['entityType'];
  entityId: string;
  summary: string;
  metadata?: Record<string, any>;
  ipAddress?: string;
}): Promise<ServerAuditLog> {
  const entry: ServerAuditLog = {
    id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    companyId: params.companyId,
    userId: params.userId,
    userName: params.userName || 'System / Staff',
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId || '',
    summary: params.summary,
    metadata: params.metadata || {},
    ipAddress: params.ipAddress || '',
    timestamp: new Date().toISOString(),
  };

  serverAuditLogs.push(entry);

  // Firestore background sync
  if (
    typeof params.companyId === 'string' &&
    params.companyId.trim().length > 0 &&
    !params.companyId.includes('/') &&
    entry.id.trim().length > 0
  ) {
    const cleanData = JSON.parse(JSON.stringify(entry));
    await runAdminFirestore('Firestore audit log sync note', async (db) => {
      await db
        .collection('companies')
        .doc(params.companyId.trim())
        .collection('audit_logs')
        .doc(entry.id)
        .set(cleanData);
    });
  }

  return entry;
}

/**
 * Fetch company-isolated audit logs
 */
export function getCompanyAuditLogs(companyId: string, limit = 50): ServerAuditLog[] {
  return serverAuditLogs
    .filter((log) => log.companyId === companyId)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}
