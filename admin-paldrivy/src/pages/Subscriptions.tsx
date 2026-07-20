import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { getSubscriptions, getPlans, cancelSubscription, upsertSubscription } from '../services/admin';
import type { Subscription, Plan, SubscriptionStatus } from '../types';

const STATUS_OPTS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Todos' },
  { value: 'active', label: 'Ativo' },
  { value: 'trial', label: 'Trial' },
  { value: 'complimentary', label: 'Gratuidade' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'expired', label: 'Expirado' },
];

const STATUS_COLOR: Record<string, string> = {
  active:        'bg-emerald-500/15 text-emerald-400',
  trial:         'bg-blue-500/15 text-blue-400',
  complimentary: 'bg-[#F59E0B]/15 text-[#F59E0B]',
  cancelled:     'bg-red-500/15 text-red-400',
  expired:       'bg-orange-500/15 text-orange-400',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Ativo', trial: 'Trial', complimentary: 'Gratuidade',
  cancelled: 'Cancelado', expired: 'Expirado',
};

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR');
}

function endDateDisplay(end: string | null, status: SubscriptionStatus) {
  if (status === 'complimentary' && !end) return <span className="text-[#F59E0B] font-medium">Vitalício</span>;
  if (!end) return '—';
  return fmtDate(end);
}

interface AssignModalProps {
  plans: Plan[];
  onSave: (data: { user_id: string; plan_id: string; status: string; current_period_end: string | null; notes?: string }) => Promise<void>;
  onCancel: () => void;
}

function AssignModal({ plans, onSave, onCancel }: AssignModalProps) {
  const [userId, setUserId] = useState('');
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const [status, setStatus] = useState<string>('active');
  const [isLifetime, setIsLifetime] = useState(false);
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  });
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const showEndDate = !isLifetime;
  const isComplimentary = status === 'complimentary';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!userId.trim()) return;
    setSaving(true);
    await onSave({
      user_id: userId.trim(),
      plan_id: planId,
      status,
      current_period_end: (isComplimentary && isLifetime) ? null : endDate,
      notes: notes || undefined,
    });
    setSaving(false);
  }

  const inputCls = "w-full bg-[#0B1221] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/40 focus:border-[#F59E0B]/40";

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-[#111827] border border-white/10 rounded-2xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-base font-semibold text-white mb-4">Atribuir / alterar assinatura</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">User ID (UUID)</label>
            <input required value={userId} onChange={e => setUserId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              className={`${inputCls} font-mono`} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Plano</label>
            <select value={planId} onChange={e => setPlanId(e.target.value)} className={inputCls}>
              {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Tipo</label>
            <div className="flex gap-2 flex-wrap">
              {[
                { value: 'active', label: 'Pago' },
                { value: 'trial', label: 'Trial' },
                { value: 'complimentary', label: '🎁 Gratuidade' },
              ].map(opt => (
                <button key={opt.value} type="button" onClick={() => setStatus(opt.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    status === opt.value
                      ? 'bg-[#F59E0B] text-[#0B1221] border-[#F59E0B] font-bold'
                      : 'border-white/15 text-gray-400 hover:bg-white/5'
                  }`}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {isComplimentary && (
            <div className="flex items-center gap-3 bg-[#F59E0B]/8 border border-[#F59E0B]/20 rounded-lg px-3 py-2.5">
              <input type="checkbox" id="lifetime" checked={isLifetime} onChange={e => setIsLifetime(e.target.checked)}
                className="accent-[#F59E0B]" />
              <label htmlFor="lifetime" className="text-sm text-[#F59E0B]/90 font-medium cursor-pointer">
                Gratuidade vitalícia (sem data de expiração)
              </label>
            </div>
          )}

          {showEndDate && (
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1">
                {isComplimentary ? 'Válida até' : 'Período até'}
              </label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className={inputCls} />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-400 mb-1">Observações</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Motivo, referência, etc."
              className={inputCls} />
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

export default function Subscriptions() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);

  async function load() {
    setLoading(true);
    const [s, p] = await Promise.all([getSubscriptions(statusFilter), getPlans()]);
    setSubs(s);
    setPlans(p);
    setLoading(false);
  }

  useEffect(() => { load(); }, [statusFilter]);

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

  return (
    <Layout title="Assinaturas">
      <div className="space-y-4">
        <div className="flex justify-between gap-3 flex-wrap">
          <div className="flex gap-2 flex-wrap">
            {STATUS_OPTS.map(({ value, label }) => (
              <button key={value} onClick={() => setStatusFilter(value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  statusFilter === value
                    ? 'bg-[#F59E0B] text-[#0B1221] border-[#F59E0B] font-bold'
                    : 'border-white/15 text-gray-400 hover:bg-white/5'
                }`}>
                {label}
              </button>
            ))}
          </div>
          <button onClick={() => setAssigning(true)}
            className="bg-[#F59E0B] text-[#0B1221] px-4 py-2 rounded-lg text-sm font-bold hover:bg-[#D97706]">
            + Atribuir
          </button>
        </div>

        <div className="bg-[#111827] rounded-xl border border-white/8 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0D1628] border-b border-white/8">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Usuário</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Plano</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Validade</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Obs.</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-500">Carregando...</td></tr>
              ) : subs.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-500">Nenhuma assinatura encontrada.</td></tr>
              ) : subs.map(sub => (
                <tr key={sub.id} className="border-b border-white/5 hover:bg-white/3">
                  <td className="px-4 py-3 font-medium text-white">
                    {(sub as any).profile?.name ?? sub.user_id.slice(0, 8) + '…'}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{(sub as any).plan?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[sub.status] ?? 'bg-white/5 text-gray-500'}`}>
                      {STATUS_LABEL[sub.status] ?? sub.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-sm">
                    {endDateDisplay(sub.current_period_end, sub.status)}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs max-w-[160px] truncate">
                    {sub.notes ?? ''}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {(sub.status === 'active' || sub.status === 'complimentary' || sub.status === 'trial') && (
                      <button onClick={() => handleCancel(sub.id)}
                        className="text-xs text-red-400 hover:underline">
                        Cancelar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-600">{subs.length} assinatura(s)</p>
      </div>

      {assigning && (
        <AssignModal plans={plans} onSave={handleAssign} onCancel={() => setAssigning(false)} />
      )}
    </Layout>
  );
}
