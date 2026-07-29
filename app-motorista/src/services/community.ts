import { supabase } from '../lib/supabase';

export interface CommunityProfile {
  user_id: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_url: string | null;
  followers_count: number;
  following_count: number;
}

// profiles and community_profiles have no FK to each other (only a shared PK),
// so this follows the project's existing two-query + merge pattern (see the
// getSubscriptions() bugfix precedent in admin-paldrivy).
export async function getCommunityProfile(userId: string): Promise<CommunityProfile | null> {
  const [{ data: profile }, { data: community }] = await Promise.all([
    supabase.from('profiles').select('id, name, city, state, country').eq('id', userId).maybeSingle(),
    supabase.from('community_profiles').select('bio, avatar_url, cover_url, followers_count, following_count').eq('user_id', userId).maybeSingle(),
  ]);
  if (!profile) return null;
  return {
    user_id: profile.id,
    name: profile.name,
    city: profile.city,
    state: profile.state,
    country: profile.country,
    bio: community?.bio ?? null,
    avatar_url: community?.avatar_url ?? null,
    cover_url: community?.cover_url ?? null,
    followers_count: community?.followers_count ?? 0,
    following_count: community?.following_count ?? 0,
  };
}

export async function updateCommunityProfile(
  userId: string,
  patch: { bio?: string; avatar_url?: string; cover_url?: string },
): Promise<void> {
  const { error } = await supabase.from('community_profiles').upsert(
    { user_id: userId, ...patch },
    { onConflict: 'user_id' },
  );
  if (error) throw error;
}

export async function isFollowing(followerId: string, followedId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_follows').select('follower_id')
    .eq('follower_id', followerId).eq('followed_id', followedId).maybeSingle();
  return !!data;
}

export async function followUser(followerId: string, followedId: string): Promise<void> {
  const { error } = await supabase.from('user_follows').insert({ follower_id: followerId, followed_id: followedId });
  if (error) throw error;
}

export async function unfollowUser(followerId: string, followedId: string): Promise<void> {
  const { error } = await supabase.from('user_follows').delete()
    .eq('follower_id', followerId).eq('followed_id', followedId);
  if (error) throw error;
}

export async function isBlocked(blockerId: string, blockedId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_blocks').select('blocker_id')
    .eq('blocker_id', blockerId).eq('blocked_id', blockedId).maybeSingle();
  return !!data;
}

export async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabase.from('user_blocks').insert({ blocker_id: blockerId, blocked_id: blockedId });
  if (error) throw error;
  // Blocking severs any existing follow relationship in both directions.
  await supabase.from('user_follows').delete()
    .or(`and(follower_id.eq.${blockerId},followed_id.eq.${blockedId}),and(follower_id.eq.${blockedId},followed_id.eq.${blockerId})`);
}

export async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  const { error } = await supabase.from('user_blocks').delete()
    .eq('blocker_id', blockerId).eq('blocked_id', blockedId);
  if (error) throw error;
}

export async function hidePost(userId: string, postId: string, reason?: string): Promise<void> {
  const { error } = await supabase.from('hidden_posts').insert({ user_id: userId, post_id: postId, reason: reason ?? null });
  if (error) throw error;
}

export async function searchUsers(query: string, excludeUserId: string): Promise<CommunityProfile[]> {
  if (!query.trim()) return [];
  const { data: profiles } = await supabase
    .from('profiles').select('id, name, city, state, country')
    .ilike('name', `%${query}%`).neq('id', excludeUserId).limit(20);
  if (!profiles || profiles.length === 0) return [];

  const ids = profiles.map(p => p.id);
  const { data: communities } = await supabase
    .from('community_profiles').select('user_id, bio, avatar_url, cover_url, followers_count, following_count')
    .in('user_id', ids);
  const byId = new Map((communities ?? []).map(c => [c.user_id, c]));

  return profiles.map(p => {
    const c = byId.get(p.id);
    return {
      user_id: p.id, name: p.name, city: p.city, state: p.state, country: p.country,
      bio: c?.bio ?? null, avatar_url: c?.avatar_url ?? null, cover_url: c?.cover_url ?? null,
      followers_count: c?.followers_count ?? 0, following_count: c?.following_count ?? 0,
    };
  });
}
