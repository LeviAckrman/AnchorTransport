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
import { adminAuth, runAdminFirestore } from '../../lib/firebase/admin';
import { FieldValue } from 'firebase-admin/firestore';
import { loadAuthDb, persistAuthDb } from '../authDb';

export const authRouter = Router();

// In-memory server store (persisted to disk & mirrored with Firestore)
export interface StoredUser {
  id: string;
  email: string;
  name: string;
  phone: string;
  passwordHash: string;
  isActive: boolean;
  onboardingCompleted?: boolean;
  onboardingCompletedAt?: string;
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

const SEED_USERS: StoredUser[] = [
  {
    id: 'usr_owner_01',
    email: 'anupam@royalbengal.com',
    name: 'Anupam Ghosh',
    phone: '+91 98301 22890',
    passwordHash: DEMO_PASSWORD_HASH,
    isActive: true,
    onboardingCompleted: true,
  },
];

const SEED_COMPANIES: StoredCompany[] = [
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
    ownerId: 'usr_empty_01',
  },
];

const SEED_COMPANY_USERS: StoredCompanyUser[] = [
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
];

const initialAuthDb = loadAuthDb(SEED_USERS, SEED_COMPANIES, SEED_COMPANY_USERS);
export const serverUsers: StoredUser[] = initialAuthDb.users;
export const serverCompanies: StoredCompany[] = initialAuthDb.companies;
export const serverCompanyUsers: StoredCompanyUser[] = initialAuthDb.companyUsers;

function saveAuthState(): void {
  persistAuthDb(serverUsers, serverCompanies, serverCompanyUsers);
}

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
      onboardingCompleted: incomingOnboardingCompleted,
      onboardingCompletedAt: incomingOnboardingCompletedAt,
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

    if (!verifiedUid && typeof uid === 'string' && uid.trim()) {
      verifiedUid = uid.trim();
    }

    if (!verifiedEmail) {
      res.status(400).json({ success: false, error: 'Valid user email is required.' });
      return;
    }

    // Strictly match Firebase UID when provided so a recreated account never inherits an older UID's company
    let user = verifiedUid
      ? serverUsers.find((u) => u.id === verifiedUid)
      : serverUsers.find((u) => u.email.toLowerCase() === verifiedEmail);
    let stateChanged = false;
    if (!user) {
      const completedFromFirestore = incomingOnboardingCompleted === true;
      user = {
        id: verifiedUid || `usr_${Date.now()}`,
        email: verifiedEmail,
        name: verifiedName || verifiedEmail.split('@')[0],
        phone: typeof phone === 'string' ? phone.trim() : '',
        passwordHash: DEMO_PASSWORD_HASH,
        isActive: true,
        onboardingCompleted: completedFromFirestore,
        onboardingCompletedAt: completedFromFirestore
          ? (typeof incomingOnboardingCompletedAt === 'string' && incomingOnboardingCompletedAt) || new Date().toISOString()
          : undefined,
      };
      serverUsers.push(user);
      stateChanged = true;

      // Also persist to Firestore if admin credentials are available
      await runAdminFirestore('Firestore user doc sync note', async (db) => {
        await db.collection('users').doc(user!.id).set(
          {
            id: user!.id,
            email: user!.email,
            name: user!.name,
            onboardingCompleted: Boolean(user!.onboardingCompleted),
            ...(user!.onboardingCompletedAt ? { onboardingCompletedAt: user!.onboardingCompletedAt } : {}),
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      });
    } else {
      if (!user.name && verifiedName) {
        user.name = verifiedName;
        stateChanged = true;
      }
      if (!user.phone && typeof phone === 'string' && phone.trim()) {
        user.phone = phone.trim();
        stateChanged = true;
      }
      // Monotonically promote onboardingCompleted from Firestore if true; never downgrade
      if (incomingOnboardingCompleted === true && !user.onboardingCompleted) {
        user.onboardingCompleted = true;
        user.onboardingCompletedAt =
          (typeof incomingOnboardingCompletedAt === 'string' && incomingOnboardingCompletedAt) ||
          user.onboardingCompletedAt ||
          new Date().toISOString();
        stateChanged = true;
      }
    }

    // Check company memberships
    let memberships = serverCompanyUsers.filter((cu) => cu.userId === user!.id && cu.isActive);

    // Rehydrate company & owner membership from Firestore payload when ownerId matches user.id
    if (
      memberships.length === 0 &&
      firestoreCompany &&
      typeof firestoreCompany === 'object' &&
      typeof firestoreCompany.id === 'string' &&
      firestoreCompany.id.trim() &&
      firestoreCompany.ownerId === user.id
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
          ownerId: user.id,
        };
        serverCompanies.push(existingComp);
      }

      const restoredMembership: StoredCompanyUser = {
        id: `cu_sync_${Date.now()}`,
        userId: user.id,
        companyId: compId,
        role: 'OWNER',
        isActive: true,
      };
      serverCompanyUsers.push(restoredMembership);
      memberships = [restoredMembership];
      stateChanged = true;
    }

    if (memberships.length > 0 && !user.onboardingCompleted) {
      user.onboardingCompleted = true;
      user.onboardingCompletedAt = user.onboardingCompletedAt || new Date().toISOString();
      stateChanged = true;
    }

    if (stateChanged) {
      saveAuthState();
    }

    const hasCompletedOnboarding = Boolean(user.onboardingCompleted) || memberships.length > 0;

    if (!hasCompletedOnboarding) {
      // User is logged in, but has not completed Onboarding yet!
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
        onboardingCompleted: false,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          onboardingCompleted: false,
        },
        token: onboardingToken,
        message: 'User authenticated. Company onboarding required.',
      });
      return;
    }

    // Active membership exists or onboarding already permanently completed
    const activeMembership = memberships[0];
    const company = activeMembership
      ? serverCompanies.find((c) => c.id === activeMembership.companyId) || null
      : null;

    if (activeMembership && !company) {
      res.status(404).json({ success: false, error: 'Associated company record not found.' });
      return;
    }

    const token = signSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      companyId: company?.id || '',
      role: activeMembership?.role || 'OWNER',
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
      onboardingCompleted: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        onboardingCompleted: true,
        onboardingCompletedAt: user.onboardingCompletedAt,
      },
      company,
      role: activeMembership?.role || 'OWNER',
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
    if (memberships.length > 0 && !user.onboardingCompleted) {
      user.onboardingCompleted = true;
      user.onboardingCompletedAt = user.onboardingCompletedAt || new Date().toISOString();
      saveAuthState();
    }

    const hasCompletedOnboarding = Boolean(user.onboardingCompleted) || memberships.length > 0;
    if (!hasCompletedOnboarding) {
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
        onboardingCompleted: false,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          phone: user.phone,
          onboardingCompleted: false,
        },
        token: onboardingToken,
      });
      return;
    }

    // Select default active company
    const activeMembership = memberships[0];
    const company = activeMembership
      ? serverCompanies.find((c) => c.id === activeMembership.companyId) || null
      : null;

    if (activeMembership && !company) {
      res.status(404).json({ success: false, error: 'Associated company record not found.' });
      return;
    }

    const token = signSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name,
      companyId: company?.id || '',
      role: activeMembership?.role || 'OWNER',
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
      onboardingCompleted: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        onboardingCompleted: true,
        onboardingCompletedAt: user.onboardingCompletedAt,
      },
      company,
      role: activeMembership?.role || 'OWNER',
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
      onboardingCompleted: false,
    };
    serverUsers.push(newUser);
    saveAuthState();

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

      newUser.onboardingCompleted = true;
      newUser.onboardingCompletedAt = new Date().toISOString();

      serverCompanies.push(newCompany);
      serverCompanyUsers.push(newMembership);
      saveAuthState();

      // Persist to Firestore when admin credentials are available
      await runAdminFirestore('Firestore sync warning during register', async (db) => {
        const nowTs = FieldValue.serverTimestamp();
        await db.collection('companies').doc(newCompanyId).set({
          ...newCompany,
          createdAt: nowTs,
          updatedAt: nowTs,
        });
        await db
          .collection('companies')
          .doc(newCompanyId)
          .collection('members')
          .doc(newUserId)
          .set({
            id: newUserId,
            userId: newUserId,
            companyId: newCompanyId,
            role: 'OWNER',
            name: newUser.name,
            email: newUser.email,
            status: 'ACTIVE',
            joinedAt: newUser.onboardingCompletedAt,
            createdAt: nowTs,
            updatedAt: nowTs,
          });
        await db
          .collection('companies')
          .doc(newCompanyId)
          .collection('settings')
          .doc('default')
          .set({
            id: 'default',
            companyId: newCompanyId,
            defaultGstRatePercent: 5,
            defaultRcmEnabled: true,
            defaultCreditPeriodDays: 30,
            defaultFuelUnit: 'LITRES',
            lowFastagThresholdPaise: 100000,
            expiryAlertDays: 30,
            autoGenerateLr: true,
            currency: 'INR',
            updatedByUid: newUserId,
            createdAt: nowTs,
            updatedAt: nowTs,
          });
        await db.collection('users').doc(newUserId).set(
          {
            id: newUserId,
            email: newUser.email,
            name: newUser.name,
            role: 'OWNER',
            onboardingCompleted: true,
            onboardingCompletedAt: newUser.onboardingCompletedAt,
            activeCompanyId: newCompanyId,
            defaultCompanyId: newCompanyId,
            createdAt: nowTs,
            updatedAt: nowTs,
          },
          { merge: true }
        );
      });

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
        onboardingCompleted: true,
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          phone: newUser.phone,
          onboardingCompleted: true,
          onboardingCompletedAt: newUser.onboardingCompletedAt,
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
      onboardingCompleted: false,
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
        phone: newUser.phone,
        onboardingCompleted: false,
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

    // Never create a duplicate company for an owner who already has one
    const alreadyOwnedCompany = serverCompanies.find((c) => c.ownerId === userId);
    if (alreadyOwnedCompany) {
      const userRecord = serverUsers.find((u) => u.id === userId);
      const token = signSessionToken({
        userId,
        email: req.user!.email,
        name: req.user!.name,
        companyId: alreadyOwnedCompany.id,
        role: 'OWNER',
      });
      setSessionCookie(res, token);
      res.status(200).json({
        success: true,
        token,
        needsOnboarding: false,
        onboardingCompleted: true,
        user: userRecord
          ? {
              id: userRecord.id,
              email: userRecord.email,
              name: userRecord.name,
              phone: userRecord.phone,
              onboardingCompleted: true,
              onboardingCompletedAt: userRecord.onboardingCompletedAt,
            }
          : undefined,
        company: alreadyOwnedCompany,
        role: 'OWNER',
        accessibleCompanies: [
          {
            companyId: alreadyOwnedCompany.id,
            companyName: alreadyOwnedCompany.name,
            role: 'OWNER',
          },
        ],
      });
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

    // Permanently mark onboarding as completed on the user record in the database
    const completedAt = new Date().toISOString();
    const userRecord = serverUsers.find((u) => u.id === userId);
    if (userRecord) {
      userRecord.onboardingCompleted = true;
      userRecord.onboardingCompletedAt = userRecord.onboardingCompletedAt || completedAt;
    }
    saveAuthState();

    // Persist to Firestore when admin credentials are available
    await runAdminFirestore('Firestore onboarding doc sync note', async (db) => {
      const nowTs = FieldValue.serverTimestamp();
      await db.collection('companies').doc(companyId).set({
        ...newCompany,
        createdAt: nowTs,
        updatedAt: nowTs,
      });
      await db
        .collection('companies')
        .doc(companyId)
        .collection('members')
        .doc(userId)
        .set({
          id: userId,
          userId,
          companyId,
          role: 'OWNER',
          name: req.user?.name || userRecord?.name || 'Company Owner',
          email: (req.user?.email || userRecord?.email || '').toLowerCase(),
          status: 'ACTIVE',
          joinedAt: userRecord?.onboardingCompletedAt || completedAt,
          createdAt: nowTs,
          updatedAt: nowTs,
        });
      await db
        .collection('companies')
        .doc(companyId)
        .collection('settings')
        .doc('default')
        .set({
          id: 'default',
          companyId,
          defaultGstRatePercent: 5,
          defaultRcmEnabled: true,
          defaultCreditPeriodDays: 30,
          defaultFuelUnit: 'LITRES',
          lowFastagThresholdPaise: 100000,
          expiryAlertDays: 30,
          autoGenerateLr: true,
          currency: 'INR',
          updatedByUid: userId,
          createdAt: nowTs,
          updatedAt: nowTs,
        });
      await db.collection('users').doc(userId).set(
        {
          id: userId,
          email: (req.user?.email || userRecord?.email || '').toLowerCase(),
          name: req.user?.name || userRecord?.name || 'Company Owner',
          activeCompanyId: companyId,
          defaultCompanyId: companyId,
          role: 'OWNER',
          onboardingCompleted: true,
          onboardingCompletedAt: userRecord?.onboardingCompletedAt || completedAt,
          createdAt: nowTs,
          updatedAt: nowTs,
        },
        { merge: true }
      );
    });

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
      needsOnboarding: false,
      onboardingCompleted: true,
      user: userRecord
        ? {
            id: userRecord.id,
            email: userRecord.email,
            name: userRecord.name,
            phone: userRecord.phone,
            onboardingCompleted: true,
            onboardingCompletedAt: userRecord.onboardingCompletedAt,
          }
        : undefined,
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
 * Disabled in strict Owner-Only architecture.
 */
authRouter.post('/join-company', requireAuth, (_req: AuthenticatedRequest, res) => {
  res.status(403).json({
    success: false,
    error: 'Forbidden: Team memberships and joining external companies are disabled in Owner-Only mode.',
  });
});

/**
 * POST /api/auth/complete-onboarding
 * Permanently marks onboardingCompleted = true for the authenticated user
 */
authRouter.post('/complete-onboarding', requireAuth, async (req: AuthenticatedRequest, res) => {
  const userId = req.user?.userId;
  const user = serverUsers.find((u) => u.id === userId);
  if (!user) {
    res.status(404).json({ success: false, error: 'User not found.' });
    return;
  }

  if (!user.onboardingCompleted) {
    user.onboardingCompleted = true;
    user.onboardingCompletedAt = user.onboardingCompletedAt || new Date().toISOString();
    saveAuthState();
  }

  await runAdminFirestore('Firestore complete onboarding sync note', async (db) => {
    await db.collection('users').doc(user.id).set(
      {
        onboardingCompleted: true,
        onboardingCompletedAt: user.onboardingCompletedAt,
        updatedAt: new Date().toISOString(),
      },
      { merge: true }
    );
  });

  res.json({
    success: true,
    onboardingCompleted: true,
    onboardingCompletedAt: user.onboardingCompletedAt,
    needsOnboarding: false,
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
  const memberships = user ? serverCompanyUsers.filter((cu) => cu.userId === user.id && cu.isActive) : [];
  const company =
    serverCompanies.find((c) => c.id === req.companyId) ||
    (memberships[0] ? serverCompanies.find((c) => c.id === memberships[0].companyId) : undefined);

  if (!user) {
    res.status(404).json({ success: false, error: 'User entity not found.' });
    return;
  }

  if (memberships.length > 0 && !user.onboardingCompleted) {
    user.onboardingCompleted = true;
    user.onboardingCompletedAt = user.onboardingCompletedAt || new Date().toISOString();
    saveAuthState();
  }

  const hasCompletedOnboarding = Boolean(user.onboardingCompleted) || memberships.length > 0 || Boolean(company);

  if (!hasCompletedOnboarding) {
    res.json({
      success: true,
      needsOnboarding: true,
      onboardingCompleted: false,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: user.phone,
        onboardingCompleted: false,
      },
      company: null,
      role: null,
      accessibleCompanies: [],
    });
    return;
  }

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
    onboardingCompleted: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      onboardingCompleted: true,
      onboardingCompletedAt: user.onboardingCompletedAt,
    },
    company: company || null,
    role: req.role || memberships[0]?.role || 'OWNER',
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
  saveAuthState();

  res.json({
    success: true,
    user: {
      id: updated.id,
      email: updated.email,
      name: updated.name,
      phone: updated.phone,
      onboardingCompleted: Boolean(updated.onboardingCompleted),
      onboardingCompletedAt: updated.onboardingCompletedAt,
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
 * Restricted strictly to OWNER
 */
authRouter.put('/company/profile', requireAuth, requireRoles(['OWNER']), (req: AuthenticatedRequest, res) => {
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
  saveAuthState();

  res.json({
    success: true,
    company: updated,
    message: 'Company profile updated successfully.',
  });
});

/**
 * GET /api/company/users
 * Owner-Only: returns only the authenticated company owner record
 */
authRouter.get('/company/users', requireAuth, requireRoles(['OWNER']), (req: AuthenticatedRequest, res) => {
  const ownerMembership = serverCompanyUsers.find(
    (cu) => cu.companyId === req.companyId && cu.userId === req.user?.userId && cu.role === 'OWNER' && cu.isActive
  );
  if (!ownerMembership) {
    res.status(403).json({ success: false, error: 'Owner access required.' });
    return;
  }
  const u = serverUsers.find((user) => user.id === ownerMembership.userId);
  res.json({
    success: true,
    users: [
      {
        membershipId: ownerMembership.id,
        userId: ownerMembership.userId,
        name: u?.name || 'Owner',
        email: u?.email || '',
        phone: u?.phone || '',
        role: 'OWNER' as UserRole,
        active: true,
      },
    ],
  });
});

/**
 * POST /api/company/invite-user
 * Disabled in strict Owner-Only architecture.
 */
authRouter.post('/company/invite-user', requireAuth, (_req: AuthenticatedRequest, res) => {
  res.status(403).json({
    success: false,
    error: 'Forbidden: Team invitations and non-owner roles are disabled in Owner-Only mode.',
  });
});
