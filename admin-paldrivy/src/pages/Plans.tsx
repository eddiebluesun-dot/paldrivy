import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { getPlans, upsertPlan, togglePlanActive } from '../services/admin';
import type { Plan } from '../types';

const PRICE_CURRENCIES: { code: string; symbol: string; label: string; flag: string }[] = [
  { code: 'BRL', symbol: 'R$', label: 'Brasil',        flag: '🇧🇷' },
  { code: 'USD', symbol: '$',  label: 'United States', flag: '🇺🇸' },
  { code: 'GBP', symbol: '£',  label: 'United Kingdom',flag: '🇬🇧' },
  { code: 'EUR', symbol: '€',  label: 'Europa',        flag: '🇪🇺' },
];

function fmtPrice(cents: number, currency: string): string {
  if (cents === 0) return '—';
  const locales: Record<string, string> = { BRL: 'pt-BR', USD: 'en-US', GBP: 'en-GB', EUR: 'de-DE' };
  return (cents / 100).toLocaleString(locales[currency] ?? 'en-US', {
    style: 'currency', currency, minimumFractionDigits: 2,
  });
}

function PriceBadges({ prices, interval }: { prices: Record<string, number>; interval: string }) {
  const suffix = interval === 'monthly' ? '/mês' : '/ano';
  const active = PRICE_CURRENCIES.filter(c => (prices[c.code] ?? 0) > 0);
  if (active.length === 0) return <p className="text-gray-600 text-sm italic">Sem preço definido</p>;
  return (
    <div className="flex flex-wrap gap-2 mt-1">
      {active.map(c => (
        <span key={c.code} className="flex items-center gap-1 text-sm">
          <span>{c.flag}</span>
          <span className="font-bold text-[#F59E0B]">{fmtPrice(prices[c.code], c.code)}</span>
          <span className="text-gray-500 text-xs">{suffix}</span>
        </span>
      ))}
    </div>
  );
}

const EMPTY: Partial<Plan> = {
  name: '', description: '', price_cents: 0, prices: {},
  interval: 'monthly', features: [], is_active: true, sort_order: 0,
};

interface PlanFormProps {
  initial: Partial<Plan>;
  onSave: (plan: Partial<Plan>) => Promise<void>;
  onCancel: () => void;
}

function PlanForm({ initial, onSave, onCancel }: PlanFormProps) {
  const [form, setForm] = useState<Partial<Plan>>(initial);
  const [prices, setPrices] = useState<Record<string, string>>(() => {
    const p = initial.prices ?? {};
    const out: Record<string, string> = {};
    for (const c of PRICE_CURRENCIES) {
      out[c.code] = p[c.code] ? (p[c.code] / 100).toFixed(2) : '';
    }
    return out;
  });
  const [featuresRaw, setFeaturesRaw] = useState((initial.features ?? []).join('\n'));
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const pricesCents: Record<string, number> = {};
    for (const c of PRICE_CURRENCIES) {
      const val = parseFloat(prices[c.code].replace(',', '.'));
      if (!isNaN(val) && val > 0) pricesCents[c.code] = Math.round(val * 100);
    }
    await onSave({
      ...form,
      prices: pricesCents,
      price_cents: pricesCents['BRL'] ?? 0,
      features: featuresRaw.split('\n').map(s => s.trim()).filter(Boolean),
    });
    setSaving(false);
  }

  const inputCls = "w-full bg-[#0B1221] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/40 focus:border-[#F59E0B]/40";

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4 overflow-y-auto py-8">
      <div className="bg-[#111827] border border-white/10 rounded-2xl shadow-xl w-full max-w-lg p-6">
        <h2 className="text-base font-semibold text-white mb-5">
          {form.id ? 'Editar plano' : 'Novo plano'}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Nome</label>
              <input required value={form.name ?? ''}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                className={inputCls} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">Intervalo</label>
              <select value={form.interval ?? 'monthly'}
                onChange={e => setForm(p => ({ ...p, interval: e.target.value as 'monthly' | 'yearly' }))}
                className={inputCls}>
                <option value="monthly">Mensal</option>
                <option value="yearly">Anual</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Descrição</label>
            <input value={form.description ?? ''}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              className={inputCls} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-2">
              Preços por país — deixe em branco para não exibir
            </label>
            <div className="rounded-xl border border-white/10 overflow-hidden divide-y divide-white/5">
              {PRICE_CURRENCIES.map(c => {
                const preview = (() => {
                  const v = parseFloat(prices[c.code].replace(',', '.'));
                  if (isNaN(v) || v <= 0) return null;
                  return fmtPrice(Math.round(v * 100), c.code);
                })();
                return (
                  <div key={c.code} className="flex items-center gap-3 px-4 py-3 bg-[#0D1628]">
                    <span className="text-xl w-7 flex-shrink-0">{c.flag}</span>
                    <div className="w-10 flex-shrink-0">
                      <span className="text-xs font-semibold text-gray-400 uppercase">{c.code}</span>
                      <p className="text-xs text-gray-600">{c.label}</p>
                    </div>
                    <div className="flex-1 relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">
                        {c.symbol}
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={prices[c.code]}
                        onChange={e => setPrices(p => ({ ...p, [c.code]: e.target.value }))}
                        placeholder="0.00"
                        className="w-full pl-8 bg-[#111827] border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/40"
                      />
                    </div>
                    {preview && (
                      <span className="text-sm font-semibold text-[#F59E0B] w-28 text-right flex-shrink-0">
                        {preview}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Recursos (um por linha)</label>
            <textarea rows={4} value={featuresRaw}
              onChange={e => setFeaturesRaw(e.target.value)}
              className={`${inputCls} resize-none`} />
          </div>

          <div className="flex items-center gap-2">
            <input type="checkbox" id="active" checked={form.is_active ?? true}
              onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))}
              className="accent-[#F59E0B]" />
            <label htmlFor="active" className="text-sm text-gray-300">Ativo</label>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onCancel}
              className="flex-1 border border-white/15 text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-white/5">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-[#F59E0B] text-[#0B1221] py-2 rounded-lg text-sm font-bold hover:bg-[#D97706] disabled:opacity-60">
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Plans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Plan> | null>(null);

  async function load() {
    setLoading(true);
    setPlans(await getPlans());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleSave(plan: Partial<Plan>) {
    await upsertPlan(plan);
    setEditing(null);
    load();
  }

  async function handleToggle(plan: Plan) {
    await togglePlanActive(plan.id, !plan.is_active);
    load();
  }

  return (
    <Layout title="Planos">
      <div className="space-y-4">
        <div className="flex justify-end">
          <button onClick={() => setEditing(EMPTY)}
            className="bg-[#F59E0B] text-[#0B1221] px-4 py-2 rounded-lg text-sm font-bold hover:bg-[#D97706]">
            + Novo plano
          </button>
        </div>

        {loading ? (
          <div className="text-gray-500 py-8 text-center">Carregando...</div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {plans.map(plan => (
              <div key={plan.id}
                className={`bg-[#111827] rounded-xl border p-5 flex flex-col ${plan.is_active ? 'border-white/10' : 'border-white/5 opacity-50'}`}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-semibold text-white">{plan.name}</p>
                    {plan.description && <p className="text-xs text-gray-500 mt-0.5">{plan.description}</p>}
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ml-2 ${plan.is_active ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/5 text-gray-500'}`}>
                    {plan.is_active ? 'Ativo' : 'Inativo'}
                  </span>
                </div>

                <PriceBadges prices={plan.prices ?? {}} interval={plan.interval} />

                <p className="text-xs text-gray-600 mt-2">{plan.subscriber_count ?? 0} assinantes</p>

                <ul className="mt-3 space-y-1 flex-1">
                  {(plan.features ?? []).map((f, i) => (
                    <li key={i} className="text-xs text-gray-400 flex items-center gap-1.5">
                      <span className="text-[#F59E0B]">✓</span>{f}
                    </li>
                  ))}
                </ul>

                <div className="flex gap-2 mt-4">
                  <button onClick={() => setEditing(plan)}
                    className="flex-1 border border-white/10 text-gray-300 py-1.5 rounded-lg text-xs font-medium hover:bg-white/5">
                    Editar
                  </button>
                  <button onClick={() => handleToggle(plan)}
                    className="flex-1 border border-white/10 text-gray-300 py-1.5 rounded-lg text-xs font-medium hover:bg-white/5">
                    {plan.is_active ? 'Desativar' : 'Ativar'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <PlanForm initial={editing} onSave={handleSave} onCancel={() => setEditing(null)} />
      )}
    </Layout>
  );
}
