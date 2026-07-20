import { useEffect, useState, ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { supabase } from './lib/supabase';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Users from './pages/Users';
import UserDetail from './pages/UserDetail';
import Plans from './pages/Plans';
import Subscriptions from './pages/Subscriptions';
import LegalDocs from './pages/LegalDocs';
import Stats from './pages/Stats';

type AuthState = 'loading' | 'admin' | 'nonadmin' | 'unauthenticated';

function AuthGuard({ state, children }: { state: AuthState; children: ReactNode }) {
  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-[#0B1221] flex items-center justify-center">
        <span className="text-[#F59E0B] text-sm">Carregando...</span>
      </div>
    );
  }
  if (state !== 'admin') return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('loading');

  useEffect(() => {
    async function checkAuth(userId: string | undefined) {
      if (!userId) { setAuthState('unauthenticated'); return; }
      const { data } = await supabase.from('profiles').select('role').eq('id', userId).single();
      setAuthState(data?.role === 'admin' ? 'admin' : 'nonadmin');
    }

    supabase.auth.getSession().then(({ data }) => {
      checkAuth(data.session?.user.id);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      checkAuth(session?.user.id);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={
          authState === 'admin' ? <Navigate to="/" replace /> : <Login />
        } />
        <Route path="/" element={<AuthGuard state={authState}><Dashboard /></AuthGuard>} />
        <Route path="/users" element={<AuthGuard state={authState}><Users /></AuthGuard>} />
        <Route path="/users/:id" element={<AuthGuard state={authState}><UserDetail /></AuthGuard>} />
        <Route path="/plans" element={<AuthGuard state={authState}><Plans /></AuthGuard>} />
        <Route path="/subscriptions" element={<AuthGuard state={authState}><Subscriptions /></AuthGuard>} />
        <Route path="/legal"  element={<AuthGuard state={authState}><LegalDocs /></AuthGuard>} />
        <Route path="/stats"  element={<AuthGuard state={authState}><Stats /></AuthGuard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
