/**
 * AnchorTransport TMS - Company-Scoped Dashboard API Routes
 * Implements server-side dashboard metrics, date filtering, and multi-tenant security
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest, requireAuth } from '../auth';
import { serverFleetStore } from '../store';

export const dashboardRouter = Router();

/**
 * GET /api/dashboard/stats
 * Returns the 8 required dashboard metrics for the authenticated company context:
 * 1. Active trips
 * 2. Completed trips
 * 3. Freight revenue
 * 4. Recorded trip expenses
 * 5. Trip contribution (Freight Revenue - Expenses)
 * 6. Outstanding invoices
 * 7. Recent trips
 * 8. Vehicles requiring attention
 */
dashboardRouter.get('/stats', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId;

    if (!companyId) {
      res.status(403).json({
        success: false,
        error: 'Forbidden: No authorized company context in active session.',
      });
      return;
    }

    await serverFleetStore.hydrateFromFirestore(companyId);

    const period = (req.query.period as any) || 'all';
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const metrics = serverFleetStore.getDashboardMetrics(companyId, period, startDate, endDate);

    res.json({
      success: true,
      companyId,
      metrics,
    });
  } catch (err: any) {
    console.error('Error fetching dashboard metrics:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Internal server error calculating dashboard metrics.',
    });
  }
});

/**
 * POST /api/dashboard/seed-demo-data
 * Seeds realistic development records for testing
 */
dashboardRouter.post('/seed-demo-data', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      res.status(403).json({ success: false, error: 'No company context' });
      return;
    }

    serverFleetStore.seedCompanyData(companyId);
    const metrics = serverFleetStore.getDashboardMetrics(companyId, 'all');

    res.json({
      success: true,
      message: `Demo fleet records loaded for company ${companyId}`,
      metrics,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/dashboard/clear-data
 * Clears operational data for the active company to test empty state
 */
dashboardRouter.post('/clear-data', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId;
    if (!companyId) {
      res.status(403).json({ success: false, error: 'No company context' });
      return;
    }

    serverFleetStore.clearCompanyData(companyId);
    const metrics = serverFleetStore.getDashboardMetrics(companyId, 'all');

    res.json({
      success: true,
      message: `Operational records cleared for company ${companyId} (Empty State)`,
      metrics,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
