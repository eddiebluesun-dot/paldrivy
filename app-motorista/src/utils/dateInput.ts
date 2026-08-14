// Normalizes a user-typed date to YYYY-MM-DD (Postgres `date` format).
// Accepts the app's own ISO placeholder format (AAAA-MM-DD) unchanged, and
// also DD/MM/AAAA -- the format Brazilian users naturally type regardless
// of the placeholder. Confirmed in production TWICE: the exact same literal
// value ("14/08/2026", today's date typed DD/MM/YYYY into the rental
// contract start date field) crashed vehicle registration both times with
// a raw Postgres "date/time field value out of range" error (SQLSTATE
// 22008) -- the app sent the free-text input straight through with no
// parsing or validation at all.
// Returns null when the input matches neither format (or isn't a real
// calendar date), so a garbage value degrades to "no date" instead of
// crashing the request that contains it.
export function parseFlexibleDateInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return isValidYMD(Number(y), Number(m), Number(d)) ? trimmed : null;
  }

  const brMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) {
    const [, d, m, y] = brMatch;
    if (!isValidYMD(Number(y), Number(m), Number(d))) return null;
    return `${y}-${m}-${d}`;
  }

  return null;
}

function isValidYMD(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
