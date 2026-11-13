/**
 * AnchorTransport TMS - Financial Operations API Routes (Phase 7)
 * Implements:
 * 1. Trip Expenses (Fuel, Toll, Parking, Driver Allowance, Loading, Unloading, Repair, Other)
 * 2. Driver Advances (Cash movements that do NOT count as corporate expenses)
 * 3. Driver Settlements (Reconciliation of advances against approved deductions & bata)
 * 4. Trip Contribution (Freight Revenue - Recorded Trip Expenses; Decimal-safe, excludes advances)
 * 5. Referential Integrity & Immutability of Finalized Settlements
 * 6. Multi-Tenant Company Isolation on every query and mutation
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest, requireAuth, requireRoles } from '../auth';
import { serverFleetStore } from '../store';
import {
  TripExpense,
  DriverAdvance,
  TripSettlement,
  ExpenseCategory,
  PaymentMode,
  SettlementStatus,
  Trip,
} from '../../types/tms';
import { calculateTripContribution, calculateDriverSettlement } from '../../lib/financialEngine';

export const financialsRouter = Router();

/**
 * Helper to generate unique sequential settlement number for a company (e.g. STL-2026-0001)
 */
function generateSettlementNumber(companyId: string): string {
  const year = new Date().getFullYear();
  const prefix = `STL-${year}-`;
  const companySettlements = serverFleetStore.settlements.filter((s) => s.companyId === companyId);
  const existingNumbers = companySettlements
    .map((s) => s.settlementNumber || '')
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.replace(prefix, ''), 10))
    .filter((n) => !isNaN(n));

  const maxNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) : 0;
  const nextNum = (maxNum + 1).toString().padStart(4, '0');
  return `${prefix}${nextNum}`;
}

/**
 * Recomputes trip financial aggregate fields (totalRevenuePaise, totalExpensesPaise, totalAdvancesPaise, tripContributionPaise)
 */
function syncTripFinancialTotals(trip: Trip): void {
  const companyId = trip.companyId;
  const expenses = serverFleetStore.expenses.filter((e) => e.tripId === trip.id && e.companyId === companyId);
  const advances = serverFleetStore.advances.filter((a) => a.tripId === trip.id && a.companyId === companyId);

  const totalRevenue = trip.totalRevenuePaise || trip.freightAmountPaise || 0;
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amountPaise, 0);
  const totalAdvances = advances.reduce((sum, a) => sum + a.amountPaise, 0);

  // Trip Contribution = Revenue - Recorded Expenses
  // DRIVER ADVANCES MUST NEVER BE DEDUCTED AS EXPENSES!
  const contributionDetails = calculateTripContribution(totalRevenue, expenses);

  trip.totalExpensesPaise = totalExpenses;
  trip.totalAdvancesPaise = totalAdvances;
  trip.tripContributionPaise = contributionDetails.contributionPaise;
  trip.updatedAt = new Date().toISOString();
}

// =========================================================================
// 1. TRIP EXPENSES ROUTES
// =========================================================================

/**
 * GET /api/expenses
 * Lists recorded expenses for the company with pagination, category filter, date filter, and search.
 */
financialsRouter.get('/expenses', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 15;
    const search = ((req.query.search as string) || '').trim().toLowerCase();
    const category = (req.query.category as string) || '';
    const paymentMode = (req.query.paymentMode as string) || '';
    const tripId = (req.query.tripId as string) || '';
    const vehicleId = (req.query.vehicleId as string) || '';
    const startDate = (req.query.startDate as string) || '';
    const endDate = (req.query.endDate as string) || '';

    let list = serverFleetStore.expenses.filter((e) => e.companyId === companyId);

    if (tripId) {
      list = list.filter((e) => e.tripId === tripId);
    }

    if (vehicleId) {
      list = list.filter((e) => e.vehicleId === vehicleId);
    }

    if (category) {
      list = list.filter((e) => e.category === category || (category === 'FUEL' && e.category === 'DIESEL') || (category === 'TOLL' && e.category === 'TOLL_FASTAG'));
    }

    if (paymentMode) {
      list = list.filter((e) => e.paymentMode === paymentMode);
    }

    if (startDate) {
      list = list.filter((e) => {
        const d = (e.expenseDate || e.date || '').split('T')[0];
        return d >= startDate;
      });
    }

    if (endDate) {
      list = list.filter((e) => {
        const d = (e.expenseDate || e.date || '').split('T')[0];
        return d <= endDate;
      });
    }

    if (search) {
      list = list.filter(
        (e) =>
          (e.tripNumber && e.tripNumber.toLowerCase().includes(search)) ||
          (e.vehicleReg && e.vehicleReg.toLowerCase().includes(search)) ||
          (e.driverName && e.driverName.toLowerCase().includes(search)) ||
          (e.petrolPumpName && e.petrolPumpName.toLowerCase().includes(search)) ||
          (e.voucherNumber && e.voucherNumber.toLowerCase().includes(search)) ||
          (e.notes && e.notes.toLowerCase().includes(search)) ||
          e.category.toLowerCase().includes(search)
      );
    }

    // Sort descending by date
    list.sort((a, b) => {
      const da = new Date(a.expenseDate || a.date || a.createdAt || 0).getTime();
      const db = new Date(b.expenseDate || b.date || b.createdAt || 0).getTime();
      return db - da;
    });

    const total = list.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginated = list.slice(startIndex, startIndex + limit);

    // Calculate summary statistics
    const totalAmountPaise = list.reduce((sum, e) => sum + e.amountPaise, 0);
    const fuelAmountPaise = list
      .filter((e) => e.category === 'FUEL' || e.category === 'DIESEL')
      .reduce((sum, e) => sum + e.amountPaise, 0);
    const tollAmountPaise = list
      .filter((e) => e.category === 'TOLL' || e.category === 'TOLL_FASTAG')
      .reduce((sum, e) => sum + e.amountPaise, 0);
    const otherAmountPaise = totalAmountPaise - fuelAmountPaise - tollAmountPaise;

    res.json({
      success: true,
      data: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      summary: {
        totalAmountPaise,
        fuelAmountPaise,
        tollAmountPaise,
        otherAmountPaise,
        count: total,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to list expenses' });
  }
});

/**
 * GET /api/expenses/:id
 * Retrieves details for a specific expense
 */
financialsRouter.get('/expenses/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);
    const expense = serverFleetStore.expenses.find((e) => e.id === req.params.id && e.companyId === companyId);

    if (!expense) {
      res.status(404).json({ success: false, error: 'Expense record not found in your company.' });
      return;
    }

    const trip = serverFleetStore.trips.find((t) => t.id === expense.tripId && t.companyId === companyId);
    const vehicle = trip ? serverFleetStore.vehicles.find((v) => v.id === trip.vehicleId && v.companyId === companyId) : undefined;
    const driver = trip ? serverFleetStore.drivers.find((d) => d.id === trip.driverId && d.companyId === companyId) : undefined;

    res.json({
      success: true,
      expense,
      trip: trip || null,
      vehicle: vehicle || null,
      driver: driver || null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to get expense' });
  }
});

/**
 * POST /api/expenses
 * Records a new trip expense
 */
financialsRouter.post('/expenses', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const {
      tripId,
      category,
      amountPaise,
      paymentMode = 'CASH',
      expenseDate,
      litres,
      ratePerLitrePaise,
      petrolPumpName,
      location,
      odometerReading,
      receiptNumber,
      voucherNumber,
      receiptUrl,
      receiptAttachmentUrl,
      notes,
      isDriverDisbursed,
    } = req.body;

    if (!tripId) {
      res.status(400).json({ success: false, error: 'Trip association is mandatory for expense tracking.' });
      return;
    }

    const trip = serverFleetStore.trips.find((t) => t.id === tripId && t.companyId === companyId);
    if (!trip) {
      res.status(404).json({ success: false, error: 'Trip not found or does not belong to your company.' });
      return;
    }

    const amount = parseInt(amountPaise, 10);
    if (isNaN(amount) || amount <= 0) {
      res.status(400).json({ success: false, error: 'Amount must be a positive integer in paise.' });
      return;
    }

    if (!category) {
      res.status(400).json({ success: false, error: 'Expense category is required.' });
      return;
    }

    const effectiveReceipt = (receiptAttachmentUrl || receiptUrl)?.trim();

    const newExpense: TripExpense = {
      id: `exp_${companyId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      companyId,
      tripId: trip.id,
      tripNumber: trip.tripNumber,
      vehicleId: trip.vehicleId,
      vehicleReg: trip.vehicleReg,
      driverId: trip.driverId,
      driverName: trip.driverName,
      category: category as ExpenseCategory,
      amountPaise: amount,
      paymentMode: (paymentMode as PaymentMode) || 'CASH',
      expenseDate: expenseDate || new Date().toISOString().split('T')[0],
      litres: litres ? parseFloat(litres) : undefined,
      ratePerLitrePaise: ratePerLitrePaise ? parseInt(ratePerLitrePaise, 10) : undefined,
      petrolPumpName: petrolPumpName?.trim(),
      location: location?.trim(),
      odometerReading: odometerReading ? parseInt(odometerReading, 10) : undefined,
      receiptNumber: receiptNumber?.trim(),
      voucherNumber: voucherNumber?.trim(),
      receiptUrl: effectiveReceipt,
      receiptAttachmentUrl: effectiveReceipt,
      notes: notes?.trim(),
      recordedBy: req.user?.name || 'Operations',
      isDriverDisbursed: Boolean(isDriverDisbursed || paymentMode === 'CASH' || paymentMode === 'DRIVER_POCKET'),
      isSettled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    serverFleetStore.expenses.push(newExpense);

    // If FastTag deduction, decrease vehicle's FastTag balance
    if (newExpense.paymentMode === 'FASTAG') {
      const veh = serverFleetStore.vehicles.find((v) => v.id === trip.vehicleId && v.companyId === companyId);
      if (veh) {
        veh.fastagBalancePaise = Math.max(0, veh.fastagBalancePaise - amount);
      }
    }

    // Recalculate trip contribution (Revenue - Expenses)
    syncTripFinancialTotals(trip);

    await serverFleetStore.persistToFirestore(companyId, 'expenses', newExpense.id, newExpense);
    await serverFleetStore.persistToFirestore(companyId, 'trips', trip.id, trip);
    let updatedVehicle: any = null;
    if (newExpense.paymentMode === 'FASTAG') {
      const veh = serverFleetStore.vehicles.find((v) => v.id === trip.vehicleId && v.companyId === companyId);
      if (veh) {
        updatedVehicle = veh;
        await serverFleetStore.persistToFirestore(companyId, 'vehicles', veh.id, veh);
      }
    }

    res.status(201).json({
      success: true,
      message: `Recorded ${newExpense.category} expense of ₹${(amount / 100).toFixed(0)} for trip ${trip.tripNumber}.`,
      expense: newExpense,
      trip,
      vehicle: updatedVehicle,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to record expense' });
  }
});

/**
 * PUT /api/expenses/:id
 * Updates an existing trip expense
 */
financialsRouter.put('/expenses/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const expense = serverFleetStore.expenses.find((e) => e.id === req.params.id && e.companyId === companyId);

    if (!expense) {
      res.status(404).json({ success: false, error: 'Expense record not found in your company.' });
      return;
    }

    // Check if expense has already been settled in a finalized driver settlement
    if (expense.isSettled) {
      const isOwnerOrAdmin = req.role === 'OWNER' || req.role === 'ADMIN';
      if (!isOwnerOrAdmin || !req.body.isAuthorizedCorrection) {
        res.status(403).json({
          success: false,
          error: 'This expense voucher has been finalized in a driver settlement. Modifications require an authorized correction reason from an Administrator.',
        });
        return;
      }
    }

    const {
      category,
      amountPaise,
      paymentMode,
      expenseDate,
      litres,
      ratePerLitrePaise,
      petrolPumpName,
      location,
      odometerReading,
      receiptNumber,
      voucherNumber,
      receiptUrl,
      notes,
      isDriverDisbursed,
    } = req.body;

    if (amountPaise !== undefined) {
      const newAmount = parseInt(amountPaise, 10);
      if (isNaN(newAmount) || newAmount <= 0) {
        res.status(400).json({ success: false, error: 'Amount must be a positive integer in paise.' });
        return;
      }
      expense.amountPaise = newAmount;
    }

    if (category) expense.category = category;
    if (paymentMode) expense.paymentMode = paymentMode;
    if (expenseDate) expense.expenseDate = expenseDate;
    if (litres !== undefined) expense.litres = parseFloat(litres);
    if (ratePerLitrePaise !== undefined) expense.ratePerLitrePaise = parseInt(ratePerLitrePaise, 10);
    if (petrolPumpName !== undefined) expense.petrolPumpName = petrolPumpName.trim();
    if (location !== undefined) expense.location = location.trim();
    if (odometerReading !== undefined) expense.odometerReading = parseInt(odometerReading, 10);
    if (receiptNumber !== undefined) expense.receiptNumber = receiptNumber.trim();
    if (voucherNumber !== undefined) expense.voucherNumber = voucherNumber.trim();
    if (receiptUrl !== undefined) expense.receiptUrl = receiptUrl.trim();
    if (notes !== undefined) expense.notes = notes.trim();
    if (isDriverDisbursed !== undefined) expense.isDriverDisbursed = Boolean(isDriverDisbursed);
    expense.updatedAt = new Date().toISOString();

    // Recalculate trip contribution
    const trip = serverFleetStore.trips.find((t) => t.id === expense.tripId && t.companyId === companyId);
    if (trip) {
      syncTripFinancialTotals(trip);
      await serverFleetStore.persistToFirestore(companyId, 'trips', trip.id, trip);
    }

    await serverFleetStore.persistToFirestore(companyId, 'expenses', expense.id, expense);

    res.json({
      success: true,
      message: 'Expense record updated successfully.',
      expense,
      trip: trip || null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to update expense' });
  }
});

/**
 * DELETE /api/expenses/:id
 * Deletes an expense voucher
 */
financialsRouter.delete('/expenses/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const expenseIndex = serverFleetStore.expenses.findIndex((e) => e.id === req.params.id && e.companyId === companyId);

    if (expenseIndex === -1) {
      res.status(404).json({ success: false, error: 'Expense record not found in your company.' });
      return;
    }

    const expense = serverFleetStore.expenses[expenseIndex];
    if (expense.isSettled) {
      res.status(403).json({
        success: false,
        error: 'Cannot delete an expense that is already audited in a finalized driver settlement.',
      });
      return;
    }

    serverFleetStore.expenses.splice(expenseIndex, 1);
    await serverFleetStore.deleteFromFirestore(companyId, 'expenses', expense.id);

    // Recalculate trip contribution
    const trip = serverFleetStore.trips.find((t) => t.id === expense.tripId && t.companyId === companyId);
    if (trip) {
      syncTripFinancialTotals(trip);
      await serverFleetStore.persistToFirestore(companyId, 'trips', trip.id, trip);
    }

    res.json({
      success: true,
      message: 'Expense voucher removed.',
      trip: trip || null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to delete expense' });
  }
});

// =========================================================================
// 2. DRIVER ADVANCES ROUTES
// =========================================================================

/**
 * GET /api/advances
 * Lists driver cash advances
 */
financialsRouter.get('/advances', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 15;
    const search = ((req.query.search as string) || '').trim().toLowerCase();
    const tripId = (req.query.tripId as string) || '';
    const driverId = (req.query.driverId as string) || '';
    const isSettledParam = req.query.isSettled as string | undefined;

    let list = serverFleetStore.advances.filter((a) => a.companyId === companyId);

    if (tripId) {
      list = list.filter((a) => a.tripId === tripId);
    }

    if (driverId) {
      list = list.filter((a) => a.driverId === driverId);
    }

    if (isSettledParam !== undefined) {
      const wantSettled = isSettledParam === 'true';
      list = list.filter((a) => a.isSettled === wantSettled);
    }

    if (search) {
      list = list.filter(
        (a) =>
          (a.tripNumber && a.tripNumber.toLowerCase().includes(search)) ||
          (a.driverName && a.driverName.toLowerCase().includes(search)) ||
          (a.reference && a.reference.toLowerCase().includes(search)) ||
          (a.referenceNotes && a.referenceNotes.toLowerCase().includes(search)) ||
          (a.notes && a.notes.toLowerCase().includes(search)) ||
          a.advanceType.toLowerCase().includes(search)
      );
    }

    // Sort descending by date
    list.sort((a, b) => new Date(b.date || b.createdAt || 0).getTime() - new Date(a.date || a.createdAt || 0).getTime());

    const total = list.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginated = list.slice(startIndex, startIndex + limit);

    const totalAdvancesPaise = list.reduce((sum, a) => sum + a.amountPaise, 0);
    const settledAdvancesPaise = list.filter((a) => a.isSettled).reduce((sum, a) => sum + a.amountPaise, 0);
    const pendingAdvancesPaise = totalAdvancesPaise - settledAdvancesPaise;

    res.json({
      success: true,
      data: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      summary: {
        totalAdvancesPaise,
        settledAdvancesPaise,
        pendingAdvancesPaise,
        count: total,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to list advances' });
  }
});

/**
 * POST /api/advances
 * Records money advanced to a driver.
 * Advances are cash movements. They must NOT automatically count as trip expenses.
 */
financialsRouter.post('/advances', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const {
      tripId,
      driverId,
      amountPaise,
      date,
      paymentMode = 'CASH',
      advanceType = 'CASH_DISPATCH',
      reference,
      notes,
    } = req.body;

    if (!tripId) {
      res.status(400).json({ success: false, error: 'Trip association is required for driver advance disbursements.' });
      return;
    }

    const trip = serverFleetStore.trips.find((t) => t.id === tripId && t.companyId === companyId);
    if (!trip) {
      res.status(404).json({ success: false, error: 'Trip not found in your company.' });
      return;
    }

    const amount = parseInt(amountPaise, 10);
    if (isNaN(amount) || amount <= 0) {
      res.status(400).json({ success: false, error: 'Advance amount must be a positive integer in paise.' });
      return;
    }

    const effectiveDriverId = driverId || trip.driverId;
    const driver = serverFleetStore.drivers.find((d) => d.id === effectiveDriverId && d.companyId === companyId);
    const driverName = driver ? driver.fullName : trip.driverName;

    const newAdvance: DriverAdvance = {
      id: `adv_${companyId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      companyId,
      tripId: trip.id,
      tripNumber: trip.tripNumber,
      vehicleReg: trip.vehicleReg,
      driverId: effectiveDriverId,
      driverName,
      amountPaise: amount,
      advanceType,
      paymentMode,
      date: date || new Date().toISOString().split('T')[0],
      reference: reference?.trim(),
      referenceNotes: notes?.trim() || reference?.trim() || `Advance on trip ${trip.tripNumber}`,
      notes: notes?.trim(),
      disbursedBy: req.user?.name || 'Operations',
      isSettled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    serverFleetStore.advances.push(newAdvance);

    // Update driver's running advance ledger balance
    if (driver) {
      driver.currentAdvanceBalancePaise = (driver.currentAdvanceBalancePaise || 0) + amount;
      driver.updatedAt = new Date().toISOString();
      await serverFleetStore.persistToFirestore(companyId, 'drivers', driver.id, driver);
    }

    // Recompute trip totals (increases totalAdvancesPaise, but totalExpensesPaise and contributionPaise REMAIN UNTOUCHED!)
    syncTripFinancialTotals(trip);

    await serverFleetStore.persistToFirestore(companyId, 'advances', newAdvance.id, newAdvance);
    await serverFleetStore.persistToFirestore(companyId, 'trips', trip.id, trip);

    res.status(201).json({
      success: true,
      message: `Disbursed advance of ₹${(amount / 100).toFixed(0)} to ${driverName}.`,
      advance: newAdvance,
      trip,
      driver: driver || null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to record advance' });
  }
});

// =========================================================================
// 3. DRIVER SETTLEMENTS WORKFLOW
// =========================================================================

/**
 * GET /api/settlements
 * Lists settlement history with status filter
 */
financialsRouter.get('/settlements', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 15;
    const status = req.query.status as string;
    const search = ((req.query.search as string) || '').trim().toLowerCase();

    let list = serverFleetStore.settlements.filter((s) => s.companyId === companyId);

    if (status) {
      list = list.filter((s) => s.status === status);
    }

    if (search) {
      list = list.filter(
        (s) =>
          (s.tripNumber && s.tripNumber.toLowerCase().includes(search)) ||
          (s.driverName && s.driverName.toLowerCase().includes(search)) ||
          (s.settlementNumber && s.settlementNumber.toLowerCase().includes(search)) ||
          (s.settlementNotes && s.settlementNotes.toLowerCase().includes(search))
      );
    }

    list.sort((a, b) => new Date(b.settledDate || b.createdAt || 0).getTime() - new Date(a.settledDate || a.createdAt || 0).getTime());

    const total = list.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginated = list.slice(startIndex, startIndex + limit);

    const totalSettledAmountPaise = list.reduce((sum, s) => sum + s.totalAdvanceGivenPaise, 0);
    const finalizedCount = list.filter((s) => s.status === 'FINALIZED' || s.status === 'APPROVED_SETTLED').length;
    const pendingCount = list.filter((s) => s.status === 'DRAFT' || s.status === 'PENDING_APPROVAL').length;

    res.json({
      success: true,
      data: paginated,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      summary: {
        totalSettledAmountPaise,
        finalizedCount,
        pendingCount,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to list settlements' });
  }
});

/**
 * GET /api/settlements/:id
 * Retrieves full settlement dossier with attached expenses and advances
 */
financialsRouter.get('/settlements/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);
    const settlement = serverFleetStore.settlements.find((s) => s.id === req.params.id && s.companyId === companyId);

    if (!settlement) {
      res.status(404).json({ success: false, error: 'Settlement record not found in your company.' });
      return;
    }

    const trip = serverFleetStore.trips.find((t) => t.id === settlement.tripId && t.companyId === companyId);
    const expenses = serverFleetStore.expenses.filter((e) => e.tripId === settlement.tripId && e.companyId === companyId);
    const advances = serverFleetStore.advances.filter((a) => a.tripId === settlement.tripId && a.companyId === companyId);
    const driver = serverFleetStore.drivers.find((d) => d.id === settlement.driverId && d.companyId === companyId);

    res.json({
      success: true,
      settlement,
      trip: trip || null,
      expenses,
      advances,
      driver: driver || null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to get settlement details' });
  }
});

/**
 * POST /api/settlements
 * Creates or finalizes a driver settlement.
 * STRICTLY ENFORCES:
 * 1. Duplicate settlement prevention (One settlement per trip).
 * 2. Calculation: Total advances minus approved deductions equals remaining driver balance.
 * 3. Atomic status and balance updating on finalization.
 */
financialsRouter.post('/settlements', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const {
      tripId,
      status = 'FINALIZED', // 'DRAFT' | 'PENDING_APPROVAL' | 'FINALIZED' | 'APPROVED_SETTLED'
      driverBataDays = 1,
      approvedDeductionsPaise = 0,
      otherDeductionsPaise = 0,
      deductionReason,
      settlementNotes,
    } = req.body;

    if (!tripId) {
      res.status(400).json({ success: false, error: 'Trip selection is required for driver settlement.' });
      return;
    }

    const trip = serverFleetStore.trips.find((t) => t.id === tripId && t.companyId === companyId);
    if (!trip) {
      res.status(404).json({ success: false, error: 'Trip not found in your company.' });
      return;
    }

    // 1. PREVENT DUPLICATE SETTLEMENTS FOR THE SAME TRIP
    const existingSettlement = serverFleetStore.settlements.find(
      (s) => s.tripId === trip.id && s.companyId === companyId
    );
    if (existingSettlement) {
      res.status(409).json({
        success: false,
        error: `Trip ${trip.tripNumber} already has an existing settlement (${existingSettlement.settlementNumber || existingSettlement.id}). Duplicate settlements are strictly blocked. Review or edit the existing record instead.`,
        existingSettlementId: existingSettlement.id,
      });
      return;
    }

    const driver = serverFleetStore.drivers.find((d) => d.id === trip.driverId && d.companyId === companyId);
    const perDayBataPaise = driver?.perDayBataPaise || 50000; // ₹500 default daily allowance

    const advances = serverFleetStore.advances.filter((a) => a.tripId === trip.id && a.companyId === companyId);
    const expenses = serverFleetStore.expenses.filter((e) => e.tripId === trip.id && e.companyId === companyId);

    const deductions = parseInt(approvedDeductionsPaise, 10) || parseInt(otherDeductionsPaise, 10) || 0;
    const days = parseInt(driverBataDays, 10) || 1;

    // Use pure calculation engine
    const calc = calculateDriverSettlement(advances, expenses, days, perDayBataPaise, deductions);

    const settlementNumber = generateSettlementNumber(companyId);
    const isFinalized = status === 'FINALIZED' || status === 'APPROVED_SETTLED';

    const newSettlement: TripSettlement = {
      id: `stl_${companyId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      companyId,
      tripId: trip.id,
      tripNumber: trip.tripNumber,
      driverId: trip.driverId,
      driverName: trip.driverName,
      vehicleId: trip.vehicleId,
      vehicleReg: trip.vehicleReg,
      settlementNumber,
      totalAdvanceGivenPaise: calc.totalAdvancesGivenPaise,
      driverCashExpensesPaise: calc.driverPaidExpensesPaise,
      driverBataAllowancePaise: calc.driverBataAllowancePaise,
      approvedDeductionsPaise: deductions,
      otherDeductionsPaise: deductions,
      deductionReason: deductionReason?.trim(),
      remainingDriverBalancePaise: calc.remainingDriverBalancePaise,
      netPayableToDriverPaise: calc.netPayableToDriverPaise,
      isCompanyDue: calc.isCompanyDue,
      status: isFinalized ? 'FINALIZED' : 'PENDING_APPROVAL',
      settledDate: new Date().toISOString().split('T')[0],
      settledBy: req.user?.name || 'Accountant',
      settlementNotes: settlementNotes?.trim(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    serverFleetStore.settlements.push(newSettlement);

    // If finalized, lock the trip and advances atomically
    if (isFinalized) {
      trip.isSettled = true;
      if (trip.status === 'DELIVERED') {
        trip.status = 'SETTLED';
      }

      // Mark advances as settled
      for (const adv of advances) {
        adv.isSettled = true;
        adv.settlementId = newSettlement.id;
        adv.updatedAt = new Date().toISOString();
      }

      // Mark cash expenses as settled
      for (const exp of expenses) {
        if (exp.isDriverDisbursed || exp.paymentMode === 'CASH' || exp.paymentMode === 'DRIVER_POCKET') {
          exp.isSettled = true;
          exp.settlementId = newSettlement.id;
          exp.updatedAt = new Date().toISOString();
        }
      }

      // Adjust driver running balance
      if (driver) {
        // Driver returns surplus cash or company pays shortfall
        driver.currentAdvanceBalancePaise = Math.max(0, (driver.currentAdvanceBalancePaise || 0) - calc.totalAdvancesGivenPaise);
        driver.updatedAt = new Date().toISOString();
      }

      syncTripFinancialTotals(trip);
    }

    await serverFleetStore.persistToFirestore(companyId, 'settlements', newSettlement.id, newSettlement);
    await serverFleetStore.persistToFirestore(companyId, 'trips', trip.id, trip);
    if (driver) {
      await serverFleetStore.persistToFirestore(companyId, 'drivers', driver.id, driver);
    }
    const settledExpenses = expenses.filter((e) => e.isSettled && e.settlementId === newSettlement.id);
    if (isFinalized) {
      for (const adv of advances) {
        await serverFleetStore.persistToFirestore(companyId, 'advances', adv.id, adv);
      }
      for (const exp of settledExpenses) {
        await serverFleetStore.persistToFirestore(companyId, 'expenses', exp.id, exp);
      }
    }

    res.status(201).json({
      success: true,
      message: isFinalized
        ? `Finalized driver settlement ${settlementNumber} for trip ${trip.tripNumber}.`
        : `Created draft settlement ${settlementNumber} for review.`,
      settlement: newSettlement,
      trip,
      driver: driver || null,
      updatedAdvances: isFinalized ? advances : [],
      updatedExpenses: isFinalized ? settledExpenses : [],
      calculation: calc,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to create settlement' });
  }
});

/**
 * PUT /api/settlements/:id
 * Updates or finalizes a settlement.
 * STRICTLY PREVENTS CHANGES TO FINALIZED SETTLEMENTS without an authorized correction process!
 */
financialsRouter.put('/settlements/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const settlement = serverFleetStore.settlements.find((s) => s.id === req.params.id && s.companyId === companyId);

    if (!settlement) {
      res.status(404).json({ success: false, error: 'Settlement record not found in your company.' });
      return;
    }

    const isAlreadyFinalized = settlement.status === 'FINALIZED' || settlement.status === 'APPROVED_SETTLED';

    // PREVENT UNAUTHORIZED CHANGES TO FINALIZED SETTLEMENTS
    if (isAlreadyFinalized) {
      const isOwnerOrAdmin = req.role === 'OWNER' || req.role === 'ADMIN';
      const hasAuthCorrection = req.body.isCorrectionAuthorized && req.body.correctionReason;

      if (!isOwnerOrAdmin || !hasAuthCorrection) {
        res.status(403).json({
          success: false,
          error: 'Modifications to finalized driver settlements are locked. An authorized correction reason and Administrator privileges are required to modify finalized settlements.',
        });
        return;
      }

      // Log authorized correction
      settlement.isCorrectionAuthorized = true;
      settlement.correctionReason = req.body.correctionReason.trim();
      settlement.correctedBy = req.user?.name || 'Administrator';
      settlement.correctedAt = new Date().toISOString();
    }

    const {
      approvedDeductionsPaise,
      otherDeductionsPaise,
      deductionReason,
      settlementNotes,
      status,
      driverBataDays,
    } = req.body;

    const trip = serverFleetStore.trips.find((t) => t.id === settlement.tripId && t.companyId === companyId);
    const driver = serverFleetStore.drivers.find((d) => d.id === settlement.driverId && d.companyId === companyId);
    const perDayBataPaise = driver?.perDayBataPaise || 50000;

    const advances = serverFleetStore.advances.filter((a) => a.tripId === settlement.tripId && a.companyId === companyId);
    const expenses = serverFleetStore.expenses.filter((e) => e.tripId === settlement.tripId && e.companyId === companyId);

    const deductions =
      approvedDeductionsPaise !== undefined
        ? parseInt(approvedDeductionsPaise, 10)
        : otherDeductionsPaise !== undefined
        ? parseInt(otherDeductionsPaise, 10)
        : settlement.approvedDeductionsPaise || 0;

    const days = driverBataDays !== undefined ? parseInt(driverBataDays, 10) : 1;

    const calc = calculateDriverSettlement(advances, expenses, days, perDayBataPaise, deductions);

    settlement.totalAdvanceGivenPaise = calc.totalAdvancesGivenPaise;
    settlement.driverCashExpensesPaise = calc.driverPaidExpensesPaise;
    settlement.driverBataAllowancePaise = calc.driverBataAllowancePaise;
    settlement.approvedDeductionsPaise = deductions;
    settlement.otherDeductionsPaise = deductions;
    if (deductionReason !== undefined) settlement.deductionReason = deductionReason.trim();
    if (settlementNotes !== undefined) settlement.settlementNotes = settlementNotes.trim();
    settlement.remainingDriverBalancePaise = calc.remainingDriverBalancePaise;
    settlement.netPayableToDriverPaise = calc.netPayableToDriverPaise;
    settlement.isCompanyDue = calc.isCompanyDue;
    settlement.updatedAt = new Date().toISOString();

    if (status) {
      settlement.status = status;
      if ((status === 'FINALIZED' || status === 'APPROVED_SETTLED') && trip) {
        trip.isSettled = true;
        if (trip.status === 'DELIVERED') {
          trip.status = 'SETTLED';
        }
        for (const adv of advances) adv.isSettled = true;
        for (const exp of expenses) {
          if (exp.isDriverDisbursed || exp.paymentMode === 'CASH') exp.isSettled = true;
        }
        syncTripFinancialTotals(trip);
      }
    }

    await serverFleetStore.persistToFirestore(companyId, 'settlements', settlement.id, settlement);
    if (trip) {
      await serverFleetStore.persistToFirestore(companyId, 'trips', trip.id, trip);
    }
    if (driver) {
      await serverFleetStore.persistToFirestore(companyId, 'drivers', driver.id, driver);
    }
    for (const adv of advances) {
      await serverFleetStore.persistToFirestore(companyId, 'advances', adv.id, adv);
    }
    for (const exp of expenses) {
      if (exp.isSettled) {
        await serverFleetStore.persistToFirestore(companyId, 'expenses', exp.id, exp);
      }
    }

    res.json({
      success: true,
      message: 'Settlement record updated successfully.',
      settlement,
      trip: trip || null,
      driver: driver || null,
      updatedAdvances: advances,
      updatedExpenses: expenses.filter((e) => e.isSettled),
      calculation: calc,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to update settlement' });
  }
});
