/**
 * AnchorTransport TMS - Realistic Indian Fleet Seed Dataset
 * Context: West Bengal transport corridor (Kolkata, Haldia, Durgapur, Siliguri, Asansol)
 */

import { Company, User, CompanyUser, Vehicle, Driver, Customer, Trip, TripExpense, DriverAdvance, TripSettlement, Invoice, Payment, VehicleDocument } from '../types/tms';

export const INITIAL_COMPANY: Company = {
  id: 'comp_wb_royal_001',
  name: 'Royal Bengal Roadlines Pvt. Ltd.',
  tradeName: 'Royal Bengal Logistics',
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
  lrPrefix: 'RBR/25-26/',
  invoicePrefix: 'INV/25-26/',
  createdAt: '2025-04-01T00:00:00Z',
};

export const INITIAL_USERS: User[] = [
  {
    id: 'usr_owner_01',
    name: 'Anupam Ghosh',
    email: 'anupam@royalbengal.com',
    phone: '+91 98301 22890',
  },
  {
    id: 'usr_acct_02',
    name: 'Subhashish Dey',
    email: 'accounts@royalbengal.com',
    phone: '+91 98310 99411',
  },
  {
    id: 'usr_ops_03',
    name: 'Bikash Mahato',
    email: 'bikash@royalbengal.com',
    phone: '+91 94340 18273',
  },
];

export const INITIAL_COMPANY_USERS: CompanyUser[] = [
  {
    id: 'cu_01',
    companyId: 'comp_wb_royal_001',
    userId: 'usr_owner_01',
    role: 'OWNER',
    user: INITIAL_USERS[0],
    active: true,
  },
  {
    id: 'cu_02',
    companyId: 'comp_wb_royal_001',
    userId: 'usr_acct_02',
    role: 'ACCOUNTANT',
    user: INITIAL_USERS[1],
    active: true,
  },
  {
    id: 'cu_03',
    companyId: 'comp_wb_royal_001',
    userId: 'usr_ops_03',
    role: 'MANAGER',
    user: INITIAL_USERS[2],
    active: true,
  },
];

export const INITIAL_VEHICLES: Vehicle[] = [
  {
    id: 'veh_01',
    companyId: 'comp_wb_royal_001',
    registrationNumber: 'WB-19-K-4821',
    vehicleType: '14-Wheeler (28T)',
    makeModel: 'Tata Signa 2823.TK',
    capacityTonnes: 28,
    unladenWeightTonnes: 10.5,
    chassisNumber: 'MAT624001P2K10984',
    engineNumber: '497TC72P90281',
    status: 'IN_TRANSIT',
    currentOdometerKm: 142850,
    fastagBalancePaise: 840000, // ₹8,400
    assignedDriverId: 'drv_01',
    assignedDriverName: 'Rajesh Yadav',
    activeTripId: 'trip_01',
    insuranceExpiry: '2027-04-10',
    insurancePolicyNumber: 'NIC-COMM-991204',
    fitnessExpiry: '2026-11-19', // Expiring soon (~16 days)
    fitnessCertificateNumber: 'WB19/FIT/2025/8912',
    permitExpiry: '2029-05-09',
    permitNumber: 'NP/WB/2024/091823',
    permitType: 'NATIONAL',
    pucExpiry: '2027-03-15',
    pucNumber: 'WB-PUC-2026-9901',
    createdAt: '2024-01-15T00:00:00Z',
  },
  {
    id: 'veh_02',
    companyId: 'comp_wb_royal_001',
    registrationNumber: 'WB-29-B-7104',
    vehicleType: '12-Wheeler (21T)',
    makeModel: 'Ashok Leyland 2820',
    capacityTonnes: 21,
    unladenWeightTonnes: 8.2,
    chassisNumber: 'MB11EAC00P3E87612',
    engineNumber: 'H6ETIC4RU0192',
    status: 'IN_TRANSIT',
    currentOdometerKm: 198420,
    fastagBalancePaise: 420000, // ₹4,200
    assignedDriverId: 'drv_02',
    assignedDriverName: 'Md. Farooq Alam',
    activeTripId: 'trip_02',
    insuranceExpiry: '2026-08-14',
    insurancePolicyNumber: 'NIC/COMP/48910283/2025',
    fitnessExpiry: '2027-02-28',
    fitnessCertificateNumber: 'WB29/FIT/2025/3811',
    permitExpiry: '2028-10-15',
    permitNumber: 'STA-WB-2023-8812',
    permitType: 'STATE',
    pucExpiry: '2027-01-10',
    pucNumber: 'WB-PUC-2026-1204',
    createdAt: '2023-08-10T00:00:00Z',
  },
  {
    id: 'veh_03',
    companyId: 'comp_wb_royal_001',
    registrationNumber: 'WB-11-D-9033',
    vehicleType: '10-Wheeler (16T)',
    makeModel: 'Tata Prima 2830',
    capacityTonnes: 16,
    unladenWeightTonnes: 6.8,
    chassisNumber: 'MAT621008P9N20194',
    engineNumber: 'CUMMINS6BT99120',
    status: 'AVAILABLE',
    currentOdometerKm: 87400,
    fastagBalancePaise: 1250000, // ₹12,500
    assignedDriverId: 'drv_03',
    assignedDriverName: 'Somenath Karmakar',
    insuranceExpiry: '2027-06-18',
    insurancePolicyNumber: 'UIIC-FLEET-882910',
    fitnessExpiry: '2027-09-30',
    fitnessCertificateNumber: 'WB11/FIT/2024/7710',
    permitExpiry: '2028-06-19',
    permitNumber: 'NP/WB/2024/110928',
    permitType: 'NATIONAL',
    pucExpiry: '2027-05-12',
    pucNumber: 'WB-PUC-2026-5501',
    createdAt: '2024-06-20T00:00:00Z',
  },
  {
    id: 'veh_04',
    companyId: 'comp_wb_royal_001',
    registrationNumber: 'WB-33-C-5219',
    vehicleType: 'Trailer (40T+)',
    makeModel: 'BharatBenz 5528TT',
    capacityTonnes: 42,
    unladenWeightTonnes: 14.0,
    chassisNumber: 'MBL74DCA0PX219401',
    engineNumber: 'OM906LAIV1829',
    status: 'UNDER_MAINTENANCE',
    currentOdometerKm: 265100,
    fastagBalancePaise: 150000, // ₹1,500 (Low FastTag alert)
    insuranceExpiry: '2027-01-20',
    insurancePolicyNumber: 'OICL-COMM-77192',
    fitnessExpiry: '2026-10-11', // Expired!
    fitnessCertificateNumber: 'WB33/FIT/2025/1092',
    permitExpiry: '2027-11-04',
    permitNumber: 'NP/WB/2023/882190',
    permitType: 'NATIONAL',
    pucExpiry: '2026-10-11', // Expired!
    pucNumber: 'WB-PUC-2026-44912',
    notes: 'Brake booster overhaul & 2 front tyre replacement at Dankuni workshop',
    createdAt: '2022-11-05T00:00:00Z',
  },
  {
    id: 'veh_05',
    companyId: 'comp_wb_royal_001',
    registrationNumber: 'WB-23-E-1882',
    vehicleType: '14-Wheeler (28T)',
    makeModel: 'Tata Signa 4825',
    capacityTonnes: 28,
    unladenWeightTonnes: 10.8,
    chassisNumber: 'MAT624009N2L44102',
    engineNumber: '497TC72P98311',
    status: 'AVAILABLE',
    currentOdometerKm: 112300,
    fastagBalancePaise: 950000, // ₹9,500
    insuranceExpiry: '2027-08-25',
    insurancePolicyNumber: 'TATA-AIG-991208',
    fitnessExpiry: '2027-05-14',
    fitnessCertificateNumber: 'WB23/FIT/2025/9981',
    permitExpiry: '2029-02-28',
    permitNumber: 'NP/WB/2024/771928',
    permitType: 'NATIONAL',
    pucExpiry: '2027-04-18',
    pucNumber: 'WB-PUC-2026-3829',
    createdAt: '2024-03-01T00:00:00Z',
  },
];

export const INITIAL_DRIVERS: Driver[] = [
  {
    id: 'drv_01',
    companyId: 'comp_wb_royal_001',
    fullName: 'Rajesh Yadav',
    phone: '+91 97321 44501',
    altPhone: '+91 97321 44502',
    licenseNumber: 'WB1920140029182',
    licenseExpiry: '2028-09-14',
    address: 'Vill: Bauria, PS: Uluberia, Howrah - 711310',
    emergencyContact: 'Sunita Yadav (Wife)',
    emergencyPhone: '+91 97321 44509',
    status: 'ON_TRIP',
    currentAdvanceBalancePaise: 1800000, // ₹18,000 cash advance received
    totalTripsCompleted: 48,
    monthlySalaryPaise: 2400000, // ₹24,000/mo (Sensitive)
    perDayBataPaise: 60000, // ₹600/day
    assignedVehicleReg: 'WB-19-K-4821',
    aadharNumber: '489210948210', // 12-digit Aadhaar (Sensitive)
    panNumber: 'CYPY9812A', // PAN (Sensitive)
    bankAccount: '302910492812', // Sensitive
    bankIfsc: 'SBIN0001829', // Sensitive
    bankName: 'State Bank of India',
    bankBranch: 'Uluberia Branch',
    joinedDate: '2022-04-10',
  },
  {
    id: 'drv_02',
    companyId: 'comp_wb_royal_001',
    fullName: 'Md. Farooq Alam',
    phone: '+91 98322 81900',
    altPhone: '+91 98322 81901',
    licenseNumber: 'BR0220160081293',
    licenseExpiry: '2027-11-30',
    address: 'Line Paar, Asansol, Paschim Bardhaman - 713301',
    emergencyContact: 'Nasreen Bano (Wife)',
    emergencyPhone: '+91 98322 81905',
    status: 'ON_TRIP',
    currentAdvanceBalancePaise: 1200000, // ₹12,000
    totalTripsCompleted: 35,
    monthlySalaryPaise: 2200000, // ₹22,000/mo (Sensitive)
    perDayBataPaise: 60000, // ₹600/day
    assignedVehicleReg: 'WB-29-B-7104',
    aadharNumber: '891238491029',
    panNumber: 'BKPA8819M',
    bankAccount: '50100293819201',
    bankIfsc: 'HDFC0000182',
    bankName: 'HDFC Bank Ltd.',
    bankBranch: 'Asansol GT Road',
    joinedDate: '2023-02-18',
  },
  {
    id: 'drv_03',
    companyId: 'comp_wb_royal_001',
    fullName: 'Somenath Karmakar',
    phone: '+91 94348 21992',
    altPhone: '+91 94348 21993',
    licenseNumber: 'WB2420180041920',
    licenseExpiry: '2026-11-20', // Expiring soon (~17 days)!
    address: 'Netaji Subhas Road, Chinsurah, Hooghly - 712101',
    emergencyContact: 'Tapan Karmakar (Brother)',
    emergencyPhone: '+91 94348 21995',
    status: 'AVAILABLE',
    currentAdvanceBalancePaise: 0,
    totalTripsCompleted: 62,
    monthlySalaryPaise: 2500000, // ₹25,000/mo (Sensitive)
    perDayBataPaise: 55000, // ₹550/day
    assignedVehicleReg: 'WB-11-D-9033',
    aadharNumber: '781920394819',
    panNumber: 'AUIP8810K',
    bankAccount: '992019482019',
    bankIfsc: 'PUNB0182900',
    bankName: 'Punjab National Bank',
    bankBranch: 'Chinsurah Main',
    joinedDate: '2021-09-01',
  },
  {
    id: 'drv_04',
    companyId: 'comp_wb_royal_001',
    fullName: 'Gurpreet Singh',
    phone: '+91 98144 02911',
    altPhone: '+91 98144 02912',
    licenseNumber: 'PB1020120092104',
    licenseExpiry: '2029-05-15',
    address: 'Transport Nagar, Durgapur - 713212',
    emergencyContact: 'Harjeet Kaur (Wife)',
    emergencyPhone: '+91 98144 02919',
    status: 'AVAILABLE',
    currentAdvanceBalancePaise: 0,
    totalTripsCompleted: 74,
    monthlySalaryPaise: 2800000, // ₹28,000/mo (Sensitive)
    perDayBataPaise: 70000, // ₹700/day
    aadharNumber: '291048291048',
    panNumber: 'AAAPG9912L',
    bankAccount: '11029482910',
    bankIfsc: 'ICIC0000109',
    bankName: 'ICICI Bank Ltd.',
    bankBranch: 'Durgapur City Centre',
    joinedDate: '2020-07-15',
  },
];

export const INITIAL_CUSTOMERS: Customer[] = [
  {
    id: 'cust_01',
    companyId: 'comp_wb_royal_001',
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
    creditLimitPaise: 500000000, // ₹50 Lakhs
    currentOutstandingPaise: 29500000, // ₹2.95 Lakhs
    totalFreightBilledPaise: 184000000, // ₹18.4 Lakhs
    createdAt: '2024-01-01T00:00:00Z',
  },
  {
    id: 'cust_02',
    companyId: 'comp_wb_royal_001',
    name: 'Emami Paper Mills Ltd.',
    tradeName: 'Emami Paper',
    gstin: '21AAACE1902E1ZN',
    pan: 'AAACE1902E',
    contactPerson: 'Rameshwar Patnaik',
    phone: '+91 6782 275555',
    email: 'dispatch.balasore@emamipaper.com',
    billingAddress: 'Balgopalpur Industrial Area',
    city: 'Balasore',
    state: 'Odisha',
    stateCode: '21',
    pincode: '756020',
    creditPeriodDays: 45,
    creditLimitPaise: 350000000, // ₹35 Lakhs
    currentOutstandingPaise: 14500000, // ₹1.45 Lakhs
    totalFreightBilledPaise: 98000000, // ₹9.8 Lakhs
    createdAt: '2024-02-15T00:00:00Z',
  },
  {
    id: 'cust_03',
    companyId: 'comp_wb_royal_001',
    name: 'Haldia Petrochemicals Ltd.',
    tradeName: 'HPL Haldia',
    gstin: '19AAACH3890A1ZY',
    pan: 'AAACH3890A',
    contactPerson: 'Debanjan Chatterjee',
    phone: '+91 3224 223000',
    email: 'freight@haldia.co.in',
    billingAddress: '1, Nelson Mandela Sarani, City Centre',
    city: 'Haldia',
    state: 'West Bengal',
    stateCode: '19',
    pincode: '721602',
    creditPeriodDays: 30,
    creditLimitPaise: 600000000, // ₹60 Lakhs
    currentOutstandingPaise: 0,
    totalFreightBilledPaise: 240000000,
    createdAt: '2024-01-10T00:00:00Z',
  },
];

export const INITIAL_TRIPS: Trip[] = [
  {
    id: 'trip_01',
    companyId: 'comp_wb_royal_001',
    tripNumber: 'TR-2026-0038',
    lrNumber: 'RBR/25-26/0142',
    customerId: 'cust_01',
    customerName: 'Shyam Steel Industries Ltd.',
    customerGstin: '19AAACS4128F1Z8',
    vehicleId: 'veh_01',
    vehicleReg: 'WB-19-K-4821',
    driverId: 'drv_01',
    driverName: 'Rajesh Yadav',
    driverPhone: '+91 97321 44501',
    originCity: 'Durgapur, WB',
    destinationCity: 'Siliguri, WB',
    goodsType: 'TMT Steel Bars & Coils',
    weightTonnes: 26.5,
    ratePerTonnePaise: 280000, // ₹2,800/Tonne
    freightAmountPaise: 7420000, // ₹74,200
    otherChargesPaise: 350000, // ₹3,500 unloading / toll support
    totalRevenuePaise: 7770000, // ₹77,700
    dispatchDate: '2026-11-01T08:30:00Z',
    expectedDeliveryDate: '2026-11-03T18:00:00Z',
    status: 'IN_TRANSIT',
    startOdometerKm: 142200,
    podReceived: false,
    totalExpensesPaise: 3820000, // ₹38,200 (Fuel + Toll + Bata)
    totalAdvancesPaise: 1800000, // ₹18,000
    tripContributionPaise: 3950000, // ₹39,500 contribution!
    isSettled: false,
    isInvoiced: false,
    notes: 'Urgent consignment for Matigara flyover project',
    createdAt: '2026-11-01T06:00:00Z',
  },
  {
    id: 'trip_02',
    companyId: 'comp_wb_royal_001',
    tripNumber: 'TR-2026-0037',
    lrNumber: 'RBR/25-26/0141',
    customerId: 'cust_02',
    customerName: 'Emami Paper Mills Ltd.',
    customerGstin: '21AAACE1902E1ZN',
    vehicleId: 'veh_02',
    vehicleReg: 'WB-29-B-7104',
    driverId: 'drv_02',
    driverName: 'Md. Farooq Alam',
    driverPhone: '+91 98322 81900',
    originCity: 'Balasore, Odisha',
    destinationCity: 'Kolkata, WB',
    goodsType: 'Duplex Board Paper Reels',
    weightTonnes: 19.8,
    ratePerTonnePaise: 185000, // ₹1,850/Tonne
    freightAmountPaise: 3663000, // ₹36,630
    otherChargesPaise: 150000, // ₹1,500
    totalRevenuePaise: 3813000, // ₹38,130
    dispatchDate: '2026-11-01T14:00:00Z',
    expectedDeliveryDate: '2026-11-02T22:00:00Z',
    status: 'IN_TRANSIT',
    startOdometerKm: 198180,
    podReceived: false,
    totalExpensesPaise: 1740000, // ₹17,400
    totalAdvancesPaise: 1200000, // ₹12,000
    tripContributionPaise: 2073000, // ₹20,730
    isSettled: false,
    isInvoiced: false,
    notes: 'Interstate shipment via Kharagpur NH-16',
    createdAt: '2026-11-01T11:00:00Z',
  },
  {
    id: 'trip_03',
    companyId: 'comp_wb_royal_001',
    tripNumber: 'TR-2026-0036',
    lrNumber: 'RBR/25-26/0140',
    customerId: 'cust_01',
    customerName: 'Shyam Steel Industries Ltd.',
    customerGstin: '19AAACS4128F1Z8',
    vehicleId: 'veh_03',
    vehicleReg: 'WB-11-D-9033',
    driverId: 'drv_03',
    driverName: 'Somenath Karmakar',
    driverPhone: '+91 94348 21992',
    originCity: 'Durgapur, WB',
    destinationCity: 'Kolkata, WB',
    goodsType: 'Structural Steel Angles',
    weightTonnes: 15.2,
    ratePerTonnePaise: 140000,
    freightAmountPaise: 2128000,
    otherChargesPaise: 100000,
    totalRevenuePaise: 2228000, // ₹22,280
    dispatchDate: '2026-10-28T09:00:00Z',
    expectedDeliveryDate: '2026-10-29T16:00:00Z',
    actualDeliveryDate: '2026-10-29T14:30:00Z',
    status: 'SETTLED',
    startOdometerKm: 87190,
    endOdometerKm: 87400,
    podReceived: true,
    totalExpensesPaise: 980000, // ₹9,800
    totalAdvancesPaise: 800000, // ₹8,000
    tripContributionPaise: 1248000, // ₹12,480
    isSettled: true,
    isInvoiced: true,
    invoiceId: 'inv_01',
    createdAt: '2026-10-28T07:00:00Z',
  },
];

export const INITIAL_EXPENSES: TripExpense[] = [
  {
    id: 'exp_01',
    companyId: 'comp_wb_royal_001',
    tripId: 'trip_01',
    vehicleId: 'veh_01',
    category: 'DIESEL',
    amountPaise: 2750000, // ₹27,500
    paymentMode: 'PETRO_CARD',
    date: '2026-11-01',
    description: '300.5 Litres Diesel at Dankuni IOCL COCO pump',
    litresFuel: 300.5,
    ratePerLitrePaise: 9151, // ₹91.51/Litre
    pumpName: 'IOCL COCO Dankuni Toll Plaza',
    odometerReading: 142200,
    receiptNumber: 'IOCL-98124',
    recordedBy: 'Anupam Ghosh',
    isDriverDisbursed: false,
  },
  {
    id: 'exp_02',
    companyId: 'comp_wb_royal_001',
    tripId: 'trip_01',
    vehicleId: 'veh_01',
    category: 'TOLL_FASTAG',
    amountPaise: 480000, // ₹4,800
    paymentMode: 'FASTAG',
    date: '2026-11-01',
    description: 'FastTag auto-debit: Dankuni, Palsit, Panagarh, Moregram Plazas',
    receiptNumber: 'FASTAG-TXN-4912',
    recordedBy: 'System Auto-Sync',
    isDriverDisbursed: false,
  },
  {
    id: 'exp_03',
    companyId: 'comp_wb_royal_001',
    tripId: 'trip_01',
    vehicleId: 'veh_01',
    category: 'DRIVER_BATA',
    amountPaise: 180000, // ₹1,800 (3 days @ ₹600)
    paymentMode: 'CASH',
    date: '2026-11-01',
    description: 'Driver trip daily allowance (3 days x ₹600)',
    recordedBy: 'Bikash Mahato',
    isDriverDisbursed: true,
  },
  {
    id: 'exp_04',
    companyId: 'comp_wb_royal_001',
    tripId: 'trip_01',
    vehicleId: 'veh_01',
    category: 'LOADING_UNLOADING',
    amountPaise: 250000, // ₹2,500
    paymentMode: 'CASH',
    date: '2026-11-01',
    description: 'Loading tarpaulin & dunnage charge at Durgapur stockyard',
    recordedBy: 'Rajesh Yadav (Driver)',
    isDriverDisbursed: true,
  },
  {
    id: 'exp_05',
    companyId: 'comp_wb_royal_001',
    tripId: 'trip_01',
    vehicleId: 'veh_01',
    category: 'DEF_ADBLUE',
    amountPaise: 160000, // ₹1,600
    paymentMode: 'CASH',
    date: '2026-11-01',
    description: '20L Tata Genuine DEF Blue at Farakka',
    recordedBy: 'Rajesh Yadav',
    isDriverDisbursed: true,
  },
];

export const INITIAL_ADVANCES: DriverAdvance[] = [
  {
    id: 'adv_01',
    companyId: 'comp_wb_royal_001',
    tripId: 'trip_01',
    driverId: 'drv_01',
    amountPaise: 1800000, // ₹18,000 cash advance
    advanceType: 'CASH_DISPATCH',
    date: '2026-11-01',
    referenceNotes: 'Handover at Dankuni office before Siliguri dispatch',
    disbursedBy: 'Bikash Mahato',
    isSettled: false,
  },
  {
    id: 'adv_02',
    companyId: 'comp_wb_royal_001',
    tripId: 'trip_02',
    driverId: 'drv_02',
    amountPaise: 1200000, // ₹12,000
    advanceType: 'UPI_ONLINE',
    date: '2026-11-01',
    referenceNotes: 'Sent via GPay to driver mobile for Balasore route',
    disbursedBy: 'Anupam Ghosh',
    isSettled: false,
  },
];

export const INITIAL_SETTLEMENTS: TripSettlement[] = [
  {
    id: 'set_01',
    companyId: 'comp_wb_royal_001',
    tripId: 'trip_03',
    driverId: 'drv_03',
    tripNumber: 'TR-2026-0036',
    driverName: 'Somenath Karmakar',
    totalAdvanceGivenPaise: 800000, // ₹8,000
    driverCashExpensesPaise: 540000, // ₹5,400 (unloading + weighbridge)
    driverBataAllowancePaise: 110000, // ₹1,100 (2 days @ ₹550)
    otherDeductionsPaise: 0,
    netPayableToDriverPaise: -150000, // -₹1,500 (Driver returned ₹1,500 surplus cash)
    status: 'APPROVED_SETTLED',
    settledDate: '2026-10-30',
    settledBy: 'Subhashish Dey (Accountant)',
    settlementNotes: 'Vouchers verified against IOCL slip & weighbridge slip. ₹1,500 deposited into petty cash.',
  },
];

export const INITIAL_INVOICES: Invoice[] = [
  {
    id: 'inv_01',
    companyId: 'comp_wb_royal_001',
    invoiceNumber: 'INV/25-26/0140',
    tripId: 'trip_03',
    tripNumber: 'TR-2026-0036',
    lrNumber: 'RBR/25-26/0140',
    customerId: 'cust_01',
    customerName: 'Shyam Steel Industries Ltd.',
    customerGstin: '19AAACS4128F1Z8',
    issueDate: '2026-10-30',
    dueDate: '2026-11-29',
    taxableAmountPaise: 2228000, // ₹22,280
    isRcmApplicable: true, // GTA RCM (Recipient pays tax)
    cgstRatePercent: 0,
    sgstRatePercent: 0,
    igstRatePercent: 0,
    cgstAmountPaise: 0,
    sgstAmountPaise: 0,
    igstAmountPaise: 0,
    totalAmountPaise: 2228000,
    amountPaidPaise: 0,
    balanceDuePaise: 2228000,
    paymentStatus: 'UNPAID',
    status: 'ISSUED',
    notes: 'GST payable under Reverse Charge Mechanism (GTA). Stamped POD attached.',
    createdAt: '2026-10-30T10:00:00Z',
  },
];

export const INITIAL_PAYMENTS: Payment[] = [
  {
    id: 'pay_01',
    companyId: 'comp_wb_royal_001',
    invoiceId: 'inv_old_01',
    invoiceNumber: 'INV/25-26/0128',
    customerId: 'cust_01',
    customerName: 'Shyam Steel Industries Ltd.',
    amountPaise: 18500000, // ₹1,85,000
    paymentDate: '2026-10-25',
    paymentMode: 'NEFT_RTGS',
    referenceNumber: 'HDFCR5202610250089',
    tdsDeductedPaise: 377500, // ₹3,775 (2% TDS u/s 194C)
    bankAccount: 'HDFC Bank Ltd. (A/C ...1234)',
    recordedBy: 'Subhashish Dey',
    notes: 'Payment received via RTGS. TDS certificate awaited.',
  },
];

export const INITIAL_DOCUMENTS: VehicleDocument[] = [
  {
    id: 'doc_01',
    companyId: 'comp_wb_royal_001',
    vehicleId: 'veh_01',
    vehicleReg: 'WB-19-K-4821',
    docType: 'FITNESS',
    documentNumber: 'WB19/FIT/2025/8912',
    issuingAuthority: 'RTO Howrah',
    issueDate: '2025-11-20',
    expiryDate: '2026-11-19', // ~17 days away! (Amber / Expiring soon)
    daysUntilExpiry: 17,
    status: 'EXPIRING_SOON',
  },
  {
    id: 'doc_02',
    companyId: 'comp_wb_royal_001',
    vehicleId: 'veh_01',
    vehicleReg: 'WB-19-K-4821',
    docType: 'NATIONAL_PERMIT',
    documentNumber: 'NP/WB/2024/091823',
    issuingAuthority: 'STA West Bengal',
    issueDate: '2024-05-10',
    expiryDate: '2029-05-09',
    daysUntilExpiry: 918,
    status: 'VALID',
  },
  {
    id: 'doc_03',
    companyId: 'comp_wb_royal_001',
    vehicleId: 'veh_02',
    vehicleReg: 'WB-29-B-7104',
    docType: 'INSURANCE',
    documentNumber: 'NIC/COMP/48910283/2025',
    issuingAuthority: 'National Insurance Co.',
    issueDate: '2025-08-15',
    expiryDate: '2026-08-14',
    daysUntilExpiry: 285,
    status: 'VALID',
  },
  {
    id: 'doc_04',
    companyId: 'comp_wb_royal_001',
    vehicleId: 'veh_04',
    vehicleReg: 'WB-33-C-5219',
    docType: 'PUC',
    documentNumber: 'WB-PUC-2026-44912',
    issuingAuthority: 'Authorized Testing Center Durgapur',
    issueDate: '2026-04-12',
    expiryDate: '2026-10-11', // Expired 22 days ago! (Red)
    daysUntilExpiry: -22,
    status: 'EXPIRED',
  },
];
