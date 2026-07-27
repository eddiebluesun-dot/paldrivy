export const Colors = {
  background:       '#0B1221',                    // navy — landing --bg
  surface:          '#111827',                    // card  — landing --bg-card
  surfaceAlt:       '#162032',                    // muted — landing --bg-muted
  surfaceElevated:  '#1E293B',                    // raised — landing --bg-card-2
  accent:           '#F59E0B',                    // gold  — landing --gold (PRIMARY)
  accentDim:        'rgba(245, 158, 11, 0.12)',   // landing --gold-dim
  accentGlow:       'rgba(245, 158, 11, 0.06)',
  brandBlue:        '#8B5CF6',                    // violet — landing --violet (secondary)
  brandBlueLight:   'rgba(139, 92, 246, 0.12)',   // landing --violet-dim
  onBrand:          '#0B1221',                    // dark text ON gold
  onAccent:         '#0B1221',                    // dark text ON gold
  border:           'rgba(255, 255, 255, 0.08)',
  borderBright:     'rgba(255, 255, 255, 0.16)',
  textPrimary:      '#FFFFFF',
  textSecondary:    'rgba(255, 255, 255, 0.55)',
  error:            '#EF4444',
  errorBg:          'rgba(239, 68, 68, 0.12)',
  success:          '#10B981',
  successBg:        'rgba(16, 185, 129, 0.12)',
  successGlow:      'rgba(16, 185, 129, 0.40)',
  errorGlow:        'rgba(239, 68, 68, 0.35)',
  accentGlowBright: 'rgba(245, 158, 11, 0.45)',
  brandBlueGlow:    'rgba(139, 92, 246, 0.35)',
} as const;

export const Radius = {
  button: 999,
  input:  12,
  card:   16,
} as const;

export const Spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
} as const;
