import { supabase } from '../lib/supabase';

export type CommunityImageKind = 'avatar' | 'cover' | 'post';

function pathFor(userId: string, kind: CommunityImageKind, postId?: string): string {
  if (kind === 'avatar') return `${userId}/avatar.jpg`;
  if (kind === 'cover') return `${userId}/cover.jpg`;
  if (!postId) throw new Error('postId is required for kind "post"');
  return `${userId}/posts/${postId}.jpg`;
}

export async function uploadCommunityImage(
  userId: string,
  localUri: string,
  kind: CommunityImageKind,
  postId?: string,
): Promise<string> {
  const path = pathFor(userId, kind, postId);
  const response = await fetch(localUri);
  const blob = await response.blob();

  const { error } = await supabase.storage.from('community').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) throw error;

  const { data } = supabase.storage.from('community').getPublicUrl(path);
  return data.publicUrl;
}
