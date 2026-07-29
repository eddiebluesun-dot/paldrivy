import { supabase } from '../lib/supabase';
import { getDayDetail } from './dashboard';
import { buildPlatformBreakdown, computeCommunityMetrics, type PlatformBreakdownItem, type CommunityMetrics } from '../utils/communityStats';
import { uploadCommunityImage } from './communityStorage';
import type { SupportedLang } from '../utils/communityTranslation';

export interface CommunityStatsSnapshot {
  date: string;
  platforms: PlatformBreakdownItem[];
  expenses_cents: number;
  metrics: CommunityMetrics;
}

export async function buildStatsSnapshotForDate(userId: string, dateStr: string): Promise<CommunityStatsSnapshot> {
  const detail = await getDayDetail(userId, dateStr);

  const { data: shiftsWithPlatforms } = await supabase
    .from('shifts')
    .select('platforms, rides_count, gross_cents, net_cents, duration_seconds, odometer_start_meters, odometer_end_meters')
    .eq('user_id', userId)
    .gte('started_at', `${dateStr}T00:00:00`)
    .lte('started_at', `${dateStr}T23:59:59.999`)
    .not('ended_at', 'is', null);

  const rows = shiftsWithPlatforms ?? [];
  const flatPlatforms = rows.flatMap(
    (r) => (r.platforms ?? []) as Array<{ platform_name: string; amount_cents: number }>,
  );
  const platforms = buildPlatformBreakdown(flatPlatforms);

  const gross_cents = detail.shifts.reduce((s, sh) => s + (sh.gross_cents ?? 0), 0);
  const net_cents = detail.shifts.reduce((s, sh) => s + (sh.net_cents ?? 0), 0);
  const duration_seconds = detail.shifts.reduce((s, sh) => s + (sh.duration_seconds ?? 0), 0);
  const km_meters = detail.shifts.reduce(
    (s, sh) => s + ((sh.odometer_end_meters ?? 0) - (sh.odometer_start_meters ?? 0)), 0,
  );
  const rides_count = rows.reduce((s, r) => s + (r.rides_count ?? 0), 0);

  const metrics = computeCommunityMetrics({ gross_cents, net_cents, duration_seconds, km_meters, rides_count });

  return { date: dateStr, platforms, expenses_cents: detail.expenses_cents, metrics };
}

export async function createPost(
  userId: string,
  input: { dateStr: string; caption: string; photoUri?: string },
): Promise<string> {
  const stats_snapshot = await buildStatsSnapshotForDate(userId, input.dateStr);

  const { data, error } = await supabase
    .from('community_posts')
    .insert({ user_id: userId, shift_date: input.dateStr, caption: input.caption || null, stats_snapshot })
    .select('id')
    .single();
  if (error) throw error;

  if (input.photoUri) {
    const photo_url = await uploadCommunityImage(userId, input.photoUri, 'post', data.id);
    await supabase.from('community_posts').update({ photo_url }).eq('id', data.id);
  }

  return data.id;
}

export interface CommunityPost {
  id: string;
  user_id: string;
  caption: string | null;
  photo_url: string | null;
  stats_snapshot: CommunityStatsSnapshot;
  likes_count: number;
  comments_count: number;
  views_count: number;
  created_at: string;
  author: { name: string; avatar_url: string | null; city: string | null; state: string | null; country: string | null; locale: string };
  liked_by_me: boolean;
}

async function hydratePosts(viewerId: string, rows: any[]): Promise<CommunityPost[]> {
  if (rows.length === 0) return [];
  const userIds = Array.from(new Set(rows.map(r => r.user_id)));

  const [{ data: profiles }, { data: communities }, { data: myLikes }] = await Promise.all([
    supabase.from('profiles').select('id, name, city, state, country, locale').in('id', userIds),
    supabase.from('community_profiles').select('user_id, avatar_url').in('user_id', userIds),
    supabase.from('post_likes').select('post_id').eq('user_id', viewerId).in('post_id', rows.map(r => r.id)),
  ]);
  const profileById = new Map((profiles ?? []).map(p => [p.id, p]));
  const avatarById = new Map((communities ?? []).map(c => [c.user_id, c.avatar_url]));
  const likedSet = new Set((myLikes ?? []).map(l => l.post_id));

  return rows.map(r => {
    const p = profileById.get(r.user_id);
    return {
      id: r.id, user_id: r.user_id, caption: r.caption, photo_url: r.photo_url,
      stats_snapshot: r.stats_snapshot, likes_count: r.likes_count, comments_count: r.comments_count,
      views_count: r.views_count, created_at: r.created_at,
      author: {
        name: p?.name ?? '', avatar_url: avatarById.get(r.user_id) ?? null,
        city: p?.city ?? null, state: p?.state ?? null, country: p?.country ?? null,
        locale: p?.locale ?? 'pt-BR',
      },
      liked_by_me: likedSet.has(r.id),
    };
  });
}

export async function getFeed(viewerId: string, opts?: { limit?: number; before?: string }): Promise<CommunityPost[]> {
  let query = supabase.from('community_posts').select('*').order('created_at', { ascending: false }).limit(opts?.limit ?? 20);
  if (opts?.before) query = query.lt('created_at', opts.before);
  const { data, error } = await query;
  if (error) throw error;
  return hydratePosts(viewerId, data ?? []);
}

export async function getUserPosts(viewerId: string, targetUserId: string): Promise<CommunityPost[]> {
  const { data, error } = await supabase
    .from('community_posts').select('*').eq('user_id', targetUserId).order('created_at', { ascending: false });
  if (error) throw error;
  return hydratePosts(viewerId, data ?? []);
}

export async function toggleLike(userId: string, postId: string, like: boolean): Promise<void> {
  if (like) {
    const { error } = await supabase.from('post_likes').insert({ post_id: postId, user_id: userId });
    if (error) throw error;
  } else {
    const { error } = await supabase.from('post_likes').delete().eq('post_id', postId).eq('user_id', userId);
    if (error) throw error;
  }
}

export interface PostComment {
  id: string; user_id: string; body: string; created_at: string;
  author_name: string; author_avatar_url: string | null;
}

export async function getComments(postId: string): Promise<PostComment[]> {
  const { data: comments, error } = await supabase
    .from('post_comments').select('id, user_id, body, created_at').eq('post_id', postId).order('created_at', { ascending: true });
  if (error) throw error;
  if (!comments || comments.length === 0) return [];

  const userIds = Array.from(new Set(comments.map(c => c.user_id)));
  const [{ data: profiles }, { data: communities }] = await Promise.all([
    supabase.from('profiles').select('id, name').in('id', userIds),
    supabase.from('community_profiles').select('user_id, avatar_url').in('user_id', userIds),
  ]);
  const nameById = new Map((profiles ?? []).map(p => [p.id, p.name]));
  const avatarById = new Map((communities ?? []).map(c => [c.user_id, c.avatar_url]));

  return comments.map(c => ({
    ...c,
    author_name: nameById.get(c.user_id) ?? '',
    author_avatar_url: avatarById.get(c.user_id) ?? null,
  }));
}

export async function addComment(userId: string, postId: string, body: string): Promise<void> {
  const { error } = await supabase.from('post_comments').insert({ post_id: postId, user_id: userId, body });
  if (error) throw error;
}

export async function recordView(userId: string, postId: string): Promise<void> {
  await supabase.from('post_views').insert({ post_id: postId, user_id: userId }); // ON CONFLICT via PK — ignore duplicate errors
}

export async function getTranslatedCaption(postId: string, targetLang: SupportedLang): Promise<string> {
  const { data, error } = await supabase.functions.invoke('translate-post', { body: { post_id: postId, target_lang: targetLang } });
  if (error) throw error;
  return data.translated_text as string;
}
