export const centsToDecimal = (cents: number): number => cents / 100;
export const decimalToCents = (value: number): number => Math.round(value * 100);

export const formatMoney = (
  cents: number,
  currencyCode: string,
  locale: string
): string =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
  }).format(centsToDecimal(cents));
