import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { getCountryStats } from '../services/admin';
import type { CountryStat } from '../types';
import { countryFlag, countryName } from '../utils/countries';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';

const ACCENT = '#F59E0B';
const COLORS = ['#F59E0B', '#3B82F6', '#10B981', '#8B5CF6', '#EF4444', '#EC4899', '#14B8A6', '#6366F1'];

const CHART_TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 8,
  background: '#1F2937',
  border: '1px solid rgba(255,255,255,0.1)',
  color: '#fff',
};

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[#111827] rounded-xl border border-white/8 p-5">
      <p className="text-xs text-gray-500 font-semibold uppercase tracking-wide mb-1">{label}</p>
      <p className="text-2xl font-bold text-white tabular-nums">{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function Stats() {
  const [stats, setStats] = useState<CountryStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    getCountryStats()
      .then(setStats)
      .catch(() => setError('Erro ao carregar estatísticas.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Layout title="Estatísticas por País"><div className="text-gray-500 py-8 text-center">Carregando...</div></Layout>;
  if (error) return <Layout title="Estatísticas por País"><div className="text-red-400 py-8 text-center">{error}</div></Layout>;

  const totalUsers  = stats.reduce((s, c) => s + c.total_users, 0);
  const totalActive = stats.reduce((s, c) => s + c.active_subs, 0);
  const totalNew    = stats.reduce((s, c) => s + c.new_users_month, 0);
  const topCountry  = stats[0];

  const barData = stats.map(c => ({
    name: `${countryFlag(c.country)} ${c.country}`,
    Usuários: c.total_users,
    Ativos: c.active_subs,
    Trial: c.trial_subs,
    Free: c.free_users,
  }));

  const workerData = stats.map(c => ({
    name: `${countryFlag(c.country)} ${c.country}`,
    Motoristas: c.drivers,
    Entregadores: c.motoboys,
  }));

  const pieData = stats.map((c, i) => ({
    name: `${countryFlag(c.country)} ${countryName(c.country)}`,
    value: c.total_users,
    color: COLORS[i % COLORS.length],
  }));

  return (
    <Layout title="Estatísticas por País">
      <div className="space-y-6 max-w-6xl">

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Kpi label="Total de usuários" value={totalUsers} />
          <Kpi label="Países ativos" value={stats.length} />
          <Kpi label="Assinaturas ativas" value={totalActive} />
          <Kpi label="Novos este mês" value={totalNew} sub={topCountry ? `maior: ${countryFlag(topCountry.country)} ${countryName(topCountry.country)}` : undefined} />
        </div>

        <div className="bg-[#111827] rounded-xl border border-white/8 p-5">
          <p className="text-sm font-semibold text-white mb-4">Usuários por país</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={barData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#6B7280' }} />
              <YAxis tick={{ fontSize: 12, fill: '#6B7280' }} allowDecimals={false} />
              <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
              <Legend wrapperStyle={{ fontSize: 12, color: '#9CA3AF' }} />
              <Bar dataKey="Usuários" fill={ACCENT}    radius={[4, 4, 0, 0]} />
              <Bar dataKey="Ativos"   fill="#10B981"   radius={[4, 4, 0, 0]} />
              <Bar dataKey="Trial"    fill="#3B82F6"   radius={[4, 4, 0, 0]} />
              <Bar dataKey="Free"     fill="#374151"   radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          <div className="bg-[#111827] rounded-xl border border-white/8 p-5">
            <p className="text-sm font-semibold text-white mb-4">Tipo de trabalhador por país</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={workerData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#6B7280' }} />
                <YAxis tick={{ fontSize: 12, fill: '#6B7280' }} allowDecimals={false} />
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
                <Legend wrapperStyle={{ fontSize: 12, color: '#9CA3AF' }} />
                <Bar dataKey="Motoristas"   fill={ACCENT}  radius={[4, 4, 0, 0]} />
                <Bar dataKey="Entregadores" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-[#111827] rounded-xl border border-white/8 p-5">
            <p className="text-sm font-semibold text-white mb-4">Distribuição de usuários</p>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {pieData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#111827] rounded-xl border border-white/8 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#0D1628] border-b border-white/8">
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">País</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Novos/mês</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Ativos</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Trial</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Gratu.</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Free</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">🚗</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">🛵</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Moeda</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((c, i) => (
                <tr key={c.country} className={`border-b border-white/5 ${i % 2 === 1 ? 'bg-white/2' : ''}`}>
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2">
                      <span className="text-lg">{countryFlag(c.country)}</span>
                      <span>
                        <span className="font-medium text-white">{countryName(c.country)}</span>
                        <span className="ml-1.5 text-xs text-gray-600 font-mono">{c.country}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-white tabular-nums">{c.total_users}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-xs font-medium ${c.new_users_month > 0 ? 'text-emerald-400' : 'text-gray-600'}`}>
                      {c.new_users_month > 0 ? `+${c.new_users_month}` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.active_subs > 0 ? (
                      <span className="text-xs bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded-full font-medium">{c.active_subs}</span>
                    ) : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.trial_subs > 0 ? (
                      <span className="text-xs bg-blue-500/15 text-blue-400 px-1.5 py-0.5 rounded-full font-medium">{c.trial_subs}</span>
                    ) : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {c.complimentary_subs > 0 ? (
                      <span className="text-xs bg-[#F59E0B]/15 text-[#F59E0B] px-1.5 py-0.5 rounded-full font-medium">{c.complimentary_subs}</span>
                    ) : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-500 text-xs tabular-nums">{c.free_users || '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-500 text-xs tabular-nums">{c.drivers || '—'}</td>
                  <td className="px-4 py-3 text-right text-gray-500 text-xs tabular-nums">{c.motoboys || '—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 font-mono">{c.currency_code ?? '—'}</td>
                </tr>
              ))}
              <tr className="bg-[#0D1628] border-t border-white/15 font-semibold text-white">
                <td className="px-4 py-3">Total</td>
                <td className="px-4 py-3 text-right tabular-nums">{totalUsers}</td>
                <td className="px-4 py-3 text-right text-emerald-400">+{totalNew}</td>
                <td className="px-4 py-3 text-right tabular-nums">{totalActive}</td>
                <td className="px-4 py-3 text-right tabular-nums">{stats.reduce((s, c) => s + c.trial_subs, 0)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{stats.reduce((s, c) => s + c.complimentary_subs, 0)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{stats.reduce((s, c) => s + c.free_users, 0)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{stats.reduce((s, c) => s + c.drivers, 0)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{stats.reduce((s, c) => s + c.motoboys, 0)}</td>
                <td className="px-4 py-3">—</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
    </Layout>
  );
}
