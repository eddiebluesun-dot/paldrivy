import { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import Layout from '../components/Layout';
import { getDashboardStats, getUserGrowth } from '../services/admin';
import type { DashboardStats } from '../types';

function fmt(cents: number) {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: boolean;
  green?: boolean;
}

function StatCard({ label, value, sub, accent, green }: StatCardProps) {
  const valueColor = accent ? 'text-[#F59E0B]' : green ? 'text-emerald-400' : 'text-white';
  return (
    <div className="bg-[#111827] rounded-xl border border-white/8 p-5">
      <p className="text-xs text-gray-500 font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 tabular-nums ${valueColor}`}>{value}</p>
      {sub && <p className="text-xs text-gray-600 mt-1">{sub}</p>}
    </div>
  );
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [growth, setGrowth] = useState<{ date: string; count: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([getDashboardStats(), getUserGrowth()])
      .then(([s, g]) => { setStats(s); setGrowth(g); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <Layout title="Dashboard">
      {loading ? (
        <div className="flex items-center justify-center h-40 text-gray-500">Carregando...</div>
      ) : stats ? (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard label="Total de usuários" value={stats.total_users} />
            <StatCard label="Novos este mês" value={stats.new_users_month} accent />
            <StatCard label="Assinaturas ativas" value={stats.active_subscriptions} green />
            <StatCard label="Usuários gratuitos" value={stats.free_users} />
            <StatCard label="Turnos este mês" value={stats.shifts_month} />
            <StatCard
              label="Faturamento bruto"
              value={fmt(stats.gross_month_cents)}
              sub="soma de todos os motoristas"
              green
            />
          </div>

          <div className="bg-[#111827] rounded-xl border border-white/8 p-5">
            <p className="text-sm font-semibold text-white mb-4">Novos usuários — últimos 30 dias</p>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={growth} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#4B5563' }}
                  tickFormatter={d => d.slice(5)}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 10, fill: '#4B5563' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, background: '#1F2937', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                  formatter={(v: number) => [v, 'Novos usuários']}
                  labelFormatter={l => `Data: ${l}`}
                />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="#F59E0B"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        <p className="text-red-400">Erro ao carregar dados.</p>
      )}
    </Layout>
  );
}
