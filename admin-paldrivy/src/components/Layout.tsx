import { ReactNode, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const NAV = [
  { to: '/',             label: 'Dashboard',    icon: '▦' },
  { to: '/users',        label: 'Usuários',     icon: '👥' },
  { to: '/stats',        label: 'Estatísticas', icon: '🌍' },
  { to: '/plans',        label: 'Planos',       icon: '🏷️' },
  { to: '/subscriptions',label: 'Assinaturas',  icon: '📋' },
  { to: '/legal',        label: 'Legal / LGPD', icon: '⚖️' },
];

interface LayoutProps {
  children: ReactNode;
  title: string;
}

export default function Layout({ children, title }: LayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [signing, setSigning] = useState(false);

  async function signOut() {
    setSigning(true);
    await supabase.auth.signOut();
    navigate('/login');
  }

  return (
    <div className="flex h-screen bg-[#0B1221] overflow-hidden">
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 bg-[#111827] border-r border-white/8 flex flex-col">
        <div className="px-5 py-5 border-b border-white/8 flex items-center gap-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[#F59E0B]/15 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 64 64" fill="none">
              <rect x="18" y="14" width="5" height="36" rx="2.5" fill="#F59E0B"/>
              <rect x="18" y="14" width="22" height="5" rx="2.5" fill="#F59E0B"/>
              <rect x="18" y="29" width="18" height="5" rx="2.5" fill="#F59E0B"/>
            </svg>
          </div>
          <div>
            <span className="text-white font-bold text-base tracking-tight leading-none">PalDrivy</span>
            <span className="block text-[10px] text-[#F59E0B]/70 font-medium uppercase tracking-widest leading-none mt-0.5">Admin</span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {NAV.map(({ to, label, icon }) => {
            const active = location.pathname === to;
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  active
                    ? 'bg-[#F59E0B]/12 text-[#F59E0B]'
                    : 'text-gray-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span className="text-base w-5 text-center">{icon}</span>
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pb-4 border-t border-white/8 pt-3">
          <button
            onClick={signOut}
            disabled={signing}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-white/5 hover:text-gray-300 transition-colors"
          >
            <span className="w-5 text-center">🚪</span>
            {signing ? 'Saindo...' : 'Sair'}
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-14 bg-[#111827] border-b border-white/8 flex items-center px-6">
          <h1 className="text-sm font-semibold text-white">{title}</h1>
        </header>
        <main className="flex-1 overflow-y-auto p-6 bg-[#0B1221]">
          {children}
        </main>
      </div>
    </div>
  );
}
