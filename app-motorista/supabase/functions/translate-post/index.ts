// Edge Function: translate-post
// Client calls this (with a normal session JWT) when a viewer opens a post
// caption written in a different language than their own. Caches results in
// post_translations so the same post+lang pair is never sent to the
// translation API twice.

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const LANG_TO_MYMEMORY: Record<string, string> = { pt: 'pt-BR', en: 'en-GB', es: 'es-ES' };

Deno.serve(async (req) => {
  try {
    const { post_id, target_lang } = await req.json();
    if (!post_id || !target_lang || !LANG_TO_MYMEMORY[target_lang]) {
      return new Response(JSON.stringify({ error: 'invalid post_id/target_lang' }), { status: 400 });
    }

    const { data: cached } = await supabase
      .from('post_translations')
      .select('translated_text')
      .eq('post_id', post_id)
      .eq('lang', target_lang)
      .maybeSingle();

    if (cached) {
      return new Response(JSON.stringify({ translated_text: cached.translated_text }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: post } = await supabase
      .from('community_posts')
      .select('caption, user_id')
      .eq('id', post_id)
      .single();

    if (!post?.caption) {
      return new Response(JSON.stringify({ translated_text: '' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: author } = await supabase.from('profiles').select('locale').eq('id', post.user_id).single();
    const sourceLang = LANG_TO_MYMEMORY[(author?.locale ?? 'pt').slice(0, 2)] ?? 'pt-BR';
    const targetLangPair = LANG_TO_MYMEMORY[target_lang];

    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(post.caption)}&langpair=${sourceLang}|${targetLangPair}&de=contato@grupo3es.com`;
    const res = await fetch(url);
    const json = await res.json();
    const translated: string = json?.responseData?.translatedText ?? post.caption;

    await supabase.from('post_translations').insert({ post_id, lang: target_lang, translated_text: translated });

    return new Response(JSON.stringify({ translated_text: translated }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
