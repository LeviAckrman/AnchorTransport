import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function readSrc(relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

describe('Strict Firebase Email Verification Architecture', () => {
  it('dispatches sendEmailVerification immediately on registration and uses user.reload() on login/refresh', () => {
    const firebaseAuthSrc = readSrc('src/lib/firebase/auth.ts');

    assert.ok(
      firebaseAuthSrc.includes('createUserWithEmailAndPassword(') &&
        firebaseAuthSrc.includes('await sendEmailVerification(userCredential.user)'),
      'registerFirebaseUser must create account and immediately call sendEmailVerification()'
    );

    assert.ok(
      firebaseAuthSrc.includes('await reload(fbUser)') &&
        firebaseAuthSrc.includes('reloadTargetFirebaseUser(userCredential.user)'),
      'loginFirebaseUser must call user.reload() via reloadTargetFirebaseUser to fetch latest emailVerified status'
    );

    assert.ok(
      firebaseAuthSrc.includes('await reload(user)') &&
        firebaseAuthSrc.includes('await sendEmailVerification(freshUser)'),
      'resendVerificationEmail must reload user and send verification email via Firebase sendEmailVerification()'
    );
  });

  it('enforces user.reload() and emailVerified in AuthContext without trusting localStorage flags', () => {
    const authCtxSrc = readSrc('src/context/AuthContext.tsx');

    assert.ok(
      authCtxSrc.includes('useState(false)') && !authCtxSrc.includes('isEmailVerified, setIsEmailVerified] = useState(true)'),
      'isEmailVerified must default to false before authoritative Firebase check'
    );

    assert.ok(
      authCtxSrc.includes('reloadTargetFirebaseUser(firebaseUser)') &&
        authCtxSrc.includes('if (!freshUser.emailVerified)'),
      'onAuthStateChanged listener must call user.reload() and block unverified Firebase users'
    );

    assert.ok(
      authCtxSrc.includes('if (!firebaseUser.emailVerified)') &&
        authCtxSrc.includes('setUnverifiedFirebaseSession(firebaseUser)'),
      'login must block unverified users and redirect to verification screen'
    );

    assert.ok(
      authCtxSrc.includes('clearClientTmsCaches()') &&
        authCtxSrc.includes('!reloaded.emailVerified') &&
        authCtxSrc.includes('reloadFirebaseUser()'),
      'refreshVerificationStatus must call user.reload(), check emailVerified, and clear caches when unverified'
    );
  });

  it('renders EmailVerificationPage with exact message, registered email, and 3 required buttons before dashboard/onboarding', () => {
    const appSrc = readSrc('src/App.tsx');
    const verifyPageSrc = readSrc('src/components/auth/EmailVerificationPage.tsx');

    const verifyGateIdx = appSrc.indexOf('if (isFirebaseUser && !isEmailVerified)');
    const onboardingGateIdx = appSrc.indexOf('if (needsOnboarding && !onboardingCompleted)');
    const dashboardIdx = appSrc.indexOf('<DashboardView');

    assert.ok(verifyGateIdx !== -1, 'App.tsx must contain strict isFirebaseUser && !isEmailVerified guard');
    assert.ok(
      verifyGateIdx < onboardingGateIdx && verifyGateIdx < dashboardIdx,
      'Email verification guard in App.tsx must run BEFORE onboarding and dashboard'
    );
    assert.ok(
      !appSrc.includes('Email Verification Reminder Banner'),
      'Unverified users must never enter dashboard with a dismissal banner'
    );

    const exactMsg =
      'A verification link has been sent to your email address. Please check your inbox and click the verification link to activate your AnchorTransports account.';
    assert.ok(
      verifyPageSrc.includes(exactMsg),
      'EmailVerificationPage must display the exact required verification message'
    );
    assert.ok(
      verifyPageSrc.includes('{user.email}'),
      'EmailVerificationPage must display the registered email address'
    );
    assert.ok(
      verifyPageSrc.includes('Resend Verification Email') &&
        verifyPageSrc.includes('I Have Verified My Email') &&
        verifyPageSrc.includes('Back to Login'),
      'EmailVerificationPage must render all three required buttons'
    );
    assert.ok(
      verifyPageSrc.includes("window.addEventListener('focus'") &&
        verifyPageSrc.includes('refreshVerificationStatus'),
      'EmailVerificationPage must auto-refresh Firebase user state via user.reload() when returning to the website'
    );
  });

  it('prevents FirestoreDataContext listeners from subscribing while email is unverified', () => {
    const fsDataCtxSrc = readSrc('src/context/FirestoreDataContext.tsx');
    assert.ok(
      fsDataCtxSrc.includes('isEmailVerified') &&
        /canSubscribe\s*=[\s\S]*isEmailVerified/.test(fsDataCtxSrc),
      'FirestoreDataContext must require isEmailVerified before attaching Firestore listeners'
    );
  });
});
