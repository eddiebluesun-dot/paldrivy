import { supabase } from '../lib/supabase';
import type { DashboardStats, Plan, Subscription, UserWithSubscription, LegalDocument, ConsentStats, CountryStat, PushFilters, PushBroadcast } from '../types';

// ─── Dashboard ────────────────────────────────────────────────────────────────

export async function getDashboardStats(): Promise<DashboardStats> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [profilesRes, newUsersRes, subsRes, shiftsRes] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('profiles').select('id', { count: 'exact', head: true })
      .gte('created_at', monthStart.toISOString()),
    supabase.from('subscriptions').select('status'),
    supabase.from('shifts').select('gross_cents')
      .gte('started_at', monthStart.toISOString())
      .not('ended_at', 'is', null),
  ]);

  const subs = (subsRes.data ?? []) as { status: string }[];
  const shifts = (shiftsRes.data ?? []) as { gross_cents: number | null }[];
  const total_users = profilesRes.count ?? 0;
  const active_subscriptions = subs.filter(s => s.status === 'active').length;

  return {
    total_users,
    new_users_month: newUsersRes.count ?? 0,
    active_subscriptions,
    free_users: total_users - active_subscriptions,
    shifts_month: shifts.length,
    gross_month_cents: shifts.reduce((s, r) => s + (r.gross_cents ?? 0), 0),
  };
}

export async function getUserGrowth(): Promise<{ date: string; count: number }[]> {
  const since = new Date();
  since.setDate(since.getDate() - 29);
  const { data } = await supabase.from('profiles')
    .select('created_at')
    .gte('created_at', since.toISOString())
    .order('created_at');

  const rows = (data ?? []) as { created_at: string }[];
  const map = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    map.set(d.toISOString().slice(0, 10), 0);
  }
  for (const r of rows) {
    const k = r.created_at.slice(0, 10);
    if (map.has(k)) map.set(k, (map.get(k) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([date, count]) => ({ date, count }));
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function getUsers(search = '', planId = ''): Promise<UserWithSubscription[]> {
  // Try RPC that joins auth.users ↔ profiles (shows users without profiles too)
  const { data: rpcData, error: rpcErr } = await supabase.rpc('get_all_users_admin');

  let userList: any[];
  if (rpcErr || !rpcData) {
    // Fallback: profiles-only (old behaviour)
    let q = supabase.from('profiles').select('*').order('created_at', { ascending: false }).limit(200);
    if (search) q = q.ilike('name', `%${search}%`);
    const { data: profiles, error } = await q;
    if (error) throw error;
    userList = (profiles ?? []).map((p: any) => ({ ...p, has_profile: true }));
  } else {
    userList = rpcData as any[];
    if (search) {
      const q = search.toLowerCase();
      userList = userList.filter(u =>
        (u.name ?? '').toLowerCase().includes(q) ||
        (u.email ?? '').toLowerCase().includes(q) ||
        (u.phone ?? '').toLowerCase().includes(q),
      );
    }
  }

  if (userList.length === 0) return [];

  const { data: subs } = await supabase
    .from('subscriptions')
    .select('*, plan:plans(*)')
    .in('user_id', userList.map((u: any) => u.id));

  const subsByUser = new Map(((subs ?? []) as any[]).map((s: any) => [s.user_id, s]));
  const result = userList.map((u: any) => ({ ...u, subscription: subsByUser.get(u.id) ?? null }));
  return planId ? result.filter((u: any) => u.subscription?.plan_id === planId) : result;
}

export async function deleteUser(userId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_auth_user', { target_user_id: userId });
  if (error) throw error;
}

export async function updateUserRole(userId: string, role: 'admin' | 'driver'): Promise<void> {
  const { error } = await supabase.from('profiles').update({ role }).eq('id', userId);
  if (error) throw error;
}

export async function updateUserProfile(userId: string, patch: {
  name?: string;
  phone?: string;
  country?: string;
  city?: string;
  state?: string;
  currency_code?: string;
  distance_unit?: string;
  volume_unit?: string;
  worker_type?: string;
  locale?: string;
  timezone?: string;
}): Promise<void> {
  // SECURITY DEFINER RPC bypasses RLS so admin can edit any profile
  const { error } = await supabase.rpc('admin_update_profile', {
    target_user_id: userId,
    p_name:          patch.name          ?? null,
    p_phone:         patch.phone         ?? null,
    p_country:       patch.country       ?? null,
    p_city:          patch.city          ?? null,
    p_state:         patch.state         ?? null,
    p_currency_code: patch.currency_code ?? null,
    p_distance_unit: patch.distance_unit ?? null,
    p_volume_unit:   patch.volume_unit   ?? null,
    p_worker_type:   patch.worker_type   ?? null,
    p_locale:        patch.locale        ?? null,
    p_timezone:      patch.timezone      ?? null,
  });
  if (error) throw error;
}

export async function getUserDetail(userId: string) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthIso = monthStart.toISOString();
  const monthDate = monthIso.slice(0, 10);

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

  if (profileRes.error) throw profileRes.error;

  const s = (arr: any[] | null, key: string) => (arr ?? []).reduce((acc, r) => acc + (r[key] ?? 0), 0);

  // Skeleton for users without a profile row (incomplete onboarding)
  const profile = (profileRes.data as any) ?? { id: userId, name: null, phone: null, role: 'driver', has_profile: false };
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
}

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

// ─── Plans ───────────────────────────────────────────────────────────────────

export async function getPlans(): Promise<Plan[]> {
  const { data: plans, error } = await supabase.from('plans')
    .select('*').order('sort_order');
  if (error) throw error;

  const { data: counts } = await supabase.from('subscriptions')
    .select('plan_id').eq('status', 'active');

  const countMap = new Map<string, number>();
  for (const s of (counts ?? []) as { plan_id: string }[]) {
    countMap.set(s.plan_id, (countMap.get(s.plan_id) ?? 0) + 1);
  }

  return ((plans ?? []) as Plan[]).map(p => ({
    ...p,
    features: Array.isArray(p.features) ? p.features : [],
    prices: (p.prices && typeof p.prices === 'object' && !Array.isArray(p.prices)) ? p.prices : {},
    subscriber_count: countMap.get(p.id) ?? 0,
  }));
}

export async function upsertPlan(plan: Partial<Plan>): Promise<void> {
  const prices = plan.prices ?? {};
  const payload = {
    name: plan.name,
    description: plan.description ?? null,
    // keep price_cents in sync with BRL price (legacy column)
    price_cents: prices['BRL'] ?? plan.price_cents ?? 0,
    prices,
    interval: plan.interval ?? 'monthly',
    features: plan.features ?? [],
    is_active: plan.is_active ?? true,
    sort_order: plan.sort_order ?? 0,
  };
  if (plan.id) {
    const { error } = await supabase.from('plans').update(payload).eq('id', plan.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from('plans').insert(payload);
    if (error) throw error;
  }
}

export async function togglePlanActive(planId: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('plans').update({ is_active: active }).eq('id', planId);
  if (error) throw error;
}

// ─── Subscriptions ────────────────────────────────────────────────────────────

export async function getSubscriptions(status = ''): Promise<Subscription[]> {
  let q = supabase.from('subscriptions')
    .select('*, profile:profiles(id,name,role), plan:plans(id,name,price_cents,interval)')
    .order('created_at', { ascending: false })
    .limit(200);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as unknown as Subscription[];
}

export async function upsertSubscription(sub: {
  user_id: string; plan_id: string; status: string;
  current_period_end: string | null; notes?: string;
}): Promise<void> {
  const { error } = await supabase.from('subscriptions').upsert(
    { ...sub, current_period_start: new Date().toISOString() },
    { onConflict: 'user_id' }
  );
  if (error) throw error;
}

export async function cancelSubscription(subId: string): Promise<void> {
  const { error } = await supabase.from('subscriptions')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
    .eq('id', subId);
  if (error) throw error;
}

// ─── Push Notifications ───────────────────────────────────────────────────────

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

// ─── Legal Documents ──────────────────────────────────────────────────────────

export async function getLegalDocuments(): Promise<LegalDocument[]> {
  const { data, error } = await supabase.from('legal_documents')
    .select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as any[];
}

export async function createDocumentVersion(doc: {
  type: 'privacy_policy' | 'terms_of_use';
  version: string;
  title: string;
  content: string;
}): Promise<string> {
  const { data, error } = await supabase.from('legal_documents')
    .insert({ ...doc, is_active: false })
    .select('id')
    .single();
  if (error) throw error;
  return (data as any).id as string;
}

export async function publishDocument(id: string): Promise<void> {
  // Get document type first
  const { data: doc, error: fetchErr } = await supabase
    .from('legal_documents').select('type').eq('id', id).single();
  if (fetchErr) throw fetchErr;

  // Deactivate all of same type, then activate this one
  const { error: e1 } = await supabase.from('legal_documents')
    .update({ is_active: false })
    .eq('type', (doc as any).type);
  if (e1) throw e1;

  const { error: e2 } = await supabase.from('legal_documents')
    .update({ is_active: true, published_at: new Date().toISOString() })
    .eq('id', id);
  if (e2) throw e2;
}

export async function getCountryStats(): Promise<CountryStat[]> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  // Two separate queries — subscriptions has no FK to profiles
  const [profilesRes, subsRes] = await Promise.all([
    supabase.from('profiles').select('id, country, worker_type, currency_code, created_at'),
    supabase.from('subscriptions').select('user_id, status'),
  ]);
  if (profilesRes.error) throw profilesRes.error;

  const subStatusByUser = new Map(((subsRes.data ?? []) as any[]).map((s: any) => [s.user_id, s.status]));

  const rows = (profilesRes.data ?? []) as any[];
  const map = new Map<string, CountryStat>();

  for (const p of rows) {
    const key = p.country ?? 'XX';
    if (!map.has(key)) {
      map.set(key, {
        country: key,
        total_users: 0,
        new_users_month: 0,
        active_subs: 0,
        trial_subs: 0,
        complimentary_subs: 0,
        free_users: 0,
        drivers: 0,
        motoboys: 0,
        currency_code: p.currency_code ?? null,
      });
    }
    const stat = map.get(key)!;
    stat.total_users++;

    if (new Date(p.created_at) >= monthStart) stat.new_users_month++;
    if (p.worker_type === 'motoboy') stat.motoboys++; else stat.drivers++;

    const subStatus = subStatusByUser.get(p.id);
    if (!subStatus || subStatus === 'expired' || subStatus === 'cancelled') {
      stat.free_users++;
    } else if (subStatus === 'active') {
      stat.active_subs++;
    } else if (subStatus === 'trial') {
      stat.trial_subs++;
    } else if (subStatus === 'complimentary') {
      stat.complimentary_subs++;
    }
  }

  return Array.from(map.values()).sort((a, b) => b.total_users - a.total_users);
}

export async function getConsentStats(): Promise<ConsentStats[]> {
  const { data, error } = await supabase
    .from('user_consents')
    .select('document_id, legal_documents(type,version), accepted_at')
    .order('accepted_at', { ascending: false });
  if (error) throw error;

  const rows = (data ?? []) as any[];
  const map = new Map<string, { type: string; version: string; count: number; latest: string | null }>();
  for (const r of rows) {
    const key = r.document_id as string;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, {
        type: r.legal_documents?.type ?? '',
        version: r.legal_documents?.version ?? '',
        count: 1,
        latest: r.accepted_at,
      });
    } else {
      existing.count++;
    }
  }
  return Array.from(map.entries()).map(([document_id, v]) => ({
    document_id,
    type: v.type,
    version: v.version,
    total_consents: v.count,
    latest_consent: v.latest,
  }));
}
