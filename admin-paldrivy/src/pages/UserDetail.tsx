import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import { getUserDetail, updateUserRole, updateUserProfile, getPlans, upsertSubscription, deleteUser,
  getUserShiftsPage, getUserExpensesPage, getUserFuelPage } from '../services/admin';
import { countryFlag, countryName } from '../utils/countries';
import type { Plan } from '../types';

function fmt(cents: number | null) {
  if (!cents) return 'R$ 0,00';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(d: string | null) {
  if (!d) return 'Vitalício';
  return new Date(d).toLocaleDateString('pt-BR');
}

const SUB_STATUS_COLOR: Record<string, string> = {
  active:        'bg-emerald-500/15 text-emerald-400',
  trial:         'bg-blue-500/15 text-blue-400',
  complimentary: 'bg-[#F59E0B]/15 text-[#F59E0B]',
  cancelled:     'bg-red-500/15 text-red-400',
  expired:       'bg-orange-500/15 text-orange-400',
};

const SUB_STATUS_LABEL: Record<string, string> = {
  active: 'Ativo', trial: 'Trial', complimentary: 'Gratuidade', cancelled: 'Cancelado', expired: 'Expirado',
};

const COUNTRIES = [
  'BR','US','GB','AR','CL','CO','MX','PE','UY','PY','BO','EC','VE','PT','ES','FR','DE','IT','CA','AU',
];

const PAGE_SIZE = 20;

const CURRENCIES = ['BRL','USD','GBP','EUR','ARS','CLP','COP','MXN'];
const LOCALES    = ['pt-BR','en-US','en-GB','es-419','es-ES','fr-FR','de-DE','pt-PT'];

const COUNTRY_DIAL_CODES: Record<string, string> = {
  BR: '+55', US: '+1',  GB: '+44', AR: '+54', CL: '+56', CO: '+57',
  MX: '+52', PE: '+51', UY: '+598', PY: '+595', BO: '+591', EC: '+593',
  VE: '+58', PT: '+351', ES: '+34', FR: '+33', DE: '+49', IT: '+39',
  CA: '+1',  AU: '+61',
};

const PHONE_PLACEHOLDER: Record<string, string> = {
  BR: '+55 (11) 99999-9999', US: '+1 (555) 123-4567', GB: '+44 7700 900123',
  AR: '+54 9 11 1234-5678',  MX: '+52 55 1234 5678',  CO: '+57 300 123 4567',
  CL: '+56 9 1234 5678',     PT: '+351 912 345 678',   AU: '+61 4 1234 5678',
};

interface ProfileFormProps {
  profile: any;
  email?: string;
  onSave: (patch: Record<string, string>) => Promise<void>;
}

function ProfileEditForm({ profile, email, onSave }: ProfileFormProps) {
  const [name,         setName]       = useState<string>(profile.name          ?? '');
  const [country,      setCountry]    = useState<string>(profile.country       ?? '');
  const [phone,        setPhone]      = useState<string>(() => {
    if (profile.phone) return profile.phone;
    const code = profile.country ? (COUNTRY_DIAL_CODES[profile.country] ?? '') : '';
    return code ? code + ' ' : '';
  });
  const [city,         setCity]       = useState<string>(profile.city          ?? '');
  const [state,        setState_]     = useState<string>(profile.state         ?? '');
  const [currency,     setCurrency]   = useState<string>(profile.currency_code ?? 'BRL');
  const [distUnit,     setDistUnit]   = useState<string>(profile.distance_unit ?? 'km');
  const [volUnit,      setVolUnit]    = useState<string>(profile.volume_unit   ?? 'liters');
  const [workerType,   setWorkerType] = useState<string>(profile.worker_type   ?? 'driver');
  const [locale,       setLocale]     = useState<string>(profile.locale        ?? 'pt-BR');
  const [timezone,     setTimezone]   = useState<string>(profile.timezone      ?? '');
  const [saving,       setSaving]     = useState(false);
  const [saved,        setSaved]      = useState(false);
  const prevCountryRef = useRef<string>(profile.country ?? '');

  useEffect(() => {
    const prev = prevCountryRef.current;
    prevCountryRef.current = country;
    if (prev === country) return;
    const oldCode = COUNTRY_DIAL_CODES[prev] ?? '';
    const newCode = COUNTRY_DIAL_CODES[country] ?? '';
    if (!newCode) return;
    setPhone(p => {
      const t = p.trim();
      if (!t || t === oldCode || (oldCode && t.startsWith(oldCode))) {
        const rest = oldCode && t.startsWith(oldCode) ? t.slice(oldCode.length).trimStart() : '';
        return rest ? newCode + ' ' + rest : newCode + ' ';
      }
      return p;
    });
  }, [country]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({ name, phone, country, city, state, currency_code: currency, distance_unit: distUnit, volume_unit: volUnit, worker_type: workerType, locale, timezone });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  const sel = 'w-full bg-[#0B1221] border border-white/15 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/40';
  const inp = 'w-full bg-[#0B1221] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/40';
  const lbl = 'block text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide';

  return (
    <form onSubmit={handleSave} className="bg-[#111827] rounded-xl border border-white/8 p-5 space-y-4">
      <p className="text-sm font-semibold text-white">Dados do perfil</p>

      <div className="grid sm:grid-cols-2 gap-4">
        {email && (
          <div className="sm:col-span-2">
            <label className={lbl}>E-mail (somente leitura)</label>
            <div className={`${inp} opacity-60 cursor-default select-all`}>{email}</div>
          </div>
        )}

        <div>
          <label className={lbl}>Nome completo</label>
          <input value={name} onChange={e => setName(e.target.value)} className={inp} placeholder="Nome completo" />
        </div>

        <div>
          <label className={lbl}>País</label>
          <select value={country} onChange={e => setCountry(e.target.value)} className={sel}>
            <option value="">— Não definido —</option>
            {COUNTRIES.map(c => (
              <option key={c} value={c}>{countryFlag(c)} {countryName(c)} ({c})</option>
            ))}
          </select>
        </div>

        <div>
          <label className={lbl}>Celular / WhatsApp</label>
          <input
            value={phone}
            onChange={e => setPhone(e.target.value)}
            className={inp}
            placeholder={PHONE_PLACEHOLDER[country] ?? (COUNTRY_DIAL_CODES[country] ? `${COUNTRY_DIAL_CODES[country]} ...` : '+XX ...')}
            type="tel"
          />
        </div>

        <div>
          <label className={lbl}>Cidade</label>
          <input value={city} onChange={e => setCity(e.target.value)} className={inp} placeholder="Ex: São Paulo" />
        </div>

        <div>
          <label className={lbl}>Estado / Província</label>
          <input value={state} onChange={e => setState_(e.target.value)} className={inp} placeholder="Ex: SP" />
        </div>

        <div>
          <label className={lbl}>Moeda</label>
          <select value={currency} onChange={e => setCurrency(e.target.value)} className={sel}>
            {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        <div>
          <label className={lbl}>Tipo de trabalhador</label>
          <select value={workerType} onChange={e => setWorkerType(e.target.value)} className={sel}>
            <option value="driver">🚗 Motorista (Uber, 99, táxi)</option>
            <option value="motoboy">🛵 Entregador / Motoboy</option>
          </select>
        </div>

        <div>
          <label className={lbl}>Locale</label>
          <select value={locale} onChange={e => setLocale(e.target.value)} className={sel}>
            {LOCALES.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>

        <div>
          <label className={lbl}>Distância</label>
          <select value={distUnit} onChange={e => setDistUnit(e.target.value)} className={sel}>
            <option value="km">Quilômetros (km)</option>
            <option value="mi">Milhas (mi)</option>
          </select>
        </div>

        <div>
          <label className={lbl}>Volume</label>
          <select value={volUnit} onChange={e => setVolUnit(e.target.value)} className={sel}>
            <option value="liters">Litros</option>
            <option value="gallons">Galões</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className={lbl}>Fuso horário</label>
          <input value={timezone} onChange={e => setTimezone(e.target.value)} className={inp}
            placeholder="America/Sao_Paulo" />
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button type="submit" disabled={saving}
          className="bg-[#F59E0B] text-[#0B1221] px-5 py-2 rounded-lg text-sm font-bold hover:bg-[#D97706] disabled:opacity-60">
          {saving ? 'Salvando...' : 'Salvar perfil'}
        </button>
        {saved && <span className="text-emerald-400 text-sm font-medium">✓ Salvo</span>}
      </div>
    </form>
  );
}

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const emailFromUrl = searchParams.get('email') ?? undefined;
  const [data, setData] = useState<Awaited<ReturnType<typeof getUserDetail>> | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [planId,       setPlanId]       = useState('');
  const [assignStatus, setAssignStatus] = useState<'active' | 'trial' | 'complimentary'>('active');
  const [isLifetime,   setIsLifetime]   = useState(false);
  const [endDate,      setEndDate]      = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState('');

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

  useEffect(() => { load(); }, [id]);

  async function handleRoleToggle() {
    if (!data || !id) return;
    const newRole = data.profile.role === 'admin' ? 'driver' : 'admin';
    if (!confirm(`Mudar papel para "${newRole}"?`)) return;
    setSaving(true);
    await updateUserRole(id, newRole);
    await load();
    setSaving(false);
  }

  async function handleDelete() {
    if (!id) return;
    const displayName = data?.profile?.name ?? emailFromUrl ?? id;
    if (!confirm(`Excluir permanentemente o usuário "${displayName}"?\n\nEsta ação não pode ser desfeita.`)) return;
    setSaving(true);
    try {
      await deleteUser(id);
      navigate('/users');
    } catch (e: any) {
      alert('Erro ao excluir: ' + (e?.message ?? String(e)));
      setSaving(false);
    }
  }

  async function handleProfileSave(patch: Record<string, string>) {
    if (!id) return;
    try {
      await updateUserProfile(id, patch);
      await load();
    } catch (e: any) {
      alert('Erro ao salvar: ' + (e?.message ?? String(e)));
    }
  }

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !planId) return;
    setSaving(true);
    await upsertSubscription({
      user_id: id,
      plan_id: planId,
      status: assignStatus,
      current_period_end: (assignStatus === 'complimentary' && isLifetime) ? null : endDate,
      notes: notes || undefined,
    });
    await load();
    setSaving(false);
  }

  const fieldCls = "bg-[#0B1221] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/40";

  if (loading) return <Layout title="Usuário"><div className="text-gray-500 py-8 text-center">Carregando...</div></Layout>;
  if (!data)   return <Layout title="Usuário"><div className="text-red-400 py-8 text-center">Usuário não encontrado.</div></Layout>;

  const { profile, stats } = data;
  const sub = profile.subscription;

  return (
    <Layout title={profile.name ?? 'Usuário'}>
      <div className="space-y-4 max-w-3xl">
        <button onClick={() => navigate('/users')} className="text-sm text-[#F59E0B] hover:underline">← Voltar</button>

        <div className="bg-[#111827] rounded-xl border border-white/8 p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-lg font-semibold text-white">{profile.name ?? <span className="italic text-gray-500">sem perfil</span>}</p>
              {emailFromUrl && <p className="text-sm text-gray-400 mt-0.5">{emailFromUrl}</p>}
              <p className="text-xs text-gray-600 font-mono mt-0.5">{profile.id}</p>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${profile.role === 'admin' ? 'bg-[#F59E0B]/15 text-[#F59E0B]' : 'bg-white/8 text-gray-400'}`}>
                  {profile.role}
                </span>
                {profile.country && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/8 text-gray-400 font-medium">
                    {countryFlag(profile.country)} {countryName(profile.country)}
                  </span>
                )}
                {profile.worker_type && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/8 text-gray-400">
                    {profile.worker_type === 'motoboy' ? '🛵 Entregador' : '🚗 Motorista'}
                  </span>
                )}
                {sub && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${SUB_STATUS_COLOR[sub.status] ?? 'bg-white/8 text-gray-500'}`}>
                    {(sub as any).plan?.name ?? '—'} · {SUB_STATUS_LABEL[sub.status] ?? sub.status}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-2 flex-shrink-0">
              <button onClick={handleRoleToggle} disabled={saving}
                className="text-xs border border-white/15 text-gray-300 px-3 py-1.5 rounded-lg hover:bg-white/5 disabled:opacity-60">
                {profile.role === 'admin' ? 'Remover admin' : 'Tornar admin'}
              </button>
              <button onClick={handleDelete} disabled={saving}
                className="text-xs border border-red-500/40 text-red-400 px-3 py-1.5 rounded-lg hover:bg-red-500/10 disabled:opacity-60">
                Excluir usuário
              </button>
            </div>
          </div>
          {sub && (
            <div className="mt-3 pt-3 border-t border-white/8 text-sm text-gray-400">
              {sub.status === 'complimentary' && !sub.current_period_end
                ? <span className="text-[#F59E0B] font-medium">🎁 Gratuidade vitalícia</span>
                : <>Válido até <strong className="text-white">{fmtDate(sub.current_period_end)}</strong></>
              }
              {sub.notes && <span className="ml-2 text-gray-600">— {sub.notes}</span>}
            </div>
          )}
        </div>

        <ProfileEditForm profile={profile} email={emailFromUrl} onSave={handleProfileSave} />

        <div className="bg-[#111827] rounded-xl border border-white/8 p-5">
          <p className="text-sm font-semibold text-white mb-4">Atribuir / alterar plano</p>
          <form onSubmit={handleAssign} className="space-y-3">
            <div className="flex gap-3 flex-wrap">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Plano</label>
                <select value={planId} onChange={e => setPlanId(e.target.value)} className={fieldCls}>
                  {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tipo</label>
                <div className="flex gap-2">
                  {([['active','Pago'],['trial','Trial'],['complimentary','🎁 Gratuidade']] as const).map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setAssignStatus(v)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                        assignStatus === v
                          ? 'bg-[#F59E0B] text-[#0B1221] border-[#F59E0B] font-bold'
                          : 'border-white/15 text-gray-400 hover:bg-white/5'
                      }`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {assignStatus === 'complimentary' && (
              <label className="flex items-center gap-2 bg-[#F59E0B]/8 border border-[#F59E0B]/20 rounded-lg px-3 py-2.5 cursor-pointer">
                <input type="checkbox" checked={isLifetime} onChange={e => setIsLifetime(e.target.checked)} className="accent-[#F59E0B]" />
                <span className="text-sm text-[#F59E0B]/90 font-medium">Gratuidade vitalícia (sem expiração)</span>
              </label>
            )}

            {!(assignStatus === 'complimentary' && isLifetime) && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">Válido até</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                  className={fieldCls} />
              </div>
            )}

            <div>
              <label className="block text-xs text-gray-500 mb-1">Observações</label>
              <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Motivo, referência…"
                className={`${fieldCls} w-full`} />
            </div>

            <button type="submit" disabled={saving}
              className="bg-[#F59E0B] text-[#0B1221] px-5 py-2 rounded-lg text-sm font-bold hover:bg-[#D97706] disabled:opacity-60">
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </form>
        </div>

        {stats && (
          <div className="bg-[#111827] rounded-xl border border-white/8 p-5">
            <p className="text-sm font-semibold text-white mb-4">Resumo financeiro</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Turnos total</p>
                <p className="text-xl font-bold text-white tabular-nums mt-0.5">{stats.total_shifts}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Bruto total</p>
                <p className="text-xl font-bold text-emerald-400 tabular-nums mt-0.5">{fmt(stats.total_gross_cents)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Despesas total</p>
                <p className="text-xl font-bold text-red-400 tabular-nums mt-0.5">{fmt(stats.total_expenses_cents)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Combustível total</p>
                <p className="text-xl font-bold text-[#F59E0B] tabular-nums mt-0.5">{fmt(stats.total_fuel_cents)}</p>
              </div>
            </div>
            <div className="border-t border-white/8 pt-3 grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-600 mb-0.5">Turnos este mês</p>
                <p className="text-sm font-semibold text-white">{stats.month_shifts}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600 mb-0.5">Bruto este mês</p>
                <p className="text-sm font-semibold text-emerald-400">{fmt(stats.month_gross_cents)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-600 mb-0.5">Despesas este mês</p>
                <p className="text-sm font-semibold text-red-400">{fmt(stats.month_expenses_cents)}</p>
              </div>
            </div>
          </div>
        )}

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
      </div>
    </Layout>
  );
}
