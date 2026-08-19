import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { MonthDetailSheet } from '../../src/components/MonthDetailSheet';
import { supabase } from '../../src/lib/supabase';
import { formatMoney } from '../../src/utils/currency';
import type { MonthHistoryItem } from '../../src/services/cockpit';

// Regression coverage for a production bug (Eddie, user
// db85eea7-8cd7-464d-ba68-05f1e8a15560, August 2026): the "DESPESAS" total at
// the top of this sheet comes from getMonthHistory() (cockpit.ts), which
// correctly excludes the raw recurring-expense anchor row and instead sums
// getRecurringExpenseTotalForRange()'s per-working-day prorated share. But
// the "Despesas por categoria" list below it ran its OWN naive query against
// the `expenses` table -- summing the raw anchor row's amount_cents with no
// recurring filter and no proration -- so "Aluguel" showed the single
// anchor-row amount while the total above already embedded the prorated
// month-long figure for the same expense. The fix makes this list use
// getRecurringExpenseBreakdownForRange, the same helper getMonthReport()
// (dashboard.ts) already uses correctly, combined with non-recurring /
// daily-recurring raw expense rows -- mirroring getMonthReport's own
// expRows-filter + recurringByCategory-merge pattern exactly.
jest.mock('../../src/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

jest.mock('../../src/services/dashboard', () => ({
  getMonthlyBucketsForMonth: jest.fn().mockResolvedValue([]),
}));

jest.mock('../../src/services/recurringExpenseAllocation', () => ({
  getRecurringExpenseBreakdownForRange: jest.fn(),
}));

import { getRecurringExpenseBreakdownForRange } from '../../src/services/recurringExpenseAllocation';

// Minimal fake Supabase query builder -- same convention as
// __tests__/services/recurringExpenseAllocation.test.ts: filters/ignores
// chained .eq()/.gte()/.lt() calls and resolves with the given rows when
// awaited (the component code does `await supabase.from(...).select(...)...`
// via Promise.all, which relies on the thenable).
function makeQueryBuilder(rows: Record<string, unknown>[]) {
  const builder: any = {
    select: () => builder,
    eq: () => builder,
    gte: () => builder,
    lt: () => builder,
    then: (resolve: (v: { data: Record<string, unknown>[] }) => unknown) =>
      resolve({ data: rows }),
  };
  return builder;
}

const CURRENCY = 'BRL';
const LOCALE = 'pt-BR';
const USER_ID = 'db85eea7-8cd7-464d-ba68-05f1e8a15560';

// R$804.31/week rent, Mon-Sat working days, August 2026 (26 working days) ->
// 80431/6 = 13405 cents/day (R$134.05) x 26 = 348530 cents (R$3,485.30).
// Same fixture numbers already established as "Eddie's real production
// figure" in __tests__/services/recurringExpenseAllocation.test.ts.
const RENT_ANCHOR_ROW = {
  category: 'rent',
  amount_cents: 80431,
  recurring: true,
  recurring_frequency: 'weekly',
  expense_date: '2026-08-04',
};
const RENT_PRORATED_CENTS = 348530;

const ITEM: MonthHistoryItem = {
  year: 2026,
  month: 8,
  gross_cents: 900000,
  // Matches getMonthHistory()'s correct (already-prorated) total: rent's
  // R$3,485.30 rateio, no other expenses.
  expenses_cents: RENT_PRORATED_CENTS,
  fuel_cents: 0,
  rides: 10,
  km_meters: 100000,
  liters_ml: 5000,
};

function setupSupabase(expenseRows: Record<string, unknown>[]) {
  (supabase.from as jest.Mock).mockImplementation((table: string) => {
    if (table === 'expenses') return makeQueryBuilder(expenseRows);
    if (table === 'fuel_entries') return makeQueryBuilder([]);
    throw new Error(`unexpected table ${table}`);
  });
}

describe('MonthDetailSheet — Despesas por categoria vs total DESPESAS', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows Aluguel matching the prorated month total (R$3.485,30), not the raw recurring anchor row (R$804,31)', async () => {
    setupSupabase([RENT_ANCHOR_ROW]);
    (getRecurringExpenseBreakdownForRange as jest.Mock).mockResolvedValue([
      { category: 'rent', amountCents: RENT_PRORATED_CENTS },
    ]);

    render(
      <MonthDetailSheet
        visible
        item={ITEM}
        userId={USER_ID}
        currencyCode={CURRENCY}
        locale={LOCALE}
        onClose={() => {}}
      />,
    );

    const proratedStr = formatMoney(RENT_PRORATED_CENTS, CURRENCY, LOCALE);
    await waitFor(() => {
      expect(screen.getByText(new RegExp(`-?${escapeRegex(proratedStr)}`))).toBeTruthy();
    });

    // The raw anchor row's own amount must NOT be what's displayed for Aluguel.
    const rawAnchorStr = formatMoney(RENT_ANCHOR_ROW.amount_cents, CURRENCY, LOCALE);
    expect(screen.queryByText(new RegExp(`-?${escapeRegex(rawAnchorStr)}`))).toBeNull();
  });

  it('the sum of category amounts equals the DESPESAS total shown at the top of the sheet', async () => {
    setupSupabase([RENT_ANCHOR_ROW]);
    (getRecurringExpenseBreakdownForRange as jest.Mock).mockResolvedValue([
      { category: 'rent', amountCents: RENT_PRORATED_CENTS },
    ]);

    render(
      <MonthDetailSheet
        visible
        item={ITEM}
        userId={USER_ID}
        currencyCode={CURRENCY}
        locale={LOCALE}
        onClose={() => {}}
      />,
    );

    const totalStr = formatMoney(ITEM.expenses_cents + ITEM.fuel_cents, CURRENCY, LOCALE);
    // DESPESAS total (header) and Aluguel category amount must be the SAME
    // figure here (rent is the only expense this month) -- proving the list
    // and the header no longer disagree.
    await waitFor(() => {
      expect(screen.getAllByText(new RegExp(`-?${escapeRegex(totalStr)}`)).length).toBeGreaterThanOrEqual(2);
    });
  });
});

// Intl.NumberFormat inserts a non-breaking space between "R$" and the
// amount; RTL's default text normalizer collapses all whitespace (including
// nbsp) to a plain space before matching -- mirror that here (same helper as
// CockpitCard.test.tsx / RentalAllowanceExtractCard.test.tsx).
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
}
