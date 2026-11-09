/**
 * AnchorTransport TMS - Firebase Status & Verification Route
 * Allows checking Firebase Client and Admin initialization status
 */

import { Router, type Request, type Response } from 'express';
import { verifyFirebaseAdminConnection } from '../../lib/firebase/admin';

export const firebaseRouter = Router();

firebaseRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const adminStatus = await verifyFirebaseAdminConnection();

    res.json({
      status: 'ok',
      firebase: {
        configured: true,
        projectId: adminStatus.projectId,
        admin: adminStatus,
        client: {
          apiKeyConfigured: Boolean(process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_PROJECT_ID),
          projectId: adminStatus.projectId,
          authDomain: `${adminStatus.projectId}.firebaseapp.com`,
          storageBucket: `${adminStatus.projectId}.firebasestorage.app`,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({
      status: 'error',
      message: 'Failed to verify Firebase configuration',
      error: message,
    });
  }
});
