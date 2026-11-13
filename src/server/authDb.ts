/**
 * AnchorTransport TMS - Persistent Auth & Tenant Database Store
 * Persists user accounts, onboarding completion state, companies, and memberships
 * to disk so state survives server restarts, logouts, browser refreshes, and reopenings.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { StoredUser, StoredCompany, StoredCompanyUser } from './routes/auth.routes';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'auth-db.json');

export interface PersistedAuthDb {
  users: StoredUser[];
  companies: StoredCompany[];
  companyUsers: StoredCompanyUser[];
}

export function loadAuthDb(
  seedUsers: StoredUser[],
  seedCompanies: StoredCompany[],
  seedCompanyUsers: StoredCompanyUser[]
): PersistedAuthDb {
  const users: StoredUser[] = [];
  const companies: StoredCompany[] = [];
  const companyUsers: StoredCompanyUser[] = [];

  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.users)) users.push(...parsed.users);
      if (Array.isArray(parsed?.companies)) companies.push(...parsed.companies);
      if (Array.isArray(parsed?.companyUsers)) companyUsers.push(...parsed.companyUsers);
    }
  } catch (err) {
    console.warn('Auth DB load notice (initializing fresh store):', err);
  }

  for (const su of seedUsers) {
    if (!users.some((u) => u.id === su.id || u.email.toLowerCase() === su.email.toLowerCase())) {
      users.push({ ...su });
    }
  }

  for (const sc of seedCompanies) {
    if (!companies.some((c) => c.id === sc.id)) {
      companies.push({ ...sc });
    }
  }

  for (const scu of seedCompanyUsers) {
    if (
      !companyUsers.some(
        (m) => m.id === scu.id || (m.userId === scu.userId && m.companyId === scu.companyId)
      )
    ) {
      companyUsers.push({ ...scu });
    }
  }

  // Normalize onboardingCompleted: any user with an existing active company membership has completed onboarding
  for (const u of users) {
    if (u.onboardingCompleted === undefined) {
      const hasMembership = companyUsers.some((m) => m.userId === u.id && m.isActive);
      u.onboardingCompleted = hasMembership;
      if (hasMembership && !u.onboardingCompletedAt) {
        u.onboardingCompletedAt = new Date().toISOString();
      }
    }
  }

  return { users, companies, companyUsers };
}

export function persistAuthDb(
  users: StoredUser[],
  companies: StoredCompany[],
  companyUsers: StoredCompanyUser[]
): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const payload: PersistedAuthDb = {
      users,
      companies,
      companyUsers,
    };
    const tmpFile = `${DB_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmpFile, DB_FILE);
  } catch (err) {
    console.warn('Auth DB persist notice:', err);
  }
}
