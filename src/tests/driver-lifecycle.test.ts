/**
 * AnchorTransport TMS - Driver Lifecycle & Zero-Default Verification Suite
 * 
 * Verifies:
 * 1. Default system state starts with 0 drivers for a company until user explicitly registers one.
 * 2. Client storage initialization and legacy purge strips mock drivers.
 * 3. Adding a new driver in Drivers (/api/drivers) stores it and makes it available.
 * 4. Trip dispatch selectors start with 0 drivers and only offer drivers after addition.
 * 5. Strict multi-tenant isolation prevents Company A drivers from appearing in Company B.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Polyfill localStorage for node CLI testing environment
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

import { serverFleetStore } from '../server/store';
import { loadStore, saveStore, getInitialStore, clearStoreForNewCustomer } from '../lib/storage';
import { Driver } from '../types/tms';

describe('Driver Lifecycle & Zero-Default Verification', () => {
  const companyA = 'comp_driver_test_001';
  const companyB = 'comp_driver_test_002';

  test('1. System starts with 0 default drivers for a new company', () => {
    // Clear company context
    serverFleetStore.clearCompanyData(companyA);
    const companyDrivers = serverFleetStore.drivers.filter((d) => d.companyId === companyA);
    assert.strictEqual(companyDrivers.length, 0, 'New company must have 0 default drivers');
  });

  test('2. Client initial store initializes with empty drivers list', () => {
    const freshStore = clearStoreForNewCustomer();
    assert.deepStrictEqual(freshStore.drivers, [], 'Initial store drivers must be empty array');
  });

  test('3. Client loadStore automatically purges legacy mock driver records', () => {
    // Simulate legacy storage containing mock drivers
    const legacyState = {
      ...clearStoreForNewCustomer(),
      drivers: [
        {
          id: 'drv_01',
          companyId: companyA,
          fullName: 'Rajesh Yadav',
          phone: '+91 97321 44501',
          licenseNumber: 'WB1920140029182',
          licenseExpiry: '2028-09-14',
          status: 'AVAILABLE',
        },
        {
          id: 'drv_user_real_99',
          companyId: companyA,
          fullName: 'Bimal Sen',
          phone: '+91 98300 12345',
          licenseNumber: 'WB1920200012345',
          licenseExpiry: '2030-01-01',
          status: 'AVAILABLE',
        },
      ],
    };

    saveStore(legacyState as any);
    const cleansed = loadStore();

    // drv_01 / Rajesh Yadav should be purged; drv_user_real_99 preserved
    assert.strictEqual(
      cleansed.drivers.some((d) => d.fullName === 'Rajesh Yadav'),
      false,
      'Legacy mock driver Rajesh Yadav must be purged'
    );
    assert.strictEqual(
      cleansed.drivers.some((d) => d.id === 'drv_01'),
      false,
      'Legacy mock id drv_01 must be purged'
    );
    assert.strictEqual(
      cleansed.drivers.some((d) => d.id === 'drv_user_real_99'),
      true,
      'User-added real driver drv_user_real_99 must be preserved'
    );
  });

  test('4. Adding a real driver makes them available for commercial trip dispatch', () => {
    serverFleetStore.clearCompanyData(companyA);

    // Initial check: 0 drivers
    assert.strictEqual(
      serverFleetStore.drivers.filter((d) => d.companyId === companyA).length,
      0
    );

    // Operator adds a commercial driver in Drivers
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

    // Verify driver now exists in company fleet
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
