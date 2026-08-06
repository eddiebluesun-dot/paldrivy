import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { CockpitCard } from '../../src/components/CockpitCard';
import { formatMoney } from '../../src/utils/currency';
import pt from '../../locales/pt.json';

// Mock react-i18next with the real pt.json copy so assertions exercise the
// actual production strings (format, punctuation, checkmarks) rather than
// a hand-rolled fixture. Avoids bootstrapping expo-localization in Jest.
// pt.json is required lazily inside the factory because jest.mock() factories
// cannot close over out-of-scope variables.
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string>) => {
      const ptDict = require('../../locales/pt.json');
      const shortKey = key.replace('dashboard.', '');
      let str: string = ptDict.dashboard[shortKey] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          str = str.replace(`{{${k}}}`, String(v));
        }
      }
      return str;
    },
  }),
}));

const CURRENCY = 'BRL';
const LOCALE = 'pt-BR';

const baseProps = {
  rides: 3,
  durationSeconds: 3600,
  distanceMeters: 50000,
  expensesTodayCents: 1000,
  distanceUnit: 'km' as const,
  currencyCode: CURRENCY,
  locale: LOCALE,
  onEditGoal: () => {},
};

describe('CockpitCard — daily goal target must always be visible ("Hoje" card)', () => {
  test('goal NOT yet met: shows "Meta · R$X · Faltam R$Y"', () => {
    const dailyGoalCents = 30770; // R$307,70
    render(<CockpitCard {...baseProps} todayGrossCents={0} dailyGoalCents={dailyGoalCents} />);

    const goalStr = formatMoney(dailyGoalCents, CURRENCY, LOCALE);
    expect(screen.getByText(new RegExp(`Meta.*${escapeRegex(goalStr)}.*Faltam`))).toBeTruthy();
  });

  test('goal MET (>=100%): the target figure is still on screen, not just the delta', () => {
    const dailyGoalCents = 30770; // R$307,70
    const todayGrossCents = 34889; // R$348,89 — matches the production screenshot
    render(<CockpitCard {...baseProps} todayGrossCents={todayGrossCents} dailyGoalCents={dailyGoalCents} />);

    const goalStr = formatMoney(dailyGoalCents, CURRENCY, LOCALE);
    const aboveStr = formatMoney(todayGrossCents - dailyGoalCents, CURRENCY, LOCALE);

    // Regression: the "Meta! ✓" label used to drop the goal figure entirely
    // once the goal was met. It must now render "Meta · R$307,70 ✓".
    expect(screen.getByText(new RegExp(`Meta.*${escapeRegex(goalStr)}`))).toBeTruthy();

    // The "above goal" delta should still be shown alongside it, not instead of it.
    expect(screen.getByText(new RegExp(`\\+${escapeRegex(aboveStr)}.*acima da meta`))).toBeTruthy();
  });
});

// Intl.NumberFormat inserts a non-breaking space (U+00A0) between "R$" and
// the amount, but RTL's default text normalizer collapses all whitespace
// (including nbsp) to a plain space before matching. Mirror that here so the
// regex lines up with the normalized text instead of the raw nbsp.
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
}
