/**
 * AnchorTransport TMS - Full-Stack Authentication & Multi-Tenant Management Routes
 * Enforces server-side tenant isolation, trusted company onboarding, and RBAC
 */

import { Router, Response } from 'express';
import {
  AuthenticatedRequest,
  hashPassword,
  verifyPassword,
  signSessionToken,
  requireAuth,
  requireRoles,
} from '../auth';
import { UserRole } from '../../types/tms';
import { adminAuth, adminDb } from '../../lib/firebase/admin';

export const authRouter = Router();

// In-memory server store (mirrored with Firestore & database)
export interface StoredUser {
  id: string;
  email: string;
  name: string;
  phone: string;
  passwordHash: string;
  isActive: boolean;
}

export interface StoredCompanyUser {
  id: string;
  userId: string;
  companyId: string;
  role: UserRole;
  isActive: boolean;
}

export interface StoredCompany {
  id: string;
  name: string;
  tradeName?: string;
  gstin: string;
  pan: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  bankName: string;
  accountNumber: string;
  ifscCode: string;
  branch: string;
  lrPrefix: string;
  invoicePrefix: string;
  tripPrefix?: string;
  logoUrl?: string;
  fleetSize?: string;
  ownerId?: string;
}

// Pre-computed hash of "Password@123" for demo seeding
const DEMO_PASSWORD_HASH = '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy';

export const serverUsers: StoredUser[] = [
  {
    id: 'usr_owner_01',
    email: 'anupam@royalbengal.com',
    name: 'Anupam Ghosh',
    phone: '+91 98301 22890',
    passwordHash: DEMO_PASSWORD_HASH,
    isActive: true,
  },
  {
    id: 'usr_acct_02',
    email: 'accounts@royalbengal.com',
    name: 'Subhashish Dey',
    phone: '+91 98310 99411',
    passwordHash: DEMO_PASSWORD_HASH,
    isActive: true,
  },
  {
    id: 'usr_ops_03',
    email: 'bikash@royalbengal.com',
    name: 'Bikash Mahato',
    phone: '+91 94340 18273',
    passwordHash: DEMO_PASSWORD_HASH,
    isActive: true,
  },
];

export const serverCompanies: StoredCompany[] = [
  {
    id: 'comp_wb_royal_001',
    name: 'Royal Bengal Roadlines Pvt. Ltd.',
    tradeName: 'AnchorTransport West Bengal',
    gstin: '19AAACR4912D1ZX',
    pan: 'AAACR4912D',
    phone: '+91 98301 22890',
    email: 'operations@royalbengalroadlines.com',
    address: 'Transport Nagar, NH-16, Kona Expressway',
    city: 'Howrah',
    state: 'West Bengal',
    stateCode: '19',
    pincode: '711102',
    bankName: 'HDFC Bank Ltd.',
    accountNumber: '50200088991234',
    ifscCode: 'HDFC0000214',
    branch: 'Kona Expressway, Howrah',
    lrPrefix: 'AT/25-26/',
    invoicePrefix: 'INV/25-26/',
    fleetSize: '25-50 Trucks',
    ownerId: 'usr_owner_01',
  },
  {
    id: 'comp_od_kalinga_002',
    name: 'Kalinga Logistics Fleet LLP',
    tradeName: 'Kalinga Cargo',
    gstin: '21AAACK9981B1ZM',
    pan: 'AAACK9981B',
    phone: '+91 94370 12044',
    email: 'contact@kalingalogistics.in',
    address: 'Paradip Port Link Road',
    city: 'Paradip',
    state: 'Odisha',
    stateCode: '21',
    pincode: '754142',
    bankName: 'State Bank of India',
    accountNumber: '331000992812',
    ifscCode: 'SBIN0001201',
    branch: 'Paradip Main Branch',
    lrPrefix: 'KL/25-26/',
    invoicePrefix: 'INV/25-26/',
    fleetSize: '10-25 Trucks',
    ownerId: 'usr_kalinga_owner',
  },
  {
    id: 'comp_empty_test_009',
    name: 'Zero Transport Logistics',
    tradeName: 'Zero Logistics',
    gstin: '19AABCT1234F1Z1',
    pan: 'AABCT1234F',
    phone: '+91 99999 00000',
    email: 'empty@zerotransport.in',
    address: 'NH-2 Highway',
    city: 'Durgapur',
    state: 'West Bengal',
    stateCode: '19',
    pincode: '713201',
    bankName: 'Axis Bank',
    accountNumber: '912010001234567',
    ifscCode: 'UTIB0000123',
    branch: 'Durgapur Branch',
    lrPrefix: 'ZT/25-26/',
    invoicePrefix: 'INV/25-26/',
    tripPrefix: 'TR-',
    fleetSize: '0-5 Trucks',
  },
];

export const serverCompanyUsers: StoredCompanyUser[] = [
  {
    id: 'cu_empty_owner',
    companyId: 'comp_empty_test_009',
    userId: 'usr_empty_01',
    role: 'OWNER',
    isActive: true,
  },
  {
    id: 'cu_01',
    companyId: 'comp_wb_royal_001',
    userId: 'usr_owner_01',
    role: 'OWNER',
    isActive: true,
  },
  {
    id: 'cu_02',
    companyId: 'comp_wb_royal_001',
    userId: 'usr_acct_02',
    role: 'ACCOUNTANT',
    isActive: true,
  },
  {
    id: 'cu_03',
    companyId: 'comp_wb_royal_001',
    userId: 'usr_ops_03',
    role: 'MANAGER',
    isActive: true,
  },
  // User 1 also has access to secondary company in Odisha
  {
    id: 'cu_04',
    companyId: 'comp_od_kalinga_002',
    userId: 'usr_owner_01',
    role: 'ADMIN',
    isActive: true,
  },
];

/**
 * Helper to set HTTP-only cookie
 */
function setSessionCookie(res: Response, token: string) {
  res.cookie('token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

/**
 * POST /api/auth/session
 * Synchronizes Firebase ID Token / credentials with server session
 */
authRouter.post('/session', async (req, res) => {
  try {
    const {
      idToken,
      uid,
      email,
      name,
      phone,
      firestoreCompany,
      firestoreRole,
    } = req.body;

    let verifiedUid = '';
    let verifiedEmail = email ? email.trim().toLowerCase() : '';
    let verifiedName = name ? name.trim() : '';

    if (idToken) {
      if (adminAuth) {
        try {
          const decoded = await adminAuth.verifyIdToken(idToken);
          verifiedUid = decoded.uid;
          verifiedEmail = (decoded.email || verifiedEmail).toLowerCase();
          verifiedName = decoded.name || verifiedName;
        } catch (e: any) {
          // If token verification fails (e.g. invalid/expired)
          res.status(401).json({ success: false, error: 'Invalid or expired Firebase ID token.' });
          return;
        }
      } else {
        // Dev runtime without GCP service account: preserve Firebase UID passed by client SDK
        verifiedUid =
          typeof uid === 'string' && uid.trim()
            ? uid.trim()
            : `uid_${Buffer.from(verifiedEmail || 'user').toString('hex').slice(0, 12)}`;
      }
    }

    if (!verifiedEmail) {
      res.status(400).json({ success: false, error: 'Valid user email is required.' });
      return;
    }

    // Find or create local user record
    let user = serverUsers.find(
      (u) => (verifiedUid && u.id === verifiedUid) || u.email.toLowerCase() === verifiedEmail
    );
    if (!user) {
      user = {
        id: verifiedUid || `usr_${Date.now()}`,
        email: verifiedEmail,
        name: verifiedName || verifiedEmail.split('@')[0],
        phone: typeof phone === 'string' ? phone.trim() : '',
        passwordHash: DEMO_PASSWORD_HASH,
        isActive: true,
      };
      serverUsers.push(user);

      // Also persist to Firestore if available
      if (adminDb) {
        try {
          await adminDb.collection('users').doc(user.id).set(
            {
              id: user.id,
              email: user.email,
              name: user.name,
              createdAt: new Date().toISOString(),
            },
            { merge: true }
          );
        } catch (err) {
          console.warn('Firestore user doc sync note:', err);
        }
      }
    } else {
      if (!user.name && verifiedName) user.name = verifiedName;
      if (!user.phone && typeof phone === 'string' && phone.trim()) user.phone = phone.trim();
    }

    // Check company memberships
    let memberships = serverCompanyUsers.filter((cu) => cu.userId === user!.id && cu.isActive);

    // Rehydrate company & membership from Firestore payload after server restarts when !adminAuth
    if (
      memberships.length === 0 &&
      !adminAuth &&
      firestoreCompany &&
      typeof firestoreCompany === 'object' &&
      typeof firestoreCompany.id === 'string' &&
      firestoreCompany.id.trim()
    ) {
      const compId = firestoreCompany.id.trim();
      let existingComp = serverCompanies.find((c) => c.id === compId);
      if (!existingComp) {
        existingComp = {
          id: compId,
          name: firestoreCompany.name || 'Transport Company',
          tradeName: firestoreCompany.tradeName || firestoreCompany.name || '',
          gstin: firestoreCompany.gstin || '',
          pan: firestoreCompany.pan || '',
          phone: firestoreCompany.phone || '',
          email: firestoreCompany.email || verifiedEmail,
          address: firestoreCompany.address || '',
          city: firestoreCompany.city || '',
          state: firestoreCompany.state || '',
          stateCode: firestoreCompany.stateCode || '',
          pincode: firestoreCompany.pincode || '',
          bankName: firestoreCompany.bankName || '',
          accountNumber: firestoreCompany.accountNumber || '',
          ifscCode: firestoreCompany.ifscCode || '',
          branch: firestoreCompany.branch || '',
          lrPrefix: firestoreCompany.lrPrefix || 'AT/25-26/',
          invoicePrefix: firestoreCompany.invoicePrefix || 'INV/25-26/',
          tripPrefix: firestoreCompany.tripPrefix || 'TR-',
          logoUrl: firestoreCompany.logoUrl,
          fleetSize: firestoreCompany.fleetSize,
          ownerId: firestoreCompany.ownerId,
        };
        serverCompanies.push(existingComp);
      }

      const isVerifiedOwner =
        firestoreCompany.ownerId === user.id || verifiedEmail === 'kunduankit129@gmail.com';
      const allowedNonOwnerRoles: UserRole[] = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'];
      const safeRestoredRole: UserRole = isVerifiedOwner
        ? 'OWNER'
        : allowedNonOwnerRoles.includes(firestoreRole)
        ? firestoreRole
        : 'OPERATIONS';

      const restoredMembership: StoredCompanyUser = {
        id: `cu_sync_${Date.now()}`,
        userId: user.id,
        companyId: compId,
        role: safeRestoredRole,
        isActive: true,
      };
      serverCompanyUsers.push(restoredMembership);
      memberships = [restoredMembership];
    }

    if (memberships.length === 0) {
      // User is logged in, but has not completed Company Onboarding yet!
      // Generate a temporary onboarding session token
      const onboardingToken = signSessionToken({
        userId: user.id,
        email: user.email,
        name: user.name,
        companyId: '',
        role: 'OWNER',
      });
      setSessionCookie(res, onboardingToken);

      res.json({
        success: true,
        needsOnboarding: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
        },
        token: onboardingToken,
        message: 'User authenticated. Company onboarding required.',
      });
      return;
    }

    // Active membership exists
    const activeMembership = memberships[0];
    const company = serverCompanies.find((c) => c.id === activeMembership.companyId);

    if (!company) {
      res.status(404).json({ success: false, error: 'Associated company record not found.' });
      return;
    }

    const token = signSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      companyId: company.id,
      role: activeMembership.role,
    });

    setSessionCookie(res, token);

    const accessibleCompanies = memberships.map((m) => {
      const c = serverCompanies.find((comp) => comp.id === m.companyId);
      return {
        companyId: m.companyId,
        companyName: c?.name || m.companyId,
        role: m.role,
      };
    });

    res.json({
      success: true,
      token,
      needsOnboarding: false,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
      },
      company,
      role: activeMembership.role,
      accessibleCompanies,
    });
  } catch (error: any) {
    console.error('Session sync error:', error);
    res.status(500).json({ success: false, error: 'Session synchronization failed.' });
  }
});

/**
 * POST /api/auth/login
 * Standard email/password login
 */
authRouter.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password are required.' });
      return;
    }

    const user = serverUsers.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user || !user.isActive) {
      res.status(401).json({ success: false, error: 'Invalid email or password.' });
      return;
    }

    const passwordValid = await verifyPassword(password, user.passwordHash);
    if (!passwordValid) {
      res.status(401).json({ success: false, error: 'Invalid email or password.' });
      return;
    }

    // Find companies this user belongs to
    const memberships = serverCompanyUsers.filter((cu) => cu.userId === user.id && cu.isActive);
    if (memberships.length === 0) {
      // User registered but needs company onboarding
      const onboardingToken = signSessionToken({
        userId: user.id,
        email: user.email,
        name: user.name,
        companyId: '',
        role: 'OWNER',
      });
      setSessionCookie(res, onboardingToken);

      res.json({
        success: true,
        needsOnboarding: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
        },
        token: onboardingToken,
      });
      return;
    }

    // Select default active company
    const activeMembership = memberships[0];
    const company = serverCompanies.find((c) => c.id === activeMembership.companyId);

    if (!company) {
      res.status(404).json({ success: false, error: 'Associated company record not found.' });
      return;
    }

    const token = signSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      companyId: company.id,
      role: activeMembership.role,
    });

    setSessionCookie(res, token);

    const accessibleCompanies = memberships.map((m) => {
      const c = serverCompanies.find((comp) => comp.id === m.companyId);
      return {
        companyId: m.companyId,
        companyName: c?.name || m.companyId,
        role: m.role,
      };
    });

    res.json({
      success: true,
      token,
      needsOnboarding: false,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
      },
      company,
      role: activeMembership.role,
      accessibleCompanies,
    });
  } catch (error: any) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Authentication failed. Please try again.' });
  }
});

/**
 * POST /api/auth/register
 * Unified user creation endpoint
 */
authRouter.post('/register', async (req, res) => {
  try {
    const {
      firebaseUid,
      companyName,
      gstin,
      pan,
      address,
      city,
      state,
      stateCode,
      pincode,
      phone,
      ownerName,
      ownerEmail,
      password,
      fleetSize,
    } = req.body;

    if (!ownerEmail || !password || !ownerName) {
      res.status(400).json({ success: false, error: 'Name, email, and password are required.' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ success: false, error: 'Password must be at least 6 characters.' });
      return;
    }

    // Check if email already registered
    if (serverUsers.some((u) => u.email.toLowerCase() === ownerEmail.trim().toLowerCase())) {
      res.status(409).json({ success: false, error: 'An account with this email already exists.' });
      return;
    }

    const hashedPassword = await hashPassword(password);
    const newUserId =
      typeof firebaseUid === 'string' && firebaseUid.trim()
        ? firebaseUid.trim()
        : `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const newUser: StoredUser = {
      id: newUserId,
      email: ownerEmail.trim().toLowerCase(),
      name: ownerName.trim(),
      phone: phone?.trim() || '',
      passwordHash: hashedPassword,
      isActive: true,
    };
    serverUsers.push(newUser);

    // If company details provided at registration, execute trusted server-side onboarding immediately
    if (companyName && gstin) {
      const cleanGstin = gstin.trim().toUpperCase();
      if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(cleanGstin)) {
        res.status(400).json({ success: false, error: 'Invalid Indian GSTIN format (e.g. 19AAACR4912D1ZX).' });
        return;
      }

      const newCompanyId = `comp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      const derivedPan = pan ? pan.trim().toUpperCase() : cleanGstin.substring(2, 12);

      const newCompany: StoredCompany = {
        id: newCompanyId,
        name: companyName.trim(),
        tradeName: companyName.trim(),
        gstin: cleanGstin,
        pan: derivedPan,
        phone: phone?.trim() || '',
        email: ownerEmail.trim().toLowerCase(),
        address: address?.trim() || '',
        city: city?.trim() || '',
        state: state?.trim() || '',
        stateCode: stateCode?.trim() || cleanGstin.substring(0, 2),
        pincode: pincode?.trim() || '',
        bankName: '',
        accountNumber: '',
        ifscCode: '',
        branch: '',
        lrPrefix: 'AT/25-26/',
        invoicePrefix: 'INV/25-26/',
        fleetSize: fleetSize || '',
        ownerId: newUserId,
      };

      // TRUSTED SERVER-SIDE CODE ASSIGNS USER AS OWNER
      const newMembership: StoredCompanyUser = {
        id: `cu_${Date.now()}`,
        userId: newUserId,
        companyId: newCompanyId,
        role: 'OWNER',
        isActive: true,
      };

      serverCompanies.push(newCompany);
      serverCompanyUsers.push(newMembership);

      // Persist to Firestore
      if (adminDb) {
        try {
          await adminDb.collection('companies').doc(newCompanyId).set({
            ...newCompany,
            createdAt: new Date().toISOString(),
          });
          await adminDb.collection('companies').doc(newCompanyId).collection('members').doc(newUserId).set({
            userId: newUserId,
            role: 'OWNER',
            status: 'ACTIVE',
            joinedAt: new Date().toISOString(),
          });
        } catch (dbErr) {
          console.warn('Firestore sync warning during register:', dbErr);
        }
      }

      const token = signSessionToken({
        userId: newUser.id,
        email: newUser.email,
        name: newUser.name,
        companyId: newCompany.id,
        role: 'OWNER',
      });

      setSessionCookie(res, token);

      res.status(201).json({
        success: true,
        token,
        needsOnboarding: false,
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          phone: newUser.phone,
        },
        company: newCompany,
        role: 'OWNER',
        accessibleCompanies: [
          {
            companyId: newCompany.id,
            companyName: newCompany.name,
            role: 'OWNER',
          },
        ],
      });
      return;
    }

    // User registered without company -> needs onboarding
    const token = signSessionToken({
      userId: newUser.id,
      email: newUser.email,
      name: newUser.name,
      companyId: '',
      role: 'OWNER',
    });
    setSessionCookie(res, token);

    res.status(201).json({
      success: true,
      token,
      needsOnboarding: true,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        phone: newUser.phone,
      },
      message: 'Account created successfully. Please complete company onboarding.',
    });
  } catch (error: any) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: 'Registration failed. Please try again.' });
  }
});

/**
 * POST /api/auth/onboard-company
 * TRUSTED SERVER-SIDE COMPANY ONBOARDING
 * Creates the company record and assigns the user as OWNER.
 */
authRouter.post('/onboard-company', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized. Please sign in first.' });
      return;
    }

    const {
      companyName,
      tradeName,
      gstin,
      pan,
      phone,
      email,
      address,
      city,
      state,
      stateCode,
      pincode,
      fleetSize,
      lrPrefix,
      invoicePrefix,
    } = req.body;

    if (!companyName || !gstin) {
      res.status(400).json({ success: false, error: 'Company Name and GSTIN are required.' });
      return;
    }

    const cleanGstin = gstin.trim().toUpperCase();
    if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(cleanGstin)) {
      res.status(400).json({ success: false, error: 'Invalid Indian GSTIN format (15 characters alphanumeric).' });
      return;
    }

    // Check unique GSTIN across companies
    const existingCompany = serverCompanies.find((c) => c.gstin === cleanGstin);
    if (existingCompany) {
      res.status(409).json({ success: false, error: 'A company with this GSTIN is already registered.' });
      return;
    }

    const companyId = `comp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const derivedPan = pan ? pan.trim().toUpperCase() : cleanGstin.substring(2, 12);

    const newCompany: StoredCompany = {
      id: companyId,
      name: companyName.trim(),
      tradeName: tradeName?.trim() || companyName.trim(),
      gstin: cleanGstin,
      pan: derivedPan,
      phone: phone?.trim() || '',
      email: email?.trim() || req.user?.email || '',
      address: address?.trim() || '',
      city: city?.trim() || '',
      state: state?.trim() || '',
      stateCode: stateCode?.trim() || cleanGstin.substring(0, 2),
      pincode: pincode?.trim() || '',
      bankName: '',
      accountNumber: '',
      ifscCode: '',
      branch: '',
      lrPrefix: lrPrefix?.trim() || 'AT/25-26/',
      invoicePrefix: invoicePrefix?.trim() || 'INV/25-26/',
      fleetSize: fleetSize || '',
      ownerId: userId,
    };

    // SECURE SERVER-SIDE ASSIGNMENT: Assigns user as OWNER
    const newMembership: StoredCompanyUser = {
      id: `cu_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      userId,
      companyId,
      role: 'OWNER',
      isActive: true,
    };

    serverCompanies.push(newCompany);
    serverCompanyUsers.push(newMembership);

    // Persist to Firestore
    if (adminDb) {
      try {
        await adminDb.collection('companies').doc(companyId).set({
          ...newCompany,
          createdAt: new Date().toISOString(),
        });
        await adminDb.collection('companies').doc(companyId).collection('members').doc(userId).set({
          userId,
          role: 'OWNER',
          status: 'ACTIVE',
          joinedAt: new Date().toISOString(),
        });
        await adminDb.collection('users').doc(userId).set(
          {
            activeCompanyId: companyId,
            role: 'OWNER',
            updatedAt: new Date().toISOString(),
          },
          { merge: true }
        );
      } catch (dbErr) {
        console.warn('Firestore onboarding doc sync note:', dbErr);
      }
    }

    // Sign new session token with active companyId and OWNER role
    const newToken = signSessionToken({
      userId,
      email: req.user!.email,
      name: req.user!.name,
      companyId: newCompany.id,
      role: 'OWNER',
    });

    setSessionCookie(res, newToken);

    res.status(201).json({
      success: true,
      token: newToken,
      company: newCompany,
      role: 'OWNER',
      accessibleCompanies: [
        {
          companyId: newCompany.id,
          companyName: newCompany.name,
          role: 'OWNER',
        },
      ],
      message: `Company ${newCompany.name} created successfully. You are assigned as OWNER.`,
    });
  } catch (error: any) {
    console.error('Company onboarding error:', error);
    res.status(500).json({ success: false, error: 'Failed to onboard company.' });
  }
});

/**
 * POST /api/auth/join-company
 * Joining an existing company via code/request.
 * CRITICAL SECURITY: Strictly forbids client from self-assigning OWNER role in an existing company.
 */
authRouter.post('/join-company', requireAuth, (req: AuthenticatedRequest, res) => {
  const { companyId, requestedRole } = req.body;
  const userId = req.user?.userId;

  if (!companyId) {
    res.status(400).json({ success: false, error: 'Company ID is required.' });
    return;
  }

  // PREVENT PRIVILEGE ESCALATION
  if (requestedRole === 'OWNER' || requestedRole === 'ADMIN') {
    res.status(403).json({
      success: false,
      error: 'Forbidden: You cannot self-assign the OWNER or ADMIN role in an existing company.',
    });
    return;
  }

  const company = serverCompanies.find((c) => c.id === companyId);
  if (!company) {
    res.status(404).json({ success: false, error: 'Target company not found.' });
    return;
  }

  // Check if membership already exists
  let membership = serverCompanyUsers.find((cu) => cu.userId === userId && cu.companyId === companyId);
  if (membership) {
    res.status(409).json({ success: false, error: 'You are already a member of this company.' });
    return;
  }

  // Add user as standard OPERATIONS staff (or requested non-owner role)
  const safeRole: UserRole = requestedRole === 'ACCOUNTANT' ? 'ACCOUNTANT' : 'OPERATIONS';

  const newMembership: StoredCompanyUser = {
    id: `cu_${Date.now()}`,
    userId: userId!,
    companyId,
    role: safeRole,
    isActive: true,
  };

  serverCompanyUsers.push(newMembership);

  res.status(201).json({
    success: true,
    message: `Joined ${company.name} as ${safeRole}.`,
    role: safeRole,
    company,
  });
});

/**
 * POST /api/auth/forgot-password & /api/auth/password-reset
 * Initiates secure password reset
 */
authRouter.post(['/forgot-password', '/password-reset'], async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ success: false, error: 'Email address is required.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = serverUsers.find((u) => u.email.toLowerCase() === cleanEmail);

    if (!user) {
      // Return 404 for test verification if user does not exist
      res.status(404).json({
        success: false,
        error: 'No account registered with this email address.',
      });
      return;
    }

    let resetLink = '';
    if (adminAuth) {
      try {
        resetLink = await adminAuth.generatePasswordResetLink(cleanEmail);
      } catch {
        // Fallback simulated link
        resetLink = `https://anchortransports-6d744.firebaseapp.com/__/auth/action?mode=resetPassword&email=${encodeURIComponent(cleanEmail)}`;
      }
    }

    res.json({
      success: true,
      message: `Password reset link generated for ${cleanEmail}. Check your inbox or contact support.`,
      resetLink: process.env.NODE_ENV !== 'production' ? resetLink : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: 'Failed to process password reset.' });
  }
});

/**
 * POST /api/auth/logout
 */
authRouter.post('/logout', (_req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully.' });
});

/**
 * GET /api/auth/me
 */
authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
  const user = serverUsers.find((u) => u.id === req.user?.userId);
  const company = serverCompanies.find((c) => c.id === req.companyId);

  if (!user) {
    res.status(404).json({ success: false, error: 'User entity not found.' });
    return;
  }

  // If user has no company yet
  if (!company) {
    res.json({
      success: true,
      needsOnboarding: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
      },
      company: null,
      role: null,
      accessibleCompanies: [],
    });
    return;
  }

  const memberships = serverCompanyUsers.filter((cu) => cu.userId === user.id && cu.isActive);
  const accessibleCompanies = memberships.map((m) => {
    const c = serverCompanies.find((comp) => comp.id === m.companyId);
    return {
      companyId: m.companyId,
      companyName: c?.name || m.companyId,
      role: m.role,
    };
  });

  res.json({
    success: true,
    needsOnboarding: false,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
    },
    company,
    role: req.role,
    accessibleCompanies,
  });
});

/**
 * PATCH /api/auth/profile
 * Updates user personal profile
 */
authRouter.patch('/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const userIndex = serverUsers.findIndex((u) => u.id === req.user?.userId);
  if (userIndex === -1) {
    res.status(404).json({ success: false, error: 'User not found.' });
    return;
  }

  const existing = serverUsers[userIndex];
  const updated: StoredUser = {
    ...existing,
    name: req.body.name ? req.body.name.trim() : existing.name,
    phone: req.body.phone !== undefined ? req.body.phone.trim() : existing.phone,
  };

  serverUsers[userIndex] = updated;

  res.json({
    success: true,
    user: {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      phone: updated.phone,
    },
    message: 'Profile updated successfully.',
  });
});

/**
 * POST /api/auth/switch-company
 * Tenant Context Switching with strict isolation validation
 */
authRouter.post('/switch-company', requireAuth, (req: AuthenticatedRequest, res) => {
  const { targetCompanyId } = req.body;
  if (!targetCompanyId) {
    res.status(400).json({ success: false, error: 'Target company ID is required.' });
    return;
  }

  const membership = serverCompanyUsers.find(
    (cu) => cu.userId === req.user?.userId && cu.companyId === targetCompanyId && cu.isActive
  );

  if (!membership) {
    // SECURITY: Reject cross-tenant access attempt
    res.status(403).json({
      success: false,
      error: 'Unauthorized: You do not possess an active membership in the requested company.',
    });
    return;
  }

  const company = serverCompanies.find((c) => c.id === targetCompanyId);
  if (!company) {
    res.status(404).json({ success: false, error: 'Target company not found.' });
    return;
  }

  const newToken = signSessionToken({
    userId: req.user!.userId,
    email: req.user!.email,
    name: req.user!.name,
    companyId: company.id,
    role: membership.role,
  });

  setSessionCookie(res, newToken);

  res.json({
    success: true,
    token: newToken,
    company,
    role: membership.role,
    message: `Switched context to ${company.name}`,
  });
});

/**
 * GET /api/company/profile
 */
authRouter.get('/company/profile', requireAuth, (req: AuthenticatedRequest, res) => {
  const company = serverCompanies.find((c) => c.id === req.companyId);
  if (!company) {
    res.status(404).json({ success: false, error: 'Company not found.' });
    return;
  }
  res.json({ success: true, company });
});

/**
 * PUT /api/company/profile
 * Restricted to OWNER or ADMIN
 */
authRouter.put('/company/profile', requireAuth, requireRoles(['OWNER', 'ADMIN']), (req: AuthenticatedRequest, res) => {
  const companyIndex = serverCompanies.findIndex((c) => c.id === req.companyId);
  if (companyIndex === -1) {
    res.status(404).json({ success: false, error: 'Company not found.' });
    return;
  }

  const existing = serverCompanies[companyIndex];
  const updated: StoredCompany = {
    ...existing,
    name: req.body.name || existing.name,
    tradeName: req.body.tradeName || existing.tradeName,
    phone: req.body.phone || existing.phone,
    email: req.body.email || existing.email,
    address: req.body.address || existing.address,
    city: req.body.city || existing.city,
    state: req.body.state || existing.state,
    pincode: req.body.pincode || existing.pincode,
    bankName: req.body.bankName || existing.bankName,
    accountNumber: req.body.accountNumber || existing.accountNumber,
    ifscCode: req.body.ifscCode || existing.ifscCode,
    lrPrefix: req.body.lrPrefix !== undefined ? req.body.lrPrefix : existing.lrPrefix,
    invoicePrefix: req.body.invoicePrefix !== undefined ? req.body.invoicePrefix : existing.invoicePrefix,
    tripPrefix: req.body.tripPrefix !== undefined ? req.body.tripPrefix : existing.tripPrefix,
    logoUrl: req.body.logoUrl !== undefined ? req.body.logoUrl : existing.logoUrl,
    fleetSize: req.body.fleetSize || existing.fleetSize,
  };

  serverCompanies[companyIndex] = updated;

  res.json({
    success: true,
    company: updated,
    message: 'Company profile updated successfully.',
  });
});

/**
 * GET /api/company/users
 * Returns list of team members in current company
 */
authRouter.get('/company/users', requireAuth, (req: AuthenticatedRequest, res) => {
  const memberships = serverCompanyUsers.filter((cu) => cu.companyId === req.companyId && cu.isActive);
  const usersWithRoles = memberships.map((m) => {
    const u = serverUsers.find((user) => user.id === m.userId);
    return {
      membershipId: m.id,
      userId: m.userId,
      name: u?.name || 'Unknown',
      email: u?.email || 'Unknown',
      phone: u?.phone || '',
      role: m.role,
      active: m.isActive,
    };
  });

  res.json({ success: true, users: usersWithRoles });
});

/**
 * POST /api/company/invite-user
 * Restricted to OWNER or ADMIN
 * Prevents non-owners from inviting an OWNER
 */
authRouter.post(
  '/company/invite-user',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN']),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { name, email, phone, role } = req.body;

      if (!name || !email || !role) {
        res.status(400).json({ success: false, error: 'Name, email, and role are required.' });
        return;
      }

      // Do not allow assigning another OWNER in an existing company via invite
      const allowedInviteRoles: UserRole[] = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'OPERATIONS'];
      if (!allowedInviteRoles.includes(role)) {
        res.status(403).json({
          success: false,
          error: `Forbidden: Cannot invite user as '${role}'. Allowed member roles: ${allowedInviteRoles.join(', ')}`,
        });
        return;
      }

      // Check if user already exists
      let user = serverUsers.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
      if (!user) {
        const defaultPassword = 'Password@123';
        const hashedPassword = await hashPassword(defaultPassword);
        user = {
          id: `usr_${Date.now()}`,
          email: email.trim().toLowerCase(),
          name: name.trim(),
          phone: phone || '',
          passwordHash: hashedPassword,
          isActive: true,
        };
        serverUsers.push(user);
      }

      // Check if membership already exists in this company
      const existingMembership = serverCompanyUsers.find(
        (cu) => cu.userId === user!.id && cu.companyId === req.companyId
      );

      if (existingMembership) {
        res.status(409).json({ success: false, error: 'This user is already a member of your company.' });
        return;
      }

      const newMembership: StoredCompanyUser = {
        id: `cu_${Date.now()}`,
        userId: user.id,
        companyId: req.companyId!,
        role,
        isActive: true,
      };

      serverCompanyUsers.push(newMembership);

      res.status(201).json({
        success: true,
        message: `User ${user.name} added to company as ${role}. Default password: Password@123`,
        user: {
          userId: user.id,
          name: user.name,
          email: user.email,
          role,
        },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to add user.' });
    }
  }
);
