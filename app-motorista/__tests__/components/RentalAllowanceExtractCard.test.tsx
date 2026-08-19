import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { RentalAllowanceExtractCard } from '../../src/components/RentalAllowanceExtractCard';
import { Colors } from '../../src/theme';
import type { RentalAllowanceStatus } from '../../src/utils/rentalKmAllowanceUtils';

// Same convention as RentalAllowanceBanner.test.tsx: mock react-i18next with
// the real pt.json copy so assertions exercise the actual production strings.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => {
      const ptDict = require('../../locales/pt.json');
      const shortKey = key.replace('rental_allowance.', '');
      let str: string = ptDict.rental_allowance[shortKey] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{{${k}}}`, String(v));
        }
      }
      return str;
    },
  }),
}));

function flattenStyle(style: unknown): Record<string, unknown> {
  return Array.isArray(style) ? Object.assign({}, ...style) : (style as Record<string, unknown>);
}

function makeStatus(overrides: Partial<RentalAllowanceStatus> = {}): RentalAllowanceStatus {
  return {
    allowanceAmountKm: 1500, allowancePeriod: 'weekly',
    baselineMeters: 19228000, baselineIsEstimated: true, currentOdometerMeters: 20739000,
    cumulativeUsageKm: 2858, cumulativeAllowanceKm: 3000, balanceKm: 142,
    currentCycleUsageKm: 519,
    isNearLimit: true, isOverLimit: false,
    overageKm: 0, overageCostCents: 0, remainingKm: 142,
    ...overrides,
  };
}

describe('RentalAllowanceExtractCard', () => {
  it('renders nothing when status is null', () => {
    const { toJSON } = render(<RentalAllowanceExtractCard status={null} />);
    expect(toJSON()).toBeNull();
  });

  it('shows used/total km and percentage from the CUMULATIVE balance, not a period-scoped figure', () => {
    render(<RentalAllowanceExtractCard status={makeStatus()} />);
    expect(screen.getByText('2858 / 3000 km usados')).toBeTruthy();
    expect(screen.getByText('95%')).toBeTruthy(); // round(2858/3000 * 100) = 95
  });

  it('shows a positive balance as banked km', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({ balanceKm: 142 })} />);
    expect(screen.getByTestId('rental-allowance-balance').props.children).toBe('142 km de saldo');
  });

  it('shows a negative balance as debt, without a minus sign leaking into the label', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({
      cumulativeUsageKm: 3011, isOverLimit: true, balanceKm: -11,
    })} />);
    expect(screen.getByTestId('rental-allowance-balance').props.children).toBe('11 km em débito');
  });

  it('caps the bar fill at 100% and switches it to error color once the cumulative balance goes negative, regardless of how far over', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({
      cumulativeUsageKm: 6000, cumulativeAllowanceKm: 3000,
      isNearLimit: true, isOverLimit: true, balanceKm: -3000,
    })} />);
    const fill = flattenStyle(screen.getByTestId('rental-allowance-fill').props.style);
    expect(fill.width).toBe('100%'); // usage is 2x allowance -- fill must still cap at 100%
    expect(fill.backgroundColor).toBe(Colors.error);
  });

  it('shows the bar in accent color, not yet full, while near but under the limit', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({
      cumulativeUsageKm: 2858, cumulativeAllowanceKm: 3000, isNearLimit: true, isOverLimit: false,
    })} />);
    const fill = flattenStyle(screen.getByTestId('rental-allowance-fill').props.style);
    expect(fill.width).toBe(`${(2858 / 3000) * 100}%`);
    expect(fill.backgroundColor).toBe(Colors.accent);
  });

  it('shows the current-cycle usage line regardless of cap status', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({ currentCycleUsageKm: 519, allowancePeriod: 'weekly' })} />);
    expect(screen.getByText('519 km na semanal atual')).toBeTruthy();
  });

  it('shows the daily period label', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({ allowancePeriod: 'daily' })} />);
    expect(screen.getByText('diária')).toBeTruthy();
  });

  it('uncapped/informational mode: no bar, no balance, no percentage -- only the current-cycle usage line', () => {
    render(<RentalAllowanceExtractCard status={makeStatus({
      cumulativeAllowanceKm: null, balanceKm: null, currentCycleUsageKm: 127, allowancePeriod: 'weekly',
    })} />);
    expect(screen.getByText('127 km na semanal atual')).toBeTruthy();
    expect(screen.queryByTestId('rental-allowance-fill')).toBeNull();
    expect(screen.queryByTestId('rental-allowance-balance')).toBeNull();
  });
});
