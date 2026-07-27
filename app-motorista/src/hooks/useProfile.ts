import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { getProfile } from '../services/profile';
import type { Profile } from '../types';

export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  async function refetch() {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const p = await getProfile(data.user.id);
      setProfile(p);
    }
  }

  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data }) => {
        if (data.user) {
          return getProfile(data.user.id).then((p) => {
            setProfile(p);
            setLoading(false);
          });
        } else {
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
  }, []);

  return { profile, loading, setProfile, refetch };
}
