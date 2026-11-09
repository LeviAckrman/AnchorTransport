/**
 * AnchorTransport TMS - Development Database Seeder
 * 
 * SAFEGUARD: Only executes in development or staging environments.
 * Seeds realistic West Bengal transport corridor fleet operations.
 */

import { PrismaClient, UserRole, VehicleStatus, VehicleType, DriverStatus, TripStatus, ExpenseCategory, PaymentMode, AdvanceType, SettlementStatus, InvoicePaymentStatus, PaymentRecordMode, DocumentType, MaintenanceType, AuditAction, AuditEntity } from '@prisma/client';
import { Decimal } from 'decimal.js';

const prisma = new PrismaClient();

async function main() {
  // CRITICAL PRODUCTION SAFEGUARD
  if (process.env.NODE_ENV === 'production') {
    console.error('⛔ FATAL: Cannot run development seed script in PRODUCTION environment.');
    process.exit(1);
  }

  console.log('🌱 Starting AnchorTransport TMS database seed for development...');

  // 1. Seed Transport Company (Royal Bengal Logistics, Howrah / West Bengal)
  const company = await prisma.company.upsert({
    where: { gstin: '19AAACR4912D1ZX' },
    update: {},
    create: {
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
    },
  });

  console.log(`✓ Seeded Company: ${company.name} (${company.id})`);

  // 2. Seed Users
  const userOwner = await prisma.user.upsert({
    where: { email: 'anupam@royalbengal.com' },
    update: {},
    create: {
      email: 'anupam@royalbengal.com',
      passwordHash: '$2b$10$ep/0.uH7lI9V73ZkQ13m7edXw0092182098231298492098129031', // bcrypt placeholder
      name: 'Anupam Ghosh',
      phone: '+91 98301 22890',
      isActive: true,
    },
  });

  const userAccountant = await prisma.user.upsert({
    where: { email: 'accounts@royalbengal.com' },
    update: {},
    create: {
      email: 'accounts@royalbengal.com',
      passwordHash: '$2b$10$ep/0.uH7lI9V73ZkQ13m7edXw0092182098231298492098129032',
      name: 'Subhashish Dey',
      phone: '+91 98310 99411',
      isActive: true,
    },
  });

  const userManager = await prisma.user.upsert({
    where: { email: 'bikash@royalbengal.com' },
    update: {},
    create: {
      email: 'bikash@royalbengal.com',
      passwordHash: '$2b$10$ep/0.uH7lI9V73ZkQ13m7edXw0092182098231298492098129033',
      name: 'Bikash Mahato',
      phone: '+91 94340 18273',
      isActive: true,
    },
  });

  // 3. Seed Company-User Roles
  await prisma.companyUser.upsert({
    where: { companyId_userId: { companyId: company.id, userId: userOwner.id } },
    update: {},
    create: {
      companyId: company.id,
      userId: userOwner.id,
      role: UserRole.OWNER,
    },
  });

  await prisma.companyUser.upsert({
    where: { companyId_userId: { companyId: company.id, userId: userAccountant.id } },
    update: {},
    create: {
      companyId: company.id,
      userId: userAccountant.id,
      role: UserRole.ACCOUNTANT,
    },
  });

  await prisma.companyUser.upsert({
    where: { companyId_userId: { companyId: company.id, userId: userManager.id } },
    update: {},
    create: {
      companyId: company.id,
      userId: userManager.id,
      role: UserRole.MANAGER,
    },
  });

  // 4. Seed Drivers
  const driver1 = await prisma.driver.upsert({
    where: { companyId_licenseNumber: { companyId: company.id, licenseNumber: 'WB1920140029182' } },
    update: {},
    create: {
      companyId: company.id,
      fullName: 'Rajesh Yadav',
      phone: '+91 97321 44501',
      licenseNumber: 'WB1920140029182',
      licenseExpiry: new Date('2028-09-14'),
      address: 'Vill: Bauria, PS: Uluberia, Howrah - 711310',
      emergencyContact: 'Sunita Yadav (Wife)',
      emergencyPhone: '+91 97321 44509',
      status: DriverStatus.ON_TRIP,
      currentAdvanceBalance: new Decimal(18000.00),
      perDayBata: new Decimal(600.00),
      totalTripsCompleted: 48,
      joinedDate: new Date('2022-04-10'),
    },
  });

  const driver2 = await prisma.driver.upsert({
    where: { companyId_licenseNumber: { companyId: company.id, licenseNumber: 'BR0220160081293' } },
    update: {},
    create: {
      companyId: company.id,
      fullName: 'Md. Farooq Alam',
      phone: '+91 98322 81900',
      licenseNumber: 'BR0220160081293',
      licenseExpiry: new Date('2027-11-30'),
      address: 'Line Paar, Asansol, Paschim Bardhaman - 713301',
      emergencyContact: 'Nasreen Bano (Wife)',
      emergencyPhone: '+91 98322 81905',
      status: DriverStatus.ON_TRIP,
      currentAdvanceBalance: new Decimal(12000.00),
      perDayBata: new Decimal(600.00),
      totalTripsCompleted: 35,
      joinedDate: new Date('2023-02-18'),
    },
  });

  const driver3 = await prisma.driver.upsert({
    where: { companyId_licenseNumber: { companyId: company.id, licenseNumber: 'WB2420180041920' } },
    update: {},
    create: {
      companyId: company.id,
      fullName: 'Somenath Karmakar',
      phone: '+91 94348 21992',
      licenseNumber: 'WB2420180041920',
      licenseExpiry: new Date('2026-11-20'),
      address: 'Netaji Subhas Road, Chinsurah, Hooghly - 712101',
      emergencyContact: 'Tapan Karmakar (Brother)',
      emergencyPhone: '+91 94348 21995',
      status: DriverStatus.AVAILABLE,
      currentAdvanceBalance: new Decimal(0.00),
      perDayBata: new Decimal(550.00),
      totalTripsCompleted: 62,
      joinedDate: new Date('2021-09-01'),
    },
  });

  // 5. Seed Vehicles
  const vehicle1 = await prisma.vehicle.upsert({
    where: { companyId_registrationNumber: { companyId: company.id, registrationNumber: 'WB-19-K-4821' } },
    update: {},
    create: {
      companyId: company.id,
      registrationNumber: 'WB-19-K-4821',
      vehicleType: VehicleType.FOURTEEN_WHEELER_28T,
      makeModel: 'Tata Signa 2823.TK',
      capacityTonnes: new Decimal(28.00),
      unladenWeightTonnes: new Decimal(10.50),
      chassisNumber: 'MAT624001P2K10984',
      engineNumber: '497TC72P90281',
      status: VehicleStatus.IN_TRANSIT,
      currentOdometerKm: 142850,
      fastagBalance: new Decimal(8400.00),
      assignedDriverId: driver1.id,
    },
  });

  const vehicle2 = await prisma.vehicle.upsert({
    where: { companyId_registrationNumber: { companyId: company.id, registrationNumber: 'WB-29-B-7104' } },
    update: {},
    create: {
      companyId: company.id,
      registrationNumber: 'WB-29-B-7104',
      vehicleType: VehicleType.TWELVE_WHEELER_21T,
      makeModel: 'Ashok Leyland 2820',
      capacityTonnes: new Decimal(21.00),
      unladenWeightTonnes: new Decimal(8.20),
      chassisNumber: 'MB11EAC00P3E87612',
      engineNumber: 'H6ETIC4RU0192',
      status: VehicleStatus.IN_TRANSIT,
      currentOdometerKm: 198420,
      fastagBalance: new Decimal(4200.00),
      assignedDriverId: driver2.id,
    },
  });

  const vehicle3 = await prisma.vehicle.upsert({
    where: { companyId_registrationNumber: { companyId: company.id, registrationNumber: 'WB-11-D-9033' } },
    update: {},
    create: {
      companyId: company.id,
      registrationNumber: 'WB-11-D-9033',
      vehicleType: VehicleType.TEN_WHEELER_16T,
      makeModel: 'Tata Prima 2830',
      capacityTonnes: new Decimal(16.00),
      unladenWeightTonnes: new Decimal(6.80),
      chassisNumber: 'MAT621008P9N20194',
      engineNumber: 'CUMMINS6BT99120',
      status: VehicleStatus.AVAILABLE,
      currentOdometerKm: 87400,
      fastagBalance: new Decimal(12500.00),
      assignedDriverId: driver3.id,
    },
  });

  // 6. Seed Customers
  const customer1 = await prisma.customer.upsert({
    where: { companyId_gstin: { companyId: company.id, gstin: '19AAACS4128F1Z8' } },
    update: {},
    create: {
      companyId: company.id,
      name: 'Shyam Steel Industries Ltd.',
      tradeName: 'Shyam Steel',
      gstin: '19AAACS4128F1Z8',
      pan: 'AAACS4128F',
      contactPerson: 'Prabir Bhattacharya (Dispatch GM)',
      phone: '+91 33 4007 4007',
      email: 'logistics@shyamsteel.com',
      billingAddress: 'Shyam Towers, EN-32, Sector V, Salt Lake',
      city: 'Kolkata',
      state: 'West Bengal',
      stateCode: '19',
      pincode: '700091',
      creditPeriodDays: 30,
      creditLimit: new Decimal(5000000.00),
      currentOutstanding: new Decimal(295000.00),
      totalFreightBilled: new Decimal(1840000.00),
    },
  });

  // 7. Seed Trips
  const trip1 = await prisma.trip.upsert({
    where: { companyId_tripNumber: { companyId: company.id, tripNumber: 'TR-2026-0038' } },
    update: {},
    create: {
      companyId: company.id,
      tripNumber: 'TR-2026-0038',
      lrNumber: 'AT/25-26/0142',
      customerId: customer1.id,
      vehicleId: vehicle1.id,
      driverId: driver1.id,
      originCity: 'Durgapur, WB',
      destinationCity: 'Siliguri, WB',
      goodsType: 'TMT Steel Bars & Coils',
      weightTonnes: new Decimal(26.50),
      ratePerTonne: new Decimal(2800.00),
      freightAmount: new Decimal(74200.00),
      otherCharges: new Decimal(3500.00),
      totalRevenue: new Decimal(77700.00),
      totalExpenses: new Decimal(38200.00),
      totalAdvances: new Decimal(18000.00),
      tripContribution: new Decimal(39500.00),
      dispatchDate: new Date('2026-11-01T08:30:00Z'),
      expectedDeliveryDate: new Date('2026-11-03T18:00:00Z'),
      status: TripStatus.IN_TRANSIT,
      startOdometerKm: 142200,
      podReceived: false,
      notes: 'Urgent consignment for Matigara flyover project',
    },
  });

  // 8. Seed Trip Expenses
  await prisma.tripExpense.create({
    data: {
      companyId: company.id,
      tripId: trip1.id,
      vehicleId: vehicle1.id,
      category: ExpenseCategory.DIESEL,
      amount: new Decimal(27500.00),
      paymentMode: PaymentMode.PETRO_CARD,
      date: new Date('2026-11-01'),
      description: '300.5 Litres Diesel at Dankuni IOCL COCO pump',
      litresFuel: new Decimal(300.50),
      ratePerLitre: new Decimal(91.51),
      pumpName: 'IOCL COCO Dankuni Toll Plaza',
      odometerReading: 142200,
      receiptNumber: 'IOCL-98124',
      recordedBy: 'Anupam Ghosh',
      isDriverDisbursed: false,
    },
  });

  await prisma.tripExpense.create({
    data: {
      companyId: company.id,
      tripId: trip1.id,
      vehicleId: vehicle1.id,
      category: ExpenseCategory.TOLL_FASTAG,
      amount: new Decimal(4800.00),
      paymentMode: PaymentMode.FASTAG,
      date: new Date('2026-11-01'),
      description: 'FastTag toll: Dankuni, Palsit, Panagarh, Moregram Plazas',
      receiptNumber: 'FASTAG-TXN-4912',
      recordedBy: 'System Auto-Sync',
      isDriverDisbursed: false,
    },
  });

  // 9. Seed Driver Advance
  await prisma.driverAdvance.create({
    data: {
      companyId: company.id,
      tripId: trip1.id,
      driverId: driver1.id,
      amount: new Decimal(18000.00),
      advanceType: AdvanceType.CASH_DISPATCH,
      date: new Date('2026-11-01'),
      referenceNotes: 'Cash handover at Dankuni office before Siliguri dispatch',
      disbursedBy: 'Bikash Mahato',
      isSettled: false,
    },
  });

  // 10. Seed Completed Settled Trip (Trip 3)
  const trip3 = await prisma.trip.upsert({
    where: { companyId_tripNumber: { companyId: company.id, tripNumber: 'TR-2026-0036' } },
    update: {},
    create: {
      companyId: company.id,
      tripNumber: 'TR-2026-0036',
      lrNumber: 'AT/25-26/0140',
      customerId: customer1.id,
      vehicleId: vehicle3.id,
      driverId: driver3.id,
      originCity: 'Durgapur, WB',
      destinationCity: 'Kolkata, WB',
      goodsType: 'Structural Steel Angles',
      weightTonnes: new Decimal(15.20),
      ratePerTonne: new Decimal(1400.00),
      freightAmount: new Decimal(21280.00),
      otherCharges: new Decimal(1000.00),
      totalRevenue: new Decimal(22280.00),
      totalExpenses: new Decimal(9800.00),
      totalAdvances: new Decimal(8000.00),
      tripContribution: new Decimal(12480.00),
      dispatchDate: new Date('2026-10-28T09:00:00Z'),
      expectedDeliveryDate: new Date('2026-10-29T16:00:00Z'),
      actualDeliveryDate: new Date('2026-10-29T14:30:00Z'),
      status: TripStatus.SETTLED,
      startOdometerKm: 87190,
      endOdometerKm: 87400,
      podReceived: true,
      isSettled: true,
      isInvoiced: true,
    },
  });

  // 11. Seed Trip Settlement (Driver returned surplus cash)
  await prisma.tripSettlement.upsert({
    where: { tripId: trip3.id },
    update: {},
    create: {
      companyId: company.id,
      tripId: trip3.id,
      driverId: driver3.id,
      totalAdvanceGiven: new Decimal(8000.00),
      driverCashExpenses: new Decimal(5400.00),
      driverBataAllowance: new Decimal(1100.00),
      otherDeductions: new Decimal(0.00),
      netPayableToDriver: new Decimal(-1500.00), // Driver returned ₹1,500 cash
      status: SettlementStatus.APPROVED_SETTLED,
      settledDate: new Date('2026-10-30'),
      settledBy: 'Subhashish Dey (Accountant)',
      settlementNotes: 'Vouchers verified against IOCL slip & weighbridge slip. ₹1,500 deposited into petty cash.',
    },
  });

  // 12. Seed Invoice
  const invoice1 = await prisma.invoice.upsert({
    where: { companyId_invoiceNumber: { companyId: company.id, invoiceNumber: 'INV/25-26/0140' } },
    update: {},
    create: {
      companyId: company.id,
      invoiceNumber: 'INV/25-26/0140',
      tripId: trip3.id,
      customerId: customer1.id,
      issueDate: new Date('2026-10-30'),
      dueDate: new Date('2026-11-29'),
      taxableAmount: new Decimal(22280.00),
      isRcmApplicable: true, // GTA RCM
      cgstRatePercent: new Decimal(0.00),
      sgstRatePercent: new Decimal(0.00),
      igstRatePercent: new Decimal(0.00),
      cgstAmount: new Decimal(0.00),
      sgstAmount: new Decimal(0.00),
      igstAmount: new Decimal(0.00),
      totalAmount: new Decimal(22280.00),
      amountPaid: new Decimal(0.00),
      balanceDue: new Decimal(22280.00),
      paymentStatus: InvoicePaymentStatus.UNPAID,
      notes: 'GST payable under Reverse Charge Mechanism (GTA). Stamped POD attached.',
    },
  });

  // 13. Seed Vehicle Documents
  await prisma.vehicleDocument.upsert({
    where: { vehicleId_docType: { vehicleId: vehicle1.id, docType: DocumentType.FITNESS } },
    update: {},
    create: {
      companyId: company.id,
      vehicleId: vehicle1.id,
      docType: DocumentType.FITNESS,
      documentNumber: 'WB19/FIT/2025/8912',
      issuingAuthority: 'RTO Howrah',
      issueDate: new Date('2025-11-20'),
      expiryDate: new Date('2026-11-19'), // Expiring soon in ~17 days
    },
  });

  await prisma.vehicleDocument.upsert({
    where: { vehicleId_docType: { vehicleId: vehicle1.id, docType: DocumentType.NATIONAL_PERMIT } },
    update: {},
    create: {
      companyId: company.id,
      vehicleId: vehicle1.id,
      docType: DocumentType.NATIONAL_PERMIT,
      documentNumber: 'NP/WB/2024/091823',
      issuingAuthority: 'STA West Bengal',
      issueDate: new Date('2024-05-10'),
      expiryDate: new Date('2029-05-09'),
    },
  });

  // 14. Seed Audit Log
  await prisma.auditLog.create({
    data: {
      companyId: company.id,
      userId: userOwner.id,
      userName: 'Anupam Ghosh',
      action: AuditAction.DISPATCH,
      entityType: AuditEntity.TRIP,
      entityId: trip1.id,
      summary: 'Dispatched trip TR-2026-0038 (Durgapur to Siliguri) on WB-19-K-4821',
      timestamp: new Date('2026-11-01T08:30:00Z'),
    },
  });

  console.log('✅ AnchorTransport TMS development database successfully seeded!');
}

main()
  .catch((e) => {
    console.error('❌ Error executing database seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
