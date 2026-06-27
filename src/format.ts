// Formatting helpers, AU locale throughout.

export function formatCurrency(n: number, opts?: { decimals?: boolean }): string {
  if (!Number.isFinite(n)) return "$0";
  const decimals = opts?.decimals ?? false;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  return (
    sign +
    "$" +
    abs.toLocaleString("en-AU", {
      minimumFractionDigits: decimals ? 2 : 0,
      maximumFractionDigits: decimals ? 2 : 0,
    })
  );
}

/** Compact currency for axis labels, e.g. $1.7m, $260k. */
export function formatCurrencyCompact(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return sign + "$" + (abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1) + "m";
  if (abs >= 1_000) return sign + "$" + Math.round(abs / 1_000) + "k";
  return sign + "$" + Math.round(abs);
}

export function formatPercent(fraction: number, decimals = 1): string {
  if (!Number.isFinite(fraction)) return "0%";
  return (fraction * 100).toFixed(decimals) + "%";
}

export function formatNumber(n: number, decimals = 0): string {
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString("en-AU", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function roundClients(n: number): number {
  return Math.ceil(n - 1e-9);
}

/** Null-safe display for figures that are genuinely undefined (e.g. break even
 *  with no revenue). */
export function orNa(
  n: number | null,
  fmt: (x: number) => string,
  na = "n/a"
): string {
  return n === null || !Number.isFinite(n) ? na : fmt(n);
}
