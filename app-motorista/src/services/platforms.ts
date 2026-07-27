import { supabase } from '../lib/supabase';

export interface UserPlatform {
  id: string;
  platform_name: string;
  sort_order: number;
}

export const PRESET_PLATFORMS = [
  'Uber', '99', 'iFood', 'Rappi', 'Loggi', 'InDriver', 'Lalamove', 'Shopper',
];

export async function getUserPlatforms(userId: string): Promise<UserPlatform[]> {
  const { data } = await supabase
    .from('user_platforms')
    .select('id, platform_name, sort_order')
    .eq('user_id', userId)
    .order('sort_order', { ascending: true });
  return (data ?? []) as UserPlatform[];
}

export async function saveUserPlatforms(userId: string, names: string[]): Promise<void> {
  await supabase.from('user_platforms').delete().eq('user_id', userId);
  if (names.length === 0) return;
  await supabase.from('user_platforms').insert(
    names.map((platform_name, sort_order) => ({ user_id: userId, platform_name, sort_order })),
  );
}
