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
