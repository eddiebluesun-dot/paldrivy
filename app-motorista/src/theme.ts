/**
 * DriveWise brand design tokens.
 * All UI components must reference these constants — never hardcode color values.
 */
export const Colors = {
  background: '#F8FAFC',
  surface: '#FFFFFF',
  surfaceAlt: '#F1F5F9',
  brandBlue: '#2563EB',
  brandBlueLight: '#DBEAFE',
  onBrand: '#FFFFFF',
  border: '#E2E8F0',
  textPrimary: '#0F172A',
  textSecondary: '#64748B',
  error: '#EF4444',
  errorBg: '#FFF1F2',
  success: '#10B981',
  successBg: '#ECFDF5',
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
