import { useEffect, useState } from 'react';
import { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { getAutoLocale } from '../utils/autoLocale';

// Bare functions for use in screens — no listener overhead
export const authSignIn = (email: string, password: string) =>
  supabase.auth.signInWithPassword({ email, password });

// Captures the device's auto-detected locale into user_metadata at signup time.
// No profile exists yet at this point (it's only created during onboarding), so
// this is the only way transactional emails sent before onboarding — the signup
// confirmation email and the incomplete-signup recovery reminder — can be
// localized instead of always falling back to Portuguese.
export const authSignUp = (email: string, password: string) =>
  supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: 'https://app.paldrivy.com',
      data: { locale: getAutoLocale().locale },
    },
  });

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
