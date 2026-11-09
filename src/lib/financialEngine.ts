/**
 * AnchorTransport TMS - Core Financial & Settlement Engine
 * 
 * Implements strict financial rules:
 * 1. Trip Contribution = Freight Revenue - Recorded Trip Expenses.
 * 2. Advances are cash movements (balance sheet asset/liability), NOT corporate expenses.
 * 3. Driver settlement reconciles advances against presented expense vouchers + driver bata.
 * 4. GST GTA compliance (RCM vs Forward Charge) and TDS 194C calculations.
 */

import { TripExpense, DriverAdvance } from '../types/tms';

export interface TripContributionResult {
  revenuePaise: number;
  expensesPaise: number;
  contributionPaise: number;
  profitMarginPercent: number;
  fuelExpensesPaise: number;
  tollExpensesPaise: number;
  otherExpensesPaise: number;
}

/**
 * Calculates trip operational contribution.
 * NOTE: Contribution is explicitly gross operational margin before truck EMI, insurance, and company overheads.
 */
export function calculateTripContribution(
  freightRevenuePaise: number,
  expenses: TripExpense[]
): TripContributionResult {
  let totalExpenses = 0;
  let fuelExpenses = 0;
  let tollExpenses = 0;
  let otherExpenses = 0;

  for (const exp of expenses) {
    totalExpenses += exp.amountPaise;
    if (exp.category === 'DIESEL') {
      fuelExpenses += exp.amountPaise;
    } else if (exp.category === 'TOLL_FASTAG') {
      tollExpenses += exp.amountPaise;
    } else {
      otherExpenses += exp.amountPaise;
    }
  }

  const contribution = freightRevenuePaise - totalExpenses;
  const margin = freightRevenuePaise > 0 
    ? Math.round((contribution / freightRevenuePaise) * 1000) / 10 
    : 0;

  return {
    revenuePaise: freightRevenuePaise,
    expensesPaise: totalExpenses,
    contributionPaise: contribution,
    profitMarginPercent: margin,
    fuelExpensesPaise: fuelExpenses,
    tollExpensesPaise: tollExpenses,
    otherExpensesPaise: otherExpenses,
  };
}

export interface DriverSettlementCalculation {
  totalAdvancesGivenPaise: number;
  driverPaidExpensesPaise: number;
  driverBataAllowancePaise: number;
  approvedDeductionsPaise: number;
  remainingDriverBalancePaise: number; // Total Advances - Approved Deductions & Incurred Expenses (Cash driver still holds)
  netPayableToDriverPaise: number; // If positive: company pays driver. If negative: driver returns cash.
  isCompanyDue: boolean;
}

/**
 * Reconciles Driver Cash Advances against physical expense receipts & driver daily bata.
 * 
 * Formula:
 * Remaining Driver Balance = Total Advances - (Approved Deductions + Driver Cash Expenses + Bata Allowance)
 * Net Payable to Driver = (Driver Cash Expenses + Bata Allowance) - (Total Advances + Deductions)
 */
export function calculateDriverSettlement(
  advances: DriverAdvance[],
  expenses: TripExpense[],
  tripDays: number,
  perDayBataPaise: number,
  approvedDeductionsPaise: number = 0
): DriverSettlementCalculation {
  // Sum advances disbursed
  const totalAdvances = advances.reduce((sum, a) => sum + a.amountPaise, 0);

  // Filter expenses paid by the driver out of pocket / cash in hand
  const driverCashExpenses = expenses
    .filter((e) => e.isDriverDisbursed || e.paymentMode === 'CASH' || e.paymentMode === 'DRIVER_POCKET')
    .reduce((sum, e) => sum + e.amountPaise, 0);

  const totalBata = Math.max(0, tripDays) * perDayBataPaise;
  const totalCreditsToDriver = driverCashExpenses + totalBata;
  const totalDebitsToDriver = totalAdvances + approvedDeductionsPaise;

  const netBalance = totalCreditsToDriver - totalDebitsToDriver;
  // Per Phase 7 TMS Specification:
  // Total advances minus approved driver deductions equals remaining driver balance
  const remainingDriverBalance = totalAdvances - approvedDeductionsPaise;

  return {
    totalAdvancesGivenPaise: totalAdvances,
    driverPaidExpensesPaise: driverCashExpenses,
    driverBataAllowancePaise: totalBata,
    approvedDeductionsPaise,
    remainingDriverBalancePaise: remainingDriverBalance,
    netPayableToDriverPaise: netBalance,
    isCompanyDue: netBalance >= 0,
  };
}

export interface GstTaxCalculation {
  taxableAmountPaise: number;
  cgstAmountPaise: number;
  sgstAmountPaise: number;
  igstAmountPaise: number;
  totalTaxPaise: number;
  totalInvoiceAmountPaise: number;
  isRcm: boolean;
}

/**
 * Calculates GST based on GTA (Goods Transport Agency) Indian regulations.
 * 
 * In GTA:
 * - If RCM (Reverse Charge Mechanism): Customer pays 5% tax directly to government, transporter invoice tax is ₹0.
 * - If Forward Charge (Intra-state, e.g. WB to WB): 2.5% CGST + 2.5% SGST (or 6% + 6% with ITC)
 * - If Forward Charge (Inter-state, e.g. WB to Odisha/Bihar): 5% IGST (or 12% IGST with ITC)
 */
export function calculateGstInvoice(
  freightPaise: number,
  companyStateCode: string,
  customerStateCode: string,
  isRcm: boolean = true,
  taxRatePercent: number = 5
): GstTaxCalculation {
  if (isRcm) {
    // Under RCM, the GST is payable by the recipient of service (consignor/consignee)
    return {
      taxableAmountPaise: freightPaise,
      cgstAmountPaise: 0,
      sgstAmountPaise: 0,
      igstAmountPaise: 0,
      totalTaxPaise: 0,
      totalInvoiceAmountPaise: freightPaise,
      isRcm: true,
    };
  }

  const isIntraState = companyStateCode.trim() === customerStateCode.trim();

  if (isIntraState) {
    const halfRate = taxRatePercent / 2 / 100;
    const cgst = Math.round(freightPaise * halfRate);
    const sgst = Math.round(freightPaise * halfRate);
    const totalTax = cgst + sgst;
    return {
      taxableAmountPaise: freightPaise,
      cgstAmountPaise: cgst,
      sgstAmountPaise: sgst,
      igstAmountPaise: 0,
      totalTaxPaise: totalTax,
      totalInvoiceAmountPaise: freightPaise + totalTax,
      isRcm: false,
    };
  } else {
    const igstRate = taxRatePercent / 100;
    const igst = Math.round(freightPaise * igstRate);
    return {
      taxableAmountPaise: freightPaise,
      cgstAmountPaise: 0,
      sgstAmountPaise: 0,
      igstAmountPaise: igst,
      totalTaxPaise: igst,
      totalInvoiceAmountPaise: freightPaise + igst,
      isRcm: false,
    };
  }
}

/**
 * Calculates Section 194C TDS deduction on transport payments (1% for individuals/HUF, 2% for companies)
 */
export function calculateTds(amountPaise: number, tdsRatePercent: number = 2): number {
  return Math.round((amountPaise * tdsRatePercent) / 100);
}

/**
 * Converts integer paise to float rupees (e.g. 10050 paise -> 100.50 rupees)
 */
export function paiseToRupees(paise: number): number {
  return (paise || 0) / 100;
}

/**
 * Converts float rupees to integer paise without floating point inaccuracy (e.g. 100.50 -> 10050)
 */
export function rupeesToPaise(rupees: number): number {
  return Math.round((rupees || 0) * 100);
}

/**
 * Formats integer paise into Indian Rupee string (e.g. ₹1,25,000.00)
 */
export function formatINR(paise: number, includeDecimals = true): string {
  const rupees = paiseToRupees(paise);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: includeDecimals ? 2 : 0,
    maximumFractionDigits: includeDecimals ? 2 : 0,
  }).format(rupees);
}

/**
 * Convenient alias for formatINR
 */
export const formatRupees = formatINR;

