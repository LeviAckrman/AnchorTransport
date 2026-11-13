/**
 * AnchorTransport TMS - Fleet & Customer Management API Routes
 * Implements full CRUD, search, pagination, validation, duplicate checks,
 * sensitive data redaction, and multi-tenant company isolation.
 */

import { Router, Response } from 'express';
import { AuthenticatedRequest, requireAuth, requireRoles } from '../auth';
import { serverFleetStore } from '../store';
import { Vehicle, Driver, Customer, VehicleDocument, UserRole } from '../../types/tms';
import { isAdminFirestoreWritable, runAdminFirestore } from '../../lib/firebase/admin';

export const fleetRouter = Router();

// Indian standard GSTIN regex
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const INDIAN_GSTIN_REGEX = GSTIN_REGEX;

// Indian vehicle registration standard regex (e.g., WB-19-K-4821, WB19K4821, WB 19 K 4821)
export const VEHICLE_REG_REGEX = /^[A-Z]{2}[ -]?[0-9]{1,2}[ -]?[A-Z]{1,3}[ -]?[0-9]{4}$/i;

// Indian 10-digit mobile phone
export const PHONE_REGEX = /^[6-9]\d{9}$/;
export const INDIAN_PHONE_REGEX = PHONE_REGEX;

/**
 * Normalise vehicle registration for strict duplicate detection:
 * e.g., "wb 19 k 4821" -> "WB-19-K-4821" / "WB19K4821"
 */
export function normalizeRegNumber(reg: string): string {
  return reg.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Format registration number cleanly with hyphens (e.g. WB-19-K-4821)
 */
export function formatRegNumber(reg: string): string {
  const clean = normalizeRegNumber(reg);
  const match = clean.match(/^([A-Z]{2})([0-9]{1,2})([A-Z]{1,3})([0-9]{4})$/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, '0')}-${match[3]}-${match[4]}`;
  }
  return reg.trim().toUpperCase();
}

export function extractPanFromGstin(gstin: string): string {
  const clean = gstin.trim().toUpperCase();
  if (clean.length >= 12) {
    return clean.substring(2, 12);
  }
  return '';
}

export const STATE_CODE_MAP: Record<string, string> = {
  '19': 'West Bengal',
  '21': 'Odisha',
  '10': 'Bihar',
  '20': 'Jharkhand',
  '18': 'Assam',
  '09': 'Uttar Pradesh',
  '27': 'Maharashtra',
  '07': 'Delhi',
  '33': 'Tamil Nadu',
  '29': 'Karnataka',
  '24': 'Gujarat',
  '23': 'Madhya Pradesh',
  '22': 'Chhattisgarh',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
};

export function getStateFromGstin(gstin: string): { code: string; name: string } | null {
  const clean = gstin.trim().toUpperCase();
  if (clean.length >= 2) {
    const code = clean.substring(0, 2);
    return { code, name: STATE_CODE_MAP[code] || 'Other State' };
  }
  return null;
}

/**
 * Synchronizes compliance document records for a vehicle into serverFleetStore.documents
 */
export function syncVehicleDocuments(
  vehicle: Vehicle,
  companyId: string
): { documents: VehicleDocument[]; deletedIds: string[] } {
  const removedIds = serverFleetStore.documents
    .filter((d) => d.companyId === companyId && d.vehicleId === vehicle.id)
    .map((d) => d.id);

  // Clear any previously existing documents for this vehicle in company
  serverFleetStore.documents = serverFleetStore.documents.filter(
    (d) => !(d.companyId === companyId && d.vehicleId === vehicle.id)
  );

  const now = Date.now();
  const todayStr = new Date().toISOString().split('T')[0];
  const createdDocs: VehicleDocument[] = [];

  const pushDoc = (
    docType: any,
    documentNumber?: string,
    expiryDate?: string,
    issuingAuthority = 'Transport Authority'
  ) => {
    if (!expiryDate) return;
    const daysUntil = Math.ceil((new Date(expiryDate).getTime() - now) / (1000 * 60 * 60 * 24));
    const docObj: VehicleDocument = {
      id: `doc_${companyId}_${vehicle.id}_${docType.toLowerCase()}`,
      companyId,
      vehicleId: vehicle.id,
      vehicleReg: vehicle.registrationNumber,
      docType,
      documentNumber: documentNumber || `${docType}-PENDING`,
      issuingAuthority,
      issueDate: todayStr,
      expiryDate,
      daysUntilExpiry: daysUntil,
      status: daysUntil < 0 ? 'EXPIRED' : daysUntil <= 30 ? 'EXPIRING_SOON' : 'VALID',
    };
    serverFleetStore.documents.push(docObj);
    createdDocs.push(docObj);
  };

  if (vehicle.insuranceExpiry) {
    pushDoc('INSURANCE', vehicle.insurancePolicyNumber, vehicle.insuranceExpiry, 'General Insurance Company');
  }
  if (vehicle.fitnessExpiry) {
    pushDoc('FITNESS', vehicle.fitnessCertificateNumber, vehicle.fitnessExpiry, 'RTO Transport Department');
  }
  if (vehicle.permitExpiry) {
    const pType = vehicle.permitType === 'STATE' ? 'STATE_PERMIT' : 'NATIONAL_PERMIT';
    pushDoc(pType, vehicle.permitNumber, vehicle.permitExpiry, 'State Transport Authority');
  }
  if (vehicle.pucExpiry) {
    pushDoc('PUC', vehicle.pucNumber, vehicle.pucExpiry, 'Pollution Testing Center');
  }

  // Also persist generated compliance documents to Firestore if available
  if (isAdminFirestoreWritable()) {
    for (const d of createdDocs) {
      serverFleetStore.persistToFirestore(companyId, 'documents', d.id, d).catch(() => {});
    }
  }

  const createdIdSet = new Set(createdDocs.map((d) => d.id));
  return {
    documents: createdDocs,
    deletedIds: removedIds.filter((id) => !createdIdSet.has(id)),
  };
}

/**
 * Check if the active user role has access to driver sensitive personal info
 */
function canAccessSensitiveInfo(role?: UserRole): boolean {
  return role === 'OWNER' || role === 'ADMIN' || role === 'ACCOUNTANT';
}

/**
 * Redact sensitive fields for non-privileged roles
 */
function sanitizeDriverForRole(driver: Driver, role?: UserRole): Driver {
  if (canAccessSensitiveInfo(role)) {
    return { ...driver, isSensitiveDataRedacted: false };
  }

  const maskLast4 = (val?: string) => {
    if (!val) return '';
    const clean = val.replace(/\s+/g, '');
    const last4 = clean.slice(-4);
    return `•••• •••• ${last4}`;
  };

  const maskPan = (pan?: string) => {
    if (!pan) return '';
    const last4 = pan.slice(-4);
    return `••••••${last4}`;
  };

  const maskBank = (acc?: string) => {
    if (!acc) return '';
    const last4 = acc.slice(-4);
    return `••••••••${last4}`;
  };

  return {
    ...driver,
    aadharNumber: driver.aadharNumber ? maskLast4(driver.aadharNumber) : undefined,
    panNumber: driver.panNumber ? maskPan(driver.panNumber) : undefined,
    bankAccount: driver.bankAccount ? maskBank(driver.bankAccount) : undefined,
    bankIfsc: driver.bankIfsc ? '••••••••' : undefined,
    monthlySalaryPaise: undefined, // Fully hidden from operations/managers
    isSensitiveDataRedacted: true,
  };
}

// ============================================================================
// VEHICLES ENDPOINTS
// ============================================================================

/**
 * GET /api/vehicles
 * Returns company-scoped vehicles with search, filtering, and pagination
 */
fleetRouter.get('/vehicles', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);

    const search = ((req.query.search as string) || '').trim().toLowerCase();
    const status = (req.query.status as string) || 'ALL';
    const vehicleType = (req.query.vehicleType as string) || 'ALL';
    const docStatus = (req.query.docStatus as string) || 'ALL'; // ALL, EXPIRING_SOON, EXPIRED
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 10));

    // 1. Company scope
    let list = serverFleetStore.vehicles.filter((v) => v.companyId === companyId);

    // 2. Search
    if (search) {
      list = list.filter(
        (v) =>
          v.registrationNumber.toLowerCase().includes(search) ||
          normalizeRegNumber(v.registrationNumber).includes(search.replace(/[^a-z0-9]/g, '')) ||
          v.makeModel.toLowerCase().includes(search) ||
          v.vehicleType.toLowerCase().includes(search) ||
          (v.assignedDriverName && v.assignedDriverName.toLowerCase().includes(search))
      );
    }

    // 3. Status filter
    if (status !== 'ALL') {
      list = list.filter((v) => v.status === status);
    }

    // 4. Vehicle type filter
    if (vehicleType !== 'ALL') {
      list = list.filter((v) => v.vehicleType === vehicleType);
    }

    // 5. Document compliance filter
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAhead = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    if (docStatus === 'EXPIRED') {
      list = list.filter((v) => {
        return (
          (v.fitnessExpiry && v.fitnessExpiry < today) ||
          (v.insuranceExpiry && v.insuranceExpiry < today) ||
          (v.permitExpiry && v.permitExpiry < today) ||
          (v.pucExpiry && v.pucExpiry < today)
        );
      });
    } else if (docStatus === 'EXPIRING_SOON') {
      list = list.filter((v) => {
        const isNear = (d?: string) => Boolean(d && d >= today && d <= thirtyDaysAhead);
        return isNear(v.fitnessExpiry) || isNear(v.insuranceExpiry) || isNear(v.permitExpiry) || isNear(v.pucExpiry);
      });
    }

    // Sort: newest first
    list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const total = list.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const items = list.slice(startIndex, startIndex + limit);

    res.json({
      success: true,
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch vehicles' });
  }
});

/**
 * GET /api/vehicles/:id
 * Returns single vehicle details along with related documents and recent trips
 */
fleetRouter.get('/vehicles/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);
    const vehicle = serverFleetStore.vehicles.find((v) => v.id === req.params.id && v.companyId === companyId);

    if (!vehicle) {
      res.status(404).json({ success: false, error: 'Vehicle not found or does not belong to your company.' });
      return;
    }

    // Associated compliance documents
    const documents = serverFleetStore.documents.filter(
      (d) => d.vehicleId === vehicle.id && d.companyId === companyId
    );

    // Associated recent trips
    const trips = serverFleetStore.trips
      .filter((t) => t.vehicleId === vehicle.id && t.companyId === companyId)
      .slice(0, 5);

    // Associated assigned driver
    const driver = vehicle.assignedDriverId
      ? serverFleetStore.drivers.find((d) => d.id === vehicle.assignedDriverId && d.companyId === companyId)
      : null;

    res.json({
      success: true,
      vehicle,
      documents,
      trips,
      driver: driver ? sanitizeDriverForRole(driver, req.role) : null,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch vehicle details' });
  }
});

/**
 * POST /api/vehicles
 * Creates a new vehicle with strict validation and duplicate check
 */
fleetRouter.post('/vehicles', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const {
      registrationNumber,
      vehicleType,
      makeModel,
      capacityTonnes,
      unladenWeightTonnes,
      chassisNumber,
      engineNumber,
      status = 'AVAILABLE',
      currentOdometerKm = 0,
      fastagBalancePaise = 0,
      assignedDriverId,
      insuranceExpiry,
      insurancePolicyNumber,
      fitnessExpiry,
      fitnessCertificateNumber,
      permitExpiry,
      permitNumber,
      permitType = 'NATIONAL',
      pucExpiry,
      pucNumber,
      notes,
    } = req.body;

    // 1. Validation
    if (!registrationNumber || typeof registrationNumber !== 'string') {
      res.status(400).json({ success: false, error: 'Registration number is required.' });
      return;
    }

    const cleanReg = normalizeRegNumber(registrationNumber);
    if (cleanReg.length < 6 || cleanReg.length > 15) {
      res.status(400).json({
        success: false,
        error: 'Invalid vehicle registration format. Must be a valid Indian registration number (e.g. WB-19-K-4821).',
      });
      return;
    }

    if (!VEHICLE_REG_REGEX.test(registrationNumber.trim())) {
      res.status(400).json({
        success: false,
        error: 'Registration number format is invalid. Accepted format example: WB-19-K-4821.',
      });
      return;
    }

    // 2. DUPLICATE CHECK within same company
    const existing = serverFleetStore.vehicles.find(
      (v) => v.companyId === companyId && normalizeRegNumber(v.registrationNumber) === cleanReg
    );
    if (existing) {
      res.status(409).json({
        success: false,
        error: `A vehicle with registration number "${existing.registrationNumber}" is already registered in your company fleet. Duplicate registrations are prohibited.`,
      });
      return;
    }

    if (!vehicleType) {
      res.status(400).json({ success: false, error: 'Vehicle type is required.' });
      return;
    }

    if (!makeModel || typeof makeModel !== 'string' || !makeModel.trim()) {
      res.status(400).json({ success: false, error: 'Make and model is required (e.g. Tata Signa 2823.TK).' });
      return;
    }

    const capacityNum = parseFloat(capacityTonnes);
    if (isNaN(capacityNum) || capacityNum <= 0) {
      res.status(400).json({ success: false, error: 'Payload capacity must be a positive number in Tonnes.' });
      return;
    }

    const unladenNum = parseFloat(unladenWeightTonnes) || 0;
    if (unladenNum < 0) {
      res.status(400).json({ success: false, error: 'Unladen weight cannot be negative.' });
      return;
    }

    const finalChassis = (chassisNumber && typeof chassisNumber === 'string' && chassisNumber.trim().length >= 4)
      ? chassisNumber.trim().toUpperCase()
      : `CHAS-${cleanReg}`;

    const finalEngine = (engineNumber && typeof engineNumber === 'string' && engineNumber.trim().length >= 4)
      ? engineNumber.trim().toUpperCase()
      : `ENG-${cleanReg}`;

    // Find assigned driver name if assigned
    let driverName: string | undefined;
    if (assignedDriverId) {
      const drv = serverFleetStore.drivers.find((d) => d.id === assignedDriverId && d.companyId === companyId);
      if (drv) {
        driverName = drv.fullName;
      }
    }

    const formattedReg = formatRegNumber(registrationNumber);
    const newVehicleId = `veh_${companyId}_${Date.now()}`;
    const nowIso = new Date().toISOString();

    const newVehicle: Vehicle = {
      id: newVehicleId,
      companyId,
      registrationNumber: formattedReg,
      vehicleType,
      makeModel: makeModel.trim(),
      capacityTonnes: capacityNum,
      unladenWeightTonnes: unladenNum,
      chassisNumber: finalChassis,
      engineNumber: finalEngine,
      status,
      currentOdometerKm: req.body.startOdometerKm !== undefined ? parseInt(req.body.startOdometerKm, 10) : Math.max(0, parseInt(currentOdometerKm, 10) || 0),
      fastagBalancePaise: req.body.fastagBalancePaise !== undefined ? parseInt(req.body.fastagBalancePaise, 10) : (req.body.fastagBalanceRupees !== undefined ? Math.round(parseFloat(req.body.fastagBalanceRupees) * 100) : 0),
      assignedDriverId: assignedDriverId || undefined,
      assignedDriverName: driverName,
      insuranceExpiry: insuranceExpiry || undefined,
      insurancePolicyNumber: insurancePolicyNumber?.trim() || undefined,
      fitnessExpiry: fitnessExpiry || undefined,
      fitnessCertificateNumber: fitnessCertificateNumber?.trim() || undefined,
      permitExpiry: permitExpiry || undefined,
      permitNumber: permitNumber?.trim() || undefined,
      permitType,
      pucExpiry: pucExpiry || undefined,
      pucNumber: pucNumber?.trim() || undefined,
      notes: notes?.trim() || undefined,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    serverFleetStore.vehicles.unshift(newVehicle);

    // Sync all compliance documents for vehicle
    const { documents: syncedDocs, deletedIds: deletedDocumentIds } = syncVehicleDocuments(newVehicle, companyId);

    // Also persist to Firestore if available
    await runAdminFirestore('Firestore vehicle sync note', async (db) => {
      await db
        .collection('companies')
        .doc(companyId)
        .collection('vehicles')
        .doc(newVehicle.id)
        .set(newVehicle);
    });

    res.status(201).json({
      success: true,
      message: `Vehicle ${formattedReg} added successfully to company fleet.`,
      vehicle: newVehicle,
      documents: syncedDocs,
      deletedDocumentIds,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to add vehicle' });
  }
});

/**
 * PUT /api/vehicles/:id
 * Updates an existing vehicle with duplicate check
 */
fleetRouter.put('/vehicles/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const vehicleId = req.params.id;
    const vehicle = serverFleetStore.vehicles.find((v) => v.id === vehicleId && v.companyId === companyId);

    if (!vehicle) {
      res.status(404).json({ success: false, error: 'Vehicle not found in your company fleet.' });
      return;
    }

    const {
      registrationNumber,
      vehicleType,
      makeModel,
      capacityTonnes,
      unladenWeightTonnes,
      chassisNumber,
      engineNumber,
      status,
      currentOdometerKm,
      fastagBalancePaise,
      assignedDriverId,
      insuranceExpiry,
      insurancePolicyNumber,
      fitnessExpiry,
      fitnessCertificateNumber,
      permitExpiry,
      permitNumber,
      permitType,
      pucExpiry,
      pucNumber,
      notes,
    } = req.body;

    // Check duplicate if registration is changed
    if (registrationNumber) {
      const cleanReg = normalizeRegNumber(registrationNumber);
      if (!VEHICLE_REG_REGEX.test(registrationNumber.trim())) {
        res.status(400).json({
          success: false,
          error: 'Registration number format is invalid. Accepted format example: WB-19-K-4821.',
        });
        return;
      }

      const duplicate = serverFleetStore.vehicles.find(
        (v) => v.id !== vehicleId && v.companyId === companyId && normalizeRegNumber(v.registrationNumber) === cleanReg
      );
      if (duplicate) {
        res.status(409).json({
          success: false,
          error: `Another vehicle with registration number "${duplicate.registrationNumber}" already exists in your fleet.`,
        });
        return;
      }
      vehicle.registrationNumber = formatRegNumber(registrationNumber);
    }

    if (vehicleType) vehicle.vehicleType = vehicleType;
    if (makeModel) vehicle.makeModel = makeModel.trim();
    if (capacityTonnes !== undefined) {
      const cap = parseFloat(capacityTonnes);
      if (isNaN(cap) || cap <= 0) {
        res.status(400).json({ success: false, error: 'Payload capacity must be a positive number.' });
        return;
      }
      vehicle.capacityTonnes = cap;
    }
    if (unladenWeightTonnes !== undefined) {
      vehicle.unladenWeightTonnes = Math.max(0, parseFloat(unladenWeightTonnes) || 0);
    }
    if (chassisNumber) vehicle.chassisNumber = chassisNumber.trim().toUpperCase();
    if (engineNumber) vehicle.engineNumber = engineNumber.trim().toUpperCase();
    if (status) vehicle.status = status;
    if (currentOdometerKm !== undefined) {
      vehicle.currentOdometerKm = Math.max(0, parseInt(currentOdometerKm, 10) || 0);
    }
    if (req.body.fastagBalanceRupees !== undefined) {
      vehicle.fastagBalancePaise = Math.max(0, Math.round(parseFloat(req.body.fastagBalanceRupees) * 100) || 0);
    } else if (fastagBalancePaise !== undefined) {
      vehicle.fastagBalancePaise = Math.max(0, parseInt(fastagBalancePaise, 10) || 0);
    }

    if (assignedDriverId !== undefined) {
      vehicle.assignedDriverId = assignedDriverId || undefined;
      if (assignedDriverId) {
        const drv = serverFleetStore.drivers.find((d) => d.id === assignedDriverId && d.companyId === companyId);
        vehicle.assignedDriverName = drv?.fullName;
      } else {
        vehicle.assignedDriverName = undefined;
      }
    }

    if (insuranceExpiry !== undefined) vehicle.insuranceExpiry = insuranceExpiry;
    if (insurancePolicyNumber !== undefined) vehicle.insurancePolicyNumber = insurancePolicyNumber;
    if (fitnessExpiry !== undefined) vehicle.fitnessExpiry = fitnessExpiry;
    if (fitnessCertificateNumber !== undefined) vehicle.fitnessCertificateNumber = fitnessCertificateNumber;
    if (permitExpiry !== undefined) vehicle.permitExpiry = permitExpiry;
    if (permitNumber !== undefined) vehicle.permitNumber = permitNumber;
    if (permitType !== undefined) vehicle.permitType = permitType;
    if (pucExpiry !== undefined) vehicle.pucExpiry = pucExpiry;
    if (pucNumber !== undefined) vehicle.pucNumber = pucNumber;
    if (notes !== undefined) vehicle.notes = notes;

    vehicle.updatedAt = new Date().toISOString();

    // Re-sync compliance documents
    const { documents: syncedDocs, deletedIds: deletedDocumentIds } = syncVehicleDocuments(vehicle, companyId);

    // Persist to Firestore if available
    await runAdminFirestore('Firestore vehicle update note', async (db) => {
      await db
        .collection('companies')
        .doc(companyId)
        .collection('vehicles')
        .doc(vehicle.id)
        .set(vehicle, { merge: true });
    });

    res.json({
      success: true,
      message: `Vehicle ${vehicle.registrationNumber} updated successfully.`,
      vehicle,
      documents: syncedDocs,
      deletedDocumentIds,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to update vehicle' });
  }
});

/**
 * DELETE /api/vehicles/:id
 * Deletes a vehicle with referential integrity check (cannot delete if on trip)
 */
fleetRouter.delete(
  '/vehicles/:id',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const companyId = req.companyId!;
      const vehicleId = req.params.id;
      const vehicle = serverFleetStore.vehicles.find((v) => v.id === vehicleId && v.companyId === companyId);

      if (!vehicle) {
        res.status(404).json({ success: false, error: 'Vehicle not found in your company fleet.' });
        return;
      }

      // Check active trips
      const activeTrips = serverFleetStore.trips.filter(
        (t) =>
          t.vehicleId === vehicleId &&
          t.companyId === companyId &&
          (t.status === 'IN_TRANSIT' || t.status === 'DISPATCHED' || t.status === 'PLANNED')
      );

      if (activeTrips.length > 0) {
        res.status(400).json({
          success: false,
          error: `Cannot delete truck ${vehicle.registrationNumber}: It is currently assigned to ${activeTrips.length} active trip(s) (e.g. ${activeTrips[0].tripNumber}). Complete or cancel active trips first.`,
        });
        return;
      }

      // Remove from store
      serverFleetStore.vehicles = serverFleetStore.vehicles.filter((v) => v.id !== vehicleId);

      // Clean up linked documents
      const deletedDocumentIds = serverFleetStore.documents
        .filter((d) => d.companyId === companyId && d.vehicleId === vehicleId)
        .map((d) => d.id);
      serverFleetStore.documents = serverFleetStore.documents.filter((d) => d.vehicleId !== vehicleId);

      await runAdminFirestore('Firestore vehicle delete note', async (db) => {
        await db.collection('companies').doc(companyId).collection('vehicles').doc(vehicleId).delete();
      });

      res.json({
        success: true,
        message: `Vehicle ${vehicle.registrationNumber} deleted successfully.`,
        deletedDocumentIds,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to delete vehicle' });
    }
  }
);

// ============================================================================
// DRIVERS ENDPOINTS
// ============================================================================

/**
 * GET /api/drivers
 * Returns company-scoped drivers with search, status filtering, and sensitive data protection
 */
fleetRouter.get('/drivers', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);

    const search = ((req.query.search as string) || '').trim().toLowerCase();
    const status = (req.query.status as string) || 'ALL';
    const licenseFilter = (req.query.licenseFilter as string) || 'ALL';
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 10));

    let list = serverFleetStore.drivers.filter((d) => d.companyId === companyId);

    // Search
    if (search) {
      list = list.filter(
        (d) =>
          d.fullName.toLowerCase().includes(search) ||
          d.phone.includes(search) ||
          d.licenseNumber.toLowerCase().includes(search) ||
          (d.assignedVehicleReg && d.assignedVehicleReg.toLowerCase().includes(search))
      );
    }

    // Status filter
    if (status !== 'ALL') {
      list = list.filter((d) => d.status === status);
    }

    // License expiry filter
    const today = new Date().toISOString().split('T')[0];
    const thirtyDaysAhead = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    if (licenseFilter === 'EXPIRED') {
      list = list.filter((d) => d.licenseExpiry < today);
    } else if (licenseFilter === 'EXPIRING_SOON') {
      list = list.filter((d) => d.licenseExpiry >= today && d.licenseExpiry <= thirtyDaysAhead);
    }

    // Sort: newest or alphabetical
    list.sort((a, b) => a.fullName.localeCompare(b.fullName));

    const total = list.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paged = list.slice(startIndex, startIndex + limit);

    // Apply sensitive data redaction based on requester's role
    const sanitized = paged.map((d) => sanitizeDriverForRole(d, req.role));

    res.json({
      success: true,
      data: sanitized,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch drivers' });
  }
});

/**
 * GET /api/drivers/:id
 * Returns single driver details with role-based sensitive data protection
 */
fleetRouter.get('/drivers/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);
    const driver = serverFleetStore.drivers.find((d) => d.id === req.params.id && d.companyId === companyId);

    if (!driver) {
      res.status(404).json({ success: false, error: 'Driver not found in your company directory.' });
      return;
    }

    const trips = serverFleetStore.trips
      .filter((t) => t.driverId === driver.id && t.companyId === companyId)
      .slice(0, 5);

    const advances = serverFleetStore.advances
      .filter((a) => a.driverId === driver.id && a.companyId === companyId)
      .slice(0, 5);

    res.json({
      success: true,
      driver: sanitizeDriverForRole(driver, req.role),
      trips,
      advances,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch driver details' });
  }
});

/**
 * POST /api/drivers
 * Adds a new driver with validation and role-based sensitive field protection
 */
fleetRouter.post('/drivers', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const isPrivileged = canAccessSensitiveInfo(req.role);

    const {
      fullName,
      phone,
      altPhone,
      licenseNumber,
      licenseExpiry,
      badgeNumber,
      address,
      emergencyContact,
      emergencyPhone,
      status = 'AVAILABLE',
      perDayBataPaise = 50000,
      monthlySalaryPaise,
      assignedVehicleReg,
      aadharNumber,
      panNumber,
      bankAccount,
      bankIfsc,
      bankName,
      bankBranch,
    } = req.body;

    if (!fullName || typeof fullName !== 'string' || fullName.trim().length < 2) {
      res.status(400).json({ success: false, error: 'Full driver name is required.' });
      return;
    }

    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    const clean10DigitPhone = cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone;
    if (!PHONE_REGEX.test(clean10DigitPhone)) {
      res.status(400).json({ success: false, error: 'Valid 10-digit Indian phone number is required.' });
      return;
    }

    if (!licenseNumber || licenseNumber.trim().length < 6) {
      res.status(400).json({ success: false, error: 'Valid Driving License (DL) number is required.' });
      return;
    }

    if (!licenseExpiry) {
      res.status(400).json({ success: false, error: 'Driving License expiry date is required.' });
      return;
    }

    // Check duplicate license in company
    const existingDl = serverFleetStore.drivers.find(
      (d) => d.companyId === companyId && d.licenseNumber.toUpperCase() === licenseNumber.trim().toUpperCase()
    );
    if (existingDl) {
      res.status(409).json({
        success: false,
        error: `A driver with Driving License "${licenseNumber}" is already registered (${existingDl.fullName}).`,
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const newDriverId = `drv_${companyId}_${Date.now()}`;

    const newDriver: Driver = {
      id: newDriverId,
      companyId,
      fullName: fullName.trim(),
      phone: `+91 ${clean10DigitPhone}`,
      altPhone: altPhone ? `+91 ${altPhone.replace(/[^0-9]/g, '').slice(-10)}` : undefined,
      licenseNumber: licenseNumber.trim().toUpperCase(),
      licenseExpiry,
      badgeNumber: badgeNumber?.trim() || undefined,
      address: address?.trim() || '',
      emergencyContact: emergencyContact?.trim() || '',
      emergencyPhone: emergencyPhone?.trim()
        ? `+91 ${emergencyPhone.replace(/[^0-9]/g, '').slice(-10)}`
        : '',
      status,
      currentAdvanceBalancePaise: 0,
      totalTripsCompleted: 0,
      perDayBataPaise: req.body.perDayBataPaise !== undefined 
        ? parseInt(req.body.perDayBataPaise, 10) 
        : (req.body.perDayBataRupees !== undefined ? Math.round(parseFloat(req.body.perDayBataRupees) * 100) : 50000),
      assignedVehicleReg: assignedVehicleReg?.trim() || undefined,
      // Sensitive fields only allowed if privileged
      monthlySalaryPaise: isPrivileged 
        ? (req.body.monthlySalaryPaise !== undefined 
            ? parseInt(req.body.monthlySalaryPaise, 10) 
            : (req.body.monthlySalaryRupees !== undefined ? Math.round(parseFloat(req.body.monthlySalaryRupees) * 100) : undefined))
        : undefined,
      aadharNumber: isPrivileged && aadharNumber ? aadharNumber.replace(/\s+/g, '') : undefined,
      panNumber: isPrivileged && panNumber ? panNumber.trim().toUpperCase() : undefined,
      bankAccount: isPrivileged && bankAccount ? bankAccount.trim() : undefined,
      bankIfsc: isPrivileged && bankIfsc ? bankIfsc.trim().toUpperCase() : undefined,
      bankName: isPrivileged && bankName ? bankName.trim() : undefined,
      bankBranch: isPrivileged && bankBranch ? bankBranch.trim() : undefined,
      joinedDate: nowIso.split('T')[0],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    serverFleetStore.drivers.unshift(newDriver);

    await runAdminFirestore('Firestore driver sync note', async (db) => {
      await db.collection('companies').doc(companyId).collection('drivers').doc(newDriver.id).set(newDriver);
    });

    res.status(201).json({
      success: true,
      message: `Driver ${newDriver.fullName} onboarded successfully.`,
      driver: sanitizeDriverForRole(newDriver, req.role),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to add driver' });
  }
});

/**
 * PUT /api/drivers/:id
 * Updates an existing driver
 */
fleetRouter.put('/drivers/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const driverId = req.params.id;
    const isPrivileged = canAccessSensitiveInfo(req.role);
    const driver = serverFleetStore.drivers.find((d) => d.id === driverId && d.companyId === companyId);

    if (!driver) {
      res.status(404).json({ success: false, error: 'Driver not found in your company directory.' });
      return;
    }

    const {
      fullName,
      phone,
      altPhone,
      licenseNumber,
      licenseExpiry,
      badgeNumber,
      address,
      emergencyContact,
      emergencyPhone,
      status,
      perDayBataPaise,
      monthlySalaryPaise,
      assignedVehicleReg,
      aadharNumber,
      panNumber,
      bankAccount,
      bankIfsc,
      bankName,
      bankBranch,
    } = req.body;

    if (fullName) driver.fullName = fullName.trim();
    if (phone) {
      const clean = phone.replace(/[^0-9]/g, '').slice(-10);
      if (PHONE_REGEX.test(clean)) {
        driver.phone = `+91 ${clean}`;
      }
    }
    if (altPhone) {
      const clean = altPhone.replace(/[^0-9]/g, '').slice(-10);
      driver.altPhone = clean ? `+91 ${clean}` : undefined;
    }
    if (licenseNumber) {
      const duplicate = serverFleetStore.drivers.find(
        (d) => d.id !== driverId && d.companyId === companyId && d.licenseNumber.toUpperCase() === licenseNumber.trim().toUpperCase()
      );
      if (duplicate) {
        res.status(409).json({
          success: false,
          error: `Another driver with DL "${licenseNumber}" already exists in your company.`,
        });
        return;
      }
      driver.licenseNumber = licenseNumber.trim().toUpperCase();
    }
    if (licenseExpiry) driver.licenseExpiry = licenseExpiry;
    if (badgeNumber !== undefined) driver.badgeNumber = badgeNumber;
    if (address !== undefined) driver.address = address;
    if (emergencyContact !== undefined) driver.emergencyContact = emergencyContact;
    if (emergencyPhone !== undefined) driver.emergencyPhone = emergencyPhone;
    if (status) driver.status = status;
    if (req.body.perDayBataRupees !== undefined) {
      driver.perDayBataPaise = Math.max(0, Math.round(parseFloat(req.body.perDayBataRupees) * 100) || 0);
    } else if (perDayBataPaise !== undefined) {
      driver.perDayBataPaise = Math.max(0, parseInt(perDayBataPaise, 10) || 0);
    }
    if (assignedVehicleReg !== undefined) driver.assignedVehicleReg = assignedVehicleReg;

    // Sensitive fields only editable if privileged
    if (isPrivileged) {
      if (req.body.monthlySalaryRupees !== undefined) {
        driver.monthlySalaryPaise = Math.max(0, Math.round(parseFloat(req.body.monthlySalaryRupees) * 100) || 0);
      } else if (monthlySalaryPaise !== undefined) {
        driver.monthlySalaryPaise = Math.max(0, parseInt(monthlySalaryPaise, 10) || 0);
      }
      if (aadharNumber !== undefined) driver.aadharNumber = aadharNumber.replace(/\s+/g, '');
      if (panNumber !== undefined) driver.panNumber = panNumber.trim().toUpperCase();
      if (bankAccount !== undefined) driver.bankAccount = bankAccount.trim();
      if (bankIfsc !== undefined) driver.bankIfsc = bankIfsc.trim().toUpperCase();
      if (bankName !== undefined) driver.bankName = bankName.trim();
      if (bankBranch !== undefined) driver.bankBranch = bankBranch.trim();
    }

    driver.updatedAt = new Date().toISOString();

    await runAdminFirestore('Firestore driver update note', async (db) => {
      await db.collection('companies').doc(companyId).collection('drivers').doc(driver.id).set(driver, { merge: true });
    });

    res.json({
      success: true,
      message: `Driver ${driver.fullName} updated successfully.`,
      driver: sanitizeDriverForRole(driver, req.role),
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to update driver' });
  }
});

/**
 * DELETE /api/drivers/:id
 * Deletes a driver (prevents deleting if currently on trip)
 */
fleetRouter.delete(
  '/drivers/:id',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const companyId = req.companyId!;
      const driverId = req.params.id;
      const driver = serverFleetStore.drivers.find((d) => d.id === driverId && d.companyId === companyId);

      if (!driver) {
        res.status(404).json({ success: false, error: 'Driver not found in your company directory.' });
        return;
      }

      if (driver.status === 'ON_TRIP') {
        res.status(400).json({
          success: false,
          error: `Cannot delete driver ${driver.fullName}: Driver is currently recorded as ON_TRIP. Settle or reassign the active trip first.`,
        });
        return;
      }

      serverFleetStore.drivers = serverFleetStore.drivers.filter((d) => d.id !== driverId);

      await runAdminFirestore('Firestore driver delete note', async (db) => {
        await db.collection('companies').doc(companyId).collection('drivers').doc(driverId).delete();
      });

      res.json({
        success: true,
        message: `Driver ${driver.fullName} deleted successfully.`,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to delete driver' });
    }
  }
);

// ============================================================================
// CUSTOMERS ENDPOINTS
// ============================================================================

/**
 * GET /api/customers
 * Returns company-scoped customers with search and pagination
 */
fleetRouter.get('/customers', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);

    const search = ((req.query.search as string) || '').trim().toLowerCase();
    const balanceFilter = (req.query.balanceFilter as string) || 'ALL'; // ALL, OUTSTANDING, CLEARED
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.max(1, Math.min(100, parseInt(req.query.limit as string, 10) || 10));

    let list = serverFleetStore.customers.filter((c) => c.companyId === companyId);

    if (search) {
      list = list.filter(
        (c) =>
          c.name.toLowerCase().includes(search) ||
          (c.tradeName && c.tradeName.toLowerCase().includes(search)) ||
          c.gstin.toLowerCase().includes(search) ||
          c.city.toLowerCase().includes(search) ||
          c.contactPerson.toLowerCase().includes(search) ||
          c.phone.includes(search)
      );
    }

    if (balanceFilter === 'OUTSTANDING') {
      list = list.filter((c) => c.currentOutstandingPaise > 0);
    } else if (balanceFilter === 'CLEARED') {
      list = list.filter((c) => c.currentOutstandingPaise === 0);
    }

    list.sort((a, b) => b.currentOutstandingPaise - a.currentOutstandingPaise);

    const total = list.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIndex = (page - 1) * limit;
    const paged = list.slice(startIndex, startIndex + limit);

    res.json({
      success: true,
      data: paged,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch customers' });
  }
});

/**
 * GET /api/customers/:id
 * Returns single customer details with invoice history and outstanding breakdown
 */
fleetRouter.get('/customers/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);
    const customer = serverFleetStore.customers.find((c) => c.id === req.params.id && c.companyId === companyId);

    if (!customer) {
      res.status(404).json({ success: false, error: 'Customer not found in your company directory.' });
      return;
    }

    const invoices = serverFleetStore.invoices.filter(
      (i) => i.customerId === customer.id && i.companyId === companyId
    );

    const recentTrips = serverFleetStore.trips
      .filter((t) => t.customerId === customer.id && t.companyId === companyId)
      .slice(0, 5);

    res.json({
      success: true,
      customer,
      invoices,
      recentTrips,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch customer details' });
  }
});

/**
 * GET /api/customers/:id/invoices
 * Returns full invoice history for a customer
 */
fleetRouter.get('/customers/:id/invoices', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const customer = serverFleetStore.customers.find((c) => c.id === req.params.id && c.companyId === companyId);

    if (!customer) {
      res.status(404).json({ success: false, error: 'Customer not found.' });
      return;
    }

    const invoices = serverFleetStore.invoices.filter(
      (i) => i.customerId === customer.id && i.companyId === companyId
    );

    const totalBilled = invoices.reduce((sum, i) => sum + i.totalAmountPaise, 0);
    const totalPaid = invoices.reduce((sum, i) => sum + i.amountPaidPaise, 0);
    const totalDue = invoices.reduce((sum, i) => sum + i.balanceDuePaise, 0);

    res.json({
      success: true,
      customer: {
        id: customer.id,
        name: customer.name,
        gstin: customer.gstin,
      },
      summary: {
        totalInvoices: invoices.length,
        totalBilledPaise: totalBilled,
        totalPaidPaise: totalPaid,
        balanceDuePaise: totalDue,
      },
      invoices,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch customer invoices' });
  }
});

/**
 * POST /api/customers
 * Creates a new customer with GSTIN validation and PAN derivation
 */
fleetRouter.post('/customers', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const {
      name,
      tradeName,
      gstin,
      pan,
      contactPerson,
      phone,
      email,
      billingAddress,
      city,
      state,
      stateCode,
      pincode,
      creditPeriodDays = 30,
      creditLimitPaise = 0,
      notes,
    } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      res.status(400).json({ success: false, error: 'Customer / Corporate legal name is required.' });
      return;
    }

    if (!gstin || typeof gstin !== 'string') {
      res.status(400).json({ success: false, error: 'Customer GSTIN is required.' });
      return;
    }

    const cleanGstin = gstin.trim().toUpperCase();
    if (!GSTIN_REGEX.test(cleanGstin)) {
      res.status(400).json({
        success: false,
        error: 'Invalid GSTIN format. Must be a valid 15-character Indian Goods and Services Tax Identification Number (e.g. 19AAACS4128F1Z8).',
      });
      return;
    }

    // Check duplicate GSTIN in same company
    const existingGstin = serverFleetStore.customers.find(
      (c) => c.companyId === companyId && c.gstin.toUpperCase() === cleanGstin
    );
    if (existingGstin) {
      res.status(409).json({
        success: false,
        error: `A customer with GSTIN "${cleanGstin}" is already registered (${existingGstin.name}).`,
      });
      return;
    }

    // Extract PAN from GSTIN (chars 3 to 12)
    const derivedPan = cleanGstin.substring(2, 12);
    const finalPan = pan ? pan.trim().toUpperCase() : derivedPan;

    const gstinStateCode = cleanGstin.substring(0, 2);
    const finalStateCode = stateCode ? stateCode.padStart(2, '0') : gstinStateCode;

    const cleanPhone = (phone || '').replace(/[^0-9]/g, '');
    const clean10DigitPhone = cleanPhone.length > 10 ? cleanPhone.slice(-10) : cleanPhone;
    if (!PHONE_REGEX.test(clean10DigitPhone)) {
      res.status(400).json({ success: false, error: 'Valid 10-digit Indian phone number is required.' });
      return;
    }

    const creditPeriodNum = parseInt(creditPeriodDays, 10);
    if (isNaN(creditPeriodNum) || creditPeriodNum < 0) {
      res.status(400).json({ success: false, error: 'Credit period must be 0 or a positive number of days.' });
      return;
    }

    const creditLimitPaiseVal =
      req.body.creditLimitRupees !== undefined
        ? Math.round(parseFloat(req.body.creditLimitRupees || '0') * 100)
        : Math.round(parseFloat(creditLimitPaise || 0));
    if (isNaN(creditLimitPaiseVal) || creditLimitPaiseVal < 0) {
      res.status(400).json({ success: false, error: 'Credit limit cannot be negative.' });
      return;
    }

    const nowIso = new Date().toISOString();
    const newCustomerId = `cust_${companyId}_${Date.now()}`;

    const newCustomer: Customer = {
      id: newCustomerId,
      companyId,
      name: name.trim(),
      tradeName: tradeName?.trim() || name.trim(),
      gstin: cleanGstin,
      pan: finalPan,
      contactPerson: contactPerson?.trim() || '',
      phone: `+91 ${clean10DigitPhone}`,
      email: email?.trim().toLowerCase() || '',
      billingAddress: billingAddress?.trim() || '',
      city: city?.trim() || '',
      state: state?.trim() || '',
      stateCode: finalStateCode,
      pincode: pincode?.trim() || '',
      creditPeriodDays: creditPeriodNum,
      creditLimitPaise: creditLimitPaiseVal,
      currentOutstandingPaise: 0,
      totalFreightBilledPaise: 0,
      notes: notes?.trim() || undefined,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    serverFleetStore.customers.unshift(newCustomer);

    await runAdminFirestore('Firestore customer sync note', async (db) => {
      await db
        .collection('companies')
        .doc(companyId)
        .collection('customers')
        .doc(newCustomer.id)
        .set(newCustomer);
    });

    res.status(201).json({
      success: true,
      message: `Customer ${newCustomer.name} added successfully.`,
      customer: newCustomer,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to add customer' });
  }
});

/**
 * PUT /api/customers/:id
 * Updates customer details
 */
fleetRouter.put('/customers/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const customerId = req.params.id;
    const customer = serverFleetStore.customers.find((c) => c.id === customerId && c.companyId === companyId);

    if (!customer) {
      res.status(404).json({ success: false, error: 'Customer not found in your company directory.' });
      return;
    }

    const {
      name,
      tradeName,
      gstin,
      pan,
      contactPerson,
      phone,
      email,
      billingAddress,
      city,
      state,
      stateCode,
      pincode,
      creditPeriodDays,
      creditLimitPaise,
      notes,
    } = req.body;

    if (name) customer.name = name.trim();
    if (tradeName !== undefined) customer.tradeName = tradeName.trim();

    if (gstin) {
      const cleanGstin = gstin.trim().toUpperCase();
      if (!GSTIN_REGEX.test(cleanGstin)) {
        res.status(400).json({
          success: false,
          error: 'Invalid GSTIN format. Must be a valid 15-character GST identification number.',
        });
        return;
      }
      const duplicate = serverFleetStore.customers.find(
        (c) => c.id !== customerId && c.companyId === companyId && c.gstin.toUpperCase() === cleanGstin
      );
      if (duplicate) {
        res.status(409).json({
          success: false,
          error: `Another customer with GSTIN "${cleanGstin}" is already registered (${duplicate.name}).`,
        });
        return;
      }
      customer.gstin = cleanGstin;
      customer.pan = cleanGstin.substring(2, 12);
    }

    if (pan) customer.pan = pan.trim().toUpperCase();
    if (contactPerson !== undefined) customer.contactPerson = contactPerson.trim();
    if (phone) {
      const clean = phone.replace(/[^0-9]/g, '').slice(-10);
      if (PHONE_REGEX.test(clean)) customer.phone = `+91 ${clean}`;
    }
    if (email !== undefined) customer.email = email.trim().toLowerCase();
    if (billingAddress !== undefined) customer.billingAddress = billingAddress.trim();
    if (city !== undefined) customer.city = city.trim();
    if (state !== undefined) customer.state = state.trim();
    if (stateCode !== undefined) customer.stateCode = stateCode.trim();
    if (pincode !== undefined) customer.pincode = pincode.trim();
    if (creditPeriodDays !== undefined) {
      customer.creditPeriodDays = Math.max(0, parseInt(creditPeriodDays, 10) || 0);
    }
    if (req.body.creditLimitRupees !== undefined) {
      customer.creditLimitPaise = Math.max(0, Math.round(parseFloat(req.body.creditLimitRupees) * 100) || 0);
    } else if (creditLimitPaise !== undefined) {
      customer.creditLimitPaise = Math.max(0, parseInt(creditLimitPaise, 10) || 0);
    }
    if (notes !== undefined) customer.notes = notes;

    customer.updatedAt = new Date().toISOString();

    await runAdminFirestore('Firestore customer update note', async (db) => {
      await db.collection('companies').doc(companyId).collection('customers').doc(customer.id).set(customer, { merge: true });
    });

    res.json({
      success: true,
      message: `Customer ${customer.name} updated successfully.`,
      customer,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to update customer' });
  }
});

/**
 * DELETE /api/customers/:id
 * Deletes customer if no unpaid balance or active trips
 */
fleetRouter.delete(
  '/customers/:id',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const companyId = req.companyId!;
      const customerId = req.params.id;
      const customer = serverFleetStore.customers.find((c) => c.id === customerId && c.companyId === companyId);

      if (!customer) {
        res.status(404).json({ success: false, error: 'Customer not found in your company directory.' });
        return;
      }

      if (customer.currentOutstandingPaise > 0) {
        res.status(400).json({
          success: false,
          error: `Cannot delete customer ${customer.name}: This party has an outstanding balance of ₹${(customer.currentOutstandingPaise / 100).toLocaleString('en-IN')}. Settle all invoices first.`,
        });
        return;
      }

      // Check active trips
      const activeTrips = serverFleetStore.trips.filter(
        (t) =>
          t.customerId === customerId &&
          t.companyId === companyId &&
          (t.status === 'IN_TRANSIT' || t.status === 'DISPATCHED' || t.status === 'PLANNED')
      );
      if (activeTrips.length > 0) {
        res.status(400).json({
          success: false,
          error: `Cannot delete customer ${customer.name}: They have ${activeTrips.length} active trip(s) in progress.`,
        });
        return;
      }

      serverFleetStore.customers = serverFleetStore.customers.filter((c) => c.id !== customerId);

      await runAdminFirestore('Firestore customer delete note', async (db) => {
        await db.collection('companies').doc(companyId).collection('customers').doc(customerId).delete();
      });

      res.json({
        success: true,
        message: `Customer ${customer.name} deleted successfully.`,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to delete customer' });
    }
  }
);

// =========================================================================
// 8. BULK CSV IMPORTS & TEMPLATES (PHASE 10 PRODUCTION ONBOARDING)
// =========================================================================

/**
 * GET /api/fleet/import-templates/:type
 * Returns ready-to-use CSV template for customer onboarding
 */
fleetRouter.get('/import-templates/:type', (_req, res: Response) => {
  const { type } = _req.params;

  if (type === 'vehicles') {
    const csv = [
      'registrationNumber,vehicleType,makeModel,capacityTonnes,chassisNumber,engineNumber,fastagBalanceRupees',
      'WB-19-K-4821,14-Wheeler (28T),Tata Signa 2823.K,28,MAT613042N1A12345,697TC56N12345,3500',
      'WB-19-L-9022,12-Wheeler (21T),Ashok Leyland 2820,21,MB1B3CSD4NA56789,H6ETIC4RU98765,4200',
    ].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="vehicles_import_template.csv"');
    res.send(csv);
    return;
  }

  if (type === 'drivers') {
    const csv = [
      'fullName,phone,licenseNumber,licenseExpiry,perDayBataRupees,address,emergencyContact,emergencyPhone',
      'Ramesh Kumar Yadav,9830112345,WB1920150012345,2029-12-31,500,Transport Nagar Howrah,Sunita Yadav,9830112346',
      'Suresh Chandra Das,9831099887,WB1920180098765,2028-06-30,450,NH-6 Kona Howrah,Amiya Das,9831099888',
    ].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="drivers_import_template.csv"');
    res.send(csv);
    return;
  }

  if (type === 'customers') {
    const csv = [
      'name,tradeName,gstin,contactPerson,phone,email,billingAddress,city,state,pincode,creditPeriodDays',
      'Bengal Cement Works Pvt Ltd,BCW Cement,19AABCB1234F1Z9,Debashis Roy,9830011223,accounts@bengalcement.com,Park Street Kolkata,Kolkata,West Bengal,700016,30',
      'Tata Steel BSL Logistics,Tata BSL,19AAACT2727Q1ZT,Sumit Mukherjee,9831122334,dispatch@tatasteel.com,Tata Centre JL Nehru Road,Kolkata,West Bengal,700071,45',
    ].join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="customers_import_template.csv"');
    res.send(csv);
    return;
  }

  res.status(400).json({ success: false, error: 'Invalid template type. Allowed: vehicles, drivers, customers' });
});

/**
 * POST /api/fleet/vehicles/bulk-import
 * Batch imports verified trucks for quick onboarding
 */
fleetRouter.post(
  '/vehicles/bulk-import',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN', 'MANAGER']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const companyId = req.companyId!;
      const { vehicles: rawList } = req.body;

      if (!Array.isArray(rawList) || rawList.length === 0) {
        res.status(400).json({ success: false, error: 'Expected non-empty array of vehicle rows' });
        return;
      }

      const imported: Vehicle[] = [];
      const errors: { row: number; registrationNumber?: string; reason: string }[] = [];

      for (let idx = 0; idx < rawList.length; idx++) {
        const item = rawList[idx];
        const reg = item.registrationNumber?.trim().toUpperCase();

        if (!reg) {
          errors.push({ row: idx + 1, reason: 'Registration number is missing' });
          continue;
        }

        const normalized = normalizeRegNumber(reg);
        const existing = serverFleetStore.vehicles.find(
          (v) => v.companyId === companyId && normalizeRegNumber(v.registrationNumber) === normalized
        );

        if (existing) {
          errors.push({ row: idx + 1, registrationNumber: reg, reason: 'Vehicle already exists in company fleet' });
          continue;
        }

        const newVehicle: Vehicle = {
          id: `veh_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          companyId,
          registrationNumber: formatRegNumber(reg),
          vehicleType: item.vehicleType || '14-Wheeler (28T)',
          makeModel: item.makeModel || 'Commercial Heavy Vehicle',
          capacityTonnes: parseFloat(item.capacityTonnes) || 28,
          unladenWeightTonnes: parseFloat(item.unladenWeightTonnes) || 10,
          chassisNumber: item.chassisNumber || `CHAS-${normalized}`,
          engineNumber: item.engineNumber || `ENG-${normalized}`,
          status: 'AVAILABLE',
          currentOdometerKm: parseInt(item.currentOdometerKm, 10) || 0,
          fastagBalancePaise: Math.round((parseFloat(item.fastagBalanceRupees) || 0) * 100),
          createdAt: new Date().toISOString(),
        };

        serverFleetStore.vehicles.push(newVehicle);
        imported.push(newVehicle);
      }

      res.status(201).json({
        success: true,
        message: `Successfully imported ${imported.length} vehicle(s). ${errors.length} skipped.`,
        importedCount: imported.length,
        skippedCount: errors.length,
        errors,
        vehicles: imported,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed bulk vehicle import' });
    }
  }
);

/**
 * POST /api/fleet/drivers/bulk-import
 * Batch imports verified drivers
 */
fleetRouter.post(
  '/drivers/bulk-import',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN', 'MANAGER']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const companyId = req.companyId!;
      const { drivers: rawList } = req.body;

      if (!Array.isArray(rawList) || rawList.length === 0) {
        res.status(400).json({ success: false, error: 'Expected non-empty array of driver rows' });
        return;
      }

      const imported: Driver[] = [];
      const errors: { row: number; name?: string; reason: string }[] = [];

      for (let idx = 0; idx < rawList.length; idx++) {
        const item = rawList[idx];
        const name = item.fullName?.trim();
        const phone = item.phone?.replace(/[^0-9]/g, '');

        if (!name) {
          errors.push({ row: idx + 1, reason: 'Driver name is missing' });
          continue;
        }

        const newDriver: Driver = {
          id: `drv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          companyId,
          fullName: name,
          phone: phone || '+91 90000 00000',
          licenseNumber: item.licenseNumber?.trim().toUpperCase() || `DL-${Date.now()}`,
          licenseExpiry: item.licenseExpiry || '2030-12-31',
          address: item.address || 'Local Transport Nagar',
          emergencyContact: item.emergencyContact || 'Family',
          emergencyPhone: item.emergencyPhone || phone || '',
          status: 'AVAILABLE',
          currentAdvanceBalancePaise: 0,
          totalTripsCompleted: 0,
          perDayBataPaise: Math.round((parseFloat(item.perDayBataRupees) || 500) * 100),
          joinedDate: new Date().toISOString(),
        };

        serverFleetStore.drivers.push(newDriver);
        imported.push(newDriver);
      }

      res.status(201).json({
        success: true,
        message: `Successfully imported ${imported.length} driver(s). ${errors.length} skipped.`,
        importedCount: imported.length,
        skippedCount: errors.length,
        errors,
        drivers: imported,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed bulk driver import' });
    }
  }
);

/**
 * POST /api/fleet/customers/bulk-import
 * Batch imports customers with verified GSTIN
 */
fleetRouter.post(
  '/customers/bulk-import',
  requireAuth,
  requireRoles(['OWNER', 'ADMIN', 'ACCOUNTANT']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const companyId = req.companyId!;
      const { customers: rawList } = req.body;

      if (!Array.isArray(rawList) || rawList.length === 0) {
        res.status(400).json({ success: false, error: 'Expected non-empty array of customer rows' });
        return;
      }

      const imported: Customer[] = [];
      const errors: { row: number; name?: string; reason: string }[] = [];

      for (let idx = 0; idx < rawList.length; idx++) {
        const item = rawList[idx];
        const name = item.name?.trim();
        const gstin = item.gstin?.trim().toUpperCase() || 'URP-UNREGISTERED';

        if (!name) {
          errors.push({ row: idx + 1, reason: 'Customer name is missing' });
          continue;
        }

        const stateCode = gstin.length === 15 ? gstin.substring(0, 2) : '19';
        const pan = gstin.length === 15 ? extractPanFromGstin(gstin) : 'PANNOTREQ';

        const newCustomer: Customer = {
          id: `cust_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          companyId,
          name,
          tradeName: item.tradeName || name,
          gstin,
          pan,
          contactPerson: item.contactPerson || 'Logistics In-charge',
          phone: item.phone || '+91 90000 00000',
          email: item.email || 'billing@customer.com',
          billingAddress: item.billingAddress || 'Kolkata Industrial Area',
          city: item.city || 'Kolkata',
          state: item.state || 'West Bengal',
          stateCode,
          pincode: item.pincode || '700001',
          creditPeriodDays: parseInt(item.creditPeriodDays, 10) || 30,
          creditLimitPaise: 100000000, // ₹10,00,000 default
          currentOutstandingPaise: 0,
          totalFreightBilledPaise: 0,
          createdAt: new Date().toISOString(),
        };

        serverFleetStore.customers.push(newCustomer);
        imported.push(newCustomer);
      }

      res.status(201).json({
        success: true,
        message: `Successfully imported ${imported.length} customer(s). ${errors.length} skipped.`,
        importedCount: imported.length,
        skippedCount: errors.length,
        errors,
        customers: imported,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed bulk customer import' });
    }
  }
);

/**
 * POST /api/fleet/reset-data
 * Completely resets operational data (vehicles, drivers, customers, trips, expenses, invoices)
 * for new customers or a fresh start.
 */
fleetRouter.post('/reset-data', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const companyId = req.companyId!;
    const role = req.user?.role || 'OWNER';
    const scope = req.body?.scope || 'current_company';

    if (role !== 'OWNER' && role !== 'ADMIN') {
      res.status(403).json({
        success: false,
        error: 'Only Company Owners and System Admins have permission to reset company data.',
      });
      return;
    }

    if (scope === 'all') {
      // Clear all demo data across the server store
      serverFleetStore.trips = [];
      serverFleetStore.expenses = [];
      serverFleetStore.advances = [];
      serverFleetStore.settlements = [];
      serverFleetStore.invoices = [];
      serverFleetStore.payments = [];
      serverFleetStore.vehicles = [];
      serverFleetStore.drivers = [];
      serverFleetStore.customers = [];
      serverFleetStore.documents = [];

      res.json({
        success: true,
        message: 'All system data across all companies has been completely reset to a clean slate for new customers.',
        clearedScope: 'all',
      });
      return;
    }

    // Default: Reset data specifically for the authenticated company
    serverFleetStore.clearCompanyData(companyId);

    res.json({
      success: true,
      message: `All vehicles, drivers, customers, trips, expenses, and invoices have been cleared for your company. Ready for fresh onboarding.`,
      clearedScope: 'current_company',
      companyId,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to reset company data' });
  }
});

fleetRouter.post('/api/fleet/reset-data', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  // Delegate to same handler
  const companyId = req.companyId!;
  const role = req.user?.role || 'OWNER';
  const scope = req.body?.scope || 'current_company';

  if (role !== 'OWNER' && role !== 'ADMIN') {
    res.status(403).json({
      success: false,
      error: 'Only Company Owners and System Admins have permission to reset company data.',
    });
    return;
  }

  if (scope === 'all') {
    serverFleetStore.trips = [];
    serverFleetStore.expenses = [];
    serverFleetStore.advances = [];
    serverFleetStore.settlements = [];
    serverFleetStore.invoices = [];
    serverFleetStore.payments = [];
    serverFleetStore.vehicles = [];
    serverFleetStore.drivers = [];
    serverFleetStore.customers = [];
    serverFleetStore.documents = [];

    res.json({
      success: true,
      message: 'All system data across all companies has been completely reset to a clean slate for new customers.',
      clearedScope: 'all',
    });
    return;
  }

  serverFleetStore.clearCompanyData(companyId);
  res.json({
    success: true,
    message: `All vehicles, drivers, customers, trips, expenses, and invoices have been cleared for your company. Ready for fresh onboarding.`,
    clearedScope: 'current_company',
    companyId,
  });
});

/**
 * ============================================================================
 * VEHICLE DOCUMENTS & COMPLIANCE VAULT ENDPOINTS
 * ============================================================================
 */

// GET /api/fleet/documents
fleetRouter.get('/documents', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await handleGetDocuments(req, res);
});
fleetRouter.get('/api/fleet/documents', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await handleGetDocuments(req, res);
});

async function handleGetDocuments(req: AuthenticatedRequest, res: Response) {
  try {
    const companyId = req.companyId!;
    await serverFleetStore.hydrateFromFirestore(companyId);
    const { vehicleId, status, docType, search } = req.query;

    let list = serverFleetStore.documents.filter((d) => d.companyId === companyId);

    // Refresh dynamic status
    const now = Date.now();
    list.forEach((doc) => {
      const expTime = new Date(doc.expiryDate).getTime();
      const daysUntil = Math.ceil((expTime - now) / (1000 * 60 * 60 * 24));
      doc.daysUntilExpiry = daysUntil;
      doc.status = daysUntil < 0 ? 'EXPIRED' : daysUntil <= 30 ? 'EXPIRING_SOON' : 'VALID';
    });

    if (vehicleId && vehicleId !== 'ALL') {
      list = list.filter((d) => d.vehicleId === vehicleId);
    }

    if (status && status !== 'ALL') {
      list = list.filter((d) => d.status === status);
    }

    if (docType && docType !== 'ALL') {
      list = list.filter((d) => d.docType === docType);
    }

    if (search && typeof search === 'string' && search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (d) =>
          d.vehicleReg.toLowerCase().includes(q) ||
          d.documentNumber.toLowerCase().includes(q) ||
          (d.issuingAuthority && d.issuingAuthority.toLowerCase().includes(q))
      );
    }

    // Sort: Expired first, then earliest expiring
    list.sort((a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime());

    const allCompanyDocs = serverFleetStore.documents.filter((d) => d.companyId === companyId);
    const summary = {
      total: allCompanyDocs.length,
      expired: allCompanyDocs.filter((d) => d.status === 'EXPIRED').length,
      expiringSoon: allCompanyDocs.filter((d) => d.status === 'EXPIRING_SOON').length,
      valid: allCompanyDocs.filter((d) => d.status === 'VALID').length,
    };

    res.json({
      success: true,
      documents: list,
      summary,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to fetch compliance documents' });
  }
}

// POST /api/fleet/documents
fleetRouter.post('/documents', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await handleCreateDocument(req, res);
});
fleetRouter.post('/api/fleet/documents', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await handleCreateDocument(req, res);
});

async function handleCreateDocument(req: AuthenticatedRequest, res: Response) {
  try {
    const companyId = req.companyId!;
    const { vehicleId, docType, documentNumber, issuingAuthority, issueDate, expiryDate, documentUrl } = req.body;

    if (!vehicleId) {
      res.status(400).json({ success: false, error: 'Vehicle selection is required.' });
      return;
    }

    const vehicle = serverFleetStore.vehicles.find((v) => v.id === vehicleId && v.companyId === companyId);
    if (!vehicle) {
      res.status(404).json({ success: false, error: 'Vehicle not found in your fleet.' });
      return;
    }

    if (!docType) {
      res.status(400).json({ success: false, error: 'Document type is required.' });
      return;
    }

    if (!documentNumber || !documentNumber.trim()) {
      res.status(400).json({ success: false, error: 'Certificate or policy number is required.' });
      return;
    }

    if (!expiryDate) {
      res.status(400).json({ success: false, error: 'Document expiry date is required.' });
      return;
    }

    const now = Date.now();
    const daysUntil = Math.ceil((new Date(expiryDate).getTime() - now) / (1000 * 60 * 60 * 24));
    const status: 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' =
      daysUntil < 0 ? 'EXPIRED' : daysUntil <= 30 ? 'EXPIRING_SOON' : 'VALID';

    const newDocId = `doc_${companyId}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newDoc: VehicleDocument = {
      id: newDocId,
      companyId,
      vehicleId: vehicle.id,
      vehicleReg: vehicle.registrationNumber,
      docType,
      documentNumber: documentNumber.trim().toUpperCase(),
      issuingAuthority: issuingAuthority?.trim() || 'Transport Authority',
      issueDate: issueDate || new Date().toISOString().split('T')[0],
      expiryDate,
      documentUrl: documentUrl?.trim() || undefined,
      daysUntilExpiry: daysUntil,
      status,
    };

    serverFleetStore.documents.unshift(newDoc);
    await serverFleetStore.persistToFirestore(companyId, 'documents', newDoc.id, newDoc);

    // Sync back to vehicle fields
    if (docType === 'FITNESS') {
      vehicle.fitnessExpiry = expiryDate;
      vehicle.fitnessCertificateNumber = documentNumber.trim().toUpperCase();
    } else if (docType === 'INSURANCE') {
      vehicle.insuranceExpiry = expiryDate;
      vehicle.insurancePolicyNumber = documentNumber.trim().toUpperCase();
    } else if (docType === 'NATIONAL_PERMIT' || docType === 'STATE_PERMIT') {
      vehicle.permitExpiry = expiryDate;
      vehicle.permitNumber = documentNumber.trim().toUpperCase();
      vehicle.permitType = docType === 'STATE_PERMIT' ? 'STATE' : 'NATIONAL';
    } else if (docType === 'PUC') {
      vehicle.pucExpiry = expiryDate;
      vehicle.pucNumber = documentNumber.trim().toUpperCase();
    }

    await serverFleetStore.persistToFirestore(companyId, 'vehicles', vehicle.id, vehicle);

    res.status(201).json({
      success: true,
      message: `${docType.replace('_', ' ')} recorded successfully for ${vehicle.registrationNumber}.`,
      document: newDoc,
      vehicle,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to record document' });
  }
}

// PUT /api/fleet/documents/:id
fleetRouter.put('/documents/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await handleUpdateDocument(req, res);
});
fleetRouter.put('/api/fleet/documents/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await handleUpdateDocument(req, res);
});

async function handleUpdateDocument(req: AuthenticatedRequest, res: Response) {
  try {
    const companyId = req.companyId!;
    const docId = req.params.id;
    const doc = serverFleetStore.documents.find((d) => d.id === docId && d.companyId === companyId);

    if (!doc) {
      res.status(404).json({ success: false, error: 'Document certificate not found in your vault.' });
      return;
    }

    const { documentNumber, issuingAuthority, issueDate, expiryDate, documentUrl } = req.body;

    if (documentNumber) doc.documentNumber = documentNumber.trim().toUpperCase();
    if (issuingAuthority) doc.issuingAuthority = issuingAuthority.trim();
    if (issueDate) doc.issueDate = issueDate;
    if (expiryDate) {
      doc.expiryDate = expiryDate;
      const daysUntil = Math.ceil((new Date(expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      doc.daysUntilExpiry = daysUntil;
      doc.status = daysUntil < 0 ? 'EXPIRED' : daysUntil <= 30 ? 'EXPIRING_SOON' : 'VALID';

      // Sync parent vehicle
      const vehicle = serverFleetStore.vehicles.find((v) => v.id === doc.vehicleId && v.companyId === companyId);
      if (vehicle) {
        if (doc.docType === 'FITNESS') {
          vehicle.fitnessExpiry = expiryDate;
          if (documentNumber) vehicle.fitnessCertificateNumber = doc.documentNumber;
        } else if (doc.docType === 'INSURANCE') {
          vehicle.insuranceExpiry = expiryDate;
          if (documentNumber) vehicle.insurancePolicyNumber = doc.documentNumber;
        } else if (doc.docType === 'NATIONAL_PERMIT' || doc.docType === 'STATE_PERMIT') {
          vehicle.permitExpiry = expiryDate;
          if (documentNumber) vehicle.permitNumber = doc.documentNumber;
        } else if (doc.docType === 'PUC') {
          vehicle.pucExpiry = expiryDate;
          if (documentNumber) vehicle.pucNumber = doc.documentNumber;
        }
        await serverFleetStore.persistToFirestore(companyId, 'vehicles', vehicle.id, vehicle);
      }
    }
    if (documentUrl !== undefined) doc.documentUrl = documentUrl ? documentUrl.trim() : undefined;

    await serverFleetStore.persistToFirestore(companyId, 'documents', doc.id, doc);

    const updatedVehicle = serverFleetStore.vehicles.find((v) => v.id === doc.vehicleId && v.companyId === companyId) || null;
    res.json({
      success: true,
      message: `Document ${doc.docType} renewed/updated successfully.`,
      document: doc,
      vehicle: updatedVehicle,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to update document' });
  }
}

// DELETE /api/fleet/documents/:id
fleetRouter.delete('/documents/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await handleDeleteDocument(req, res);
});
fleetRouter.delete('/api/fleet/documents/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  await handleDeleteDocument(req, res);
});

async function handleDeleteDocument(req: AuthenticatedRequest, res: Response) {
  try {
    const companyId = req.companyId!;
    const docId = req.params.id;
    const doc = serverFleetStore.documents.find((d) => d.id === docId && d.companyId === companyId);

    if (!doc) {
      res.status(404).json({ success: false, error: 'Document not found.' });
      return;
    }

    serverFleetStore.documents = serverFleetStore.documents.filter((d) => d.id !== docId);
    await serverFleetStore.deleteFromFirestore(companyId, 'documents', docId);

    res.json({
      success: true,
      message: `Document ${doc.documentNumber} (${doc.docType}) deleted from vault.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Failed to delete document' });
  }
}


