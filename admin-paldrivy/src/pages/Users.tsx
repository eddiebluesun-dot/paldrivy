import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import { getUsers, getPlans } from '../services/admin';
import type { UserWithSubscription, Plan } from '../types';
import { countryFlag, countryName } from '../utils/countries';

function statusBadge(sub: UserWithSubscription['subscription']) {
  if (!sub) return <span className="text-xs bg-white/8 text-gray-500 px-2 py-0.5 rounded-full">Free</span>;
  const map: Record<string, string> = {
    active:        'bg-emerald-500/15 text-emerald-400',
    cancelled:     'bg-red-500/15 text-red-400',
    expired:       'bg-orange-500/15 text-orange-400',
    trial:         'bg-blue-500/15 text-blue-400',
    complimentary: 'bg-[#F59E0B]/15 text-[#F59E0B]',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${map[sub.status] ?? 'bg-white/8 text-gray-500'}`}>
      {sub.plan?.name ?? sub.status}
    </span>
  );
}

const inputCls = "bg-[#1F2937] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/40 focus:border-[#F59E0B]/40";

export default function Users() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<UserWithSubscription[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [countryFilter, setCountryFilter] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [u, p] = await Promise.all([getUsers(search, planFilter), getPlans()]);
    setUsers(u);
    setPlans(p);
    setLoading(false);
  }, [search, planFilter]);

  useEffect(() => { load(); }, [load]);

  const countries = Array.from(
    new Set(users.map(u => u.country).filter(Boolean) as string[])
  ).sort();

  const filtered = countryFilter
    ? users.filter(u => u.country === countryFilter)
    : users;

  return (
    <Layout title="Usuários">
      <div className="space-y-4">
        <div className="flex gap-3 flex-wrap">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome, email ou telefone..."
            className={`${inputCls} w-72`}
          />
          <select
            value={planFilter}
            onChange={e => setPlanFilter(e.target.value)}
            className={inputCls}
          >
            <option value="">Todos os planos</option>
            {plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select
            value={countryFilter}
            onChange={e => setCountryFilter(e.target.value)}
            className={inputCls}
          >
            <option value="">Todos os países</option>
            {countries.map(c => (
              <option key={c} value={c}>{countryFlag(c)} {countryName(c)}</option>
            ))}
          </select>
        </div>

        <div className="bg-[#111827] rounded-xl border border-white/8 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0D1628] border-b border-white/8">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Nome / E-mail</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Telefone</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">País</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Cidade / Estado</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Tipo</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Plano</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Papel</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Desde</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-500">Carregando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-500">Nenhum usuário encontrado.</td></tr>
              ) : filtered.map(u => (
                <tr
                  key={u.id}
                  onClick={() => navigate(`/users/${u.id}?email=${encodeURIComponent(u.email ?? '')}`)}
                  className="border-b border-white/5 hover:bg-white/3 cursor-pointer"
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-white">
                      {u.name ?? <span className="text-gray-500 italic">sem perfil</span>}
                    </div>
                    {u.email && (
                      <div className="text-xs text-gray-500 mt-0.5">{u.email}</div>
                    )}
                    {u.has_profile === false && (
                      <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-400 font-semibold">onboarding incompleto</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{u.phone ?? <span className="text-gray-600">—</span>}</td>
                  <td className="px-4 py-3">
                    {u.country ? (
                      <span className="flex items-center gap-1.5 text-gray-300">
                        <span className="text-base">{countryFlag(u.country)}</span>
                        <span className="text-xs font-mono text-gray-500">{u.country}</span>
                      </span>
                    ) : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {u.city || u.state
                      ? <span>{[u.city, u.state].filter(Boolean).join(', ')}</span>
                      : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-sm">{u.worker_type === 'motoboy' ? '🛵' : '🚗'}</span>
                  </td>
                  <td className="px-4 py-3">{statusBadge(u.subscription)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.role === 'admin' ? 'bg-[#F59E0B]/15 text-[#F59E0B]' : 'bg-white/8 text-gray-400'}`}>
                      {u.role}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-600">{filtered.length} usuário(s)</p>
      </div>
    </Layout>
  );
}
