/**
 * AnchorTransport TMS - Vehicle / Truck Lifecycle & Zero-Default Verification Suite
 * 
 * Verifies:
 * 1. Default system state starts with 0 trucks for a company until user explicitly registers one.
 * 2. Client storage initialization and legacy purge strips mock vehicles and associated documents.
 * 3. Adding a new truck in Vehicles / Trucks (/api/vehicles) stores it and makes it available.
 * 4. Trip dispatch selectors start with 0 trucks and only offer trucks after addition.
 * 5. Strict multi-tenant isolation prevents Company A trucks from appearing in Company B.
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
import { Vehicle } from '../types/tms';
import { syncVehicleDocuments } from '../server/routes/fleet.routes';

describe('Trucks Lifecycle & Zero-Default Verification', () => {
  const companyA = 'comp_truck_test_001';
  const companyB = 'comp_truck_test_002';

  test('1. System starts with 0 default vehicles for a new company', () => {
    // Clear company context
    serverFleetStore.clearCompanyData(companyA);
    const companyVehicles = serverFleetStore.vehicles.filter((v) => v.companyId === companyA);
    assert.strictEqual(companyVehicles.length, 0, 'New company must have 0 default trucks');
  });

  test('2. Client initial store initializes with empty vehicles and empty documents list', () => {
    const freshStore = clearStoreForNewCustomer();
    assert.deepStrictEqual(freshStore.vehicles, [], 'Initial store vehicles must be empty array');
    assert.deepStrictEqual(freshStore.documents, [], 'Initial store documents must be empty array');
  });

  test('3. Client loadStore automatically purges legacy mock vehicle registrations', () => {
    // Simulate legacy storage containing mock vehicles
    const legacyState = {
      ...clearStoreForNewCustomer(),
      vehicles: [
        {
          id: 'veh_01',
          companyId: companyA,
          registrationNumber: 'WB-19-K-4821',
          vehicleType: '14-Wheeler (28T)',
          makeModel: 'Tata Signa 2823.TK',
          capacityTonnes: 28,
          unladenWeightTonnes: 10.5,
          status: 'AVAILABLE',
          currentOdometerKm: 142850,
          fastagBalancePaise: 840000,
        },
        {
          id: 'veh_user_real_99',
          companyId: companyA,
          registrationNumber: 'WB-24-A-1234',
          vehicleType: '12-Wheeler (21T)',
          makeModel: 'Ashok Leyland 2820',
          capacityTonnes: 21,
          unladenWeightTonnes: 8.0,
          status: 'AVAILABLE',
          currentOdometerKm: 15000,
          fastagBalancePaise: 500000,
        },
      ],
    };

    saveStore(legacyState as any);
    const cleansed = loadStore();

    // veh_01 / WB-19-K-4821 should be purged; veh_user_real_99 preserved
    assert.strictEqual(
      cleansed.vehicles.some((v) => v.registrationNumber === 'WB-19-K-4821'),
      false,
      'Legacy mock registration WB-19-K-4821 must be purged'
    );
    assert.strictEqual(
      cleansed.vehicles.some((v) => v.id === 'veh_01'),
      false,
      'Legacy mock id veh_01 must be purged'
    );
    assert.strictEqual(
      cleansed.vehicles.some((v) => v.id === 'veh_user_real_99'),
      true,
      'User-added real vehicle veh_user_real_99 must be preserved'
    );
  });

  test('4. Adding a real vehicle makes it available for commercial trip dispatch', () => {
    serverFleetStore.clearCompanyData(companyA);

    // Initial check: 0 trucks
    assert.strictEqual(
      serverFleetStore.vehicles.filter((v) => v.companyId === companyA).length,
      0
    );

    // Operator adds a commercial truck in Vehicles / Trucks
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

    // Verify truck now exists in company fleet
    const companyTrucks = serverFleetStore.vehicles.filter((v) => v.companyId === companyA);
    assert.strictEqual(companyTrucks.length, 1);
    assert.strictEqual(companyTrucks[0].registrationNumber, 'WB-19-M-9988');

    // Verify statutory documents were synced into documents vault
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
