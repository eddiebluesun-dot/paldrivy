// Pure date+time <-> ISO conversions for the shift edit form's start/end
// timestamps. Replaces the old displayToIso/isoToDisplay pair (DD/MM/YYYY
// HH:mm regex parsing) now that the form collects a DateField + TimeField
// pair instead of one free-text field -- both sub-values are already
// structurally valid (YYYY-MM-DD / HH:mm) by the time they reach here, so
// this is string composition, not validation.

export function isoToDateAndTime(iso: string | null | undefined): { date: string | null; time: string | null } {
  if (!iso) return { date: null, time: null };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: null, time: null };
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

export function dateAndTimeToIso(date: string | null, time: string | null): string | undefined {
  if (!date || !time) return undefined;
  const d = new Date(`${date}T${time}:00`);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}
