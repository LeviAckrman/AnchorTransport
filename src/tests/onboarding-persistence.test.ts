/**
 * AnchorTransport TMS - Permanent Onboarding Status Persistence Tests
 *
 * Verifies:
 * 1. Newly registered users start with onboardingCompleted=false and needsOnboarding=true
 * 2. Logging in before onboarding keeps needsOnboarding=true
 * 3. Completing onboarding permanently sets onboardingCompleted=true in DB & data/auth-db.json
 * 4. Logout does NOT reset onboardingCompleted
 * 5. Refresh (/api/auth/me) and subsequent logins (/api/auth/login, /api/auth/session) go directly to dashboard (needsOnboarding=false)
 * 6. Persisted auth-db.json survives server restarts / browser close & reopen
 * 7. Returning users cannot have onboardingCompleted downgraded back to false
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { loadAuthDb } from '../server/authDb';
import { serverFleetStore } from '../server/store';
import { runAdminFirestore } from '../lib/firebase/admin';

const BASE_URL = 'http://127.0.0.1:3000';

async function req(
  method: string,
  urlPath: string,
  body?: any,
  token?: string
): Promise<{ status: number; data: any }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : '';
    const r = http.request(
      `${BASE_URL}${urlPath}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          let parsed: any = null;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode || 500, data: parsed });
        });
      }
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

describe('Permanent Onboarding Status Persistence', () => {
  it('safely skips Firestore hydration and Admin SDK writes without PERMISSION_DENIED or documentPath warnings', async () => {
    const warnings: string[] = [];
    const origWarn = console.warn;
    console.warn = (...args: any[]) => {
      warnings.push(args.map((a) => String(a)).join(' '));
    };
    try {
      await serverFleetStore.hydrateFromFirestore('');
      await serverFleetStore.hydrateFromFirestore('   ');
      await serverFleetStore.hydrateFromFirestore('invalid/path');
      await serverFleetStore.persistToFirestore('', 'vehicles', 'veh_1', { id: 'veh_1' });
      await serverFleetStore.persistToFirestore('comp_1', 'vehicles', '', { id: '' });
      await serverFleetStore.deleteFromFirestore('', 'vehicles', 'veh_1');
      await runAdminFirestore('Firestore user doc sync note', async () => {
        const permErr: any = new Error('7 PERMISSION_DENIED: Missing or insufficient permissions.');
        permErr.code = 7;
        throw permErr;
      });
    } finally {
      console.warn = origWarn;
    }

    const docPathOrPermErrors = warnings.filter(
      (w) =>
        w.includes('documentPath') ||
        w.includes('Hydration from Firestore note') ||
        w.includes('PERMISSION_DENIED') ||
        w.includes('Firestore user doc sync note')
    );
    assert.strictEqual(
      docPathOrPermErrors.length,
      0,
      `Unexpected Firestore warnings: ${docPathOrPermErrors.join('; ')}`
    );
  });

  it('tracks first-time onboarding -> permanent DB completion -> logout/refresh/re-login skip', async () => {
    const email = `onboard_persist_${Date.now()}@anchorfleet.in`;
    const password = 'TestPassword@123';

    // 1. Register new user without company -> shows onboarding screen on first entry
    const regRes = await req('POST', '/api/auth/register', {
      ownerEmail: email,
      ownerName: 'Priya Chatterjee',
      password,
      phone: '+91 98300 77889',
    });
    assert.strictEqual(regRes.status, 201);
    assert.strictEqual(regRes.data.needsOnboarding, true);
    assert.strictEqual(regRes.data.onboardingCompleted, false);

    // 1b. Pre-onboarding fleet queries with empty companyId return cleanly without errors
    const preVeh = await req('GET', '/api/vehicles?limit=10', undefined, regRes.data.token);
    assert.strictEqual(preVeh.status, 200);
    assert.deepStrictEqual(preVeh.data.data, []);

    // 2. First login before completing onboarding still shows onboarding
    const firstLogin = await req('POST', '/api/auth/login', { email, password });
    assert.strictEqual(firstLogin.status, 200);
    assert.strictEqual(firstLogin.data.needsOnboarding, true);
    assert.strictEqual(firstLogin.data.onboardingCompleted, false);

    // 3. Complete onboarding
    const rndDigits = Math.floor(1000 + Math.random() * 9000);
    const onboardRes = await req(
      'POST',
      '/api/auth/onboard-company',
      {
        companyName: 'Bengal Freight Movers Pvt Ltd',
        gstin: `19AABCB${rndDigits}B1Z5`,
        city: 'Kolkata',
        state: 'West Bengal',
        stateCode: '19',
        fleetSize: '10-25 Trucks',
      },
      firstLogin.data.token
    );
    assert.strictEqual(onboardRes.status, 201);
    assert.strictEqual(onboardRes.data.needsOnboarding, false);
    assert.strictEqual(onboardRes.data.onboardingCompleted, true);
    assert.strictEqual(onboardRes.data.user?.onboardingCompleted, true);
    const activeToken = onboardRes.data.token;

    // 4. Browser refresh / reopen (/api/auth/me) stays completed -> dashboard directly
    const meRes = await req('GET', '/api/auth/me', undefined, activeToken);
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.data.needsOnboarding, false);
    assert.strictEqual(meRes.data.onboardingCompleted, true);
    assert.ok(meRes.data.company?.id);

    // 5. Logout does NOT reset onboarding status
    const logoutRes = await req('POST', '/api/auth/logout', {});
    assert.strictEqual(logoutRes.status, 200);

    // 6. Subsequent login goes directly to dashboard (needsOnboarding === false)
    const secondLogin = await req('POST', '/api/auth/login', { email, password });
    assert.strictEqual(secondLogin.status, 200);
    assert.strictEqual(secondLogin.data.needsOnboarding, false);
    assert.strictEqual(secondLogin.data.onboardingCompleted, true);
    assert.strictEqual(secondLogin.data.user?.onboardingCompleted, true);
    assert.ok(secondLogin.data.company?.id);

    // 7. Firebase session sync with stale onboardingCompleted: false cannot downgrade completed user
    const sessionRes = await req('POST', '/api/auth/session', {
      email,
      name: 'Priya Chatterjee',
      onboardingCompleted: false,
    });
    assert.strictEqual(sessionRes.status, 200);
    assert.strictEqual(sessionRes.data.needsOnboarding, false);
    assert.strictEqual(sessionRes.data.onboardingCompleted, true);

    // 8. Verify persistence on disk in data/auth-db.json across simulated server restart
    const dbFile = path.resolve(process.cwd(), 'data', 'auth-db.json');
    assert.ok(fs.existsSync(dbFile), 'data/auth-db.json must exist on disk');
    const reloaded = loadAuthDb([], [], []);
    const savedUser = reloaded.users.find((u) => u.email === email);
    assert.ok(savedUser, 'User must be persisted in auth-db.json');
    assert.strictEqual(savedUser?.onboardingCompleted, true);
  });
});
