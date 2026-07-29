// Edge Function: community-push
// Internal only — called by pg_net triggers on user_follows/post_likes/
// post_comments/dm_messages (see the Comunidade migrations). No user JWT is
// available at call time, so this function is pinned to verify_jwt = false
// in config.toml, same as stripe-webhook/send-auth-email.

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

type Lang = 'pt' | 'en' | 'es';

function normLang(locale: string | null | undefined): Lang {
  const l = (locale ?? 'pt').toLowerCase();
  if (l.startsWith('en')) return 'en';
  if (l.startsWith('es')) return 'es';
  return 'pt';
}

const CONTENT: Record<'follow' | 'like' | 'comment' | 'dm', Record<Lang, (actor: string) => { title: string; body: string }>> = {
  follow: {
    pt: (actor) => ({ title: 'Novo seguidor', body: `${actor} começou a seguir você.` }),
    en: (actor) => ({ title: 'New follower', body: `${actor} started following you.` }),
    es: (actor) => ({ title: 'Nuevo seguidor', body: `${actor} empezó a seguirte.` }),
  },
  like: {
    pt: (actor) => ({ title: 'Nova curtida', body: `${actor} curtiu seu post.` }),
    en: (actor) => ({ title: 'New like', body: `${actor} liked your post.` }),
    es: (actor) => ({ title: 'Nuevo me gusta', body: `${actor} le gustó tu post.` }),
  },
  comment: {
    pt: (actor) => ({ title: 'Novo comentário', body: `${actor} comentou no seu post.` }),
    en: (actor) => ({ title: 'New comment', body: `${actor} commented on your post.` }),
    es: (actor) => ({ title: 'Nuevo comentario', body: `${actor} comentó tu post.` }),
  },
  dm: {
    pt: (actor) => ({ title: actor, body: 'Nova mensagem' }),
    en: (actor) => ({ title: actor, body: 'New message' }),
    es: (actor) => ({ title: actor, body: 'Nuevo mensaje' }),
  },
};

Deno.serve(async (req) => {
  try {
    const { type, recipient_id, actor_id } = await req.json();
    if (!type || !recipient_id || !actor_id) {
      return new Response(JSON.stringify({ error: 'missing fields' }), { status: 400 });
    }

    const [{ data: recipient }, { data: actor }] = await Promise.all([
      supabase.from('profiles').select('push_token, locale').eq('id', recipient_id).single(),
      supabase.from('profiles').select('name').eq('id', actor_id).single(),
    ]);

    if (!recipient?.push_token) {
      return new Response(JSON.stringify({ sent: false, reason: 'no push token' }), { status: 200 });
    }

    const lang = normLang(recipient.locale);
    const { title, body } = CONTENT[type as keyof typeof CONTENT][lang](actor?.name ?? 'Alguém');

    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify([{ to: recipient.push_token, title, body, sound: 'default' }]),
    });

    return new Response(JSON.stringify({ sent: true, result: await res.json() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
