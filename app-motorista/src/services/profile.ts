import { supabase } from '../lib/supabase';
import type { Profile } from '../types';

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).single();
  return data;
}

export async function upsertProfile(profile: Partial<Profile> & { id: string }): Promise<void> {
  const { error } = await supabase.from('profiles').upsert(profile);
  if (error) throw error;
}

export async function markOnboardingDone(userId: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ onboarding_done: true }).eq('id', userId);
  if (error) throw error;
}

export async function markTourSeen(userId: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ tour_seen: true }).eq('id', userId);
  if (error) throw error;
}
