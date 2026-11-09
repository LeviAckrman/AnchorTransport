/**
 * Currency and Indian Numbering Format Utilities
 * Guarantees zero floating point errors by operating strictly in integer paise.
 */

/**
 * Formats integer paise into Indian Rupee string (e.g. 15000000 paise -> "₹1,50,000")
 */
export function formatINR(paise: number, showDecimals: boolean = false): string {
  if (isNaN(paise) || paise === null || paise === undefined) return '₹0';
  
  const isNegative = paise < 0;
  const absPaise = Math.abs(Math.round(paise));
  const rupees = Math.floor(absPaise / 100);
  const remainingPaise = absPaise % 100;

  // Indian numbering grouping: last 3 digits, then groups of 2
  const rupeeString = rupees.toString();
  let formattedRupees = '';

  if (rupeeString.length <= 3) {
    formattedRupees = rupeeString;
  } else {
    const lastThree = rupeeString.substring(rupeeString.length - 3);
    const otherDigits = rupeeString.substring(0, rupeeString.length - 3);
    // Group remaining into pairs
    const withCommas = otherDigits.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    formattedRupees = `${withCommas},${lastThree}`;
  }

  const prefix = isNegative ? '-₹' : '₹';
  
  if (showDecimals && remainingPaise > 0) {
    return `${prefix}${formattedRupees}.${remainingPaise.toString().padStart(2, '0')}`;
  }

  return `${prefix}${formattedRupees}`;
}

/**
 * Converts Rupees (from user form input) to integer paise
 */
export function rupeesToPaise(rupees: number | string): number {
  if (typeof rupees === 'string') {
    const clean = rupees.replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(clean);
    return isNaN(parsed) ? 0 : Math.round(parsed * 100);
  }
  return Math.round(rupees * 100);
}

/**
 * Converts integer paise to Rupees for input display
 */
export function paiseToRupees(paise: number): number {
  return (paise || 0) / 100;
}

/**
 * Formats a number to Indian system without currency symbol (e.g., 25000 -> 25,000)
 */
export function formatIndianNumber(num: number): string {
  if (isNaN(num)) return '0';
  const parts = Math.round(num).toString().split('.');
  let lastThree = parts[0].substring(parts[0].length - 3);
  const otherNumbers = parts[0].substring(0, parts[0].length - 3);
  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }
  return otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + lastThree;
}
