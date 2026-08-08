import { emailsMatch } from '@/src/utils/emailConfirmationUtils';

describe('emailsMatch', () => {
  it('matches identical emails', () => {
    expect(emailsMatch('driver@example.com', 'driver@example.com')).toBe(true);
  });
  it('matches case-insensitively', () => {
    expect(emailsMatch('Driver@Example.com', 'driver@example.com')).toBe(true);
  });
  it('matches with surrounding whitespace trimmed', () => {
    expect(emailsMatch('  driver@example.com  ', 'driver@example.com')).toBe(true);
  });
  it('does not match different emails', () => {
    expect(emailsMatch('driver@example.com', 'driver@exemple.com')).toBe(false);
  });
  it('does not match when either field is empty', () => {
    expect(emailsMatch('', '')).toBe(false);
    expect(emailsMatch('driver@example.com', '')).toBe(false);
  });
});
