-- Comunidade: social graph (profile extension, follows, blocks)

CREATE TABLE community_profiles (
  user_id          uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  bio              text,
  avatar_url       text,
  cover_url        text,
  followers_count  integer NOT NULL DEFAULT 0,
  following_count  integer NOT NULL DEFAULT 0
);

CREATE TABLE user_follows (
  follower_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  followed_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);

CREATE TABLE user_blocks (
  blocker_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  blocked_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

CREATE INDEX idx_user_follows_followed ON user_follows(followed_id);
CREATE INDEX idx_user_blocks_blocked   ON user_blocks(blocked_id);

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE community_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_follows       ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_blocks        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "community_profiles: leitura publica"
  ON community_profiles FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "community_profiles: upsert proprio"
  ON community_profiles FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY "community_profiles: atualiza proprio"
  ON community_profiles FOR UPDATE USING (user_id = auth.uid());

CREATE POLICY "user_follows: leitura publica"
  ON user_follows FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "user_follows: seguir respeita bloqueio"
  ON user_follows FOR INSERT
  WITH CHECK (
    follower_id = auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks
      WHERE (blocker_id = auth.uid() AND blocked_id = followed_id)
         OR (blocker_id = followed_id AND blocked_id = auth.uid())
    )
  );

CREATE POLICY "user_follows: deixar de seguir"
  ON user_follows FOR DELETE USING (follower_id = auth.uid());

CREATE POLICY "user_blocks: ve os proprios bloqueios"
  ON user_blocks FOR SELECT USING (blocker_id = auth.uid());

CREATE POLICY "user_blocks: bloquear"
  ON user_blocks FOR INSERT WITH CHECK (blocker_id = auth.uid());

CREATE POLICY "user_blocks: desbloquear"
  ON user_blocks FOR DELETE USING (blocker_id = auth.uid());

-- ─── Counters (denormalized followers_count/following_count) ───────────────

CREATE OR REPLACE FUNCTION fn_follow_counters() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO community_profiles (user_id, following_count)
      VALUES (NEW.follower_id, 1)
      ON CONFLICT (user_id) DO UPDATE SET following_count = community_profiles.following_count + 1;
    INSERT INTO community_profiles (user_id, followers_count)
      VALUES (NEW.followed_id, 1)
      ON CONFLICT (user_id) DO UPDATE SET followers_count = community_profiles.followers_count + 1;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE community_profiles SET following_count = GREATEST(following_count - 1, 0) WHERE user_id = OLD.follower_id;
    UPDATE community_profiles SET followers_count = GREATEST(followers_count - 1, 0) WHERE user_id = OLD.followed_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_follow_counters
  AFTER INSERT OR DELETE ON user_follows
  FOR EACH ROW EXECUTE FUNCTION fn_follow_counters();

-- ─── Push notification on new follower (fire-and-forget via pg_net) ─────────
-- The `community-push` edge function is deployed in Task 6; this trigger just
-- calls it. Safe to create now — pg_net.http_post fails silently into its own
-- request-log table if the function isn't deployed yet, it never blocks the
-- INSERT into user_follows.

CREATE OR REPLACE FUNCTION fn_notify_follow() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM net.http_post(
    url := 'https://ucxkvxqpkknxotbfxgeu.supabase.co/functions/v1/community-push',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('type', 'follow', 'recipient_id', NEW.followed_id, 'actor_id', NEW.follower_id)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_follow
  AFTER INSERT ON user_follows
  FOR EACH ROW EXECUTE FUNCTION fn_notify_follow();
