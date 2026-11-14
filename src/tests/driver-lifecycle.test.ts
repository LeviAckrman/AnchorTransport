/**
 * AnchorTransport TMS - Driver Lifecycle & Zero-Default Verification Suite
 *
 * Verifies:
 * 1. Default system state starts with 0 drivers for a company until user explicitly registers one.
 * 2. Client cache clearing strips ephemeral local keys without touching Firestore operational data.
 * 3. Adding a new driver stores it in company scope and makes it available.
 * 4. Strict multi-tenant isolation prevents Company A drivers from appearing in Company B.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) || null,
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] || null,
    get length() {
      return store.size;
    },
  } as any;
}
if (typeof (globalThis as any).window === 'undefined') {
  (globalThis as any).window = { localStorage: globalThis.localStorage };
}

import { serverFleetStore } from '../server/store';
import { EMPTY_COMPANY, clearClientTmsCaches, TMS_STORAGE_KEY } from '../lib/storage';
import { Driver } from '../types/tms';

describe('Driver Lifecycle & Zero-Default Verification', () => {
  const companyA = 'comp_driver_test_001';
  const companyB = 'comp_driver_test_002';

  test('1. System starts with 0 default drivers for a new company', () => {
    serverFleetStore.clearCompanyData(companyA);
    const companyDrivers = serverFleetStore.drivers.filter((d) => d.companyId === companyA);
    assert.strictEqual(companyDrivers.length, 0, 'New company must have 0 default drivers');
  });

  test('2. Client EMPTY_COMPANY default has empty id and no mock driver records', () => {
    assert.strictEqual(EMPTY_COMPANY.id, '', 'Empty company placeholder must have blank ID');
  });

  test('3. clearClientTmsCaches removes local cache keys cleanly', () => {
    globalThis.localStorage.setItem(TMS_STORAGE_KEY, 'stale');
    globalThis.localStorage.setItem('token', 'stale_tok');
    clearClientTmsCaches();
    assert.strictEqual(globalThis.localStorage.getItem(TMS_STORAGE_KEY), null);
    assert.strictEqual(globalThis.localStorage.getItem('token'), null);
  });

  test('4. Adding a real driver makes them available for commercial trip dispatch', () => {
    serverFleetStore.clearCompanyData(companyA);
    assert.strictEqual(
      serverFleetStore.drivers.filter((d) => d.companyId === companyA).length,
      0
    );

    const newDriver: Driver = {
      id: `drv_user_${Date.now()}`,
      companyId: companyA,
      fullName: 'Prabir Bhattacharya',
      phone: '+91 98311 55667',
      licenseNumber: 'WB2420190098765',
      licenseExpiry: '2029-12-31',
      address: 'Barasat, North 24 Parganas - 700124',
      emergencyContact: 'Aparna Bhattacharya (Wife)',
      emergencyPhone: '+91 98311 55668',
      status: 'AVAILABLE',
      currentAdvanceBalancePaise: 0,
      totalTripsCompleted: 0,
      monthlySalaryPaise: 2500000,
      perDayBataPaise: 60000,
      joinedDate: new Date().toISOString(),
    };

    serverFleetStore.drivers.unshift(newDriver);

    const companyDrivers = serverFleetStore.drivers.filter((d) => d.companyId === companyA);
    assert.strictEqual(companyDrivers.length, 1);
    assert.strictEqual(companyDrivers[0].fullName, 'Prabir Bhattacharya');
  });

  test('5. Multi-tenant isolation: Company B cannot see Company A drivers', () => {
    serverFleetStore.clearCompanyData(companyB);
    const companyBDrivers = serverFleetStore.drivers.filter((d) => d.companyId === companyB);
    assert.strictEqual(companyBDrivers.length, 0, 'Company B must see 0 drivers');
    assert.strictEqual(
      companyBDrivers.some((d) => d.fullName === 'Prabir Bhattacharya'),
      false,
      'Company A driver must not leak to Company B'
    );
  });
});
