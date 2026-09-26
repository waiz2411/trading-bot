/**
 * Dynamic Decimal & Price Formatter Utility
 * Formats low-priced altcoins (e.g. GALA, VET, SEI) with full decimal fidelity
 * while cleanly displaying major pairs and fiat instruments.
 */

export function getAssetPrecision(price, baseDecimals = 2) {
  const p = Math.abs(Number(price) || 0);
  if (p === 0) return baseDecimals;
  if (p < 0.0001) return Math.max(8, baseDecimals);
  if (p < 0.01) return Math.max(7, baseDecimals);
  if (p < 0.1) return Math.max(6, baseDecimals);
  if (p < 1.0) return Math.max(5, baseDecimals);
  if (p < 10) return Math.max(4, baseDecimals);
  if (p < 1000) return Math.max(2, baseDecimals);
  return 2;
}

export function formatPrice(price, decimals = null) {
  if (price === null || price === undefined || isNaN(price)) return '—';
  const num = Number(price);
  const prec = decimals !== null ? decimals : getAssetPrecision(num);
  return num.toLocaleString('en-US', {
    minimumFractionDigits: Math.min(2, prec),
    maximumFractionDigits: prec
  });
}

export function formatUnits(units, price = null) {
  if (units === null || units === undefined || isNaN(units)) return '—';
  const num = Number(units);
  if (price && Number(price) < 1.0) {
    return num.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
  return num < 1 ? num.toFixed(4) : num.toLocaleString('en-US', { maximumFractionDigits: 2 });
}
