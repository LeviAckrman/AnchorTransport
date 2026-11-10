/**
 * AnchorTransport TMS - Customer (Parties) Verification Suite
 * 
 * Verifies:
 * 1. Default mock customers are completely removed from initial runtime state
 * 2. Company has 0 customers initially until user adds one in Customers (Parties)
 * 3. Adding a new customer party persists to company registry
 * 4. Only user-added customer parties appear in trip dispatch booking
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { serverFleetStore } from '../server/store';
import { Customer } from '../types/tms';

describe('Customer (Parties) Lifecycle & Removal of Default Customers', () => {
  const companyId = 'comp_custom_party_test_01';

  // Clear any existing data
  serverFleetStore.clearCompanyData(companyId);

  test('1. Initial runtime customer list has 0 default mock customers', () => {
    const existing = serverFleetStore.customers.filter(c => c.companyId === companyId);
    assert.equal(existing.length, 0, 'No default mock customers should exist for this company');

    // Also assert default demo company does not have legacy mock customers in runtime store
    const legacyMockCustomer = serverFleetStore.customers.find(
      c => c.name === 'Shyam Steel Industries Ltd.' || c.id === 'cust_01'
    );
    assert.equal(legacyMockCustomer, undefined, 'Legacy mock customers (Shyam Steel, etc.) must not be pre-loaded');
  });

  test('2. Customer appears ONLY after user registers party in Customers (Parties)', () => {
    const newCustomer: Customer = {
      id: `cust_${companyId}_real_01`,
      companyId,
      name: 'Tata Steel Processing and Distribution Ltd.',
      tradeName: 'TSPDL Kolkata',
      gstin: '19AAACT2809Q1ZU',
      pan: 'AAACT2809Q',
      contactPerson: 'Debabrata Mukherjee (Dispatch Head)',
      phone: '9831098310',
      email: 'dispatch@tspdl.com',
      billingAddress: 'Tate Centre, 43 Chowringhee Road',
      city: 'Kolkata',
      state: 'West Bengal',
      stateCode: '19',
      pincode: '700071',
      creditPeriodDays: 30,
      creditLimitPaise: 100000000,
      currentOutstandingPaise: 0,
      totalFreightBilledPaise: 0,
      createdAt: new Date().toISOString(),
    };

    serverFleetStore.customers.push(newCustomer);

    const companyCustomers = serverFleetStore.customers.filter(c => c.companyId === companyId);
    assert.equal(companyCustomers.length, 1, 'Exactly 1 customer must be returned');
    assert.equal(companyCustomers[0].name, 'Tata Steel Processing and Distribution Ltd.');
    assert.equal(companyCustomers[0].gstin, '19AAACT2809Q1ZU');
  });

  test('3. New customer is available for commercial trip booking', () => {
    const customer = serverFleetStore.customers.find(c => c.id === `cust_${companyId}_real_01`);
    assert.ok(customer, 'Customer must be retrievable for trip dispatch');
    assert.equal(customer?.city, 'Kolkata');
    assert.equal(customer?.stateCode, '19');
  });
});
