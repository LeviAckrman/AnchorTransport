/**
 * AnchorTransport TMS - Firebase Phase 2 Automated Security & Authentication Test Suite
 * 
 * Verifies:
 * 1. User Registration with email and password
 * 2. Login & credential authentication with session cookie/token issuance
 * 3. Password reset initiation
 * 4. Trusted server-side company creation & assignment of OWNER role
 * 5. Strict rejection of unauthorized OWNER role self-assignment in existing companies (Privilege Escalation Guard)
 * 6. Cross-company access prevention (Multi-Tenant Isolation Guard)
 * 7. Unauthorized user access rejection (401 Unauthorized for unauthenticated requests)
 * 8. Session expiry and invalid/tampered token rejection
 * 9. Role-based access control (RBAC: Owner/Admin vs Accountant vs Operations)
 * 10. User profile retrieval and updating
 */

import http from 'http';
import jwt from 'jsonwebtoken';
import {
  serverUsers,
  serverCompanies,
  serverCompanyUsers,
} from '../server/routes/auth.routes';
import { signSessionToken, verifySessionToken, hashPassword } from '../server/auth';
import { UserRole } from '../types/tms';

const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

async function makeRequest(
  method: string,
  path: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; data: any; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const postData = body ? JSON.stringify(body) : '';
    const reqHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };
    if (postData) {
      reqHeaders['Content-Length'] = Buffer.byteLength(postData).toString();
    }

    const req = http.request(
      `${BASE_URL}${path}`,
      {
        method,
        headers: reqHeaders,
      },
      (res) => {
        let rawData = '';
        res.on('data', (chunk) => {
          rawData += chunk;
        });
        res.on('end', () => {
          let parsedData: any = rawData;
          try {
            parsedData = JSON.parse(rawData);
          } catch {
            // Raw text
          }
          resolve({
            status: res.statusCode || 500,
            data: parsedData,
            headers: res.headers,
          });
        });
      }
    );

    req.on('error', (err) => {
      reject(err);
    });

    if (postData) {
      req.write(postData);
    }
    req.end();
  });
}

async function runAuthPhase2Tests() {
  console.log('⚓ Starting AnchorTransport TMS - Firebase Phase 2 Auth & Security Suite...');
  console.log('========================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(description: string, condition: boolean, extra?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${description}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${description} ${extra ? `-> ${extra}` : ''}`);
      failed++;
    }
  }

  try {
    // -------------------------------------------------------------
    // Test 1: User Registration with Email and Password
    // -------------------------------------------------------------
    console.log('📋 Section 1: User Registration & Onboarding Initiation');
    const testOwnerEmail = `test_owner_${Date.now()}@anchorfleet.in`;
    const testPassword = 'SecurePassword@123';
    const testOwnerName = 'Rajeshwar Singha';

    const regRes = await makeRequest('POST', '/api/auth/register', {
      ownerEmail: testOwnerEmail,
      ownerName: testOwnerName,
      password: testPassword,
      phone: '+91 98311 00000',
    });

    assert('Registration: Status 201 Created', regRes.status === 201);
    assert('Registration: Success response flag', regRes.data.success === true);
    assert('Registration: User email matches', regRes.data.user?.email === testOwnerEmail);
    assert('Registration: needsOnboarding flag set for user without company', regRes.data.needsOnboarding === true);
    assert('Registration: Temporary onboarding token issued', typeof regRes.data.token === 'string');

    const newOwnerUserId = regRes.data.user?.id;
    const initialToken = regRes.data.token;

    // -------------------------------------------------------------
    // Test 2: Login with Email & Password
    // -------------------------------------------------------------
    console.log('\n📋 Section 2: User Login & Session Handling');
    const loginRes = await makeRequest('POST', '/api/auth/login', {
      email: testOwnerEmail,
      password: testPassword,
    });

    assert('Login: Status 200 OK', loginRes.status === 200);
    assert('Login: Success response flag', loginRes.data.success === true);
    assert('Login: User correctly identified', loginRes.data.user?.email === testOwnerEmail);
    assert('Login: Session cookie or token returned', typeof loginRes.data.token === 'string');

    // Test Login with Invalid Password
    const invalidLoginRes = await makeRequest('POST', '/api/auth/login', {
      email: testOwnerEmail,
      password: 'WrongPassword@999',
    });
    assert('Login: Rejects invalid password with 401 Unauthorized', invalidLoginRes.status === 401);

    // -------------------------------------------------------------
    // Test 3: Password Reset Flow
    // -------------------------------------------------------------
    console.log('\n📋 Section 3: Password Reset');
    const resetRes = await makeRequest('POST', '/api/auth/password-reset', {
      email: testOwnerEmail,
    });
    assert('Password Reset: Status 200 OK', resetRes.status === 200);
    assert('Password Reset: Returns success confirmation message', resetRes.data.success === true);

    const nonExistentReset = await makeRequest('POST', '/api/auth/password-reset', {
      email: 'nonexistent_user_9999@unknown.com',
    });
    assert('Password Reset: Returns 404 for nonexistent email', nonExistentReset.status === 404);

    // -------------------------------------------------------------
    // Test 4: Trusted Server-Side Company Creation & OWNER Role Assignment
    // -------------------------------------------------------------
    console.log('\n📋 Section 4: Trusted Company Creation & OWNER Assignment');
    const randomGstinDigits = Math.floor(1000 + Math.random() * 9000);
    const companyGstin = `19AAAAA${randomGstinDigits}A1Z5`;
    const onboardRes = await makeRequest(
      'POST',
      '/api/auth/onboard-company',
      {
        companyName: 'Singha Transport Heavy Haulers',
        tradeName: 'Singha Haulers',
        gstin: companyGstin,
        city: 'Durgapur',
        state: 'West Bengal',
        stateCode: '19',
        fleetSize: '25-50 Trucks',
        lrPrefix: 'ST/25-26/',
        invoicePrefix: 'INV/25-26/',
      },
      {
        Authorization: `Bearer ${initialToken}`,
      }
    );

    assert('Onboarding: Status 201 Created', onboardRes.status === 201);
    assert('Onboarding: Returns company record', Boolean(onboardRes.data.company?.id));
    assert('Onboarding: User assigned OWNER role by trusted server code', onboardRes.data.role === 'OWNER');
    assert('Onboarding: New session token issued with OWNER claims', typeof onboardRes.data.token === 'string');

    const createdCompanyId = onboardRes.data.company.id;
    const ownerActiveToken = onboardRes.data.token;

    // Verify membership stored in company records via authenticated API
    const membersRes = await makeRequest('GET', '/api/company/users', undefined, {
      Authorization: `Bearer ${ownerActiveToken}`,
    });
    assert('Membership: Successfully fetched company users via API', membersRes.status === 200);
    const ownerMember = membersRes.data.users?.find((u: any) => u.userId === newOwnerUserId);
    assert('Membership: Verified stored with role=OWNER in server records', ownerMember?.role === 'OWNER');

    // -------------------------------------------------------------
    // Test 5: Privilege Escalation Guard
    // -------------------------------------------------------------
    console.log('\n📋 Section 5: Privilege Escalation Guard (No Self-Assigned OWNER in Existing Company)');
    
    // Register a secondary staff user
    const staffEmail = `staff_${Date.now()}@anchorfleet.in`;
    const staffReg = await makeRequest('POST', '/api/auth/register', {
      ownerEmail: staffEmail,
      ownerName: 'Manish Verma Staff',
      password: 'StaffPassword@123',
    });
    const staffToken = staffReg.data.token;

    // Staff attempts to join the existing company claiming 'OWNER'
    const escalationAttempt = await makeRequest(
      'POST',
      '/api/auth/join-company',
      {
        companyId: createdCompanyId,
        requestedRole: 'OWNER',
      },
      {
        Authorization: `Bearer ${staffToken}`,
      }
    );

    assert('Privilege Guard: Rejects user attempting to self-assign OWNER with 403 Forbidden', escalationAttempt.status === 403);
    assert('Privilege Guard: Error explicitly forbids self-assignment of OWNER', escalationAttempt.data.error.includes('OWNER'));

    // Staff joins legitimately with allowed non-owner role
    const legitimateJoin = await makeRequest(
      'POST',
      '/api/auth/join-company',
      {
        companyId: createdCompanyId,
        requestedRole: 'OPERATIONS',
      },
      {
        Authorization: `Bearer ${staffToken}`,
      }
    );
    assert('Legitimate Join: Staff allowed to join as OPERATIONS', legitimateJoin.status === 201 && legitimateJoin.data.role === 'OPERATIONS');

    // -------------------------------------------------------------
    // Test 6: Cross-Company Access Isolation Guard
    // -------------------------------------------------------------
    console.log('\n📋 Section 6: Cross-Company Tenant Isolation Guard');

    // Target Company 2 from seed: 'comp_od_kalinga_002'
    // Staff belongs only to createdCompanyId, NOT 'comp_od_kalinga_002'
    const crossCompanySwitch = await makeRequest(
      'POST',
      '/api/auth/switch-company',
      {
        targetCompanyId: 'comp_od_kalinga_002',
      },
      {
        Authorization: `Bearer ${staffToken}`,
      }
    );

    assert('Tenant Isolation: Blocks user switching to unauthorized tenant with 403 Forbidden', crossCompanySwitch.status === 403);
    assert('Tenant Isolation: Clear isolation violation error message', crossCompanySwitch.data.error.includes('Unauthorized'));

    // -------------------------------------------------------------
    // Test 7: Unauthorized Access Rejection (No Token)
    // -------------------------------------------------------------
    console.log('\n📋 Section 7: Unauthenticated Route Protection');
    const unauthRes = await makeRequest('GET', '/api/auth/me');
    assert('Route Protection: Rejects request without token with 401 Unauthorized', unauthRes.status === 401);

    // -------------------------------------------------------------
    // Test 8: Session Expiry / Tampered Token Rejection
    // -------------------------------------------------------------
    console.log('\n📋 Section 8: Invalid and Expired Token Rejection');
    const tamperedToken = `${ownerActiveToken.substring(0, ownerActiveToken.length - 8)}fakefake`;
    const tamperedRes = await makeRequest('GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${tamperedToken}`,
    });
    assert('Token Security: Rejects tampered session token with 401 Unauthorized', tamperedRes.status === 401);

    // Expired token test
    const expiredToken = jwt.sign(
      { userId: newOwnerUserId, email: testOwnerEmail, name: testOwnerName, companyId: createdCompanyId, role: 'OWNER' },
      process.env.JWT_SECRET || 'anchortransport_dev_secret_key_2026_wb',
      { expiresIn: '-1s' }
    );
    const expiredRes = await makeRequest('GET', '/api/auth/me', undefined, {
      Authorization: `Bearer ${expiredToken}`,
    });
    assert('Token Security: Rejects expired session token with 401 Unauthorized', expiredRes.status === 401);
    assert('Token Security: Indicates session expired', expiredRes.data.error.toLowerCase().includes('expired'));

    // -------------------------------------------------------------
    // Test 9: Role-Based Authorization Gates (RBAC)
    // -------------------------------------------------------------
    console.log('\n📋 Section 9: Role-Based Access Control (RBAC)');

    // Owner performs profile update on company
    const ownerUpdateRes = await makeRequest(
      'PUT',
      '/api/company/profile',
      {
        tradeName: 'Singha Heavy Haulers Premier',
        phone: '+91 98311 99999',
      },
      {
        Authorization: `Bearer ${ownerActiveToken}`,
      }
    );
    assert('RBAC: OWNER allowed to update company profile (200 OK)', ownerUpdateRes.status === 200);

    // Staff with OPERATIONS role attempts company profile update
    const staffOpsToken = signSessionToken({
      userId: staffReg.data.user.id,
      email: staffEmail,
      name: 'Manish Verma Staff',
      companyId: createdCompanyId,
      role: 'OPERATIONS',
    });
    const staffForbiddenUpdate = await makeRequest(
      'PUT',
      '/api/company/profile',
      {
        tradeName: 'Hacked Name',
      },
      {
        Authorization: `Bearer ${staffOpsToken}`,
      }
    );
    assert('RBAC: Non-owner/admin (OPERATIONS) blocked from company profile update with 403 Forbidden', staffForbiddenUpdate.status === 403);

    // -------------------------------------------------------------
    // Test 10: User Profile Management & Logout
    // -------------------------------------------------------------
    console.log('\n📋 Section 10: User Profile Management & Session Termination');
    const profileUpdateRes = await makeRequest(
      'PATCH',
      '/api/auth/profile',
      {
        name: 'Rajeshwar Singha (Fleet Director)',
        phone: '+91 98311 88888',
      },
      {
        Authorization: `Bearer ${ownerActiveToken}`,
      }
    );
    assert('Profile: User successfully updates display name & phone (200 OK)', profileUpdateRes.status === 200);
    assert('Profile: Updated name reflected', profileUpdateRes.data.user?.name.includes('Fleet Director'));

    const logoutRes = await makeRequest('POST', '/api/auth/logout');
    assert('Logout: Successfully clears session (200 OK)', logoutRes.status === 200);

    // Summary
    console.log('\n========================================================================');
    console.log(`📊 Firebase Phase 2 Auth Test Suite Results: ${passed} PASSED, ${failed} FAILED`);
    console.log('========================================================================');

    if (failed > 0) {
      process.exit(1);
    }
  } catch (err) {
    console.error('Unhandled exception in Auth Phase 2 test suite:', err);
    process.exit(1);
  }
}

runAuthPhase2Tests();
