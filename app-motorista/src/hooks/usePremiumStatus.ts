import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export function usePremiumStatus(userId: string | null) {
  const [isPremium, setIsPremium] = useState(false);
  const [isTrial, setIsTrial] = useState(false);
  const [periodEnd, setPeriodEnd] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    supabase.from('subscriptions').select('status, current_period_end')
      .eq('user_id', userId).maybeSingle()
      .then(({ data: sub }) => {
        const isPaidStatus = sub?.status === 'active' || sub?.status === 'trial' || sub?.status === 'complimentary';
        const notExpired = !sub?.current_period_end || new Date(sub.current_period_end) >= new Date();
        setIsPremium(isPaidStatus && notExpired);
        // Trial unlocks features like a paid plan, but isn't a completed purchase —
        // the subscribe CTA should keep showing so trial users can pay before it ends.
        setIsTrial(sub?.status === 'trial' && notExpired);
        setPeriodEnd(sub?.current_period_end ?? null);
      });
  }, [userId]);

  return { isPremium, isTrial, periodEnd };
}
