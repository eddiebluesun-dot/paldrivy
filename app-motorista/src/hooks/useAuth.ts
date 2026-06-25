import { useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

// Bare functions for use in screens — no listener overhead
export const authSignIn = (email: string, password: string) =>
  supabase.auth.signInWithPassword({ email, password });

export const authSignUp = (email: string, password: string) =>
  supabase.auth.signUp({ email, password });

export const authSignOut = () => supabase.auth.signOut();

// Hook with session listener — use only in root layout auth guard
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  return { session, loading, signOut: authSignOut };
}
