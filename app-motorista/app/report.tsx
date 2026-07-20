import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Platform, ScrollView, Share, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { formatMoney } from '@/src/utils/currency';
import { useProfile } from '@/src/hooks/useProfile';
import { usePremiumStatus } from '@/src/hooks/usePremiumStatus';
import { UpgradeModal } from '@/src/components/UpgradeModal';
import { canViewMonthAsFree } from '@/src/utils/freeLimits';
import {
  getMonthReport, getYearlyReport,
  type MonthReport, type YearlyReport,
} from '@/src/services/dashboard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Row({ label, value, bold, color, indent }: {
  label: string; value: string; bold?: boolean; color?: string; indent?: boolean;
}) {
  return (
    <View style={[rStyles.row, indent && { paddingLeft: Spacing.md + 4 }]}>
      <Text style={[rStyles.rowLabel, bold && { color: Colors.textPrimary, fontWeight: '700' }]}>{label}</Text>
      <Text style={[rStyles.rowValue, color ? { color } : {}, bold && { fontWeight: '800' }]}>{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: Spacing.xs }} />;
}

function SectionTitle({ title }: { title: string }) {
  return <Text style={rStyles.sectionTitle}>{title}</Text>;
}

function printReport() {
  if (Platform.OS === 'web') {
    const style = document.createElement('style');
    style.id = '__dre_print__';
    style.textContent = `@media print { .no-print { display: none !important; } body { background: white; } }`;
    document.head.appendChild(style);
    (window as any).print();
    setTimeout(() => style.remove(), 2000);
  }
}

// ─── Month comparison row ─────────────────────────────────────────────────────

function MonthCompRow({
  label, gross, totalExpenses, maxGross, fm,
}: {
  label: string;
  gross: number;
  totalExpenses: number;
  maxGross: number;
  fm: (c: number) => string;
}) {
  const grossPct = maxGross > 0 ? gross / maxGross : 0;
  const expPct   = maxGross > 0 ? totalExpenses / maxGross : 0;
  const profit   = gross - totalExpenses;
  const profitColor = profit >= 0 ? Colors.success : Colors.error;
  const hasData  = gross > 0 || totalExpenses > 0;

  return (
    <View style={rStyles.compRow}>
      <Text style={rStyles.compMonth}>{label}</Text>
      <View style={rStyles.compBars}>
        <View style={rStyles.barTrack}>
          {hasData && <View style={[rStyles.barFill, { width: `${Math.round(grossPct * 100)}%` as any, backgroundColor: Colors.accent }]} />}
        </View>
        <View style={[rStyles.barTrack, { marginTop: 3 }]}>
          {hasData && <View style={[rStyles.barFill, { width: `${Math.round(expPct * 100)}%` as any, backgroundColor: Colors.error }]} />}
        </View>
      </View>
      <View style={rStyles.compValues}>
        {hasData ? (
          <>
            <Text style={[rStyles.compNet, { color: profitColor }]}>{fm(profit)}</Text>
            <Text style={rStyles.compGross}>{fm(gross)}</Text>
          </>
        ) : (
          <Text style={[rStyles.compGross, { color: Colors.border }]}>—</Text>
        )}
      </View>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function ReportScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { profile } = useProfile();

  const now = new Date();
  const [viewMode, setViewMode]         = useState<'monthly' | 'annual'>('monthly');
  const [year,  setYear]                = useState(now.getFullYear());
  const [month, setMonth]               = useState(now.getMonth() + 1);
  const [userId, setUserId]             = useState<string | null>(null);
  const { isPremium } = usePremiumStatus(userId);
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);
  const [report,       setReport]       = useState<MonthReport | null>(null);
  const [yearlyReport, setYearlyReport] = useState<YearlyReport | null>(null);
  const [loading, setLoading]           = useState(true);
  const [error,   setError]             = useState(false);

  const monthsFull  = t('report.months_full',  { returnObjects: true }) as string[];
  const monthsShort = t('report.months',        { returnObjects: true }) as string[];

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const loadMonthly = useCallback(async () => {
    if (!userId) return;
    setLoading(true); setError(false);
    try { setReport(await getMonthReport(userId, year, month)); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [userId, year, month]);

  const loadAnnual = useCallback(async () => {
    if (!userId) return;
    setLoading(true); setError(false);
    try { setYearlyReport(await getYearlyReport(userId, year)); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, [userId, year]);

  useEffect(() => {
    if (!userId) return;
    if (viewMode === 'monthly') loadMonthly();
    else loadAnnual();
  }, [userId, viewMode, loadMonthly, loadAnnual]);

  function prevMonth() {
    if (!isPremium && canViewMonthAsFree(year, month, now)) {
      setUpgradeModalVisible(true);
      return;
    }
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (year === now.getFullYear() && month === now.getMonth() + 1) return;
    if (month === 12) { setYear(y => y + 1); setMonth(1); }
    else setMonth(m => m + 1);
  }
  function prevYear() { setYear(y => y - 1); }
  function nextYear() { if (year < now.getFullYear()) setYear(y => y + 1); }

  const currencyCode = profile?.currency_code ?? 'BRL';
  const locale = profile?.locale ?? 'pt-BR';
  const fm = (cents: number) => formatMoney(cents, currencyCode, locale);

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
  const monthLabel = `${monthsFull[month - 1] ?? ''} ${year}`;

  // Monthly calcs
  const totals = report?.totals;
  const expCats = report?.expensesByCategory ?? [];
  const totalExpenses = (totals?.expenses_cents ?? 0) + (totals?.fuel_cents ?? 0);
  const profit = (totals?.gross_cents ?? 0) - totalExpenses;
  const margin = (totals?.gross_cents ?? 0) > 0 ? Math.round((profit / totals!.gross_cents) * 100) : 0;
  const profitColor = margin >= 50 ? Colors.success : margin >= 25 ? Colors.accent : Colors.error;

  // Annual calcs
  const annualMonths = yearlyReport?.months ?? [];
  const maxGross = Math.max(...annualMonths.map(m => m.gross_cents), 1);
  const annualTotals = annualMonths.reduce(
    (acc, m) => ({ gross: acc.gross + m.gross_cents, expenses: acc.expenses + m.expenses_cents + m.fuel_cents }),
    { gross: 0, expenses: 0 },
  );
  const annualProfit = annualTotals.gross - annualTotals.expenses;
  const annualMargin = annualTotals.gross > 0 ? Math.round((annualProfit / annualTotals.gross) * 100) : 0;
  const annualProfitColor = annualMargin >= 50 ? Colors.success : annualMargin >= 25 ? Colors.accent : Colors.error;

  async function handleShareMonthly() {
    const lines = [
      `DRE — ${monthLabel}`,
      `${t('report.gross_revenue')}: ${fm(totals?.gross_cents ?? 0)}`,
      `${t('report.fuel_cost')}: -${fm(totals?.fuel_cents ?? 0)}`,
      ...expCats.map(c => `  ${t(`expense_category.${c.category}`)}: -${fm(c.total_cents)}`),
      `${t('report.total_expenses')}: -${fm(totalExpenses)}`,
      `${t('report.net_profit')}: ${fm(profit)} (${margin}%)`,
    ];
    try { await Share.share({ message: lines.join('\n') }); } catch {}
  }

  async function handleShareAnnual() {
    const lines = [
      `${t('report.annual_title')} ${year}`,
      ...annualMonths
        .filter(m => m.gross_cents > 0)
        .map(m => `${monthsShort[m.month - 1]}: ${fm(m.gross_cents)} → ${fm(m.gross_cents - m.expenses_cents - m.fuel_cents)}`),
      `${t('report.year_total')}: ${fm(annualTotals.gross)} → ${fm(annualProfit)} (${annualMargin}%)`,
    ];
    try { await Share.share({ message: lines.join('\n') }); } catch {}
  }

  const onShareOrPrint = viewMode === 'monthly'
    ? (Platform.OS === 'web' ? printReport : handleShareMonthly)
    : (Platform.OS === 'web' ? printReport : handleShareAnnual);

  return (
    <SafeAreaView style={rStyles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={rStyles.header}>
        <TouchableOpacity onPress={() => router.back()} style={rStyles.backBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={rStyles.headerTitle}>{viewMode === 'monthly' ? 'DRE' : t('report.annual_title')}</Text>
        <TouchableOpacity onPress={onShareOrPrint} style={rStyles.printBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name={Platform.OS === 'web' ? 'print-outline' : 'share-outline'} size={20} color={Colors.accent} />
        </TouchableOpacity>
      </View>

      {/* View mode toggle */}
      <View style={rStyles.segmentRow}>
        <TouchableOpacity
          style={[rStyles.segment, viewMode === 'monthly' && rStyles.segmentActive]}
          onPress={() => setViewMode('monthly')}
        >
          <Text style={[rStyles.segmentText, viewMode === 'monthly' && rStyles.segmentTextActive]}>
            {t('report.monthly')}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[rStyles.segment, viewMode === 'annual' && rStyles.segmentActive]}
          onPress={() => {
            if (!isPremium) { setUpgradeModalVisible(true); return; }
            setViewMode('annual');
          }}
        >
          <Text style={[rStyles.segmentText, viewMode === 'annual' && rStyles.segmentTextActive]}>
            {t('report.annual')}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Period picker */}
      {viewMode === 'monthly' ? (
        <View style={rStyles.monthPicker}>
          <TouchableOpacity onPress={prevMonth} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={22} color={Colors.accent} />
          </TouchableOpacity>
          <Text style={rStyles.monthLabel}>{monthLabel}</Text>
          <TouchableOpacity onPress={nextMonth} disabled={isCurrentMonth} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-forward" size={22} color={isCurrentMonth ? Colors.border : Colors.accent} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={rStyles.monthPicker}>
          <TouchableOpacity onPress={prevYear} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={22} color={Colors.accent} />
          </TouchableOpacity>
          <Text style={rStyles.monthLabel}>{year}</Text>
          <TouchableOpacity onPress={nextYear} disabled={year >= now.getFullYear()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-forward" size={22} color={year >= now.getFullYear() ? Colors.border : Colors.accent} />
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={rStyles.center}><ActivityIndicator color={Colors.accent} /></View>
      ) : error ? (
        <View style={rStyles.center}>
          <Text style={{ color: Colors.error }}>{t('common.error')}</Text>
          <TouchableOpacity onPress={viewMode === 'monthly' ? loadMonthly : loadAnnual} style={{ marginTop: Spacing.md }}>
            <Text style={{ color: Colors.accent }}>{t('report.retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : viewMode === 'monthly' ? (
        // ── MONTHLY DRE ───────────────────────────────────────────────────────
        <ScrollView style={rStyles.scroll} contentContainerStyle={rStyles.content}>
          <View style={rStyles.printHeader}>
            <Text style={rStyles.printTitle}>DRE — {monthLabel}</Text>
            {profile?.name ? <Text style={rStyles.printDriver}>{t('report.driver')}: {profile.name}</Text> : null}
          </View>

          <View style={rStyles.section}>
            <SectionTitle title={t('report.revenue')} />
            <Row label={t('report.gross_revenue')} value={fm(totals?.gross_cents ?? 0)} bold color={Colors.accent} />
          </View>

          <View style={rStyles.section}>
            <SectionTitle title={t('report.operating_expenses')} />
            {(totals?.fuel_cents ?? 0) > 0 && (
              <Row label={t('report.fuel_cost')} value={`-${fm(totals!.fuel_cents)}`} color={Colors.error} indent />
            )}
            {expCats.map(cat => (
              <Row key={cat.category} label={t(`expense_category.${cat.category}`)} value={`-${fm(cat.total_cents)}`} color={Colors.error} indent />
            ))}
            <Divider />
            <Row label={t('report.total_expenses')} value={`-${fm(totalExpenses)}`} bold color={Colors.error} />
          </View>

          <View style={rStyles.section}>
            <SectionTitle title={t('report.result')} />
            <Row label={t('report.net_profit')} value={fm(profit)} bold color={profitColor} />
            <Row label={t('report.net_margin')} value={`${margin}%`} bold color={profitColor} />
          </View>

          <View style={[rStyles.summaryCard, { borderColor: profitColor }]}>
            <View style={rStyles.summaryRow}>
              <View style={rStyles.summaryItem}>
                <Text style={rStyles.summaryValue}>{fm(totals?.gross_cents ?? 0)}</Text>
                <Text style={rStyles.summaryLabel}>{t('dashboard.gross')}</Text>
              </View>
              <View style={[rStyles.summaryItem, { borderLeftWidth: 1, borderLeftColor: Colors.border }]}>
                <Text style={[rStyles.summaryValue, { color: Colors.error }]}>{fm(totalExpenses)}</Text>
                <Text style={rStyles.summaryLabel}>{t('expense.title')}</Text>
              </View>
              <View style={[rStyles.summaryItem, { borderLeftWidth: 1, borderLeftColor: Colors.border }]}>
                <Text style={[rStyles.summaryValue, { color: profitColor }]}>{fm(profit)}</Text>
                <Text style={rStyles.summaryLabel}>{t('dashboard.net')}</Text>
              </View>
            </View>
            <View style={[rStyles.marginBar, { backgroundColor: Colors.surfaceAlt }]}>
              <View style={{ width: `${Math.max(0, Math.min(margin, 100))}%` as any, height: 8, backgroundColor: profitColor, borderRadius: 4 }} />
            </View>
            <Text style={[rStyles.marginPct, { color: profitColor }]}>{margin}% {t('report.net_margin').toLowerCase()}</Text>
          </View>

          <Text style={rStyles.footer}>{t('report.generated_by')} • {new Date().toLocaleDateString(locale)}</Text>
        </ScrollView>
      ) : (
        // ── ANNUAL VIEW ───────────────────────────────────────────────────────
        <ScrollView style={rStyles.scroll} contentContainerStyle={rStyles.content}>
          <Text style={rStyles.compTitle}>{t('report.comparison_title')}</Text>

          <View style={rStyles.legendRow}>
            <View style={rStyles.legendItem}>
              <View style={[rStyles.legendDot, { backgroundColor: Colors.accent }]} />
              <Text style={rStyles.legendText}>{t('dashboard.gross')}</Text>
            </View>
            <View style={rStyles.legendItem}>
              <View style={[rStyles.legendDot, { backgroundColor: Colors.error }]} />
              <Text style={rStyles.legendText}>{t('report.total_expenses')}</Text>
            </View>
          </View>

          <View style={rStyles.section}>
            {annualMonths.map((m, idx) => (
              <React.Fragment key={m.month}>
                {idx > 0 && <View style={{ height: 1, backgroundColor: Colors.border, marginVertical: 6 }} />}
                <MonthCompRow
                  label={monthsShort[m.month - 1] ?? String(m.month)}
                  gross={m.gross_cents}
                  totalExpenses={m.expenses_cents + m.fuel_cents}
                  maxGross={maxGross}
                  fm={fm}
                />
              </React.Fragment>
            ))}
          </View>

          {/* Annual DRE */}
          <Text style={[rStyles.compTitle, { marginTop: Spacing.sm }]}>{t('report.annual_title')} {year}</Text>
          <View style={rStyles.section}>
            <SectionTitle title={t('report.revenue')} />
            <Row label={t('report.gross_revenue')} value={fm(annualTotals.gross)} bold color={Colors.accent} />
            <Divider />
            <SectionTitle title={t('report.operating_expenses')} />
            <Row label={t('report.total_expenses')} value={`-${fm(annualTotals.expenses)}`} bold color={Colors.error} />
            <Divider />
            <SectionTitle title={t('report.result')} />
            <Row label={t('report.net_profit')} value={fm(annualProfit)} bold color={annualProfitColor} />
            <Row label={t('report.net_margin')} value={`${annualMargin}%`} bold color={annualProfitColor} />
          </View>

          <View style={[rStyles.summaryCard, { borderColor: annualProfitColor }]}>
            <View style={rStyles.summaryRow}>
              <View style={rStyles.summaryItem}>
                <Text style={rStyles.summaryValue}>{fm(annualTotals.gross)}</Text>
                <Text style={rStyles.summaryLabel}>{t('dashboard.gross')}</Text>
              </View>
              <View style={[rStyles.summaryItem, { borderLeftWidth: 1, borderLeftColor: Colors.border }]}>
                <Text style={[rStyles.summaryValue, { color: Colors.error }]}>{fm(annualTotals.expenses)}</Text>
                <Text style={rStyles.summaryLabel}>{t('expense.title')}</Text>
              </View>
              <View style={[rStyles.summaryItem, { borderLeftWidth: 1, borderLeftColor: Colors.border }]}>
                <Text style={[rStyles.summaryValue, { color: annualProfitColor }]}>{fm(annualProfit)}</Text>
                <Text style={rStyles.summaryLabel}>{t('dashboard.net')}</Text>
              </View>
            </View>
            <View style={[rStyles.marginBar, { backgroundColor: Colors.surfaceAlt }]}>
              <View style={{ width: `${Math.max(0, Math.min(annualMargin, 100))}%` as any, height: 8, backgroundColor: annualProfitColor, borderRadius: 4 }} />
            </View>
            <Text style={[rStyles.marginPct, { color: annualProfitColor }]}>{annualMargin}% {t('report.net_margin').toLowerCase()}</Text>
          </View>

          <Text style={rStyles.footer}>{t('report.generated_by')} • {new Date().toLocaleDateString(locale)}</Text>
        </ScrollView>
      )}

      <UpgradeModal
        visible={upgradeModalVisible}
        reason="history_limit"
        onClose={() => setUpgradeModalVisible(false)}
      />
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const rStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  backBtn: { padding: 4, marginRight: Spacing.sm },
  headerTitle: { flex: 1, color: Colors.textPrimary, fontSize: 17, fontWeight: '700' },
  printBtn: { padding: 4 },

  segmentRow: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm, paddingTop: Spacing.xs, gap: Spacing.sm,
  },
  segment: {
    flex: 1, paddingVertical: 8, borderRadius: Radius.button,
    alignItems: 'center', borderWidth: 1.5, borderColor: Colors.border,
  },
  segmentActive: { borderColor: Colors.accent, backgroundColor: Colors.accentDim },
  segmentText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  segmentTextActive: { color: Colors.accent },

  monthPicker: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface, gap: Spacing.xl,
  },
  monthLabel: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700', minWidth: 160, textAlign: 'center' },

  scroll: { flex: 1 },
  content: { padding: Spacing.md, paddingBottom: Spacing.xxl },
  printHeader: { marginBottom: Spacing.md },
  printTitle: { color: Colors.textPrimary, fontSize: 20, fontWeight: '800', textAlign: 'center' },
  printDriver: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center', marginTop: 4 },

  section: {
    backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md,
    marginBottom: Spacing.md,
    shadowColor: '#94A3B8', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 2,
  },
  sectionTitle: {
    color: Colors.textSecondary, fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1.5, marginBottom: Spacing.sm,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 },
  rowLabel: { color: Colors.textSecondary, fontSize: 14, flex: 1, paddingRight: 8 },
  rowValue: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },

  summaryCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md,
    marginBottom: Spacing.md, borderWidth: 2,
    shadowColor: '#94A3B8', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.10, shadowRadius: 8, elevation: 2,
  },
  summaryRow: { flexDirection: 'row', marginBottom: Spacing.md },
  summaryItem: { flex: 1, alignItems: 'center', paddingHorizontal: Spacing.sm },
  summaryValue: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  summaryLabel: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
  marginBar: { height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: Spacing.sm },
  marginPct: { textAlign: 'center', fontSize: 13, fontWeight: '700' },

  compTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: Spacing.sm },
  legendRow: { flexDirection: 'row', gap: Spacing.md, marginBottom: Spacing.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { color: Colors.textSecondary, fontSize: 12 },

  compRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  compMonth: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', width: 32 },
  compBars: { flex: 1, marginHorizontal: Spacing.sm },
  barTrack: { height: 7, backgroundColor: Colors.surfaceAlt, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  compValues: { width: 90, alignItems: 'flex-end' },
  compNet: { fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  compGross: { fontSize: 11, color: Colors.textSecondary, fontVariant: ['tabular-nums'] },

  footer: { color: Colors.textSecondary, fontSize: 11, textAlign: 'center', marginTop: Spacing.md },
});
