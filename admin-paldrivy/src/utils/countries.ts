const NAMES: Record<string, string> = {
  BR: 'Brasil',
  US: 'United States',
  GB: 'United Kingdom',
  AR: 'Argentina',
  CL: 'Chile',
  CO: 'Colombia',
  MX: 'México',
  PE: 'Peru',
  UY: 'Uruguay',
  PY: 'Paraguay',
  BO: 'Bolivia',
  EC: 'Ecuador',
  VE: 'Venezuela',
  PT: 'Portugal',
  ES: 'España',
  FR: 'France',
  DE: 'Germany',
  IT: 'Italy',
  CA: 'Canada',
  AU: 'Australia',
  XX: 'Desconhecido',
};

export function countryFlag(code: string): string {
  return [...code.toUpperCase()]
    .map(c => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join('');
}

export function countryName(code: string): string {
  return NAMES[code.toUpperCase()] ?? code;
}
