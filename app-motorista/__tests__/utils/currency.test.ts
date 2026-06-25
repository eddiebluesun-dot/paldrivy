import { formatMoney, centsToDecimal, decimalToCents } from '../../src/utils/currency';

test('formatMoney BRL', () => {
  // Intl.NumberFormat pt-BR uses non-breaking space (U+00A0) between symbol and digits
  expect(formatMoney(32000, 'BRL', 'pt-BR')).toBe('R$ 320,00');
});
test('formatMoney USD', () => {
  expect(formatMoney(100, 'USD', 'en-US')).toBe('$1.00');
});
test('centsToDecimal', () => {
  expect(centsToDecimal(32000)).toBe(320.0);
});
test('decimalToCents', () => {
  expect(decimalToCents(320.0)).toBe(32000);
});
