/**
 * Cultural color overrides per locale.
 * Applied on top of the base Colors palette — only override what differs.
 */

export interface LocaleColorOverrides {
  accent: string;
  accentDim: string;
}

const LOCALE_OVERRIDES: Record<string, LocaleColorOverrides> = {
  zh: {
    accent:    '#FFD700', // Gold — lucky in Chinese culture
    accentDim: 'rgba(255,215,0,0.15)',
  },
  fr: {
    accent:    '#F59E0B', // Keep gold (Marianne / République tone)
    accentDim: 'rgba(245,158,11,0.15)',
  },
};

export function getLocaleOverrides(lang: string): LocaleColorOverrides | null {
  const code = lang.split('-')[0].toLowerCase();
  return LOCALE_OVERRIDES[code] ?? null;
}
