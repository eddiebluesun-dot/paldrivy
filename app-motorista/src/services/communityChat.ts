import { supabase } from '../lib/supabase';
import { normalizeConversationPair } from '../utils/communityChat';
import { uploadCommunityImage } from './communityStorage';

export interface ChatConversation {
  id: string;
  other_user_id: string;
  other_name: string;
  other_avatar_url: string | null;
  last_message: string | null;
  last_message_at: string | null;
}

export async function getConversations(userId: string): Promise<ChatConversation[]> {
  const { data: convos, error } = await supabase
    .from('dm_conversations').select('id, user_a, user_b')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);
  if (error) throw error;
  if (!convos || convos.length === 0) return [];

  const otherIds = convos.map(c => (c.user_a === userId ? c.user_b : c.user_a));
  const [{ data: profiles }, { data: communities }, { data: lastMessages }] = await Promise.all([
    supabase.from('profiles').select('id, name').in('id', otherIds),
    supabase.from('community_profiles').select('user_id, avatar_url').in('user_id', otherIds),
    supabase.from('dm_messages').select('conversation_id, body, created_at')
      .in('conversation_id', convos.map(c => c.id)).order('created_at', { ascending: false }),
  ]);
  const nameById = new Map((profiles ?? []).map(p => [p.id, p.name]));
  const avatarById = new Map((communities ?? []).map(c => [c.user_id, c.avatar_url]));
  const lastByConvo = new Map<string, { body: string | null; created_at: string }>();
  for (const m of lastMessages ?? []) {
    if (!lastByConvo.has(m.conversation_id)) lastByConvo.set(m.conversation_id, m);
  }

  return convos.map(c => {
    const otherId = c.user_a === userId ? c.user_b : c.user_a;
    const last = lastByConvo.get(c.id);
    return {
      id: c.id, other_user_id: otherId,
      other_name: nameById.get(otherId) ?? '', other_avatar_url: avatarById.get(otherId) ?? null,
      last_message: last?.body ?? null, last_message_at: last?.created_at ?? null,
    };
  }).sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
}

export async function getOrCreateConversation(userId: string, otherUserId: string): Promise<string> {
  const { user_a, user_b } = normalizeConversationPair(userId, otherUserId);

  const { data: existing } = await supabase
    .from('dm_conversations').select('id').eq('user_a', user_a).eq('user_b', user_b).maybeSingle();
  if (existing) return existing.id;

  const { data, error } = await supabase
    .from('dm_conversations').insert({ user_a, user_b }).select('id').single();
  if (error) throw error;
  return data.id;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  image_url: string | null;
  created_at: string;
}

export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('dm_messages').select('id, conversation_id, sender_id, body, image_url, created_at')
    .eq('conversation_id', conversationId).order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function sendMessage(
  conversationId: string,
  senderId: string,
  input: { body?: string; imageUri?: string },
): Promise<void> {
  let image_url: string | undefined;
  if (input.imageUri) {
    image_url = await uploadCommunityImage(senderId, input.imageUri, 'post', `dm-${Date.now()}`);
  }
  const { error } = await supabase.from('dm_messages').insert({
    conversation_id: conversationId, sender_id: senderId,
    body: input.body || null, image_url: image_url ?? null,
  });
  if (error) throw error;
}

export function subscribeToConversation(
  conversationId: string,
  onMessage: (msg: ChatMessage) => void,
): () => void {
  const channel = supabase
    .channel(`dm:${conversationId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'dm_messages', filter: `conversation_id=eq.${conversationId}` },
      (payload) => onMessage(payload.new as ChatMessage),
    )
    .subscribe();

  return () => { supabase.removeChannel(channel); };
}
