import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { RentalAllowanceBanner } from '../../src/components/RentalAllowanceBanner';
import type { RentalAllowanceStatus } from '../../src/utils/rentalKmAllowanceUtils';

// Mock react-i18next with the real pt.json copy so assertions exercise the
// actual production strings, same convention as CockpitCard.test.tsx.
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

function makeStatus(overrides: Partial<RentalAllowanceStatus> = {}): RentalAllowanceStatus {
  return {
    allowanceAmountKm: 500, allowancePeriod: 'weekly',
    baselineMeters: 18332000, baselineIsEstimated: false, currentOdometerMeters: 18622000,
    cumulativeUsageKm: 290, cumulativeAllowanceKm: 500, balanceKm: 210,
    isNearLimit: false, isOverLimit: false,
    overageKm: 0, overageCostCents: 0, remainingKm: 210,
    ...overrides,
  };
}

describe('RentalAllowanceBanner', () => {
  it('renders nothing when status is null', () => {
    const { toJSON } = render(<RentalAllowanceBanner status={null} />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing below the near-limit threshold', () => {
    const { toJSON } = render(<RentalAllowanceBanner status={makeStatus()} />);
    expect(toJSON()).toBeNull();
  });

  it('shows a warning banner at >=90% CUMULATIVE usage', () => {
    render(<RentalAllowanceBanner status={makeStatus({
      isNearLimit: true, cumulativeUsageKm: 460, cumulativeAllowanceKm: 500,
    })} />);
    expect(screen.getByTestId('rental-allowance-warning')).toBeTruthy();
  });

  it('shows the remaining (banked) km on the warning banner, not just the percentage used', () => {
    render(<RentalAllowanceBanner
      status={makeStatus({ isNearLimit: true, cumulativeUsageKm: 460, cumulativeAllowanceKm: 500, remainingKm: 142 })}
    />);
    expect(screen.getByText(/142/)).toBeTruthy();
  });

  it('shows an over-limit banner with the estimated cost of the accumulated debt at >=100% CUMULATIVE usage, with no action button', () => {
    render(<RentalAllowanceBanner
      status={makeStatus({
        isNearLimit: true, isOverLimit: true, balanceKm: -20, overageKm: 20, overageCostCents: 3000,
      })}
    />);
    expect(screen.getByTestId('rental-allowance-over')).toBeTruthy();
    expect(screen.getByText(/20/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a baseline-estimated disclosure on the warning banner when the baseline was estimated', () => {
    render(<RentalAllowanceBanner
      status={makeStatus({ isNearLimit: true, baselineIsEstimated: true })}
    />);
    expect(screen.getByTestId('rental-allowance-baseline-estimated')).toBeTruthy();
  });

  it('shows a baseline-estimated disclosure on the over-limit banner when the baseline was estimated', () => {
    render(<RentalAllowanceBanner
      status={makeStatus({ isNearLimit: true, isOverLimit: true, baselineIsEstimated: true, balanceKm: -20, overageKm: 20, overageCostCents: 3000 })}
    />);
    expect(screen.getByTestId('rental-allowance-baseline-estimated')).toBeTruthy();
  });

  it('does not show a baseline-estimated disclosure when the baseline came from an explicit odometer', () => {
    render(<RentalAllowanceBanner
      status={makeStatus({ isNearLimit: true, isOverLimit: true, baselineIsEstimated: false, balanceKm: -20, overageKm: 20, overageCostCents: 3000 })}
    />);
    expect(screen.queryByTestId('rental-allowance-baseline-estimated')).toBeNull();
  });
});
