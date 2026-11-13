/**
 * AnchorTransport TMS - Trip Management API Routes
 * Implements full Trip lifecycle, automated unique numbering,
 * vehicle conflict checks, strict status transitions, and decimal-safe financial calculations.
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest, requireAuth, requireRoles } from '../auth';
import { serverFleetStore } from '../store';
import {
  Trip,
  TripStatus,
  TripExpense,
  DriverAdvance,
  Vehicle,
  Driver,
  Customer,
} from '../../types/tms';
import { calculateTripContribution } from '../../lib/financialEngine';
import { adminDb } from '../../lib/firebase/admin';

export const tripsRouter = Router();

/**
 * Valid Status Transitions Matrix
 * Strictly enforces that trips move forward in operational order.
 * Terminal states (COMPLETED, CANCELLED) cannot be transitioned out of.
 */
export const ALLOWED_STATUS_TRANSITIONS: Record<TripStatus, TripStatus[]> = {
  PLANNED: ['DISPATCHED', 'CANCELLED'],
  DISPATCHED: ['IN_TRANSIT', 'DELIVERED', 'CANCELLED'],
  IN_TRANSIT: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['COMPLETED', 'SETTLED'],
  SETTLED: ['COMPLETED'],
  COMPLETED: [], // Terminal state
  CANCELLED: [], // Terminal state: historical records preserved
};

/**
 * Checks if a requested status transition is allowed
 */
export function isValidTransition(from: TripStatus, to: TripStatus): boolean {
  if (from === to) return true;
  const allowed = ALLOWED_STATUS_TRANSITIONS[from] || [];
  return allowed.includes(to);
}

/**
 * Generates the next sequential unique trip number for a company (e.g. TR-2026-0001)
 */
export function generateTripNumber(companyId: string): string {
  const year = new Date().getFullYear();
  const prefix = `TR-${year}-`;
  const companyTrips = serverFleetStore.trips.filter((t) => t.companyId === companyId);
  const existingNumbers = companyTrips
    .map((t) => t.tripNumber)
    .filter((n) => typeof n === 'string' && n.startsWith(prefix))
    .map((n) => {
      const numStr = n.replace(prefix, '');
      const parsed = parseInt(numStr, 10);
      return isNaN(parsed) ? 0 : parsed;
    });

  const nextSeq = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  return `${prefix}${nextSeq.toString().padStart(4, '0')}`;
}

/**
 * Generates next sequential Lorry Receipt (LR / Bilty) number for a company (e.g. LR-2026-0001)
 */
export function generateLrNumber(companyId: string): string {
  const year = new Date().getFullYear();
  const prefix = `LR-${year}-`;
  const companyTrips = serverFleetStore.trips.filter((t) => t.companyId === companyId);
  const existingNumbers = companyTrips
    .map((t) => t.lrNumber)
    .filter((n) => typeof n === 'string' && n.startsWith(prefix))
    .map((n) => {
      const numStr = n.replace(prefix, '');
      const parsed = parseInt(numStr, 10);
      return isNaN(parsed) ? 0 : parsed;
    });

  const nextSeq = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
  return `${prefix}${nextSeq.toString().padStart(4, '0')}`;
}

/**
 * Recalculate trip financial totals based on recorded expenses and advances
 */
export function syncTripFinancials(trip: Trip): Trip {
  const expenses = serverFleetStore.expenses.filter(
    (e) => e.tripId === trip.id && e.companyId === trip.companyId
  );
  const advances = serverFleetStore.advances.filter(
    (a) => a.tripId === trip.id && a.companyId === trip.companyId
  );

  const totalExpensesPaise = expenses.reduce((sum, e) => sum + e.amountPaise, 0);
  const totalAdvancesPaise = advances.reduce((sum, a) => sum + a.amountPaise, 0);
  
  // Trip Contribution = Revenue - Expenses (Advances do NOT count as expenses!)
  const contributionPaise = trip.totalRevenuePaise - totalExpensesPaise;

  trip.totalExpensesPaise = totalExpensesPaise;
  trip.totalAdvancesPaise = totalAdvancesPaise;
  trip.tripContributionPaise = contributionPaise;

  return trip;
}

// ============================================================================
// TRIPS ENDPOINTS
// ============================================================================

/**
 * GET /api/trips
 * Returns company-scoped trips with search, multi-field filters, and pagination
 */
tripsRouter.get('/trips', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);

    const search = ((req.query.search as string) || '').trim().toLowerCase();
    const status = (req.query.status as string) || 'ALL';
    const vehicleId = (req.query.vehicleId as string) || 'ALL';
    const driverId = (req.query.driverId as string) || 'ALL';
    const customerId = (req.query.customerId as string) || 'ALL';
    const dateFilter = (req.query.dateFilter as string) || 'ALL'; // ALL, TODAY, THIS_MONTH, CUSTOM
    const startDate = req.query.startDate as string;
    const endDate = req.query.endDate as string;
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 10));

    // 1. Company scope
    let list = serverFleetStore.trips.filter((t) => t.companyId === companyId);

    // 2. Synchronize financials for every trip
    list = list.map((t) => syncTripFinancials(t));

    // 3. Search query
    if (search) {
      list = list.filter(
        (t) =>
          t.tripNumber.toLowerCase().includes(search) ||
          t.lrNumber.toLowerCase().includes(search) ||
          t.vehicleReg.toLowerCase().includes(search) ||
          t.driverName.toLowerCase().includes(search) ||
          t.customerName.toLowerCase().includes(search) ||
          t.originCity.toLowerCase().includes(search) ||
          t.destinationCity.toLowerCase().includes(search) ||
          t.goodsType.toLowerCase().includes(search)
      );
    }

    // 4. Status filter
    if (status !== 'ALL') {
      list = list.filter((t) => t.status === status);
    }

    // 5. Vehicle filter
    if (vehicleId !== 'ALL') {
      list = list.filter((t) => t.vehicleId === vehicleId);
    }

    // 6. Driver filter
    if (driverId !== 'ALL') {
      list = list.filter((t) => t.driverId === driverId);
    }

    // 7. Customer filter
    if (customerId !== 'ALL') {
      list = list.filter((t) => t.customerId === customerId);
    }

    // 8. Date filters
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    if (dateFilter === 'TODAY') {
      list = list.filter((t) => t.dispatchDate.startsWith(todayStr));
    } else if (dateFilter === 'THIS_MONTH') {
      const currentMonth = todayStr.substring(0, 7); // YYYY-MM
      list = list.filter((t) => t.dispatchDate.startsWith(currentMonth));
    } else if (dateFilter === 'CUSTOM' && startDate && endDate) {
      list = list.filter((t) => t.dispatchDate >= startDate && t.dispatchDate <= endDate);
    }

    // 9. Sort by dispatchDate descending (newest first)
    list.sort((a, b) => new Date(b.dispatchDate).getTime() - new Date(a.dispatchDate).getTime());

    // 10. Pagination
    const total = list.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paginated = list.slice(startIndex, startIndex + limit);

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
        totalTrips: total,
        activeTrips: list.filter((t) => ['PLANNED', 'DISPATCHED', 'IN_TRANSIT'].includes(t.status)).length,
        deliveredTrips: list.filter((t) => ['DELIVERED', 'COMPLETED', 'SETTLED'].includes(t.status)).length,
        totalRevenuePaise: list.reduce((sum, t) => sum + t.totalRevenuePaise, 0),
        totalExpensesPaise: list.reduce((sum, t) => sum + t.totalExpensesPaise, 0),
        totalContributionPaise: list.reduce((sum, t) => sum + t.tripContributionPaise, 0),
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch trips' });
  }
});

/**
 * GET /api/trips/next-numbers
 * Returns unique next trip and LR numbers for quick form population
 */
tripsRouter.get('/trips/next-numbers', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);
    const tripNumber = generateTripNumber(companyId);
    const lrNumber = generateLrNumber(companyId);

    res.json({
      success: true,
      tripNumber,
      lrNumber,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to generate numbers' });
  }
});

/**
 * GET /api/trips/:id
 * Returns complete Trip Dossier with vehicle, driver, customer, expenses, advances, and timeline
 */
tripsRouter.get('/trips/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);
    const trip = serverFleetStore.trips.find((t) => t.id === req.params.id && t.companyId === companyId);

    if (!trip) {
      res.status(404).json({ success: false, error: 'Trip not found in your company records.' });
      return;
    }

    // Refresh financials
    syncTripFinancials(trip);

    const vehicle = serverFleetStore.vehicles.find((v) => v.id === trip.vehicleId && v.companyId === companyId);
    const driver = serverFleetStore.drivers.find((d) => d.id === trip.driverId && d.companyId === companyId);
    const customer = serverFleetStore.customers.find((c) => c.id === trip.customerId && c.companyId === companyId);
    const expenses = serverFleetStore.expenses.filter((e) => e.tripId === trip.id && e.companyId === companyId);
    const advances = serverFleetStore.advances.filter((a) => a.tripId === trip.id && a.companyId === companyId);
    const settlement = serverFleetStore.settlements.find((s) => s.tripId === trip.id && s.companyId === companyId);
    const invoice = serverFleetStore.invoices.find((i) => i.tripId === trip.id && i.companyId === companyId);

    // Calculate contribution details
    const contributionDetails = calculateTripContribution(trip.totalRevenuePaise, expenses);

    res.json({
      success: true,
      trip,
      vehicle: vehicle || null,
      driver: driver || null,
      customer: customer || null,
      expenses,
      advances,
      settlement: settlement || null,
      invoice: invoice || null,
      financials: {
        totalRevenuePaise: trip.totalRevenuePaise,
        totalExpensesPaise: trip.totalExpensesPaise,
        totalAdvancesPaise: trip.totalAdvancesPaise,
        tripContributionPaise: trip.tripContributionPaise,
        profitMarginPercent: contributionDetails.profitMarginPercent,
        fuelExpensesPaise: contributionDetails.fuelExpensesPaise,
        tollExpensesPaise: contributionDetails.tollExpensesPaise,
        otherExpensesPaise: contributionDetails.otherExpensesPaise,
        // Explicit assertion: Advances are balance sheet floats, NOT expenses
        advancesCountedInExpenses: false,
      },
      allowedNextStatuses: ALLOWED_STATUS_TRANSITIONS[trip.status] || [],
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch trip details' });
  }
});

/**
 * POST /api/trips
 * Creates a new trip with automated unique numbering and server-side vehicle conflict prevention
 */
tripsRouter.post('/trips', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const {
      tripNumber: requestedTripNum,
      lrNumber: requestedLrNum,
      customerId,
      vehicleId,
      driverId,
      originCity,
      destinationCity,
      dispatchDate,
      expectedDeliveryDate,
      goodsType,
      weightTonnes,
      ratePerTonnePaise,
      freightAmountPaise,
      otherChargesPaise = 0,
      startOdometerKm,
      initialAdvancePaise = 0,
      status: requestedStatus = 'PLANNED',
      notes,
    } = req.body;

    // 1. Validate required basic fields
    if (!customerId) {
      res.status(400).json({ success: false, error: 'Customer is required for trip booking.' });
      return;
    }
    if (!vehicleId) {
      res.status(400).json({ success: false, error: 'Vehicle assignment is required.' });
      return;
    }
    if (!driverId) {
      res.status(400).json({ success: false, error: 'Driver assignment is required.' });
      return;
    }
    if (!originCity || !destinationCity) {
      res.status(400).json({ success: false, error: 'Both Origin and Destination cities are required.' });
      return;
    }
    if (!dispatchDate) {
      res.status(400).json({ success: false, error: 'Dispatch date is required.' });
      return;
    }

    // 2. Validate associations within company
    const customer = serverFleetStore.customers.find((c) => c.id === customerId && c.companyId === companyId);
    if (!customer) {
      res.status(404).json({ success: false, error: 'Selected customer not found in company records.' });
      return;
    }

    const vehicle = serverFleetStore.vehicles.find((v) => v.id === vehicleId && v.companyId === companyId);
    if (!vehicle) {
      res.status(404).json({ success: false, error: 'Selected vehicle not found in company fleet.' });
      return;
    }

    const driver = serverFleetStore.drivers.find((d) => d.id === driverId && d.companyId === companyId);
    if (!driver) {
      res.status(404).json({ success: false, error: 'Selected driver not found in company directory.' });
      return;
    }

    // 3. Initial Status Validation
    const initialStatus: TripStatus = requestedStatus === 'DISPATCHED' ? 'DISPATCHED' : 'PLANNED';

    // 4. SERVER-SIDE VEHICLE ASSIGNMENT CONFLICT VALIDATION
    // If dispatching immediately, truck must NOT have an active ongoing trip
    if (initialStatus === 'DISPATCHED') {
      const activeTripForVehicle = serverFleetStore.trips.find(
        (t) =>
          t.companyId === companyId &&
          t.vehicleId === vehicle.id &&
          ['DISPATCHED', 'IN_TRANSIT'].includes(t.status)
      );

      if (activeTripForVehicle) {
        res.status(409).json({
          success: false,
          error: `Vehicle conflict: Truck "${vehicle.registrationNumber}" is currently assigned to active trip ${activeTripForVehicle.tripNumber} (${activeTripForVehicle.originCity} -> ${activeTripForVehicle.destinationCity}). Mark that trip delivered or completed before re-dispatching this truck.`,
        });
        return;
      }

      if (vehicle.status === 'UNDER_MAINTENANCE') {
        res.status(409).json({
          success: false,
          error: `Vehicle conflict: Truck "${vehicle.registrationNumber}" is currently in garage under maintenance. Cannot dispatch.`,
        });
        return;
      }

      // Check Driver conflict
      const activeTripForDriver = serverFleetStore.trips.find(
        (t) =>
          t.companyId === companyId &&
          t.driverId === driver.id &&
          ['DISPATCHED', 'IN_TRANSIT'].includes(t.status)
      );

      if (activeTripForDriver) {
        res.status(409).json({
          success: false,
          error: `Driver conflict: Driver "${driver.fullName}" is currently on road on trip ${activeTripForDriver.tripNumber}. Complete that trip first.`,
        });
        return;
      }
    }

    // 5. Unique Trip Number & LR Number
    let finalTripNum = requestedTripNum ? requestedTripNum.trim().toUpperCase() : generateTripNumber(companyId);
    const existingTripNum = serverFleetStore.trips.find(
      (t) => t.companyId === companyId && t.tripNumber.toUpperCase() === finalTripNum
    );
    if (existingTripNum) {
      // If requested was duplicate, re-generate uniquely
      finalTripNum = generateTripNumber(companyId);
    }

    let finalLrNum = requestedLrNum ? requestedLrNum.trim().toUpperCase() : generateLrNumber(companyId);
    const existingLr = serverFleetStore.trips.find(
      (t) => t.companyId === companyId && t.lrNumber.toUpperCase() === finalLrNum
    );
    if (existingLr) {
      finalLrNum = generateLrNumber(companyId);
    }

    // 6. Financial Calculations
    const weight = Math.max(0, parseFloat(weightTonnes) || 0);
    const ratePaise = Math.max(0, parseInt(ratePerTonnePaise, 10) || 0);
    const otherPaise = Math.max(0, parseInt(otherChargesPaise, 10) || 0);

    let calculatedFreight = Math.max(0, parseInt(freightAmountPaise, 10) || 0);
    if (!calculatedFreight && weight > 0 && ratePaise > 0) {
      calculatedFreight = Math.round(weight * ratePaise);
    }
    const totalRevPaise = calculatedFreight + otherPaise;

    const initialAdvance = Math.max(0, parseInt(initialAdvancePaise, 10) || 0);
    const nowIso = new Date().toISOString();

    const newTrip: Trip = {
      id: `trip_${companyId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      companyId,
      tripNumber: finalTripNum,
      lrNumber: finalLrNum,
      customerId: customer.id,
      customerName: customer.name,
      customerGstin: customer.gstin,
      vehicleId: vehicle.id,
      vehicleReg: vehicle.registrationNumber,
      driverId: driver.id,
      driverName: driver.fullName,
      driverPhone: driver.phone,
      originCity: originCity.trim(),
      destinationCity: destinationCity.trim(),
      goodsType: (goodsType || 'General Freight').trim(),
      weightTonnes: weight,
      ratePerTonnePaise: ratePaise,
      freightAmountPaise: calculatedFreight,
      otherChargesPaise: otherPaise,
      totalRevenuePaise: totalRevPaise,
      dispatchDate,
      expectedDeliveryDate: expectedDeliveryDate || dispatchDate,
      status: initialStatus,
      startOdometerKm: startOdometerKm !== undefined ? parseInt(startOdometerKm, 10) : vehicle.currentOdometerKm,
      podReceived: false,
      totalExpensesPaise: 0,
      totalAdvancesPaise: initialAdvance,
      tripContributionPaise: totalRevPaise,
      isSettled: false,
      isInvoiced: false,
      notes: notes ? notes.trim() : undefined,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    serverFleetStore.trips.unshift(newTrip);

    let createdAdvance: DriverAdvance | null = null;
    // 7. Side effects on vehicle and driver state
    if (initialStatus === 'DISPATCHED') {
      vehicle.status = 'IN_TRANSIT';
      vehicle.activeTripId = newTrip.id;
      vehicle.assignedDriverId = driver.id;
      vehicle.assignedDriverName = driver.fullName;
      vehicle.updatedAt = nowIso;

      driver.status = 'ON_TRIP';
      driver.assignedVehicleId = vehicle.id;
      driver.assignedVehicleReg = vehicle.registrationNumber;
      driver.updatedAt = nowIso;

      // Record advance if given
      if (initialAdvance > 0) {
        createdAdvance = {
          id: `adv_${companyId}_${Date.now()}`,
          companyId,
          tripId: newTrip.id,
          driverId: driver.id,
          amountPaise: initialAdvance,
          advanceType: 'CASH_DISPATCH',
          date: dispatchDate.split('T')[0],
          referenceNotes: `Initial cash advance on trip dispatch ${newTrip.tripNumber}`,
          disbursedBy: req.user?.name || 'Owner',
          isSettled: false,
        };
        serverFleetStore.advances.push(createdAdvance);
        driver.currentAdvanceBalancePaise += initialAdvance;
        await serverFleetStore.persistToFirestore(companyId, 'advances', createdAdvance.id, createdAdvance);
        await serverFleetStore.persistToFirestore(companyId, 'drivers', driver.id, driver);
      }
    }

    // Persist to Firestore if configured
    await serverFleetStore.persistToFirestore(companyId, 'trips', newTrip.id, newTrip);
    if (vehicle) {
      await serverFleetStore.persistToFirestore(companyId, 'vehicles', vehicle.id, vehicle);
    }

    res.status(201).json({
      success: true,
      message: `Trip ${newTrip.tripNumber} (LR: ${newTrip.lrNumber}) successfully booked.`,
      trip: newTrip,
      vehicle: vehicle || null,
      driver: driver || null,
      advance: createdAdvance,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to create trip' });
  }
});

/**
 * PUT /api/trips/:id
 * Updates an existing trip (origin, destination, freight, notes) with conflict safety
 */
tripsRouter.put('/trips/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const trip = serverFleetStore.trips.find((t) => t.id === req.params.id && t.companyId === companyId);

    if (!trip) {
      res.status(404).json({ success: false, error: 'Trip not found.' });
      return;
    }

    // Completed or cancelled trips cannot have freight/routing altered
    if (['COMPLETED', 'CANCELLED'].includes(trip.status)) {
      if (req.body.notes !== undefined) {
        trip.notes = req.body.notes;
        trip.updatedAt = new Date().toISOString();
        await serverFleetStore.persistToFirestore(companyId, 'trips', trip.id, trip);
        res.json({ success: true, message: 'Trip notes updated.', trip });
        return;
      }
      res.status(400).json({
        success: false,
        error: `Cannot modify trip in ${trip.status} state. Historical records are preserved.`,
      });
      return;
    }

    const {
      customerId,
      vehicleId,
      driverId,
      originCity,
      destinationCity,
      dispatchDate,
      expectedDeliveryDate,
      goodsType,
      weightTonnes,
      ratePerTonnePaise,
      freightAmountPaise,
      otherChargesPaise,
      notes,
    } = req.body;

    let releasedOldVehicle: any = null;
    let assignedNewVehicle: any = null;
    let updatedDriver: any = null;

    // If changing vehicle on active trip, enforce conflict check
    if (vehicleId && vehicleId !== trip.vehicleId && ['DISPATCHED', 'IN_TRANSIT'].includes(trip.status)) {
      const newVeh = serverFleetStore.vehicles.find((v) => v.id === vehicleId && v.companyId === companyId);
      if (!newVeh) {
        res.status(404).json({ success: false, error: 'New vehicle not found.' });
        return;
      }
      const activeOnNew = serverFleetStore.trips.find(
        (t) => t.id !== trip.id && t.companyId === companyId && t.vehicleId === newVeh.id && ['DISPATCHED', 'IN_TRANSIT'].includes(t.status)
      );
      if (activeOnNew) {
        res.status(409).json({
          success: false,
          error: `Vehicle conflict: Truck "${newVeh.registrationNumber}" is already on active trip ${activeOnNew.tripNumber}.`,
        });
        return;
      }
      // Release old vehicle
      const oldVeh = serverFleetStore.vehicles.find((v) => v.id === trip.vehicleId && v.companyId === companyId);
      if (oldVeh) {
        oldVeh.status = 'AVAILABLE';
        oldVeh.activeTripId = undefined;
        oldVeh.updatedAt = new Date().toISOString();
        releasedOldVehicle = oldVeh;
        await serverFleetStore.persistToFirestore(companyId, 'vehicles', oldVeh.id, oldVeh);
      }
      // Assign new vehicle
      newVeh.status = 'IN_TRANSIT';
      newVeh.activeTripId = trip.id;
      newVeh.updatedAt = new Date().toISOString();
      assignedNewVehicle = newVeh;
      await serverFleetStore.persistToFirestore(companyId, 'vehicles', newVeh.id, newVeh);
      trip.vehicleId = newVeh.id;
      trip.vehicleReg = newVeh.registrationNumber;
    }

    if (customerId) {
      const cust = serverFleetStore.customers.find((c) => c.id === customerId && c.companyId === companyId);
      if (cust) {
        trip.customerId = cust.id;
        trip.customerName = cust.name;
        trip.customerGstin = cust.gstin;
      }
    }

    if (driverId) {
      const drv = serverFleetStore.drivers.find((d) => d.id === driverId && d.companyId === companyId);
      if (drv) {
        trip.driverId = drv.id;
        trip.driverName = drv.fullName;
        trip.driverPhone = drv.phone;
        updatedDriver = drv;
      }
    }

    if (originCity) trip.originCity = originCity.trim();
    if (destinationCity) trip.destinationCity = destinationCity.trim();
    if (dispatchDate) trip.dispatchDate = dispatchDate;
    if (expectedDeliveryDate) trip.expectedDeliveryDate = expectedDeliveryDate;
    if (goodsType) trip.goodsType = goodsType.trim();

    if (weightTonnes !== undefined) trip.weightTonnes = Math.max(0, parseFloat(weightTonnes) || 0);
    if (ratePerTonnePaise !== undefined) trip.ratePerTonnePaise = Math.max(0, parseInt(ratePerTonnePaise, 10) || 0);
    if (otherChargesPaise !== undefined) trip.otherChargesPaise = Math.max(0, parseInt(otherChargesPaise, 10) || 0);

    if (freightAmountPaise !== undefined) {
      trip.freightAmountPaise = Math.max(0, parseInt(freightAmountPaise, 10) || 0);
    } else if (weightTonnes !== undefined || ratePerTonnePaise !== undefined) {
      trip.freightAmountPaise = Math.round(trip.weightTonnes * trip.ratePerTonnePaise);
    }

    trip.totalRevenuePaise = trip.freightAmountPaise + trip.otherChargesPaise;
    if (notes !== undefined) trip.notes = notes.trim();
    trip.updatedAt = new Date().toISOString();

    // Recalculate contribution
    syncTripFinancials(trip);

    await serverFleetStore.persistToFirestore(companyId, 'trips', trip.id, trip);

    res.json({
      success: true,
      message: `Trip ${trip.tripNumber} updated successfully.`,
      trip,
      oldVehicle: releasedOldVehicle,
      newVehicle: assignedNewVehicle,
      driver: updatedDriver,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to update trip' });
  }
});

/**
 * POST /api/trips/:id/status
 * Executes strict, validated status transition
 * Handles vehicle and driver status sync and terminal state cancellation preservation
 */
tripsRouter.post('/trips/:id/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await handleStatusTransition(req, res);
});
tripsRouter.post('/api/trips/:id/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await handleStatusTransition(req, res);
});
tripsRouter.patch('/trips/:id/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await handleStatusTransition(req, res);
});

async function handleStatusTransition(req: AuthenticatedRequest, res: Response) {
  try {
    const companyId = req.companyId!;
    const trip = serverFleetStore.trips.find((t) => t.id === req.params.id && t.companyId === companyId);

    if (!trip) {
      res.status(404).json({ success: false, error: 'Trip not found.' });
      return;
    }

    const {
      status: targetStatus,
      cancellationReason,
      endOdometerKm,
      actualDeliveryDate,
      podReceived,
      podRemarks,
    } = req.body;

    if (!targetStatus) {
      res.status(400).json({ success: false, error: 'Target status is required.' });
      return;
    }

    // 1. Strict Transition Machine Validation
    if (!isValidTransition(trip.status, targetStatus)) {
      res.status(400).json({
        success: false,
        error: `Invalid status transition: Cannot move trip from "${trip.status}" to "${targetStatus}". Valid next statuses: ${ALLOWED_STATUS_TRANSITIONS[trip.status]?.join(', ') || 'None (terminal)'}.`,
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const vehicle = serverFleetStore.vehicles.find((v) => v.id === trip.vehicleId && v.companyId === companyId);
    const driver = serverFleetStore.drivers.find((d) => d.id === trip.driverId && d.companyId === companyId);

    // 2. Handle specific transition rules
    if (targetStatus === 'DISPATCHED') {
      // Check vehicle availability
      if (vehicle) {
        const activeTripOnVeh = serverFleetStore.trips.find(
          (t) =>
            t.id !== trip.id &&
            t.companyId === companyId &&
            t.vehicleId === vehicle.id &&
            ['DISPATCHED', 'IN_TRANSIT'].includes(t.status)
        );
        if (activeTripOnVeh) {
          res.status(409).json({
            success: false,
            error: `Cannot dispatch: Truck "${vehicle.registrationNumber}" is already active on trip ${activeTripOnVeh.tripNumber}.`,
          });
          return;
        }
        vehicle.status = 'IN_TRANSIT';
        vehicle.activeTripId = trip.id;
        vehicle.assignedDriverId = trip.driverId;
        vehicle.assignedDriverName = trip.driverName;
      }
      if (driver) {
        driver.status = 'ON_TRIP';
        driver.assignedVehicleId = trip.vehicleId;
        driver.assignedVehicleReg = trip.vehicleReg;
      }
    } else if (targetStatus === 'IN_TRANSIT') {
      if (vehicle) {
        vehicle.status = 'IN_TRANSIT';
        vehicle.activeTripId = trip.id;
      }
      if (driver) {
        driver.status = 'ON_TRIP';
      }
    } else if (targetStatus === 'DELIVERED') {
      trip.actualDeliveryDate = actualDeliveryDate || nowIso;
      if (endOdometerKm !== undefined) {
        const odo = parseInt(endOdometerKm, 10);
        if (!isNaN(odo) && odo >= trip.startOdometerKm) {
          trip.endOdometerKm = odo;
          if (vehicle && odo > vehicle.currentOdometerKm) {
            vehicle.currentOdometerKm = odo;
          }
        }
      }
      if (podReceived !== undefined) {
        trip.podReceived = Boolean(podReceived);
      }
      if (podRemarks) {
        trip.podRemarks = podRemarks.trim();
      }
      // On delivery at destination, release vehicle and driver so vehicle is AVAILABLE for next trip
      if (vehicle) {
        vehicle.status = 'AVAILABLE';
        vehicle.activeTripId = undefined;
      }
      if (driver) {
        driver.status = 'AVAILABLE';
      }
    } else if (targetStatus === 'COMPLETED' || targetStatus === 'SETTLED') {
      // Trip completed: release vehicle and driver to AVAILABLE
      if (vehicle) {
        vehicle.status = 'AVAILABLE';
        vehicle.activeTripId = undefined;
      }
      if (driver) {
        driver.status = 'AVAILABLE';
        driver.totalTripsCompleted = (driver.totalTripsCompleted || 0) + 1;
      }
    } else if (targetStatus === 'CANCELLED') {
      // Cancellation preserves history and frees vehicle & driver
      trip.cancellationReason = (cancellationReason || 'Cancelled by transporter operations').trim();
      trip.cancelledAt = nowIso;
      trip.cancelledBy = req.user?.name || 'Authorized User';

      if (vehicle && vehicle.activeTripId === trip.id) {
        vehicle.status = 'AVAILABLE';
        vehicle.activeTripId = undefined;
      }
      if (driver && driver.status === 'ON_TRIP') {
        driver.status = 'AVAILABLE';
      }
    }

    trip.status = targetStatus;
    trip.updatedAt = nowIso;

    // Refresh financials
    syncTripFinancials(trip);

    await serverFleetStore.persistToFirestore(companyId, 'trips', trip.id, trip);
    if (vehicle) {
      await serverFleetStore.persistToFirestore(companyId, 'vehicles', vehicle.id, vehicle);
    }
    if (driver) {
      await serverFleetStore.persistToFirestore(companyId, 'drivers', driver.id, driver);
    }

    res.json({
      success: true,
      message: `Trip ${trip.tripNumber} status updated to ${targetStatus}.`,
      trip,
      vehicle: vehicle || null,
      driver: driver || null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to update status' });
  }
}

/**
 * POST /api/trips/:id/expenses
 * Quickly records an expense directly against a trip and updates contribution
 */
tripsRouter.post('/trips/:id/expenses', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const trip = serverFleetStore.trips.find((t) => t.id === req.params.id && t.companyId === companyId);

    if (!trip) {
      res.status(404).json({ success: false, error: 'Trip not found.' });
      return;
    }

    const {
      category,
      amountPaise,
      paymentMode,
      litres,
      ratePerLitrePaise,
      petrolPumpName,
      location,
      notes,
      expenseDate,
      voucherNumber,
    } = req.body;

    const amount = parseInt(amountPaise, 10);
    if (isNaN(amount) || amount <= 0) {
      res.status(400).json({ success: false, error: 'Expense amount must be a positive integer in paise.' });
      return;
    }

    const newExpense: TripExpense = {
      id: `exp_${companyId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      companyId,
      tripId: trip.id,
      tripNumber: trip.tripNumber,
      vehicleReg: trip.vehicleReg,
      driverName: trip.driverName,
      category: category || 'OTHER',
      amountPaise: amount,
      paymentMode: paymentMode || 'CASH',
      expenseDate: expenseDate || new Date().toISOString().split('T')[0],
      litres: litres ? parseFloat(litres) : undefined,
      ratePerLitrePaise: ratePerLitrePaise ? parseInt(ratePerLitrePaise, 10) : undefined,
      petrolPumpName: petrolPumpName?.trim(),
      location: location?.trim(),
      voucherNumber: voucherNumber?.trim(),
      notes: notes?.trim(),
      isDriverDisbursed: paymentMode === 'CASH' || paymentMode === 'DRIVER_POCKET',
      isSettled: false,
      recordedBy: req.user?.name || 'Operations',
      createdAt: new Date().toISOString(),
    };

    serverFleetStore.expenses.push(newExpense);

    // If FastTag deduction, decrease vehicle's FastTag balance
    if (paymentMode === 'FASTAG') {
      const veh = serverFleetStore.vehicles.find((v) => v.id === trip.vehicleId && v.companyId === companyId);
      if (veh) {
        veh.fastagBalancePaise = Math.max(0, veh.fastagBalancePaise - amount);
      }
    }

    // Recalculate trip contribution
    syncTripFinancials(trip);

    await serverFleetStore.persistToFirestore(companyId, 'expenses', newExpense.id, newExpense);
    await serverFleetStore.persistToFirestore(companyId, 'trips', trip.id, trip);
    let updatedVehicle: any = null;
    if (paymentMode === 'FASTAG') {
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
 * POST /api/trips/:id/advances
 * Disburses cash/UPI driver advance for this trip.
 * Advances do NOT count as corporate expenses!
 */
tripsRouter.post('/trips/:id/advances', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const trip = serverFleetStore.trips.find((t) => t.id === req.params.id && t.companyId === companyId);

    if (!trip) {
      res.status(404).json({ success: false, error: 'Trip not found.' });
      return;
    }

    const { amountPaise, advanceType = 'CASH_EN_ROUTE', referenceNotes, date } = req.body;
    const amount = parseInt(amountPaise, 10);
    if (isNaN(amount) || amount <= 0) {
      res.status(400).json({ success: false, error: 'Advance amount must be a positive integer in paise.' });
      return;
    }

    const newAdvance: DriverAdvance = {
      id: `adv_${companyId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      companyId,
      tripId: trip.id,
      driverId: trip.driverId,
      amountPaise: amount,
      advanceType,
      date: date || new Date().toISOString().split('T')[0],
      referenceNotes: referenceNotes?.trim() || `Advance on trip ${trip.tripNumber}`,
      disbursedBy: req.user?.name || 'Operations',
      isSettled: false,
    };

    serverFleetStore.advances.push(newAdvance);

    // Update driver advance balance
    const driver = serverFleetStore.drivers.find((d) => d.id === trip.driverId && d.companyId === companyId);
    if (driver) {
      driver.currentAdvanceBalancePaise += amount;
      await serverFleetStore.persistToFirestore(companyId, 'drivers', driver.id, driver);
    }

    // Recalculate trip totals (advances increased, expenses UNCHANGED)
    syncTripFinancials(trip);

    await serverFleetStore.persistToFirestore(companyId, 'advances', newAdvance.id, newAdvance);
    await serverFleetStore.persistToFirestore(companyId, 'trips', trip.id, trip);

    res.status(201).json({
      success: true,
      message: `Disbursed advance of ₹${(amount / 100).toFixed(0)} to ${trip.driverName}.`,
      advance: newAdvance,
      trip,
      driver: driver || null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to record advance' });
  }
});

/**
 * DELETE /api/trips/:id
 * Deletes a trip with referential integrity guard
 * Cannot delete active trips or trips with attached financial documents
 */
tripsRouter.delete(
  '/trips/:id',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const companyId = req.companyId!;
      const tripIndex = serverFleetStore.trips.findIndex((t) => t.id === req.params.id && t.companyId === companyId);

      if (tripIndex === -1) {
        res.status(404).json({ success: false, error: 'Trip not found.' });
        return;
      }

      const trip = serverFleetStore.trips[tripIndex];

      // Check active transit
      if (['DISPATCHED', 'IN_TRANSIT'].includes(trip.status)) {
        res.status(400).json({
          success: false,
          error: `Cannot delete trip ${trip.tripNumber} while in ${trip.status} state. Cancel or complete the trip first.`,
        });
        return;
      }

      // Check attached expenses
      const hasExpenses = serverFleetStore.expenses.some((e) => e.tripId === trip.id && e.companyId === companyId);
      if (hasExpenses) {
        res.status(400).json({
          success: false,
          error: `Cannot delete trip ${trip.tripNumber} because it has recorded fuel/toll expenses. Cancel the trip instead to preserve ledger records.`,
        });
        return;
      }

      // Check attached advances
      const hasAdvances = serverFleetStore.advances.some((a) => a.tripId === trip.id && a.companyId === companyId);
      if (hasAdvances) {
        res.status(400).json({
          success: false,
          error: `Cannot delete trip ${trip.tripNumber} because driver cash advances were disbursed against it. Cancel the trip instead.`,
        });
        return;
      }

      // Check invoice
      if (trip.isInvoiced) {
        res.status(400).json({
          success: false,
          error: `Cannot delete trip ${trip.tripNumber} because a GST invoice has been generated for it.`,
        });
        return;
      }

      serverFleetStore.trips.splice(tripIndex, 1);
      await serverFleetStore.deleteFromFirestore(companyId, 'trips', trip.id);

      res.json({
        success: true,
        message: `Trip ${trip.tripNumber} deleted successfully.`,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to delete trip' });
    }
  }
);

/**
 * POST /api/trips/reset & POST /trips/reset
 * Resets all trip dispatches for the authenticated company,
 * clearing trips, linked expenses, advances, and freeing vehicles/drivers to AVAILABLE.
 */
const handleResetCompanyTrips = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;

    // Find all trips for this company
    const companyTrips = serverFleetStore.trips.filter((t) => t.companyId === companyId);
    const companyTripIds = new Set(companyTrips.map((t) => t.id));

    // Remove company trips
    serverFleetStore.trips = serverFleetStore.trips.filter((t) => t.companyId !== companyId);

    // Remove trip expenses & advances linked to this company
    serverFleetStore.expenses = serverFleetStore.expenses.filter((e) => e.companyId !== companyId);
    serverFleetStore.advances = serverFleetStore.advances.filter((a) => a.companyId !== companyId);
    serverFleetStore.settlements = serverFleetStore.settlements.filter((s) => s.companyId !== companyId);
    serverFleetStore.invoices = serverFleetStore.invoices.filter((i) => i.companyId !== companyId);

    // Reset vehicles for this company back to AVAILABLE and clear activeTripId
    serverFleetStore.vehicles = serverFleetStore.vehicles.map((v) => {
      if (v.companyId === companyId) {
        return {
          ...v,
          status: v.status === 'UNDER_MAINTENANCE' ? 'UNDER_MAINTENANCE' : 'AVAILABLE',
          activeTripId: undefined,
        };
      }
      return v;
    });

    // Reset drivers for this company back to AVAILABLE and clear currentAdvanceBalancePaise
    serverFleetStore.drivers = serverFleetStore.drivers.map((d) => {
      if (d.companyId === companyId) {
        return {
          ...d,
          status: 'AVAILABLE',
          currentAdvanceBalancePaise: 0,
        };
      }
      return d;
    });

    const resetVehicles = serverFleetStore.vehicles.filter((v) => v.companyId === companyId);
    const resetDrivers = serverFleetStore.drivers.filter((d) => d.companyId === companyId);

    res.json({
      success: true,
      message: 'All commercial trips have been reset. Fleet is clear and ready for new dispatches.',
      resetTripsCount: companyTrips.length,
      vehicles: resetVehicles,
      drivers: resetDrivers,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to reset trips' });
  }
};

tripsRouter.post('/trips/reset', requireAuth, requireRoles(['OWNER', 'ADMIN', 'MANAGER']), handleResetCompanyTrips);
tripsRouter.post('/api/trips/reset', requireAuth, requireRoles(['OWNER', 'ADMIN', 'MANAGER']), handleResetCompanyTrips);

