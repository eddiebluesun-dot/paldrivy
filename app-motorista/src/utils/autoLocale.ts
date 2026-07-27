import * as Localization from 'expo-localization';

export type SupportedLang = 'pt' | 'en' | 'en-GB' | 'es';

export interface AutoLocaleResult {
  lang: SupportedLang;
  currency_code: string;
  distance_unit: 'km' | 'mi';
  volume_unit: 'liters' | 'gallons';
  locale: string;   // BCP-47 for Intl formatting
  country: string;  // ISO 3166-1 alpha-2
  timezone: string; // IANA tz
}

// Countries that officially use miles for road distances
const MILES_COUNTRIES = new Set(['US', 'GB', 'MM', 'LR']);

// Countries that use gallons for fuel (US gallons only; UK switched to liters in 1988)
const GALLONS_COUNTRIES = new Set(['US']);

// Portuguese-speaking countries
const PT_COUNTRIES = new Set(['BR', 'PT', 'AO', 'MZ', 'CV', 'GW', 'ST', 'TL']);

// Spanish-speaking countries
const ES_COUNTRIES = new Set([
  'MX', 'CO', 'AR', 'PE', 'VE', 'CL', 'EC', 'GT', 'CU', 'BO',
  'DO', 'HN', 'PY', 'SV', 'NI', 'CR', 'PA', 'UY', 'GQ', 'ES',
]);

// Commonwealth + anglophone Africa/Asia/Oceania → en-GB translation
const EN_GB_COUNTRIES = new Set([
  'GB', 'AU', 'NZ', 'IE', 'ZA', 'NG', 'GH', 'KE', 'UG', 'TZ',
  'ZM', 'ZW', 'BW', 'NA', 'MW', 'LS', 'SZ', 'SG', 'MY', 'IN',
  'PK', 'BD', 'LK', 'NP', 'PG', 'FJ', 'WS', 'TO', 'VU', 'SB',
  'JM', 'TT', 'BB', 'PH',
]);

// Country → ISO 4217 currency code
export const COUNTRY_CURRENCY: Record<string, string> = {
  // Latin America
  BR: 'BRL', MX: 'MXN', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  VE: 'VES', UY: 'UYU', BO: 'BOB', PY: 'PYG', EC: 'USD', CR: 'CRC',
  PA: 'USD', SV: 'USD', CU: 'CUP', DO: 'DOP', GT: 'GTQ', HN: 'HNL',
  NI: 'NIO', JM: 'JMD', TT: 'TTD', BB: 'BBD',
  // North America
  US: 'USD', CA: 'CAD',
  // Europe — Eurozone
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', PT: 'EUR', NL: 'EUR',
  BE: 'EUR', AT: 'EUR', GR: 'EUR', IE: 'EUR', FI: 'EUR', SK: 'EUR',
  SI: 'EUR', EE: 'EUR', LV: 'EUR', LT: 'EUR', LU: 'EUR', MT: 'EUR',
  CY: 'EUR', HR: 'EUR',
  // Europe — non-EUR
  GB: 'GBP', CH: 'CHF', NO: 'NOK', SE: 'SEK', DK: 'DKK', PL: 'PLN',
  CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN', RS: 'RSD', UA: 'UAH',
  RU: 'RUB', BY: 'BYN', TR: 'TRY', IS: 'ISK', MK: 'MKD', AL: 'ALL',
  BA: 'BAM', ME: 'EUR', XK: 'EUR',
  // Asia-Pacific
  JP: 'JPY', CN: 'CNY', KR: 'KRW', IN: 'INR', AU: 'AUD', NZ: 'NZD',
  SG: 'SGD', HK: 'HKD', TW: 'TWD', TH: 'THB', VN: 'VND', ID: 'IDR',
  MY: 'MYR', PH: 'PHP', PK: 'PKR', BD: 'BDT', LK: 'LKR', NP: 'NPR',
  MM: 'MMK', KH: 'KHR', LA: 'LAK', MN: 'MNT', KZ: 'KZT', UZ: 'UZS',
  // Middle East
  AE: 'AED', SA: 'SAR', QA: 'QAR', KW: 'KWD', OM: 'OMR', BH: 'BHD',
  IL: 'ILS', JO: 'JOD', LB: 'LBP', IQ: 'IQD', IR: 'IRR', AZ: 'AZN',
  GE: 'GEL', AM: 'AMD',
  // Africa
  ZA: 'ZAR', NG: 'NGN', KE: 'KES', GH: 'GHS', ET: 'ETB', EG: 'EGP',
  MA: 'MAD', TN: 'TND', DZ: 'DZD', UG: 'UGX', TZ: 'TZS', RW: 'RWF',
  AO: 'AOA', MZ: 'MZN', CM: 'XAF', SN: 'XOF', CI: 'XOF', MG: 'MGA',
  // Portuguese-speaking Africa
  CV: 'CVE', GW: 'XOF', ST: 'STN', TL: 'USD',
  // Oceania
  PG: 'PGK', FJ: 'FJD', WS: 'WST', TO: 'TOP', VU: 'VUV', SB: 'SBD',
};

// Country → dial code prefix
export const COUNTRY_DIAL: Record<string, string> = {
  BR: '+55', US: '+1',  CA: '+1',  GB: '+44', AU: '+61', NZ: '+64',
  MX: '+52', AR: '+54', CL: '+56', CO: '+57', PE: '+51', VE: '+58',
  UY: '+598',BO: '+591',PY: '+595',EC: '+593',CR: '+506',PA: '+507',
  DO: '+1',  GT: '+502',HN: '+504',SV: '+503',NI: '+505',CU: '+53',
  JM: '+1',  TT: '+1',  BB: '+1',
  DE: '+49', FR: '+33', IT: '+39', ES: '+34', PT: '+351',NL: '+31',
  BE: '+32', AT: '+43', CH: '+41', SE: '+46', NO: '+47', DK: '+45',
  FI: '+358',PL: '+48', CZ: '+420',HU: '+36', RO: '+40', GR: '+30',
  IE: '+353',RU: '+7',  UA: '+380',TR: '+90', BY: '+375',
  JP: '+81', CN: '+86', KR: '+82', IN: '+91', SG: '+65', HK: '+852',
  TW: '+886',TH: '+66', VN: '+84', ID: '+62', MY: '+60', PH: '+63',
  PK: '+92', BD: '+880',LK: '+94', NP: '+977',
  AE: '+971',SA: '+966',QA: '+974',KW: '+965',IL: '+972',EG: '+20',
  ZA: '+27', NG: '+234',KE: '+254',GH: '+233',ET: '+251',MA: '+212',
  AO: '+244',MZ: '+258',
};

export function detectLang(languageCode: string, regionCode: string): SupportedLang {
  if (PT_COUNTRIES.has(regionCode) || languageCode === 'pt') return 'pt';
  if (ES_COUNTRIES.has(regionCode) || languageCode === 'es') return 'es';
  if (EN_GB_COUNTRIES.has(regionCode)) return 'en-GB';
  if (languageCode === 'en') return regionCode === 'US' || regionCode === 'CA' ? 'en' : 'en-GB';
  // All other languages (ja, ru, zh, de, fr, ar, hi, etc.) → English UI
  return 'en';
}

// Derives the Intl locale string from the chosen app language + device country
export function buildLocale(lang: SupportedLang, country: string): string {
  if (lang === 'pt') return country === 'PT' ? 'pt-PT' : 'pt-BR';
  if (lang === 'es') return country === 'ES' ? 'es-ES' : 'es-419';
  if (lang === 'en-GB') return `en-${country}`;
  return 'en-US';
}

export function getAutoLocale(): AutoLocaleResult {
  const device = Localization.getLocales()[0];
  const languageCode = device?.languageCode ?? 'en';
  const regionCode = device?.regionCode ?? 'US';
  const timezone = Localization.getCalendars()[0]?.timeZone ?? 'UTC';

  const lang = detectLang(languageCode, regionCode);
  return {
    lang,
    currency_code: COUNTRY_CURRENCY[regionCode] ?? 'USD',
    distance_unit: MILES_COUNTRIES.has(regionCode) ? 'mi' : 'km',
    volume_unit: GALLONS_COUNTRIES.has(regionCode) ? 'gallons' : 'liters',
    locale: buildLocale(lang, regionCode),
    country: regionCode,
    timezone,
  };
}
