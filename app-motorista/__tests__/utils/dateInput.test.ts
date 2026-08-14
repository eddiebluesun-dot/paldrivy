import { parseFlexibleDateInput } from '../../src/utils/dateInput';

describe('parseFlexibleDateInput', () => {
  it('passes through a valid ISO date unchanged', () => {
    expect(parseFlexibleDateInput('2026-08-14')).toBe('2026-08-14');
  });

  // Regression test for the production bug: the field's placeholder says
  // "AAAA-MM-DD" but the app never enforced or converted that format. The
  // exact same literal value crashed vehicle registration twice in
  // production with a raw Postgres error.
  it('converts DD/MM/YYYY (the format users actually type) to ISO', () => {
    expect(parseFlexibleDateInput('14/08/2026')).toBe('2026-08-14');
  });

  it('returns null for an empty or whitespace-only string', () => {
    expect(parseFlexibleDateInput('')).toBeNull();
    expect(parseFlexibleDateInput('   ')).toBeNull();
  });

  it('returns null for an invalid ISO date (bad month/day)', () => {
    expect(parseFlexibleDateInput('2026-14-08')).toBeNull(); // month 14 doesn't exist
    expect(parseFlexibleDateInput('2026-02-30')).toBeNull(); // Feb 30 doesn't exist
  });

  it('returns null for an invalid DD/MM/YYYY date (bad month/day)', () => {
    expect(parseFlexibleDateInput('30/02/2026')).toBeNull(); // Feb 30 doesn't exist
    expect(parseFlexibleDateInput('00/01/2026')).toBeNull(); // day 0 doesn't exist
  });

  it('returns null for text that matches neither format', () => {
    expect(parseFlexibleDateInput('14 de agosto')).toBeNull();
    expect(parseFlexibleDateInput('not a date')).toBeNull();
    expect(parseFlexibleDateInput('2026/08/14')).toBeNull(); // wrong separator for ISO
  });

  it('trims surrounding whitespace before parsing', () => {
    expect(parseFlexibleDateInput('  14/08/2026  ')).toBe('2026-08-14');
  });
});
