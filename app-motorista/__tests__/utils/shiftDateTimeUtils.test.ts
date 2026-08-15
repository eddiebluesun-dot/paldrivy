import { dateAndTimeToIso, isoToDateAndTime } from '../../src/utils/shiftDateTimeUtils';

describe('isoToDateAndTime', () => {
  it('returns null date/time for null input', () => {
    expect(isoToDateAndTime(null)).toEqual({ date: null, time: null });
  });

  it('returns null date/time for undefined input', () => {
    expect(isoToDateAndTime(undefined)).toEqual({ date: null, time: null });
  });

  it('splits an ISO timestamp into local date and time parts', () => {
    const d = new Date(2026, 7, 14, 9, 5); // local Aug 14 2026, 09:05
    const { date, time } = isoToDateAndTime(d.toISOString());
    expect(date).toBe('2026-08-14');
    expect(time).toBe('09:05');
  });

  it('zero-pads single-digit month/day/hour/minute', () => {
    const d = new Date(2026, 0, 5, 6, 3); // local Jan 5 2026, 06:03
    const { date, time } = isoToDateAndTime(d.toISOString());
    expect(date).toBe('2026-01-05');
    expect(time).toBe('06:03');
  });

  it('returns null date/time for an unparsable string', () => {
    expect(isoToDateAndTime('not-a-date')).toEqual({ date: null, time: null });
  });
});

describe('dateAndTimeToIso', () => {
  it('returns undefined when date is null', () => {
    expect(dateAndTimeToIso(null, '09:00')).toBeUndefined();
  });

  it('returns undefined when time is null', () => {
    expect(dateAndTimeToIso('2026-08-14', null)).toBeUndefined();
  });

  it('returns undefined when both are null', () => {
    expect(dateAndTimeToIso(null, null)).toBeUndefined();
  });

  it('combines a date and time into the equivalent local-time ISO string', () => {
    const expected = new Date(2026, 7, 14, 9, 5, 0).toISOString();
    expect(dateAndTimeToIso('2026-08-14', '09:05')).toBe(expected);
  });
});

describe('isoToDateAndTime / dateAndTimeToIso round-trip', () => {
  it('returns the original ISO string (to the second) after a round trip', () => {
    const original = new Date(2026, 7, 14, 9, 5, 0).toISOString();
    const { date, time } = isoToDateAndTime(original);
    expect(dateAndTimeToIso(date, time)).toBe(original);
  });
});
