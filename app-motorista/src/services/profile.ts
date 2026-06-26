import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
  return data;
}

export async function upsertProfile(profile: Partial<Profile> & { id: string }): Promise<void> {
  await supabase.from('profiles').upsert(profile);
}

export async function markOnboardingDone(userId: string): Promise<void> {
  await supabase.from('profiles').update({ onboarding_done: true }).eq('id', userId);
}
