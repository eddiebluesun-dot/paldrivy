/**
 * DriveWise brand design tokens.
 * All UI components must reference these constants — never hardcode color values.
 */
export const Colors = {
  background: '#020617',
  surface: '#0F172A',
  surfaceAlt: '#1E293B',
  brandBlue: '#2563EB',
  onBrand: '#FFFFFF',
  border: '#334155',
  textPrimary: '#F8FAFC',
  textSecondary: '#94A3B8',
  error: '#F87171',
} as const;

export const Radius = {
  button: 999,
  input: 8,
} as const;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;
