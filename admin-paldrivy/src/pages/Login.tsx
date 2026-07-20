import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const { data, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      setError('Email ou senha inválidos.');
      setLoading(false);
      return;
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('id', data.user.id)
      .single();

    if (!profile || profile.role !== 'admin') {
      await supabase.auth.signOut();
      setError('Acesso restrito a administradores.');
      setLoading(false);
      return;
    }

    navigate('/');
  }

  return (
    <div className="min-h-screen bg-[#0B1221] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#F59E0B]/15 mb-4">
            <svg width="28" height="28" viewBox="0 0 64 64" fill="none">
              <rect x="18" y="14" width="5" height="36" rx="2.5" fill="#F59E0B"/>
              <rect x="18" y="14" width="22" height="5" rx="2.5" fill="#F59E0B"/>
              <rect x="18" y="29" width="18" height="5" rx="2.5" fill="#F59E0B"/>
            </svg>
          </div>
          <span className="block text-white font-bold text-2xl tracking-tight">PalDrivy</span>
          <p className="text-gray-400 mt-1 text-sm">Painel Administrativo</p>
        </div>

        <div className="bg-[#111827] rounded-2xl border border-white/10 p-8">
          <h2 className="text-base font-semibold text-white mb-6">Entrar</h2>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-[#1F2937] border border-white/15 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/50 focus:border-[#F59E0B]/50"
                placeholder="admin@paldrivy.app"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Senha</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full bg-[#1F2937] border border-white/15 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/50 focus:border-[#F59E0B]/50"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-[#F59E0B] text-[#0B1221] py-2.5 rounded-lg text-sm font-bold hover:bg-[#D97706] transition-colors disabled:opacity-60"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
