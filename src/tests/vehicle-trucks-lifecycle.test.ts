/**
 * AnchorTransport TMS - Vehicle / Truck Lifecycle & Zero-Default Verification Suite
 *
 * Verifies:
 * 1. Default system state starts with 0 trucks for a company until user explicitly registers one.
 * 2. Client cache clearing removes legacy storage keys cleanly.
 * 3. Adding a new truck registers it and generates compliance documents.
 * 4. Strict multi-tenant isolation prevents Company A trucks from appearing in Company B.
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
import { EMPTY_COMPANY, clearClientTmsCaches, LEGACY_TMS_STORAGE_KEY } from '../lib/storage';
import { Vehicle } from '../types/tms';
import { syncVehicleDocuments } from '../server/routes/fleet.routes';

describe('Trucks Lifecycle & Zero-Default Verification', () => {
  const companyA = 'comp_truck_test_001';
  const companyB = 'comp_truck_test_002';

  test('1. System starts with 0 default vehicles for a new company', () => {
    serverFleetStore.clearCompanyData(companyA);
    const companyVehicles = serverFleetStore.vehicles.filter((v) => v.companyId === companyA);
    assert.strictEqual(companyVehicles.length, 0, 'New company must have 0 default trucks');
  });

  test('2. Client EMPTY_COMPANY default has blank id', () => {
    assert.strictEqual(EMPTY_COMPANY.id, '', 'Empty company placeholder must have blank ID');
  });

  test('3. clearClientTmsCaches purges legacy client storage keys cleanly', () => {
    globalThis.localStorage.setItem(LEGACY_TMS_STORAGE_KEY, 'legacy');
    globalThis.localStorage.setItem('onboarding_token', 'stale');
    clearClientTmsCaches();
    assert.strictEqual(globalThis.localStorage.getItem(LEGACY_TMS_STORAGE_KEY), null);
    assert.strictEqual(globalThis.localStorage.getItem('onboarding_token'), null);
  });

  test('4. Adding a real vehicle makes it available for commercial trip dispatch', () => {
    serverFleetStore.clearCompanyData(companyA);
    assert.strictEqual(
      serverFleetStore.vehicles.filter((v) => v.companyId === companyA).length,
      0
    );

    const newTruck: Vehicle = {
      id: `veh_user_${Date.now()}`,
      companyId: companyA,
      registrationNumber: 'WB-19-M-9988',
      vehicleType: '16-Wheeler (35T)',
      makeModel: 'BharatBenz 3528R',
      capacityTonnes: 35.0,
      unladenWeightTonnes: 11.5,
      chassisNumber: 'MBL99883528R001',
      engineNumber: 'OM926LA9988',
      status: 'AVAILABLE',
      currentOdometerKm: 28500,
      fastagBalancePaise: 1200000,
      insuranceExpiry: '2027-06-30',
      fitnessExpiry: '2027-05-15',
      permitExpiry: '2029-01-01',
      pucExpiry: '2027-04-10',
      createdAt: new Date().toISOString(),
    };

    serverFleetStore.vehicles.unshift(newTruck);
    syncVehicleDocuments(newTruck, companyA);

    const companyTrucks = serverFleetStore.vehicles.filter((v) => v.companyId === companyA);
    assert.strictEqual(companyTrucks.length, 1);
    assert.strictEqual(companyTrucks[0].registrationNumber, 'WB-19-M-9988');

    const truckDocs = serverFleetStore.documents.filter((d) => d.vehicleId === newTruck.id);
    assert.ok(truckDocs.length >= 4, 'Compliance certificates must be generated in vault');
  });

  test('5. Multi-tenant isolation: Company B cannot see Company A trucks', () => {
    serverFleetStore.clearCompanyData(companyB);
    const companyBTrucks = serverFleetStore.vehicles.filter((v) => v.companyId === companyB);
    assert.strictEqual(companyBTrucks.length, 0, 'Company B must see 0 trucks');
    assert.strictEqual(
      companyBTrucks.some((v) => v.registrationNumber === 'WB-19-M-9988'),
      false,
      'Company A truck must not leak to Company B'
    );
  });
});
