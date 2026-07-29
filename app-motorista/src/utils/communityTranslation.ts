export type SupportedLang = 'pt' | 'en' | 'es';

export function normalizeSupportedLang(raw: string): SupportedLang {
  const l = (raw ?? '').toLowerCase();
  if (l.startsWith('en')) return 'en';
  if (l.startsWith('es')) return 'es';
  return 'pt';
}

export function pickTranslationTargetLang(authorLocale: string, viewerLocale: string): SupportedLang | null {
  const author = normalizeSupportedLang(authorLocale);
  const viewer = normalizeSupportedLang(viewerLocale);
  return author === viewer ? null : viewer;
}
