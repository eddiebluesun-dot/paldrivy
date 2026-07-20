# Admin Panel Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 5 admin-panel improvements from `docs/superpowers/specs/2026-07-20-admin-panel-improvements-design.md`: a push-notification center, enforced Free-plan limits, a grouped subscriptions view, full driver history, and expiry notifications.

**Architecture:** Two Vite/React (admin-paldrivy) and Expo/React Native (app-motorista) apps share one Supabase project (`ucxkvxqpkknxotbfxgeu`). Admin-side changes are new pages/service functions calling existing tables directly (RLS already grants admin full read/write, as proven by the existing `admin.ts`). Mobile-side changes add a shared `usePremiumStatus` hook (replacing the duplicated inline check that caused the gratuidade bug) and two shared UI primitives (`UpgradeModal`, `PremiumGate`) reused across the shift-limit, history-limit, and dashboard-lock gates. Expiry notifications are a new Supabase Edge Function invoked by `pg_cron`.

**Tech Stack:** React 18 + Vite + Tailwind + `@supabase/supabase-js` (admin-paldrivy); Expo/React Native + `expo-router` + `react-i18next` + Jest/`jest-expo` (app-motorista); Supabase Postgres, Edge Functions (Deno), `pg_cron`.

## Global Constraints

- Both repos are linked to the same Supabase project (`ucxkvxqpkknxotbfxgeu`) — a migration or Edge Function added in one repo's `supabase/` folder is deployed to the same database the other repo reads.
- admin-paldrivy has **no test runner** (`package.json` has no `test` script, no jest/vitest dependency). Verify admin-paldrivy tasks with `npm run build` (runs `tsc -b && vite build`) plus a manual walkthrough — do not add a new test framework as part of this plan.
- app-motorista has Jest configured (`npm test`, preset `jest-expo`) but **only for pure logic** in `src/utils`/`src/services` (see `__tests__/utils/currency.test.ts`, `__tests__/services/cockpit.test.ts` for the existing pattern). Supabase Edge Functions (`supabase/functions/**`, Deno runtime) have **no test harness** in this repo (`stripe-webhook`, `calculate-shift` ship untested) — verify those with `supabase functions serve` + `curl`, not Jest.
- Money is always integer cents (`*_cents` columns/props) in both codebases — never introduce a float currency value.
- admin-paldrivy UI copy is 100% hardcoded pt-BR (no i18n library in that app) — keep new admin strings hardcoded pt-BR to match.
- app-motorista UI copy goes through `react-i18next` (`t('namespace.key')`) with translations in `locales/pt.json`, `locales/en.json`, `locales/es.json`. `locales/en-GB.json` only overrides a handful of keys and falls back to `en.json` — it does not need the new keys.
- admin-paldrivy Tailwind tokens already established: background `#0B1221`, surface `#111827`, accent `#F59E0B`, borders `border-white/8`/`border-white/15`, status pill colors (`bg-emerald-500/15 text-emerald-400` = active, `bg-blue-500/15 text-blue-400` = trial, `bg-[#F59E0B]/15 text-[#F59E0B]` = complimentary, `bg-red-500/15 text-red-400` = cancelled, `bg-orange-500/15 text-orange-400` = expired). Reuse these; don't invent new colors.
- app-motorista theme tokens come from `@/src/theme` (`Colors`, `Radius`, `Spacing`) — reuse them in new components, don't hardcode hex values inline.

---

## Part 1 — Central de envio de push (admin-paldrivy)

### Task 1: `push_broadcasts` migration

**Files:**
- Create: `app-motorista/supabase/migrations/20260720000000_push_broadcasts.sql`

**Interfaces:**
- Produces: table `push_broadcasts(id, title, body, filters jsonb, recipient_count, sent_by, created_at)`, consumed by Task 2's `sendPushBroadcast`/`getPushBroadcastHistory`.

- [ ] **Step 1: Write the migration**

```sql
create table push_broadcasts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  filters jsonb not null default '{}'::jsonb,
  recipient_count int not null default 0,
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table push_broadcasts enable row level security;

create policy "admins can read push_broadcasts"
  on push_broadcasts for select
  using (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));

create policy "admins can insert push_broadcasts"
  on push_broadcasts for insert
  with check (exists (select 1 from profiles where profiles.id = auth.uid() and profiles.role = 'admin'));
```

- [ ] **Step 2: Apply the migration**

Run: `cd "app-motorista" && supabase db push`
Expected: CLI reports `20260720000000_push_broadcasts.sql` applied with no errors.

- [ ] **Step 3: Verify the table and RLS manually**

Run: `supabase db diff` (should report no drift) and, in the Supabase SQL editor, `select * from push_broadcasts;` as a non-admin session should return zero rows (RLS blocks it); as an admin session it should return zero rows too (table is empty) with no permission error.

- [ ] **Step 4: Commit**

```bash
git add app-motorista/supabase/migrations/20260720000000_push_broadcasts.sql
git commit -m "feat: add push_broadcasts table for admin push notification history"
```

---

### Task 2: `services/admin.ts` push functions

**Files:**
- Modify: `admin-paldrivy/src/types.ts`
- Modify: `admin-paldrivy/src/services/admin.ts`

**Interfaces:**
- Consumes: `supabase` client (`admin-paldrivy/src/lib/supabase.ts`), `SubscriptionStatus` type (`types.ts:31`).
- Produces: `PushFilters`, `PushBroadcast` types; `getPushRecipientCount(filters): Promise<number>`, `sendPushBroadcast({title, body, filters}): Promise<{ recipientCount: number }>`, `getPushBroadcastHistory(): Promise<PushBroadcast[]>` — consumed by Task 3's `Notifications.tsx`.

- [ ] **Step 1: Add the types**

In `admin-paldrivy/src/types.ts`, add at the end of the file:

```ts
export interface PushFilters {
  planId?: string;
  status?: SubscriptionStatus | '';
  country?: string;
}

export interface PushBroadcast {
  id: string;
  title: string;
  body: string;
  filters: PushFilters;
  recipient_count: number;
  sent_by: string | null;
  created_at: string;
}
```

- [ ] **Step 2: Add the service functions**

In `admin-paldrivy/src/services/admin.ts`, add this new section after the `// ─── Subscriptions ─` block (after `cancelSubscription`, before `// ─── Legal Documents ─`):

```ts
// ─── Push Notifications ───────────────────────────────────────────────────────

import type { PushFilters, PushBroadcast } from '../types';

async function getPushRecipientIds(filters: PushFilters): Promise<string[]> {
  const needsSubJoin = !!filters.planId || !!filters.status;
  let q = supabase
    .from('profiles')
    .select(needsSubJoin ? 'id, subscriptions!inner(status,plan_id)' : 'id')
    .not('push_token', 'is', null);
  if (filters.country) q = q.eq('country', filters.country);
  if (filters.status)  q = q.eq('subscriptions.status', filters.status);
  if (filters.planId)  q = q.eq('subscriptions.plan_id', filters.planId);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []).map((p: any) => p.id as string);
}

export async function getPushRecipientCount(filters: PushFilters): Promise<number> {
  const ids = await getPushRecipientIds(filters);
  return ids.length;
}

export async function sendPushBroadcast(input: {
  title: string; body: string; filters: PushFilters;
}): Promise<{ recipientCount: number }> {
  const user_ids = await getPushRecipientIds(input.filters);
  if (user_ids.length === 0) {
    throw new Error('Nenhum motorista com token de push encontrado para esse filtro.');
  }

  const { error: fnError } = await supabase.functions.invoke('send-push-notification', {
    body: { title: input.title, body: input.body, user_ids },
  });
  if (fnError) throw fnError;

  const { data: { user } } = await supabase.auth.getUser();
  const { error: logError } = await supabase.from('push_broadcasts').insert({
    title: input.title,
    body: input.body,
    filters: input.filters,
    recipient_count: user_ids.length,
    sent_by: user?.id ?? null,
  });
  if (logError) throw logError;

  return { recipientCount: user_ids.length };
}

export async function getPushBroadcastHistory(): Promise<PushBroadcast[]> {
  const { data, error } = await supabase
    .from('push_broadcasts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as PushBroadcast[];
}
```

Move the `import type { PushFilters, PushBroadcast } from '../types';` line up to the top of the file next to the existing type import (line 2) instead of inline — the inline placement above is only to show which types the new block needs.

- [ ] **Step 3: Typecheck**

Run: `cd admin-paldrivy && npm run build`
Expected: builds with no TypeScript errors (this also catches the moved-import step from Step 2).

- [ ] **Step 4: Commit**

```bash
git add admin-paldrivy/src/types.ts admin-paldrivy/src/services/admin.ts
git commit -m "feat: add push broadcast service functions (recipient resolution, send, history)"
```

---

### Task 3: `Notifications.tsx` page + nav wiring

**Files:**
- Create: `admin-paldrivy/src/pages/Notifications.tsx`
- Modify: `admin-paldrivy/src/components/Layout.tsx:5-12`
- Modify: `admin-paldrivy/src/App.tsx`

**Interfaces:**
- Consumes: `getPlans()`, `getPushRecipientCount()`, `sendPushBroadcast()`, `getPushBroadcastHistory()` (Task 2), `Plan`/`PushFilters`/`PushBroadcast` types.

- [ ] **Step 1: Add the nav entry**

In `admin-paldrivy/src/components/Layout.tsx`, change the `NAV` array (lines 5-12):

```tsx
const NAV = [
  { to: '/',             label: 'Dashboard',      icon: '▦' },
  { to: '/users',        label: 'Usuários',       icon: '👥' },
  { to: '/stats',        label: 'Estatísticas',   icon: '🌍' },
  { to: '/plans',        label: 'Planos',         icon: '🏷️' },
  { to: '/subscriptions',label: 'Assinaturas',    icon: '📋' },
  { to: '/notifications',label: 'Notificações',   icon: '🔔' },
  { to: '/legal',        label: 'Legal / LGPD',   icon: '⚖️' },
];
```

- [ ] **Step 2: Wire the route**

In `admin-paldrivy/src/App.tsx`, add the import next to the other page imports:

```tsx
import Notifications from './pages/Notifications';
```

And add the route next to `/subscriptions`:

```tsx
<Route path="/notifications" element={<AuthGuard state={authState}><Notifications /></AuthGuard>} />
```

- [ ] **Step 3: Write the page**

Create `admin-paldrivy/src/pages/Notifications.tsx`:

```tsx
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import {
  getPlans, getPushRecipientCount, sendPushBroadcast, getPushBroadcastHistory,
} from '../services/admin';
import type { Plan, PushFilters, PushBroadcast, SubscriptionStatus } from '../types';

const STATUS_OPTS: Array<{ value: SubscriptionStatus | ''; label: string }> = [
  { value: '',              label: 'Todos os status' },
  { value: 'active',        label: 'Ativo' },
  { value: 'trial',         label: 'Trial' },
  { value: 'complimentary', label: 'Gratuidade' },
  { value: 'cancelled',     label: 'Cancelado' },
  { value: 'expired',       label: 'Expirado' },
];

const inputCls = "w-full bg-[#0B1221] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/40 focus:border-[#F59E0B]/40";

function fmtDate(d: string) {
  return new Date(d).toLocaleString('pt-BR');
}

export default function Notifications() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [history, setHistory] = useState<PushBroadcast[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [planId, setPlanId] = useState('');
  const [status, setStatus] = useState<SubscriptionStatus | ''>('');
  const [country, setCountry] = useState('');
  const [recipientCount, setRecipientCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const filters: PushFilters = { planId: planId || undefined, status: status || undefined, country: country || undefined };

  async function load() {
    const [p, h] = await Promise.all([getPlans(), getPushBroadcastHistory()]);
    setPlans(p);
    setHistory(h);
  }

  useEffect(() => { load(); }, []);

  async function handlePreview() {
    setCounting(true);
    setResult(null);
    try {
      const count = await getPushRecipientCount(filters);
      setRecipientCount(count);
    } catch (e: any) {
      setResult('Erro ao contar destinatários: ' + (e?.message ?? String(e)));
    } finally {
      setCounting(false);
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !body.trim()) return;
    if (!confirm(`Enviar esta notificação para ${recipientCount ?? '?'} motorista(s)?`)) return;
    setSending(true);
    setResult(null);
    try {
      const { recipientCount: sent } = await sendPushBroadcast({ title: title.trim(), body: body.trim(), filters });
      setResult(`✓ Enviado para ${sent} motorista(s).`);
      setTitle('');
      setBody('');
      setRecipientCount(null);
      await load();
    } catch (e: any) {
      setResult('Erro ao enviar: ' + (e?.message ?? String(e)));
    } finally {
      setSending(false);
    }
  }

  return (
    <Layout title="Notificações">
      <div className="space-y-4 max-w-2xl">
        <form onSubmit={handleSend} className="bg-[#111827] rounded-xl border border-white/8 p-5 space-y-4">
          <p className="text-sm font-semibold text-white">Enviar push para motoristas</p>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Título</label>
            <input required value={title} onChange={e => setTitle(e.target.value)} className={inputCls} placeholder="Ex: Nova função disponível!" />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Mensagem</label>
            <textarea required value={body} onChange={e => setBody(e.target.value)} className={inputCls} rows={3} placeholder="Texto da notificação" />
          </div>

          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Plano</label>
              <select value={planId} onChange={e => { setPlanId(e.target.value); setRecipientCount(null); }} className={inputCls}>
                <option value="">Todos os planos</option>
                {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Status</label>
              <select value={status} onChange={e => { setStatus(e.target.value as SubscriptionStatus | ''); setRecipientCount(null); }} className={inputCls}>
                {STATUS_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">País (código)</label>
              <input value={country} onChange={e => { setCountry(e.target.value.toUpperCase()); setRecipientCount(null); }} className={inputCls} placeholder="Ex: BR" maxLength={2} />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button type="button" onClick={handlePreview} disabled={counting}
              className="border border-white/15 text-gray-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-white/5 disabled:opacity-60">
              {counting ? 'Contando...' : 'Ver quantos vão receber'}
            </button>
            {recipientCount !== null && (
              <span className="text-sm text-gray-400">{recipientCount} destinatário(s)</span>
            )}
          </div>

          <button type="submit" disabled={sending || recipientCount === null}
            className="bg-[#F59E0B] text-[#0B1221] px-5 py-2 rounded-lg text-sm font-bold hover:bg-[#D97706] disabled:opacity-60">
            {sending ? 'Enviando...' : 'Enviar notificação'}
          </button>

          {recipientCount === null && (
            <p className="text-xs text-gray-600">Clique em "Ver quantos vão receber" antes de enviar.</p>
          )}
          {result && <p className="text-sm text-gray-300">{result}</p>}
        </form>

        <div className="bg-[#111827] rounded-xl border border-white/8 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/8">
            <p className="text-sm font-semibold text-white">Últimos envios</p>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0D1628] border-b border-white/8">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Título</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Destinatários</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Enviado em</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr><td colSpan={3} className="text-center py-8 text-gray-500">Nenhum envio ainda.</td></tr>
              ) : history.map(h => (
                <tr key={h.id} className="border-b border-white/5">
                  <td className="px-4 py-3 text-white">{h.title}</td>
                  <td className="px-4 py-3 text-gray-400">{h.recipient_count}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{fmtDate(h.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}
```

Note the `recipientCount === null` guard on the submit button: it forces the admin to run the preview count before sending, so a broadcast is never fired blind.

- [ ] **Step 4: Typecheck and manual walkthrough**

Run: `cd admin-paldrivy && npm run build`
Expected: no TypeScript errors.

Run: `npm run dev`, log in as admin, open **Notificações**, fill a title/message, click "Ver quantos vão receber" (confirm a plausible count appears), send it, and confirm a row appears in "Últimos envios" and the driver app (or a test push token) receives the notification.

- [ ] **Step 5: Commit**

```bash
git add admin-paldrivy/src/pages/Notifications.tsx admin-paldrivy/src/components/Layout.tsx admin-paldrivy/src/App.tsx
git commit -m "feat: add push notification center to admin panel"
```

---

## Part 2 — Limites do Plano Free (app-motorista)

### Task 4: `freeLimits.ts` pure utils + tests

**Files:**
- Create: `app-motorista/src/utils/freeLimits.ts`
- Create: `app-motorista/__tests__/utils/freeLimits.test.ts`

**Interfaces:**
- Produces: `FREE_MONTHLY_SHIFT_LIMIT`, `hasReachedShiftLimit(count: number): boolean`, `canViewMonthAsFree(year: number, month: number, now: Date): boolean` — consumed by Task 6 (shifts.ts) and Task 10 (report.tsx).

- [ ] **Step 1: Write the failing tests**

Create `app-motorista/__tests__/utils/freeLimits.test.ts`:

```ts
import { test, expect, describe } from '@jest/globals';
import { FREE_MONTHLY_SHIFT_LIMIT, hasReachedShiftLimit, canViewMonthAsFree } from '../../src/utils/freeLimits';

describe('hasReachedShiftLimit', () => {
  test('below the limit returns false', () => {
    expect(hasReachedShiftLimit(4)).toBe(false);
  });
  test('at the limit returns true', () => {
    expect(hasReachedShiftLimit(FREE_MONTHLY_SHIFT_LIMIT)).toBe(true);
  });
  test('above the limit returns true', () => {
    expect(hasReachedShiftLimit(FREE_MONTHLY_SHIFT_LIMIT + 1)).toBe(true);
  });
});

describe('canViewMonthAsFree', () => {
  const now = new Date('2026-07-20T12:00:00Z');

  test('current month is allowed', () => {
    expect(canViewMonthAsFree(2026, 7, now)).toBe(true);
  });
  test('previous month is blocked', () => {
    expect(canViewMonthAsFree(2026, 6, now)).toBe(false);
  });
  test('same month, previous year is blocked', () => {
    expect(canViewMonthAsFree(2025, 7, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd app-motorista && npx jest __tests__/utils/freeLimits.test.ts`
Expected: FAIL — `Cannot find module '../../src/utils/freeLimits'`.

- [ ] **Step 3: Implement**

Create `app-motorista/src/utils/freeLimits.ts`:

```ts
export const FREE_MONTHLY_SHIFT_LIMIT = 5;

export function hasReachedShiftLimit(shiftsThisMonth: number): boolean {
  return shiftsThisMonth >= FREE_MONTHLY_SHIFT_LIMIT;
}

export function canViewMonthAsFree(year: number, month: number, now: Date): boolean {
  return year === now.getFullYear() && month === now.getMonth() + 1;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd app-motorista && npx jest __tests__/utils/freeLimits.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add app-motorista/src/utils/freeLimits.ts app-motorista/__tests__/utils/freeLimits.test.ts
git commit -m "feat: add free-plan limit pure utils (shift count, month window)"
```

---

### Task 5: `usePremiumStatus` hook

**Files:**
- Create: `app-motorista/src/hooks/usePremiumStatus.ts`

**Interfaces:**
- Consumes: `supabase` client (`app-motorista/src/lib/supabase.ts`).
- Produces: `usePremiumStatus(userId: string | null): { isPremium: boolean; periodEnd: string | null }` — consumed by Tasks 6, 8, 9, 10.

- [ ] **Step 1: Implement the hook**

Create `app-motorista/src/hooks/usePremiumStatus.ts`, mirroring the (already-fixed) inline logic in `more.tsx:583-589`:

```ts
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export function usePremiumStatus(userId: string | null) {
  const [isPremium, setIsPremium] = useState(false);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    supabase.from('subscriptions').select('status, current_period_end')
      .eq('user_id', userId).maybeSingle()
      .then(({ data: sub }) => {
        const isPaidStatus = sub?.status === 'active' || sub?.status === 'trial' || sub?.status === 'complimentary';
        const notExpired = !sub?.current_period_end || new Date(sub.current_period_end) >= new Date();
        setIsPremium(isPaidStatus && notExpired);
        setPeriodEnd(sub?.current_period_end ?? null);
      });
  }, [userId]);

  return { isPremium, periodEnd };
}
```

- [ ] **Step 2: Refactor `more.tsx` to use it (closes the loop on the gratuidade bug)**

In `app-motorista/app/(tabs)/more.tsx`:

Add the import next to the other hook import:

```tsx
import { usePremiumStatus } from '@/src/hooks/usePremiumStatus';
```

Remove the two state declarations at lines 508-509:

```tsx
  const [isPremium, setIsPremium]         = useState(false);
  const [premiumEnd, setPremiumEnd]       = useState<string | null>(null);
```

Add, right after `const [userId, setUserId] = useState<string | null>(null);` (line 503):

```tsx
  const { isPremium, periodEnd: premiumEnd } = usePremiumStatus(userId);
```

Remove the subscriptions query block from inside the `useEffect` (lines 583-589):

```tsx
        supabase.from('subscriptions').select('status, current_period_end')
          .eq('user_id', uid).maybeSingle()
          .then(({ data: sub }) => {
            const isPaidStatus = sub?.status === 'active' || sub?.status === 'trial' || sub?.status === 'complimentary';
            const notExpired = !sub?.current_period_end || new Date(sub.current_period_end) >= new Date();
            setIsPremium(isPaidStatus && notExpired);
            setPeriodEnd(sub?.current_period_end ?? null);
          });
```

(delete it entirely — `usePremiumStatus(userId)` now handles this whenever `userId` is set by the same effect.)

- [ ] **Step 3: Typecheck**

Run: `cd app-motorista && npx tsc --noEmit`
Expected: no errors (confirms no leftover reference to the removed `setIsPremium`/`setPremiumEnd`).

- [ ] **Step 4: Manual verification**

Run the app, open **Mais**, confirm the premium badge/CTA still reflects the correct state for an `active`, a `complimentary`, and a `trial` test user (this is the scenario the original bug broke).

- [ ] **Step 5: Commit**

```bash
git add app-motorista/src/hooks/usePremiumStatus.ts "app-motorista/app/(tabs)/more.tsx"
git commit -m "refactor: extract usePremiumStatus hook, remove duplicated premium-check logic from more.tsx"
```

---

### Task 6: `UpgradeModal` + `PremiumGate` shared components + i18n keys

**Files:**
- Create: `app-motorista/src/components/UpgradeModal.tsx`
- Create: `app-motorista/src/components/PremiumGate.tsx`
- Modify: `app-motorista/locales/pt.json`
- Modify: `app-motorista/locales/en.json`
- Modify: `app-motorista/locales/es.json`

**Interfaces:**
- Consumes: `createStripeCheckout()` (`app-motorista/src/services/stripe.ts`), `Colors`/`Radius`/`Spacing` (`app-motorista/src/theme`).
- Produces: `UpgradeReason = 'shifts_limit' | 'history_limit' | 'dashboard_locked'`, `<UpgradeModal visible reason onClose />`, `<PremiumGate isPremium reason>{children}</PremiumGate>` — consumed by Tasks 8, 9, 10.

- [ ] **Step 1: Add the i18n keys**

In `app-motorista/locales/pt.json`, the file ends with:

```json
                   "annual_title":  "DRE Anual",
                   "comparison_title":  "Comparativo Mensal",
                   "year_total":  "Total do Ano",
                   "retry":  "Tentar novamente"
               }
}
```

Replace it with:

```json
                   "annual_title":  "DRE Anual",
                   "comparison_title":  "Comparativo Mensal",
                   "year_total":  "Total do Ano",
                   "retry":  "Tentar novamente"
               },
  "premium": {
    "shifts_limit_title": "Limite do plano Free atingido",
    "shifts_limit_body": "Você já registrou 5 turnos este mês. Assine o Premium para turnos ilimitados.",
    "history_limit_title": "Histórico disponível só no Premium",
    "history_limit_body": "No plano Free você só vê o mês atual. Assine o Premium para acessar meses anteriores e o relatório anual.",
    "dashboard_locked_title": "Gráficos exclusivos do Premium",
    "dashboard_locked_body": "Assine o Premium para desbloquear gráficos e histórico detalhado.",
    "upgrade_cta": "Assinar Premium",
    "maybe_later": "Agora não"
  }
}
```

In `app-motorista/locales/en.json`, the file ends with:

```json
                   "annual_title":  "Annual Report",
                   "comparison_title":  "Monthly Comparison",
                   "year_total":  "Year Total",
                   "retry":  "Try again"
               }
}
```

Replace it with:

```json
                   "annual_title":  "Annual Report",
                   "comparison_title":  "Monthly Comparison",
                   "year_total":  "Year Total",
                   "retry":  "Try again"
               },
  "premium": {
    "shifts_limit_title": "Free plan limit reached",
    "shifts_limit_body": "You've logged 5 shifts this month. Subscribe to Premium for unlimited shifts.",
    "history_limit_title": "History available on Premium only",
    "history_limit_body": "On the Free plan you can only see the current month. Subscribe to Premium to access past months and the annual report.",
    "dashboard_locked_title": "Premium-only charts",
    "dashboard_locked_body": "Subscribe to Premium to unlock charts and detailed history.",
    "upgrade_cta": "Subscribe to Premium",
    "maybe_later": "Not now"
  }
}
```

In `app-motorista/locales/es.json`, the file ends with:

```json
                   "annual_title":  "Informe Anual",
                   "comparison_title":  "Comparativo Mensual",
                   "year_total":  "Total del Año",
                   "retry":  "Reintentar"
               }
}
```

Replace it with:

```json
                   "annual_title":  "Informe Anual",
                   "comparison_title":  "Comparativo Mensual",
                   "year_total":  "Total del Año",
                   "retry":  "Reintentar"
               },
  "premium": {
    "shifts_limit_title": "Límite del plan Free alcanzado",
    "shifts_limit_body": "Ya registraste 5 turnos este mes. Suscríbete a Premium para turnos ilimitados.",
    "history_limit_title": "Historial disponible solo en Premium",
    "history_limit_body": "En el plan Free solo puedes ver el mes actual. Suscríbete a Premium para acceder a meses anteriores y el informe anual.",
    "dashboard_locked_title": "Gráficos exclusivos de Premium",
    "dashboard_locked_body": "Suscríbete a Premium para desbloquear gráficos e historial detallado.",
    "upgrade_cta": "Suscribirse a Premium",
    "maybe_later": "Ahora no"
  }
}
```

- [ ] **Step 2: Write `UpgradeModal`**

Create `app-motorista/src/components/UpgradeModal.tsx`:

```tsx
import React, { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as WebBrowser from 'expo-web-browser';
import { Colors, Radius, Spacing } from '../theme';
import { createStripeCheckout } from '../services/stripe';

export type UpgradeReason = 'shifts_limit' | 'history_limit' | 'dashboard_locked';

interface UpgradeModalProps {
  visible: boolean;
  reason: UpgradeReason;
  onClose: () => void;
}

export function UpgradeModal({ visible, reason, onClose }: UpgradeModalProps) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);

  async function handleUpgrade() {
    setLoading(true);
    try {
      const { url } = await createStripeCheckout();
      await WebBrowser.openBrowserAsync(url);
    } catch {
      // checkout failures are surfaced by the Stripe-hosted page itself
    } finally {
      setLoading(false);
      onClose();
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{t(`premium.${reason}_title`)}</Text>
          <Text style={styles.body}>{t(`premium.${reason}_body`)}</Text>
          <TouchableOpacity style={styles.upgradeBtn} onPress={handleUpgrade} disabled={loading}>
            {loading ? <ActivityIndicator color={Colors.onAccent} /> : (
              <Text style={styles.upgradeBtnText}>{t('premium.upgrade_cta')}</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.laterBtn} onPress={onClose} disabled={loading}>
            <Text style={styles.laterBtnText}>{t('premium.maybe_later')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  card: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.lg, width: '100%', maxWidth: 360 },
  title: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800', marginBottom: Spacing.sm },
  body: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, marginBottom: Spacing.lg },
  upgradeBtn: { backgroundColor: Colors.accent, borderRadius: Radius.card, paddingVertical: Spacing.md, alignItems: 'center', marginBottom: Spacing.sm },
  upgradeBtnText: { color: Colors.onAccent, fontSize: 15, fontWeight: '700' },
  laterBtn: { alignItems: 'center', paddingVertical: Spacing.sm },
  laterBtnText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
});
```

- [ ] **Step 3: Write `PremiumGate`**

Create `app-motorista/src/components/PremiumGate.tsx`:

```tsx
import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Colors, Radius, Spacing } from '../theme';
import { UpgradeModal, type UpgradeReason } from './UpgradeModal';

interface PremiumGateProps {
  isPremium: boolean;
  reason: UpgradeReason;
  children: React.ReactNode;
}

export function PremiumGate({ isPremium, reason, children }: PremiumGateProps) {
  const { t } = useTranslation();
  const [modalVisible, setModalVisible] = useState(false);

  if (isPremium) return <>{children}</>;

  return (
    <>
      <TouchableOpacity style={styles.lockedCard} onPress={() => setModalVisible(true)} activeOpacity={0.8}>
        <Ionicons name="lock-closed-outline" size={22} color={Colors.accent} />
        <Text style={styles.lockedTitle}>{t(`premium.${reason}_title`)}</Text>
        <Text style={styles.lockedBody}>{t(`premium.${reason}_body`)}</Text>
      </TouchableOpacity>
      <UpgradeModal visible={modalVisible} reason={reason} onClose={() => setModalVisible(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  lockedCard: {
    backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.lg,
    marginBottom: Spacing.md, alignItems: 'center', gap: Spacing.xs,
    borderWidth: 1.5, borderColor: Colors.border, borderStyle: 'dashed',
  },
  lockedTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  lockedBody: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center' },
});
```

- [ ] **Step 4: Typecheck**

Run: `cd app-motorista && npx tsc --noEmit`
Expected: no errors (`Colors.border` is defined in `src/theme.ts:13` as `'rgba(255, 255, 255, 0.08)'`, so no token substitution is needed).

- [ ] **Step 5: Commit**

```bash
git add app-motorista/src/components/UpgradeModal.tsx app-motorista/src/components/PremiumGate.tsx app-motorista/locales/pt.json app-motorista/locales/en.json app-motorista/locales/es.json
git commit -m "feat: add UpgradeModal and PremiumGate shared components with i18n copy"
```

---

### Task 7: Enforce the 5-shifts/month limit

**Files:**
- Modify: `app-motorista/src/services/shifts.ts`
- Modify: `app-motorista/app/(tabs)/shifts.tsx`

**Interfaces:**
- Consumes: `hasReachedShiftLimit(count)` (Task 4), `usePremiumStatus` (Task 5), `UpgradeModal` (Task 6).
- Produces: `FreeLimitError`, `getShiftsCountThisMonth(userId): Promise<number>`, `startShift(userId, vehicleId, odometerStartMeters, isPremium): Promise<Shift>` (signature change — 4th param added).

- [ ] **Step 1: Add the count function, error class, and gate to `shifts.ts`**

In `app-motorista/src/services/shifts.ts`, add the import at the top:

```ts
import { hasReachedShiftLimit } from '../utils/freeLimits';
```

Add this class and function right before `export async function startShift(`:

```ts
export class FreeLimitError extends Error {
  constructor(public readonly limit: 'shifts') {
    super(`free plan limit reached: ${limit}`);
  }
}

export async function getShiftsCountThisMonth(userId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const { count, error } = await supabase
    .from('shifts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('started_at', monthStart.toISOString());
  if (error) throw error;
  return count ?? 0;
}
```

Replace the `startShift` function (current lines 39-56):

```ts
export async function startShift(
  userId: string,
  vehicleId: string | null,
  odometerStartMeters: number | null,
  isPremium: boolean,
): Promise<Shift> {
  if (!isPremium) {
    const count = await getShiftsCountThisMonth(userId);
    if (hasReachedShiftLimit(count)) throw new FreeLimitError('shifts');
  }

  const { data, error } = await supabase
    .from('shifts')
    .insert({
      user_id: userId,
      vehicle_id: vehicleId,
      started_at: new Date().toISOString(),
      odometer_start_meters: odometerStartMeters,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 2: Wire the gate + modal into `shifts.tsx`**

In `app-motorista/app/(tabs)/shifts.tsx`, add imports:

```tsx
import { usePremiumStatus } from '@/src/hooks/usePremiumStatus';
import { UpgradeModal } from '@/src/components/UpgradeModal';
import { FreeLimitError } from '@/src/services/shifts';
```

(`FreeLimitError` is now also exported from `@/src/services/shifts` alongside the existing named imports on line 24-33 — add it to that same import statement instead of a new one.)

Find the component's userId state declaration (around line 434, alongside `startModalVisible`) and add:

```tsx
  const { isPremium } = usePremiumStatus(userId);
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);
```

Replace `handleStartShift` (current lines 483-497):

```tsx
  async function handleStartShift(odometerMeters: number | null) {
    if (!userId) return;
    setStartModalVisible(false);
    setStarting(true);
    setScreenError(null);
    try {
      const shift = await startShift(userId, profile?.vehicle_id ?? null, odometerMeters, isPremium);
      setActiveShift(shift);
      setElapsed(0);
    } catch (e) {
      if (e instanceof FreeLimitError) {
        setUpgradeModalVisible(true);
      } else {
        setScreenError(t('common.error'));
      }
    } finally {
      setStarting(false);
    }
  }
```

Add the modal render, right after the existing `<StartShiftModal ... />` block (around line 632-637):

```tsx
      <UpgradeModal
        visible={upgradeModalVisible}
        reason="shifts_limit"
        onClose={() => setUpgradeModalVisible(false)}
      />
```

- [ ] **Step 3: Typecheck**

Run: `cd app-motorista && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Using a test user with a `subscriptions` row of `status = 'cancelled'` or `'expired'` (i.e. Free), start and end 5 shifts in the current month, then try to start a 6th: confirm the odometer modal is skipped and the `UpgradeModal` (reason `shifts_limit`) appears instead, and no 6th row is inserted into `shifts`. Repeat with a `status = 'active'` test user and confirm the 6th shift starts normally.

- [ ] **Step 5: Commit**

```bash
git add app-motorista/src/services/shifts.ts "app-motorista/app/(tabs)/shifts.tsx"
git commit -m "feat: enforce 5-shifts/month limit for Free users with upgrade prompt"
```

---

### Task 8: Lock advanced cockpit charts for Free users

**Files:**
- Modify: `app-motorista/app/(tabs)/index.tsx`

**Interfaces:**
- Consumes: `usePremiumStatus` (Task 5), `PremiumGate` (Task 6).

- [ ] **Step 1: Import the hook and gate**

In `app-motorista/app/(tabs)/index.tsx`, add imports next to the existing ones:

```tsx
import { usePremiumStatus } from '@/src/hooks/usePremiumStatus';
import { PremiumGate } from '@/src/components/PremiumGate';
```

Right after `const [userId, setUserId] = useState<string | null>(null);` (line 937), add:

```tsx
  const { isPremium } = usePremiumStatus(userId);
```

- [ ] **Step 2: Wrap the advanced charts in one gate**

Replace this block (current lines 1168-1187):

```tsx
        {weekBuckets.length > 0 && (
          <WeekBarChart buckets={weekBuckets} weekTotals={weekTotals} currencyCode={currencyCode} locale={locale} language={i18n.language} distanceUnit={distanceUnit} onPress={setSelectedDay} />
        )}

        {monthlyTotals !== null && monthlyTotals.gross_cents > 0 && (
          <ProfitCard totals={monthlyTotals} currencyCode={currencyCode} locale={locale} distanceUnit={distanceUnit} />
        )}
        {monthlyBuckets.length > 0 && (
          <MonthlyChart
            buckets={monthlyBuckets}
            goalCents={goal?.target_amount_cents ?? null}
            currencyCode={currencyCode}
            locale={locale}
            onDayPress={handleMonthlyDayPress}
            selectedDay={selectedMonthDay}
            consumptionTrend={consumptionTrend}
          />
        )}

        <MonthHistoryCard items={monthHistory} currencyCode={currencyCode} locale={locale} onMonthPress={setMonthDetailItem} />
```

with:

```tsx
        <PremiumGate isPremium={isPremium} reason="dashboard_locked">
          <>
            {weekBuckets.length > 0 && (
              <WeekBarChart buckets={weekBuckets} weekTotals={weekTotals} currencyCode={currencyCode} locale={locale} language={i18n.language} distanceUnit={distanceUnit} onPress={setSelectedDay} />
            )}

            {monthlyTotals !== null && monthlyTotals.gross_cents > 0 && (
              <ProfitCard totals={monthlyTotals} currencyCode={currencyCode} locale={locale} distanceUnit={distanceUnit} />
            )}
            {monthlyBuckets.length > 0 && (
              <MonthlyChart
                buckets={monthlyBuckets}
                goalCents={goal?.target_amount_cents ?? null}
                currencyCode={currencyCode}
                locale={locale}
                onDayPress={handleMonthlyDayPress}
                selectedDay={selectedMonthDay}
                consumptionTrend={consumptionTrend}
              />
            )}

            <MonthHistoryCard items={monthHistory} currencyCode={currencyCode} locale={locale} onMonthPress={setMonthDetailItem} />
          </>
        </PremiumGate>
```

`CockpitCard` (today's summary, rendered just above this block) and `TodayCard`/`GoalProgress` (if separately rendered elsewhere in the file) are intentionally left outside the gate — Free users keep seeing today's numbers and month total, per the approved design.

- [ ] **Step 2: Typecheck**

Run: `cd app-motorista && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Log in as a Free test user: confirm the week chart, profit card, monthly chart, and month history all collapse into a single locked card with the "dashboard_locked" copy, and tapping it opens the checkout flow. Log in as a Premium test user: confirm all four render normally.

- [ ] **Step 4: Commit**

```bash
git add "app-motorista/app/(tabs)/index.tsx"
git commit -m "feat: lock advanced cockpit charts behind Premium for Free users"
```

---

### Task 9: Lock history navigation in the Relatório (report.tsx) screen

**Files:**
- Modify: `app-motorista/app/report.tsx`

**Interfaces:**
- Consumes: `canViewMonthAsFree` (Task 4), `usePremiumStatus` (Task 5), `UpgradeModal` (Task 6).

This is where "Histórico 30 dias" actually maps onto the UI: `report.tsx` is the only screen that navigates across months/years (the main cockpit in `index.tsx` always shows the current month). For Free users, block going to any month other than the current one, and block the annual tab entirely.

- [ ] **Step 1: Add imports and state**

In `app-motorista/app/report.tsx`, add imports:

```tsx
import { usePremiumStatus } from '@/src/hooks/usePremiumStatus';
import { UpgradeModal } from '@/src/components/UpgradeModal';
import { canViewMonthAsFree } from '@/src/utils/freeLimits';
```

Right after `const [userId, setUserId] = useState<string | null>(null);` (line 104), add:

```tsx
  const { isPremium } = usePremiumStatus(userId);
  const [upgradeModalVisible, setUpgradeModalVisible] = useState(false);
```

- [ ] **Step 2: Gate `prevMonth` and the annual tab**

Replace `prevMonth` (current lines 139-142):

```tsx
  function prevMonth() {
    if (!isPremium && canViewMonthAsFree(year, month, now)) {
      setUpgradeModalVisible(true);
      return;
    }
    if (month === 1) { setYear(y => y - 1); setMonth(12); }
    else setMonth(m => m - 1);
  }
```

Replace the annual-tab `TouchableOpacity` (current lines 227-234):

```tsx
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
```

- [ ] **Step 3: Render the modal**

Add near the end of the returned JSX tree, as a sibling of the outermost `<SafeAreaView>`'s other top-level children (right before its closing tag):

```tsx
      <UpgradeModal
        visible={upgradeModalVisible}
        reason="history_limit"
        onClose={() => setUpgradeModalVisible(false)}
      />
```

- [ ] **Step 4: Typecheck**

Run: `cd app-motorista && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

As a Free test user on the Relatório screen: confirm tapping the back-chevron on the monthly picker (while already on the current month) opens the upgrade modal instead of navigating, and tapping "Anual" also opens it instead of switching tabs. As a Premium test user: confirm both work normally (can navigate to prior months, can open the annual tab).

- [ ] **Step 6: Commit**

```bash
git add app-motorista/app/report.tsx
git commit -m "feat: lock prior-month and annual report views behind Premium for Free users"
```

---

## Part 3 — Aba Assinaturas agrupada por tipo/categoria (admin-paldrivy)

### Task 10: Group `Subscriptions.tsx` by status and plan

**Files:**
- Modify: `admin-paldrivy/src/pages/Subscriptions.tsx`

**Interfaces:**
- Consumes: `getSubscriptions('')`, `getPlans()` (existing, `admin-paldrivy/src/services/admin.ts`).

- [ ] **Step 1: Replace the component's data loading and filtering**

In `admin-paldrivy/src/pages/Subscriptions.tsx`, replace the `export default function Subscriptions()` body's state/loading section (current lines 159-185):

```tsx
export default function Subscriptions() {
  const [allSubs, setAllSubs] = useState<Subscription[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);

  async function load() {
    setLoading(true);
    const [s, p] = await Promise.all([getSubscriptions(''), getPlans()]);
    setAllSubs(s);
    setPlans(p);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const statusCounts = new Map<string, number>();
  for (const s of allSubs) statusCounts.set(s.status, (statusCounts.get(s.status) ?? 0) + 1);

  const planCounts = new Map<string, { id: string; count: number }>();
  for (const s of allSubs) {
    const name = (s as any).plan?.name ?? 'Sem plano';
    const id = s.plan_id ?? '';
    planCounts.set(name, { id, count: (planCounts.get(name)?.count ?? 0) + 1 });
  }

  const subs = allSubs.filter(s =>
    (!statusFilter || s.status === statusFilter) &&
    (!planFilter || s.plan_id === planFilter)
  );

  async function handleCancel(id: string) {
    if (!confirm('Cancelar esta assinatura?')) return;
    await cancelSubscription(id);
    load();
  }

  async function handleAssign(data: Parameters<typeof upsertSubscription>[0]) {
    await upsertSubscription(data);
    setAssigning(false);
    load();
  }
```

- [ ] **Step 2: Add the summary card rows above the existing filter/table**

Replace the returned JSX's filter row (current lines 187-207) — keep everything from `<div className="bg-[#111827] rounded-xl border border-white/8 overflow-hidden">` (the table) unchanged, only the block above it changes:

```tsx
  return (
    <Layout title="Assinaturas">
      <div className="space-y-4">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Por status</p>
          <div className="flex gap-2 flex-wrap">
            {STATUS_OPTS.map(({ value, label }) => (
              <button key={value} onClick={() => setStatusFilter(value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  statusFilter === value
                    ? 'bg-[#F59E0B] text-[#0B1221] border-[#F59E0B] font-bold'
                    : 'border-white/15 text-gray-400 hover:bg-white/5'
                }`}>
                {label}{value && ` (${statusCounts.get(value) ?? 0})`}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Por plano</p>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setPlanFilter('')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                planFilter === ''
                  ? 'bg-[#F59E0B] text-[#0B1221] border-[#F59E0B] font-bold'
                  : 'border-white/15 text-gray-400 hover:bg-white/5'
              }`}>
              Todos os planos
            </button>
            {Array.from(planCounts.entries()).map(([name, { id, count }]) => (
              <button key={name} onClick={() => setPlanFilter(id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  planFilter === id
                    ? 'bg-[#F59E0B] text-[#0B1221] border-[#F59E0B] font-bold'
                    : 'border-white/15 text-gray-400 hover:bg-white/5'
                }`}>
                {name} ({count})
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <button onClick={() => setAssigning(true)}
            className="bg-[#F59E0B] text-[#0B1221] px-4 py-2 rounded-lg text-sm font-bold hover:bg-[#D97706]">
            + Atribuir
          </button>
        </div>
```

The rest of the return (the table and `{assigning && <AssignModal ... />}`) stays exactly as-is — it already reads from the `subs` variable, which now comes from client-side filtering instead of a server refetch.

- [ ] **Step 2: Typecheck**

Run: `cd admin-paldrivy && npm run build`
Expected: no TypeScript errors.

- [ ] **Step 3: Manual verification**

Open **Assinaturas**: confirm the status row shows correct counts per status, the plan row shows one button per plan with correct counts, clicking either filters the table below, and clicking both together (e.g. "Gratuidade" + a specific plan) combines correctly (AND, not OR).

- [ ] **Step 4: Commit**

```bash
git add admin-paldrivy/src/pages/Subscriptions.tsx
git commit -m "feat: group subscriptions view by status and plan with clickable summary cards"
```

---

## Part 4 — Histórico completo do motorista no UserDetail (admin-paldrivy)

### Task 11: Paginated data functions in `admin.ts`

**Files:**
- Modify: `admin-paldrivy/src/services/admin.ts`

**Interfaces:**
- Produces: `getUserShiftsPage(userId, offset, limit?)`, `getUserExpensesPage(userId, offset, limit?)`, `getUserFuelPage(userId, offset, limit?)` — consumed by Task 12.
- Modifies: `getUserDetail()` return shape — drops `recentShifts`/`recentExpenses`/`recentFuel`.

- [ ] **Step 1: Add the paginated functions**

In `admin-paldrivy/src/services/admin.ts`, add right after `getUserDetail` (after line 184, before `// ─── Plans ─`):

```ts
export async function getUserShiftsPage(userId: string, offset: number, limit = 20) {
  const { data, error } = await supabase.from('shifts')
    .select('gross_cents, net_cents, started_at')
    .eq('user_id', userId).order('started_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as { gross_cents: number | null; net_cents: number | null; started_at: string }[];
}

export async function getUserExpensesPage(userId: string, offset: number, limit = 20) {
  const { data, error } = await supabase.from('expenses')
    .select('amount_cents, category, expense_date')
    .eq('user_id', userId).order('expense_date', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as { amount_cents: number; category: string; expense_date: string }[];
}

export async function getUserFuelPage(userId: string, offset: number, limit = 20) {
  const { data, error } = await supabase.from('fuel_entries')
    .select('total_cost_cents, filled_at')
    .eq('user_id', userId).order('filled_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data ?? []) as { total_cost_cents: number; filled_at: string }[];
}
```

- [ ] **Step 2: Drop the hardcoded "recent" queries from `getUserDetail`**

Replace the `Promise.all` destructure and query list in `getUserDetail` (current lines 144-160):

```ts
  const [profileRes, subsRes,
    allShiftsRes, allExpRes, allFuelRes, mShiftsRes, mExpRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', userId).maybeSingle(),
    supabase.from('subscriptions').select('*, plan:plans(*)').eq('user_id', userId).limit(1),
    supabase.from('shifts').select('gross_cents,net_cents').eq('user_id', userId).not('ended_at', 'is', null),
    supabase.from('expenses').select('amount_cents').eq('user_id', userId),
    supabase.from('fuel_entries').select('total_cost_cents').eq('user_id', userId),
    supabase.from('shifts').select('gross_cents').eq('user_id', userId)
      .gte('started_at', monthIso).not('ended_at', 'is', null),
    supabase.from('expenses').select('amount_cents').eq('user_id', userId).gte('expense_date', monthDate),
  ]);
```

And replace the function's return statement (current lines 168-183):

```ts
  return {
    profile: { ...profile, subscription: (subsRes.data ?? [])[0] ?? null },
    stats: {
      total_shifts:          (allShiftsRes.data ?? []).length,
      total_gross_cents:     s(allShiftsRes.data, 'gross_cents'),
      total_net_cents:       s(allShiftsRes.data, 'net_cents'),
      total_expenses_cents:  s(allExpRes.data, 'amount_cents'),
      total_fuel_cents:      s(allFuelRes.data, 'total_cost_cents'),
      month_shifts:          (mShiftsRes.data ?? []).length,
      month_gross_cents:     s(mShiftsRes.data, 'gross_cents'),
      month_expenses_cents:  s(mExpRes.data, 'amount_cents'),
    },
  };
```

(`recentShifts`/`recentExpenses`/`recentFuel` are gone from both the query list and the return value — Task 12 fetches the first page of each directly via the new paginated functions.)

- [ ] **Step 3: Typecheck**

Run: `cd admin-paldrivy && npm run build`
Expected: TypeScript errors in `UserDetail.tsx` referencing `data.recentShifts`/`recentExpenses`/`recentFuel` — expected, fixed in Task 12.

- [ ] **Step 4: Commit**

(Commit together with Task 12 — this task alone leaves `UserDetail.tsx` broken. Skip this step here; Task 12's Step 5 commits both files.)

---

### Task 12: Paginated history sections in `UserDetail.tsx`

**Files:**
- Modify: `admin-paldrivy/src/pages/UserDetail.tsx`

**Interfaces:**
- Consumes: `getUserShiftsPage`, `getUserExpensesPage`, `getUserFuelPage` (Task 11).

- [ ] **Step 1: Update the import and add pagination state**

In `admin-paldrivy/src/pages/UserDetail.tsx`, update the import (current line 4):

```tsx
import { getUserDetail, updateUserRole, updateUserProfile, getPlans, upsertSubscription, deleteUser,
  getUserShiftsPage, getUserExpensesPage, getUserFuelPage } from '../services/admin';
```

Add this constant near the top of the file (after the existing `const COUNTRIES = [...]` block, e.g. after line 42):

```tsx
const PAGE_SIZE = 20;
```

Inside `export default function UserDetail()`, add state right after the existing `const [notes, setNotes] = useState('');` (line 226):

```tsx
  const [shiftsList, setShiftsList] = useState<{ gross_cents: number | null; net_cents: number | null; started_at: string }[]>([]);
  const [shiftsOffset, setShiftsOffset] = useState(0);
  const [shiftsHasMore, setShiftsHasMore] = useState(true);

  const [expensesList, setExpensesList] = useState<{ amount_cents: number; category: string; expense_date: string }[]>([]);
  const [expensesOffset, setExpensesOffset] = useState(0);
  const [expensesHasMore, setExpensesHasMore] = useState(true);

  const [fuelList, setFuelList] = useState<{ total_cost_cents: number; filled_at: string }[]>([]);
  const [fuelOffset, setFuelOffset] = useState(0);
  const [fuelHasMore, setFuelHasMore] = useState(true);

  async function loadMoreShifts() {
    if (!id) return;
    const page = await getUserShiftsPage(id, shiftsOffset);
    setShiftsList(prev => [...prev, ...page]);
    setShiftsOffset(o => o + page.length);
    setShiftsHasMore(page.length === PAGE_SIZE);
  }

  async function loadMoreExpenses() {
    if (!id) return;
    const page = await getUserExpensesPage(id, expensesOffset);
    setExpensesList(prev => [...prev, ...page]);
    setExpensesOffset(o => o + page.length);
    setExpensesHasMore(page.length === PAGE_SIZE);
  }

  async function loadMoreFuel() {
    if (!id) return;
    const page = await getUserFuelPage(id, fuelOffset);
    setFuelList(prev => [...prev, ...page]);
    setFuelOffset(o => o + page.length);
    setFuelHasMore(page.length === PAGE_SIZE);
  }
```

- [ ] **Step 2: Fetch the first page in `load()`**

Replace `load()` (current lines 228-236):

```tsx
  async function load() {
    if (!id) return;
    setLoading(true);
    const [d, p, sPage, ePage, fPage] = await Promise.all([
      getUserDetail(id), getPlans(),
      getUserShiftsPage(id, 0), getUserExpensesPage(id, 0), getUserFuelPage(id, 0),
    ]);
    setData(d);
    setPlans(p);
    setPlanId(d.profile.subscription?.plan_id ?? p[0]?.id ?? '');
    setShiftsList(sPage);   setShiftsOffset(sPage.length);   setShiftsHasMore(sPage.length === PAGE_SIZE);
    setExpensesList(ePage); setExpensesOffset(ePage.length); setExpensesHasMore(ePage.length === PAGE_SIZE);
    setFuelList(fPage);     setFuelOffset(fPage.length);     setFuelHasMore(fPage.length === PAGE_SIZE);
    setLoading(false);
  }
```

(Note: the first page is fetched directly with explicit `offset = 0` here, not via `loadMoreShifts()` etc. — calling those from inside `load()` would read stale offset state from before the `setShiftsOffset(0)` reset takes effect, since React state updates aren't synchronous.)

- [ ] **Step 3: Replace the three history cards to use the paginated lists**

Replace the grid block at the end of the file (current lines 446-486):

```tsx
        <div className="grid md:grid-cols-3 gap-4">
          <div className="bg-[#111827] rounded-xl border border-white/8 p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Turnos</p>
            {shiftsList.length === 0 ? <p className="text-xs text-gray-600">Nenhum</p> : (
              <ul className="space-y-2">
                {shiftsList.map((s, i) => (
                  <li key={i} className="text-xs text-gray-300 flex justify-between">
                    <span>{new Date(s.started_at).toLocaleDateString('pt-BR')}</span>
                    <span className="font-medium text-emerald-400">{fmt(s.gross_cents)}</span>
                  </li>
                ))}
              </ul>
            )}
            {shiftsHasMore && (
              <button onClick={loadMoreShifts} className="mt-3 text-xs text-[#F59E0B] hover:underline">Carregar mais</button>
            )}
          </div>
          <div className="bg-[#111827] rounded-xl border border-white/8 p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Despesas</p>
            {expensesList.length === 0 ? <p className="text-xs text-gray-600">Nenhuma</p> : (
              <ul className="space-y-2">
                {expensesList.map((e, i) => (
                  <li key={i} className="text-xs text-gray-300 flex justify-between">
                    <span className="truncate mr-2">{e.category}</span>
                    <span className="font-medium text-red-400 flex-shrink-0">{fmt(e.amount_cents)}</span>
                  </li>
                ))}
              </ul>
            )}
            {expensesHasMore && (
              <button onClick={loadMoreExpenses} className="mt-3 text-xs text-[#F59E0B] hover:underline">Carregar mais</button>
            )}
          </div>
          <div className="bg-[#111827] rounded-xl border border-white/8 p-5">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Abastecimentos</p>
            {fuelList.length === 0 ? <p className="text-xs text-gray-600">Nenhum</p> : (
              <ul className="space-y-2">
                {fuelList.map((f, i) => (
                  <li key={i} className="text-xs text-gray-300 flex justify-between">
                    <span>{new Date(f.filled_at).toLocaleDateString('pt-BR')}</span>
                    <span className="font-medium text-[#F59E0B]">{fmt(f.total_cost_cents)}</span>
                  </li>
                ))}
              </ul>
            )}
            {fuelHasMore && (
              <button onClick={loadMoreFuel} className="mt-3 text-xs text-[#F59E0B] hover:underline">Carregar mais</button>
            )}
          </div>
        </div>
```

Also update the destructure right after the loading/not-found guards (current line 294):

```tsx
  const { profile, stats } = data;
```

(remove `recentShifts, recentExpenses, recentFuel` from that destructure — they're no longer part of `data`.)

- [ ] **Step 4: Typecheck**

Run: `cd admin-paldrivy && npm run build`
Expected: no TypeScript errors (this also confirms Task 11's `getUserDetail` change compiles cleanly against this file).

- [ ] **Step 5: Manual verification + commit both tasks**

Open a user with more than 20 shifts (or temporarily lower `PAGE_SIZE` to 2 for testing), confirm the first page loads, "Carregar mais" appends the next page, and the button disappears once a page returns fewer than `PAGE_SIZE` rows.

```bash
git add admin-paldrivy/src/services/admin.ts admin-paldrivy/src/pages/UserDetail.tsx
git commit -m "feat: paginate driver shift/expense/fuel history in UserDetail instead of truncating to 10/10/5"
```

---

## Part 5 — Notificação de vencimento de assinatura (app-motorista)

### Task 13: `subscriptions` expiry-tracking columns

**Files:**
- Create: `app-motorista/supabase/migrations/20260720000001_subscription_expiry_columns.sql`

**Interfaces:**
- Produces: `subscriptions.expiry_warning_sent_at`, `subscriptions.expiry_followup_sent_at` — consumed by Task 14.

- [ ] **Step 1: Write the migration**

```sql
alter table subscriptions
  add column expiry_warning_sent_at timestamptz,
  add column expiry_followup_sent_at timestamptz;
```

- [ ] **Step 2: Apply and verify**

Run: `cd app-motorista && supabase db push`
Expected: applies cleanly.

Run in the Supabase SQL editor: `select expiry_warning_sent_at, expiry_followup_sent_at from subscriptions limit 1;`
Expected: both columns exist and are `null` on existing rows.

- [ ] **Step 3: Commit**

```bash
git add app-motorista/supabase/migrations/20260720000001_subscription_expiry_columns.sql
git commit -m "feat: add expiry notification tracking columns to subscriptions"
```

---

### Task 14: `check-subscription-expiry` Edge Function

**Files:**
- Create: `app-motorista/supabase/functions/check-subscription-expiry/index.ts`

**Interfaces:**
- Consumes: `subscriptions` table (with Task 13's new columns), `profiles.push_token`, the Expo push API (same pattern as `send-push-notification`), the Brevo transactional email REST API.
- Produces: an HTTP endpoint invoked daily by `pg_cron` (Task 15).

- [ ] **Step 1: Write the function**

Create `app-motorista/supabase/functions/check-subscription-expiry/index.ts`:

```ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function daysBetween(from: Date, to: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24
  const utcFrom = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())
  const utcTo = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
  return Math.round((utcTo - utcFrom) / msPerDay)
}

async function sendPush(token: string, title: string, body: string) {
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ to: token, title, body, sound: 'default' }]),
    })
  } catch (err) {
    console.error('expo push send failed', err)
  }
}

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = Deno.env.get('BREVO_API_KEY')
  if (!apiKey) return
  try {
    await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({
        sender: { name: 'PalDrivy', email: 'no-reply@paldrivy.com' },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    })
  } catch (err) {
    console.error('brevo send failed', err)
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  const { data: subs, error } = await supabaseAdmin
    .from('subscriptions')
    .select('id, user_id, current_period_end, expiry_warning_sent_at, expiry_followup_sent_at, profiles(push_token)')
    .in('status', ['active', 'trial', 'complimentary'])
    .not('current_period_end', 'is', null)

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const today = new Date()
  let warned = 0
  let followedUp = 0

  for (const sub of (subs ?? []) as any[]) {
    const end = new Date(sub.current_period_end)
    const diff = daysBetween(today, end) // positive = end is still in the future
    const pushToken: string | null = sub.profiles?.push_token ?? null

    if (diff === 7 && !sub.expiry_warning_sent_at) {
      if (pushToken) await sendPush(pushToken, 'Sua assinatura vence em 7 dias', 'Renove para não perder o acesso Premium.')
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(sub.user_id)
      if (authUser?.user?.email) {
        await sendEmail(authUser.user.email, 'Sua assinatura PalDrivy vence em 7 dias',
          '<p>Sua assinatura Premium vence em 7 dias. Renove para continuar aproveitando todos os recursos.</p>')
      }
      await supabaseAdmin.from('subscriptions').update({ expiry_warning_sent_at: today.toISOString() }).eq('id', sub.id)
      warned++
    }

    if (diff === -1 && !sub.expiry_followup_sent_at) {
      if (pushToken) await sendPush(pushToken, 'Sua assinatura expirou', 'Renove agora para recuperar o acesso Premium.')
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(sub.user_id)
      if (authUser?.user?.email) {
        await sendEmail(authUser.user.email, 'Sua assinatura PalDrivy expirou',
          '<p>Sua assinatura Premium expirou ontem. Renove agora para recuperar o acesso.</p>')
      }
      await supabaseAdmin.from('subscriptions').update({ expiry_followup_sent_at: today.toISOString() }).eq('id', sub.id)
      followedUp++
    }
  }

  return new Response(JSON.stringify({ checked: (subs ?? []).length, warned, followedUp }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
```

- [ ] **Step 2: Set the Brevo secret**

Run: `supabase secrets set BREVO_API_KEY=<your-brevo-api-key> --project-ref ucxkvxqpkknxotbfxgeu`
Expected: confirms the secret is set. (Get the key from the Brevo dashboard → SMTP & API → API Keys; this is a new integration, there is no existing Brevo key in this project to reuse.)

- [ ] **Step 3: Deploy and verify manually**

Run: `cd app-motorista && supabase functions deploy check-subscription-expiry`
Expected: deploys successfully.

Run (against a test subscription row with `current_period_end` manually set to 7 days from now, and `push_token`/an auth email you control):

```bash
curl -X POST 'https://ucxkvxqpkknxotbfxgeu.supabase.co/functions/v1/check-subscription-expiry' \
  -H "Authorization: Bearer <service-role-or-anon-key>"
```

Expected: JSON response like `{"checked":N,"warned":1,"followedUp":0}`, a push notification arrives on the test device, an email arrives in the test inbox, and `expiry_warning_sent_at` is set on that row (re-running the curl immediately after should now report `warned: 0` for that same row, since the guard column is now set).

- [ ] **Step 4: Commit**

```bash
git add app-motorista/supabase/functions/check-subscription-expiry/index.ts
git commit -m "feat: add check-subscription-expiry edge function (7-day warning + 1-day-after follow-up, push + email)"
```

---

### Task 15: Schedule the daily cron (manual, production Supabase action)

**Files:** none (SQL run directly against the linked Supabase project via the SQL editor or a one-off migration) — no code changes, so no commit at the end of this task.

This step touches the shared production Supabase project's job scheduler, not a file in either repo. Do not run this automatically as part of a subagent/CI pass — it should be run once, deliberately, by whoever has access to the Supabase dashboard for `ucxkvxqpkknxotbfxgeu`.

- [ ] **Step 1: Enable required extensions (if not already enabled)**

In the Supabase SQL editor:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;
```

- [ ] **Step 2: Schedule the daily job**

```sql
select cron.schedule(
  'check-subscription-expiry-daily',
  '0 12 * * *',
  $$
  select net.http_post(
    url := 'https://ucxkvxqpkknxotbfxgeu.supabase.co/functions/v1/check-subscription-expiry',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true),
      'Content-Type', 'application/json'
    )
  );
  $$
);
```

If `current_setting('app.settings.service_role_key', true)` isn't already configured in this project (it's a common convention but not automatic), instead hardcode the service role key directly in the `headers` object here — this SQL lives only in the Supabase dashboard, not in a committed file, so it's an acceptable place for that secret.

- [ ] **Step 3: Verify the job is registered**

Run: `select * from cron.job where jobname = 'check-subscription-expiry-daily';`
Expected: one row, with the correct schedule (`0 12 * * *`) and active `true`.

- [ ] **Step 4: Verify a real run**

Wait for the next scheduled run (or run `select cron.schedule_in_background(...)` / manually trigger via `select net.http_post(...)` with the same arguments), then check `select * from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'check-subscription-expiry-daily') order by start_time desc limit 1;` — expect `status = 'succeeded'`.

---

## Plan Self-Review Notes

- **Spec coverage:** Part 1 covers spec item 1 (push center), Part 2 (Tasks 6-9) covers item 2 (Free limits + upgrade prompt), Part 3 covers item 3 (grouped subscriptions), Part 4 covers item 4 (full driver history), Part 5 covers item 5 (expiry notifications). The already-fixed gratuidade bug is folded into Task 5 as the root-cause cleanup (extracting `usePremiumStatus` so the fix can't silently regress).
- **Region-based upgrade offer:** per the user's decision (single limit, only the offer varies by region), `UpgradeModal` intentionally does not read `plans.prices`/currency at all — it always routes to the existing `createStripeCheckout()`/Stripe Checkout flow, which already renders localized pricing on the hosted Stripe page itself. No duplicate pricing logic was added client-side.
- **Naming consistency check:** `usePremiumStatus` → `{ isPremium, periodEnd }` used identically in Tasks 5, 7, 8, 9. `FreeLimitError` exported from `shifts.ts`, imported in `shifts.tsx` only. `UpgradeReason` values (`'shifts_limit' | 'history_limit' | 'dashboard_locked'`) match the i18n key prefixes added in Task 6 exactly.
