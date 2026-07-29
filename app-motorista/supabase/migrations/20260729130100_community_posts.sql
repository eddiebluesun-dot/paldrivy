-- Comunidade: posts, likes, comments, views, translation cache, hide/report

CREATE TABLE community_posts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  shift_date      date NOT NULL,
  caption         text,
  photo_url       text,
  stats_snapshot  jsonb NOT NULL,
  likes_count     integer NOT NULL DEFAULT 0,
  comments_count  integer NOT NULL DEFAULT 0,
  views_count     integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_community_posts_user_created ON community_posts(user_id, created_at DESC);
CREATE INDEX idx_community_posts_created       ON community_posts(created_at DESC);

CREATE TABLE post_likes (
  post_id     uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE post_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id     uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_post_comments_post ON post_comments(post_id, created_at);

CREATE TABLE post_views (
  post_id     uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  viewed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE post_translations (
  post_id           uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  lang              text NOT NULL,
  translated_text   text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, lang)
);

CREATE TABLE hidden_posts (
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  post_id     uuid NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE community_posts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_likes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_views         ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_translations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE hidden_posts       ENABLE ROW LEVEL SECURITY;

CREATE POLICY "community_posts: leitura sem bloqueio/oculto"
  ON community_posts FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks
      WHERE (blocker_id = auth.uid() AND blocked_id = community_posts.user_id)
         OR (blocker_id = community_posts.user_id AND blocked_id = auth.uid())
    )
    AND NOT EXISTS (
      SELECT 1 FROM hidden_posts
      WHERE hidden_posts.user_id = auth.uid() AND hidden_posts.post_id = community_posts.id
    )
  );

CREATE POLICY "community_posts: criar proprio"
  ON community_posts FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "community_posts: apagar proprio"
  ON community_posts FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "post_likes: ve a propria curtida"
  ON post_likes FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "post_likes: curtir"
  ON post_likes FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "post_likes: descurtir"
  ON post_likes FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "post_comments: leitura sem bloqueio"
  ON post_comments FOR SELECT
  USING (
    auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks
      WHERE (blocker_id = auth.uid() AND blocked_id = post_comments.user_id)
         OR (blocker_id = post_comments.user_id AND blocked_id = auth.uid())
    )
  );

CREATE POLICY "post_comments: comentar"
  ON post_comments FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "post_comments: apagar proprio"
  ON post_comments FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "post_views: registrar propria visualizacao"
  ON post_views FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "post_translations: leitura publica"
  ON post_translations FOR SELECT USING (auth.uid() IS NOT NULL);
-- No INSERT policy: only the translate-post edge function (service role) writes here.

CREATE POLICY "hidden_posts: ve os proprios"
  ON hidden_posts FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "hidden_posts: ocultar/denunciar"
  ON hidden_posts FOR INSERT WITH CHECK (user_id = auth.uid());

-- ─── Counters ───────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_post_like_counter() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE community_posts SET likes_count = likes_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE community_posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_post_like_counter
  AFTER INSERT OR DELETE ON post_likes
  FOR EACH ROW EXECUTE FUNCTION fn_post_like_counter();

CREATE OR REPLACE FUNCTION fn_post_comment_counter() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE community_posts SET comments_count = comments_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_post_comment_counter
  AFTER INSERT ON post_comments
  FOR EACH ROW EXECUTE FUNCTION fn_post_comment_counter();

CREATE OR REPLACE FUNCTION fn_post_view_counter() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE community_posts SET views_count = views_count + 1 WHERE id = NEW.post_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_post_view_counter
  AFTER INSERT ON post_views
  FOR EACH ROW EXECUTE FUNCTION fn_post_view_counter();

-- ─── Push notifications (like / comment) ────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_notify_like() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM community_posts WHERE id = NEW.post_id;
  IF v_owner IS NOT NULL AND v_owner <> NEW.user_id THEN
    PERFORM net.http_post(
      url := 'https://ucxkvxqpkknxotbfxgeu.supabase.co/functions/v1/community-push',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object('type', 'like', 'recipient_id', v_owner, 'actor_id', NEW.user_id, 'post_id', NEW.post_id)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_like
  AFTER INSERT ON post_likes
  FOR EACH ROW EXECUTE FUNCTION fn_notify_like();

CREATE OR REPLACE FUNCTION fn_notify_comment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM community_posts WHERE id = NEW.post_id;
  IF v_owner IS NOT NULL AND v_owner <> NEW.user_id THEN
    PERFORM net.http_post(
      url := 'https://ucxkvxqpkknxotbfxgeu.supabase.co/functions/v1/community-push',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object('type', 'comment', 'recipient_id', v_owner, 'actor_id', NEW.user_id, 'post_id', NEW.post_id, 'comment_body', NEW.body)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_comment
  AFTER INSERT ON post_comments
  FOR EACH ROW EXECUTE FUNCTION fn_notify_comment();
