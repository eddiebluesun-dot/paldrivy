import { dateToHm, dateToYmd, hmToDate, ymdToDate } from '../../src/utils/dateFieldFormat';

describe('ymdToDate', () => {
  it('parses a YYYY-MM-DD string into a local Date at midnight', () => {
    const d = ymdToDate('2026-08-14');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7); // 0-indexed
    expect(d.getDate()).toBe(14);
  });

  it('parses single-digit month/day correctly', () => {
    const d = ymdToDate('2026-01-05');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(5);
  });
});

describe('dateToYmd', () => {
  it('formats a Date as YYYY-MM-DD', () => {
    expect(dateToYmd(new Date(2026, 7, 14))).toBe('2026-08-14');
  });

  it('zero-pads single-digit month and day', () => {
    expect(dateToYmd(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('ymdToDate / dateToYmd round-trip', () => {
  it('returns the original string after a round trip', () => {
    expect(dateToYmd(ymdToDate('2026-12-31'))).toBe('2026-12-31');
  });
});

describe('hmToDate', () => {
  it('parses an HH:mm string into a Date with matching hours/minutes', () => {
    const d = hmToDate('06:05');
    expect(d.getHours()).toBe(6);
    expect(d.getMinutes()).toBe(5);
  });

  it('parses times at the edge of the day', () => {
    const d = hmToDate('23:59');
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
  });
});

describe('dateToHm', () => {
  it('formats a Date as zero-padded HH:mm', () => {
    const d = new Date(2026, 7, 14, 6, 5);
    expect(dateToHm(d)).toBe('06:05');
  });

  it('does not zero-pad double-digit hours/minutes', () => {
    const d = new Date(2026, 7, 14, 23, 59);
    expect(dateToHm(d)).toBe('23:59');
  });
});

describe('hmToDate / dateToHm round-trip', () => {
  it('returns the original string after a round trip', () => {
    expect(dateToHm(hmToDate('09:30'))).toBe('09:30');
  });
});
