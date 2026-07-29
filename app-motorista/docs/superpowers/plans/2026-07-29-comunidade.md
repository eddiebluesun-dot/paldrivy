# Comunidade (Community) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Comunidade social feature (feed of auto-generated shift-stat posts, follow/block, likes/comments, real-time 1:1 chat, auto-translated captions) for PalDrivy's app-motorista, plus the nav restructure it requires and one unrelated small cleanup (removing the confusing manual-shift-entry FAB).

**Architecture:** Normalized Postgres tables (matching the project's existing style — see `shifts`/`expenses`/`subscriptions`) with per-table RLS, denormalized counters kept current via triggers, and `pg_net`-driven triggers that fire an internal edge function for push notifications (same pattern already proven in this project via `fn_create_premium_trial`/webhooks). Client is React Native/Expo Router; new screens live under `app/community/*` (pattern already used by the top-level `app/report.tsx`) plus one new bottom tab `app/(tabs)/community.tsx`.

**Tech Stack:** Supabase (Postgres + RLS + Realtime + Storage + Edge Functions/Deno), React Native + Expo Router, react-i18next, `expo-image-picker` (new dependency), Jest for pure-function unit tests (matches existing `__tests__/utils/*` convention — this codebase has zero component/service tests, only pure-function tests, so new Supabase-calling service code is verified manually, not unit-tested).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-07-29-comunidade-design.md` — every requirement below traces back to it.
- Follow the project's two-query pattern for cross-table data (no FK-based PostgREST embeds across tables lacking a real FK — see `admin.ts` bugfix precedent) except where a real FK exists.
- New Supabase Edge Functions default to `verify_jwt = true` (client calls with a real session) **except** `community-push`, which is invoked only by a `pg_net` trigger with no user JWT available — pin `verify_jwt = false` for it in `supabase/config.toml`, exactly like the existing `stripe-webhook`/`send-auth-email` entries.
- All new tables get Row Level Security enabled; policy names follow the existing Portuguese `"table: description"` convention (see `supabase/rls_policies.sql`).
- i18n keys go under a new `community` namespace in `locales/{pt,en,es}.json`; user-generated content (captions, chat messages) is never run through i18n — it goes through the translation edge function instead.
- Colors/spacing/radius come from `src/theme.ts` (`Colors`, `Spacing`, `Radius`) — no new hardcoded design tokens.
- Deploy commands run from `app-motorista/` (`supabase functions deploy <name>`, `supabase db query --linked "..."`), matching how this session already deployed `stripe-checkout`/`stripe-webhook`.

---

### Task 1: Remove the manual-shift-entry FAB

**Files:**
- Modify: `app/(tabs)/shifts.tsx:723-726` (remove the FAB block), and the `<ShiftWizard .../>` render + `wizardVisible` state it drives.

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks — this is an isolated cleanup.

- [ ] **Step 1: Read the full render tree around the FAB and the wizard**

Read `app/(tabs)/shifts.tsx` lines 700-740 to see exactly how `wizardVisible` is declared/used, so removal doesn't leave dead state.

- [ ] **Step 2: Remove the FAB and the wizard invocation**

Delete:
```tsx
{/* FAB — lançamento manual via wizard */}
<TouchableOpacity style={styles.fab} onPress={() => setWizardVisible(true)}>
  <Ionicons name="flash" size={24} color={Colors.onAccent} />
</TouchableOpacity>

<ShiftWizard
  visible={wizardVisible}
  ...
  onClose={() => setWizardVisible(false)}
/>
```
Also remove the `const [wizardVisible, setWizardVisible] = useState(false);` declaration and the now-unused `import { ShiftWizard } from ...` and `styles.fab` StyleSheet entry (search the file for `fab:` in the `StyleSheet.create` block and delete that key).

- [ ] **Step 3: Verify no other references remain**

Run:
```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber/app-motorista" && grep -n "wizardVisible\|ShiftWizard\|styles.fab" "app/(tabs)/shifts.tsx"
```
Expected: no output (all references removed). If `ShiftWizard.tsx`/`createManualShift` (in `src/services/shifts.ts`) have no other importers, leave the files in place — deleting unused-but-working service code is out of scope for this task (YAGNI cuts both ways: don't delete what isn't part of this task's stated scope).

- [ ] **Step 4: Manual verification**

Start the app (`npx expo start`), open the Turnos tab, confirm the FAB is gone and the tab still renders/scrolls normally.

- [ ] **Step 5: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/"app/(tabs)/shifts.tsx" && git commit -m "$(cat <<'EOF'
fix: remove confusing manual-shift-entry FAB from Turnos

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Migration — social graph (profiles, follows, blocks)

**Files:**
- Create: `supabase/migrations/20260729130000_community_social_graph.sql`

**Interfaces:**
- Produces: tables `community_profiles(user_id, bio, avatar_url, cover_url, followers_count, following_count)`, `user_follows(follower_id, followed_id, created_at)`, `user_blocks(blocker_id, blocked_id, created_at)`. Later tasks (7, 12) read/write these directly.

- [ ] **Step 1: Write the migration file**

```sql
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
-- The `community-push` edge function is deployed in Task 7; this trigger just
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
```

- [ ] **Step 2: Apply the migration to the linked project**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber/app-motorista" && supabase db push --linked
```
Expected: output lists `20260729130000_community_social_graph.sql` as applied, no errors.

- [ ] **Step 3: Verify the tables and policies exist**

```bash
supabase db query --linked "select tablename from pg_tables where schemaname='public' and tablename in ('community_profiles','user_follows','user_blocks');"
```
Expected: all three rows returned.

- [ ] **Step 4: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/supabase/migrations/20260729130000_community_social_graph.sql && git commit -m "$(cat <<'EOF'
feat: add Comunidade social graph tables (profiles/follows/blocks)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Migration — posts & interactions

**Files:**
- Create: `supabase/migrations/20260729130100_community_posts.sql`

**Interfaces:**
- Consumes: `profiles(id)` (existing), `community_profiles(user_id)` (Task 2).
- Produces: `community_posts`, `post_likes`, `post_comments`, `post_views`, `post_translations`, `hidden_posts`. Consumed by Tasks 7 (push triggers already included here), 10 (translation edge function), 13 (service layer).

- [ ] **Step 1: Write the migration file**

```sql
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
```

- [ ] **Step 2: Apply and verify**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber/app-motorista" && supabase db push --linked
supabase db query --linked "select tablename from pg_tables where schemaname='public' and tablename in ('community_posts','post_likes','post_comments','post_views','post_translations','hidden_posts');"
```
Expected: all six rows returned.

- [ ] **Step 3: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/supabase/migrations/20260729130100_community_posts.sql && git commit -m "$(cat <<'EOF'
feat: add Comunidade posts/likes/comments/views/translation tables

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Migration — DM (conversations & messages)

**Files:**
- Create: `supabase/migrations/20260729130200_community_dm.sql`

**Interfaces:**
- Produces: `dm_conversations`, `dm_messages`, both added to the `supabase_realtime` publication. Consumed by Task 14 (chat service) and screens in Tasks 24-25.

- [ ] **Step 1: Write the migration file**

```sql
-- Comunidade: 1:1 direct messages

CREATE TABLE dm_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user_b      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (user_a < user_b),
  UNIQUE (user_a, user_b)
);

CREATE TABLE dm_messages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id   uuid NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  sender_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body              text,
  image_url         text,
  read_at           timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (body IS NOT NULL OR image_url IS NOT NULL)
);

CREATE INDEX idx_dm_messages_conversation ON dm_messages(conversation_id, created_at);

-- ─── RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE dm_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE dm_messages      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dm_conversations: participante ve"
  ON dm_conversations FOR SELECT
  USING (auth.uid() = user_a OR auth.uid() = user_b);

CREATE POLICY "dm_conversations: criar respeita bloqueio"
  ON dm_conversations FOR INSERT
  WITH CHECK (
    (auth.uid() = user_a OR auth.uid() = user_b)
    AND NOT EXISTS (
      SELECT 1 FROM user_blocks
      WHERE (blocker_id = user_a AND blocked_id = user_b)
         OR (blocker_id = user_b AND blocked_id = user_a)
    )
  );

CREATE POLICY "dm_messages: participante ve"
  ON dm_messages FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM dm_conversations c
      WHERE c.id = conversation_id AND (c.user_a = auth.uid() OR c.user_b = auth.uid())
    )
  );

CREATE POLICY "dm_messages: enviar como participante"
  ON dm_messages FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM dm_conversations c
      WHERE c.id = conversation_id AND (c.user_a = auth.uid() OR c.user_b = auth.uid())
    )
    AND NOT EXISTS (
      SELECT 1 FROM dm_conversations c
      JOIN user_blocks b ON (b.blocker_id = c.user_a AND b.blocked_id = c.user_b)
                         OR (b.blocker_id = c.user_b AND b.blocked_id = c.user_a)
      WHERE c.id = conversation_id
    )
  );

-- ─── Realtime ───────────────────────────────────────────────────────────────

ALTER PUBLICATION supabase_realtime ADD TABLE dm_messages;

-- ─── Push notification on new DM ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_notify_dm() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_recipient uuid;
BEGIN
  SELECT CASE WHEN c.user_a = NEW.sender_id THEN c.user_b ELSE c.user_a END INTO v_recipient
  FROM dm_conversations c WHERE c.id = NEW.conversation_id;

  IF v_recipient IS NOT NULL THEN
    PERFORM net.http_post(
      url := 'https://ucxkvxqpkknxotbfxgeu.supabase.co/functions/v1/community-push',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object('type', 'dm', 'recipient_id', v_recipient, 'actor_id', NEW.sender_id, 'message_body', NEW.body)
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_notify_dm
  AFTER INSERT ON dm_messages
  FOR EACH ROW EXECUTE FUNCTION fn_notify_dm();
```

- [ ] **Step 2: Apply and verify**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber/app-motorista" && supabase db push --linked
supabase db query --linked "select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='dm_messages';"
```
Expected: one row returned (confirms realtime is on for `dm_messages`).

- [ ] **Step 3: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/supabase/migrations/20260729130200_community_dm.sql && git commit -m "$(cat <<'EOF'
feat: add Comunidade DM tables with realtime enabled

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Migration — storage bucket

**Files:**
- Create: `supabase/migrations/20260729130300_community_storage.sql`

**Interfaces:**
- Produces: public bucket `community` with per-user folder RLS (`community/{user_id}/...`). Consumed by Task 11 (`communityStorage.ts`).

- [ ] **Step 1: Write the migration file**

```sql
-- Comunidade: storage bucket for avatars, covers, and post photos

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('community', 'community', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "community bucket: leitura publica"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'community');

CREATE POLICY "community bucket: upload proprio"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'community' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "community bucket: atualizar proprio"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'community' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "community bucket: deletar proprio"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'community' AND (storage.foldername(name))[1] = auth.uid()::text);
```

Object paths this expects (enforced client-side in Task 11, not by the DB): `community/{user_id}/avatar.jpg`, `community/{user_id}/cover.jpg`, `community/{user_id}/posts/{post_id}.jpg`.

- [ ] **Step 2: Apply and verify**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber/app-motorista" && supabase db push --linked
supabase db query --linked "select id, public, file_size_limit from storage.buckets where id='community';"
```
Expected: one row, `public = true`, `file_size_limit = 5242880`.

- [ ] **Step 3: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/supabase/migrations/20260729130300_community_storage.sql && git commit -m "$(cat <<'EOF'
feat: add community storage bucket with per-user folder RLS

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Edge function — `community-push`

**Files:**
- Create: `supabase/functions/community-push/index.ts`
- Modify: `supabase/config.toml` (add `[functions.community-push]` with `verify_jwt = false`, alongside the existing `send-auth-email`/`stripe-webhook` entries)

**Interfaces:**
- Consumes: called by the `pg_net` triggers from Tasks 2-4 with body `{ type: 'follow'|'like'|'comment'|'dm', recipient_id, actor_id, post_id?, comment_body?, message_body? }`.
- Produces: sends an Expo push notification to `recipient_id`'s `profiles.push_token` (same delivery mechanism as `send-push-notification`, which the existing `app/_layout.tsx` foreground listener already turns into an in-app inbox entry — no client work needed for that part).

- [ ] **Step 1: Write the edge function**

```ts
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
```

- [ ] **Step 2: Pin `verify_jwt = false`**

In `supabase/config.toml`, add right after the existing `[functions.stripe-webhook]` block:
```toml
[functions.community-push]
verify_jwt = false
```

- [ ] **Step 3: Deploy**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber/app-motorista" && supabase functions deploy community-push
```
Expected: `"Deployed Functions."` with `"community-push"` in the list.

- [ ] **Step 4: Smoke-test it directly**

```bash
curl -s -X POST "https://ucxkvxqpkknxotbfxgeu.supabase.co/functions/v1/community-push" \
  -H "Content-Type: application/json" \
  -d '{"type":"follow","recipient_id":"00000000-0000-0000-0000-000000000000","actor_id":"00000000-0000-0000-0000-000000000000"}'
```
Expected: `{"sent":false,"reason":"no push token"}` (200) — confirms the function runs and handles a missing recipient gracefully without needing an auth header (`verify_jwt=false` took effect).

- [ ] **Step 5: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/supabase/functions/community-push app-motorista/supabase/config.toml && git commit -m "$(cat <<'EOF'
feat: add community-push edge function for follow/like/comment/DM notifications

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Edge function — `translate-post`

**Files:**
- Create: `supabase/functions/translate-post/index.ts`

**Interfaces:**
- Consumes: authenticated client call `POST { post_id, target_lang }` (normal client → edge function call with the user's session JWT — `verify_jwt` stays at its default `true`, no config.toml entry needed).
- Produces: `{ translated_text }`; caches the result into `post_translations` on first call for a given `(post_id, target_lang)` pair. Consumed by Task 13's `getTranslatedCaption`.

- [ ] **Step 1: Write the edge function**

```ts
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
```

- [ ] **Step 2: Deploy**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber/app-motorista" && supabase functions deploy translate-post
```

- [ ] **Step 3: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/supabase/functions/translate-post && git commit -m "$(cat <<'EOF'
feat: add translate-post edge function (MyMemory API + cache)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Pure utils — `communityStats.ts` (platform breakdown & metrics)

**Files:**
- Create: `src/utils/communityStats.ts`
- Test: `__tests__/utils/communityStats.test.ts`

**Interfaces:**
- Produces: `buildPlatformBreakdown(entries)`, `computeCommunityMetrics(input)`, types `PlatformBreakdownItem`, `CommunityMetrics`. Consumed by Task 13 (`buildStatsSnapshotForDate`).

- [ ] **Step 1: Write the failing tests**

```ts
import { test, expect, describe } from '@jest/globals';
import { buildPlatformBreakdown, computeCommunityMetrics } from '../../src/utils/communityStats';

describe('buildPlatformBreakdown', () => {
  test('aggregates same-named platforms across shifts and computes pct', () => {
    const result = buildPlatformBreakdown([
      { platform_name: 'Uber', amount_cents: 7300 },
      { platform_name: '99', amount_cents: 15292 },
      { platform_name: 'Uber', amount_cents: 2700 },
    ]);
    expect(result).toEqual([
      { name: '99',   gross_cents: 15292, pct: 60.14 },
      { name: 'Uber', gross_cents: 10000, pct: 39.86 },
    ]);
  });

  test('empty input returns empty array', () => {
    expect(buildPlatformBreakdown([])).toEqual([]);
  });
});

describe('computeCommunityMetrics', () => {
  test('computes averages from totals', () => {
    const result = computeCommunityMetrics({
      gross_cents: 30592,
      net_cents: 30592,
      duration_seconds: 33821, // 9h23m41s
      km_meters: 139800,
      rides_count: 20,
    });
    expect(result).toEqual({
      earnings_today_cents: 30592,
      net_cents: 30592,
      avg_per_hour_cents: 3256, // 30592 / (33821/3600)
      avg_per_km_cents: 219,    // 30592 / 139.8
      total_duration_seconds: 33821,
      total_km_meters: 139800,
      rides_count: 20,
      avg_per_ride_cents: 1530, // 30592 / 20
    });
  });

  test('zero duration/km/rides never divides by zero', () => {
    const result = computeCommunityMetrics({
      gross_cents: 0, net_cents: 0, duration_seconds: 0, km_meters: 0, rides_count: 0,
    });
    expect(result.avg_per_hour_cents).toBe(0);
    expect(result.avg_per_km_cents).toBe(0);
    expect(result.avg_per_ride_cents).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber/app-motorista" && npx jest __tests__/utils/communityStats.test.ts
```
Expected: FAIL — `Cannot find module '../../src/utils/communityStats'`.

- [ ] **Step 3: Implement**

```ts
export interface PlatformBreakdownItem {
  name: string;
  gross_cents: number;
  pct: number;
}

export function buildPlatformBreakdown(
  entries: Array<{ platform_name: string; amount_cents: number }>,
): PlatformBreakdownItem[] {
  const totals = new Map<string, number>();
  for (const e of entries) {
    totals.set(e.platform_name, (totals.get(e.platform_name) ?? 0) + e.amount_cents);
  }
  const grandTotal = Array.from(totals.values()).reduce((s, v) => s + v, 0);
  return Array.from(totals.entries())
    .map(([name, gross_cents]) => ({
      name,
      gross_cents,
      pct: grandTotal > 0 ? Math.round((gross_cents / grandTotal) * 10000) / 100 : 0,
    }))
    .sort((a, b) => b.gross_cents - a.gross_cents);
}

export interface CommunityMetrics {
  earnings_today_cents: number;
  net_cents: number;
  avg_per_hour_cents: number;
  avg_per_km_cents: number;
  total_duration_seconds: number;
  total_km_meters: number;
  rides_count: number;
  avg_per_ride_cents: number;
}

export function computeCommunityMetrics(input: {
  gross_cents: number;
  net_cents: number;
  duration_seconds: number;
  km_meters: number;
  rides_count: number;
}): CommunityMetrics {
  const hours = input.duration_seconds / 3600;
  const km = input.km_meters / 1000;
  return {
    earnings_today_cents: input.gross_cents,
    net_cents: input.net_cents,
    avg_per_hour_cents: hours > 0 ? Math.round(input.gross_cents / hours) : 0,
    avg_per_km_cents: km > 0 ? Math.round(input.gross_cents / km) : 0,
    total_duration_seconds: input.duration_seconds,
    total_km_meters: input.km_meters,
    rides_count: input.rides_count,
    avg_per_ride_cents: input.rides_count > 0 ? Math.round(input.gross_cents / input.rides_count) : 0,
  };
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npx jest __tests__/utils/communityStats.test.ts
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/src/utils/communityStats.ts app-motorista/__tests__/utils/communityStats.test.ts && git commit -m "$(cat <<'EOF'
feat: add pure platform-breakdown/metrics utils for Comunidade posts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Pure utils — `communityChat.ts` (conversation pair ordering)

**Files:**
- Create: `src/utils/communityChat.ts`
- Test: `__tests__/utils/communityChat.test.ts`

**Interfaces:**
- Produces: `normalizeConversationPair(userIdA, userIdB): { user_a: string; user_b: string }`. Consumed by Task 14's `getOrCreateConversation` (the `dm_conversations` table has `CHECK (user_a < user_b)` from Task 4, so callers must pre-sort before insert/select).

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, describe } from '@jest/globals';
import { normalizeConversationPair } from '../../src/utils/communityChat';

describe('normalizeConversationPair', () => {
  test('keeps already-sorted pair as-is', () => {
    expect(normalizeConversationPair('aaa', 'bbb')).toEqual({ user_a: 'aaa', user_b: 'bbb' });
  });
  test('swaps a reversed pair', () => {
    expect(normalizeConversationPair('bbb', 'aaa')).toEqual({ user_a: 'aaa', user_b: 'bbb' });
  });
  test('is idempotent regardless of call order', () => {
    const a = normalizeConversationPair('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222');
    const b = normalizeConversationPair('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111');
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber/app-motorista" && npx jest __tests__/utils/communityChat.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export function normalizeConversationPair(
  userIdA: string,
  userIdB: string,
): { user_a: string; user_b: string } {
  return userIdA < userIdB
    ? { user_a: userIdA, user_b: userIdB }
    : { user_a: userIdB, user_b: userIdA };
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npx jest __tests__/utils/communityChat.test.ts
```
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/src/utils/communityChat.ts app-motorista/__tests__/utils/communityChat.test.ts && git commit -m "$(cat <<'EOF'
feat: add normalizeConversationPair util for DM conversation lookup

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Pure utils — `communityTranslation.ts` (target-language decision)

**Files:**
- Create: `src/utils/communityTranslation.ts`
- Test: `__tests__/utils/communityTranslation.test.ts`

**Interfaces:**
- Produces: `type SupportedLang = 'pt' | 'en' | 'es'`, `normalizeSupportedLang(raw: string): SupportedLang`, `pickTranslationTargetLang(authorLocale: string, viewerLocale: string): SupportedLang | null`. Consumed by Task 13's `getTranslatedCaption` call site (the `PostCard` component decides whether to even call it).

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, describe } from '@jest/globals';
import { normalizeSupportedLang, pickTranslationTargetLang } from '../../src/utils/communityTranslation';

describe('normalizeSupportedLang', () => {
  test('maps en-US and en-GB to en', () => {
    expect(normalizeSupportedLang('en-US')).toBe('en');
    expect(normalizeSupportedLang('en-GB')).toBe('en');
  });
  test('maps es-419 to es', () => {
    expect(normalizeSupportedLang('es-419')).toBe('es');
  });
  test('unknown locale falls back to pt', () => {
    expect(normalizeSupportedLang('fr-FR')).toBe('pt');
  });
});

describe('pickTranslationTargetLang', () => {
  test('returns null when author and viewer share a language', () => {
    expect(pickTranslationTargetLang('pt-BR', 'pt-BR')).toBeNull();
  });
  test('returns the viewer language when it differs from the author', () => {
    expect(pickTranslationTargetLang('pt-BR', 'en-US')).toBe('en');
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber/app-motorista" && npx jest __tests__/utils/communityTranslation.test.ts
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
export type SupportedLang = 'pt' | 'en' | 'es';

export function normalizeSupportedLang(raw: string): SupportedLang {
  const l = (raw ?? '').toLowerCase();
  if (l.startsWith('en')) return 'en';
  if (l.startsWith('es')) return 'es';
  return 'pt';
}

export function pickTranslationTargetLang(authorLocale: string, viewerLocale: string): SupportedLang | null {
  const author = normalizeSupportedLang(authorLocale);
  const viewer = normalizeSupportedLang(viewerLocale);
  return author === viewer ? null : viewer;
}
```

- [ ] **Step 4: Run to verify pass**

```bash
npx jest __tests__/utils/communityTranslation.test.ts
```
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/src/utils/communityTranslation.ts app-motorista/__tests__/utils/communityTranslation.test.ts && git commit -m "$(cat <<'EOF'
feat: add translation target-language util for Comunidade posts

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: `expo-image-picker` + `communityStorage.ts`

**Files:**
- Modify: `package.json` (new dependency)
- Create: `src/services/communityStorage.ts`

**Interfaces:**
- Produces: `uploadCommunityImage(userId: string, localUri: string, kind: 'avatar' | 'cover' | 'post', postId?: string): Promise<string>` — returns the public URL. Consumed by Tasks 12 (avatar/cover), 13 (post photo), 25 (chat image).

- [ ] **Step 1: Install the dependency**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber/app-motorista" && npx expo install expo-image-picker
```
Expected: `package.json` gains `"expo-image-picker": "~<version>"` matching the installed Expo SDK.

- [ ] **Step 2: Implement the upload service**

```ts
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
```

- [ ] **Step 3: Manual verification**

From a throwaway screen (or the React Native debugger), call `uploadCommunityImage(<your user id>, <a local file:// uri from an image picker test pick>, 'avatar')` and confirm the returned URL loads the image in a browser.

- [ ] **Step 4: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/package.json app-motorista/package-lock.json app-motorista/src/services/communityStorage.ts && git commit -m "$(cat <<'EOF'
feat: add expo-image-picker and community image upload service

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `src/services/community.ts` (profile, follow, block, search)

**Files:**
- Create: `src/services/community.ts`

**Interfaces:**
- Consumes: `supabase` client (`../lib/supabase`).
- Produces: `CommunityProfile` type, `getCommunityProfile`, `updateCommunityProfile`, `isFollowing`, `followUser`, `unfollowUser`, `isBlocked`, `blockUser`, `unblockUser`, `hidePost`, `searchUsers`. Consumed by Tasks 20, 22, 23.

- [ ] **Step 1: Implement**

```ts
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
```

- [ ] **Step 2: Manual verification**

From a throwaway call site (or a temporary console.log in a screen), call `followUser`/`isFollowing`/`unfollowUser` between two real test accounts and confirm the `community_profiles.followers_count`/`following_count` update (query via `supabase db query --linked` as done earlier this session).

- [ ] **Step 3: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/src/services/community.ts && git commit -m "$(cat <<'EOF'
feat: add community.ts service (profile, follow, block, search)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: `src/services/communityPosts.ts`

**Files:**
- Create: `src/services/communityPosts.ts`

**Interfaces:**
- Consumes: `getDayDetail` from `./dashboard` (existing), `buildPlatformBreakdown`/`computeCommunityMetrics` from `../utils/communityStats` (Task 8), `uploadCommunityImage` from `./communityStorage` (Task 11).
- Produces: `CommunityStatsSnapshot`, `CommunityPost`, `PostComment` types; `buildStatsSnapshotForDate`, `createPost`, `getFeed`, `getUserPosts`, `toggleLike`, `getComments`, `addComment`, `recordView`, `getTranslatedCaption`. Consumed by Tasks 19-23.

- [ ] **Step 1: Implement**

```ts
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
```

- [ ] **Step 2: Manual verification**

Call `buildStatsSnapshotForDate(<test user id>, '2026-07-28')` (a date with real shift data from this session's earlier testing) from a throwaway script/screen and confirm `platforms`/`metrics` look sane compared to what the Turnos screen already shows for that day.

- [ ] **Step 3: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/src/services/communityPosts.ts && git commit -m "$(cat <<'EOF'
feat: add communityPosts.ts service (create/feed/like/comment/translate)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 14: `src/services/communityChat.ts`

**Files:**
- Create: `src/services/communityChat.ts`

**Interfaces:**
- Consumes: `normalizeConversationPair` from `../utils/communityChat` (Task 9), `uploadCommunityImage` from `./communityStorage` (Task 11).
- Produces: `ChatConversation`, `ChatMessage` types; `getConversations`, `getOrCreateConversation`, `getMessages`, `sendMessage`, `subscribeToConversation`. Consumed by Tasks 24-25.

- [ ] **Step 1: Implement**

```ts
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
```

- [ ] **Step 2: Manual verification**

Between two test accounts, call `getOrCreateConversation` then `sendMessage`, confirm `getMessages` returns it, and confirm calling `getOrCreateConversation` a second time (in either argument order) returns the same conversation id (not a duplicate row) — this is what Task 9's `normalizeConversationPair` guarantees.

- [ ] **Step 3: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/src/services/communityChat.ts && git commit -m "$(cat <<'EOF'
feat: add communityChat.ts service (conversations, messages, realtime)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 15: `QuickAddSheet` component (bottom sheet: Combustível/Despesas)

**Files:**
- Create: `src/components/QuickAddSheet.tsx`

**Interfaces:**
- Produces: `<QuickAddSheet visible={boolean} onClose={() => void} />` — navigates via `expo-router`'s `router.push('/fuel')` / `router.push('/expenses')` equivalents. Consumed by Task 16.

Note: `fuel.tsx`/`expenses.tsx` currently live under `app/(tabs)/` as `Tabs.Screen`s reached implicitly by tab press. Task 16 removes their `Tabs.Screen` registration; Expo Router still serves any file under `app/(tabs)/` at its route even without a `Tabs.Screen` tab button for it (the file itself defines the route), so `router.push('/fuel')` and `router.push('/expenses')` keep working unchanged — confirm this in Task 16's manual verification step.

- [ ] **Step 1: Implement**

```tsx
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../theme';

export function QuickAddSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();

  function go(path: '/fuel' | '/expenses') {
    onClose();
    router.push(path);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <TouchableOpacity style={styles.row} onPress={() => go('/fuel')} activeOpacity={0.8}>
            <View style={[styles.icon, { backgroundColor: Colors.error }]}>
              <Ionicons name="flame" size={16} color="#fff" />
            </View>
            <Text style={styles.label}>{t('tabs.fuel')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.row} onPress={() => go('/expenses')} activeOpacity={0.8}>
            <View style={[styles.icon, { backgroundColor: Colors.success }]}>
              <Ionicons name="wallet" size={16} color="#fff" />
            </View>
            <Text style={styles.label}>{t('tabs.expenses')}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.background, borderTopLeftRadius: Radius.card, borderTopRightRadius: Radius.card,
    borderTopWidth: 1, borderTopColor: Colors.accent, padding: Spacing.md, paddingBottom: Spacing.xl, gap: Spacing.sm,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: Spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: Colors.surfaceAlt, padding: Spacing.md, borderRadius: Radius.input,
  },
  icon: { width: 26, height: 26, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  label: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },
});
```

- [ ] **Step 2: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/src/components/QuickAddSheet.tsx && git commit -m "$(cat <<'EOF'
feat: add QuickAddSheet bottom sheet component

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 16: Nav restructure — `app/(tabs)/_layout.tsx`

**Files:**
- Modify: `app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: `QuickAddSheet` (Task 15).
- Produces: final tab bar `Início · Turnos · (+) · Comunidade · Mais`. Task 20 (`community.tsx`) must exist as a file under `app/(tabs)/` for the new `Tabs.Screen name="community"` to resolve — create at least a placeholder before wiring this if doing tasks out of order; this plan does Task 20 right after, so no placeholder is needed if executed in order.

- [ ] **Step 1: Rewrite the layout**

```tsx
import React, { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import * as SecureStore from 'expo-secure-store';
import { View } from 'react-native';
import { Colors } from '@/src/theme';
import { BiometricGate } from '@/src/components/BiometricGate';
import { TutorialModal } from '@/src/components/TutorialModal';
import { QuickAddSheet } from '@/src/components/QuickAddSheet';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_ICONS: Record<string, [IoniconName, IoniconName]> = {
  index:     ['home-outline',    'home'],
  shifts:    ['time-outline',    'time'],
  community: ['people-outline',  'people'],
  more:      ['ellipsis-horizontal-circle-outline', 'ellipsis-horizontal-circle'],
};

const TUTORIAL_KEY = 'paldrivy_tutorial_done';

export default function TabLayout() {
  const { t } = useTranslation();
  const [tutorialVisible, setTutorialVisible] = useState(false);
  const [quickAddVisible, setQuickAddVisible] = useState(false);

  useEffect(() => {
    SecureStore.getItemAsync(TUTORIAL_KEY).then(done => {
      if (!done) setTutorialVisible(true);
    }).catch(() => {});
  }, []);

  function handleTutorialClose() {
    setTutorialVisible(false);
    SecureStore.setItemAsync(TUTORIAL_KEY, '1').catch(() => {});
  }

  return (
    <BiometricGate>
      <Tabs
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarStyle: {
            backgroundColor: Colors.surface,
            borderTopColor: Colors.border,
          },
          tabBarActiveTintColor: Colors.accent,
          tabBarInactiveTintColor: Colors.textSecondary,
          tabBarLabelStyle: { fontSize: 9 },
          tabBarIcon: ({ focused, color, size }) => {
            const [outline, filled] = TAB_ICONS[route.name] ?? ['help-circle-outline', 'help-circle'];
            return <Ionicons name={focused ? filled : outline} size={size} color={color} />;
          },
        })}
      >
        <Tabs.Screen name="index"     options={{ title: t('tabs.dashboard') }} />
        <Tabs.Screen name="shifts"    options={{ title: t('tabs.shifts') }} />
        <Tabs.Screen
          name="quickadd"
          options={{
            title: '',
            tabBarButton: () => (
              <View style={{ top: -14, alignItems: 'center', justifyContent: 'center' }}>
                <View
                  onTouchEnd={() => setQuickAddVisible(true)}
                  style={{
                    width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.accent,
                    alignItems: 'center', justifyContent: 'center',
                    shadowColor: Colors.accent, shadowOpacity: 0.6, shadowRadius: 10, elevation: 8,
                  }}
                >
                  <Ionicons name="add" size={28} color={Colors.onAccent} />
                </View>
              </View>
            ),
          }}
          listeners={{ tabPress: (e) => { e.preventDefault(); setQuickAddVisible(true); } }}
        />
        <Tabs.Screen name="community" options={{ title: t('tabs.community') }} />
        <Tabs.Screen name="more"      options={{ title: t('tabs.more') }} />
        <Tabs.Screen name="fuel"      options={{ href: null }} />
        <Tabs.Screen name="expenses"  options={{ href: null }} />
        <Tabs.Screen name="two"       options={{ href: null }} />
      </Tabs>
      <TutorialModal visible={tutorialVisible} onClose={handleTutorialClose} />
      <QuickAddSheet visible={quickAddVisible} onClose={() => setQuickAddVisible(false)} />
    </BiometricGate>
  );
}
```

`options={{ href: null }}` on `fuel`/`expenses` keeps them as valid routes (so `router.push('/fuel')` from `QuickAddSheet` still resolves) while hiding them from the tab bar — the exact same technique already used for the pre-existing `two` route.

`app/(tabs)/quickadd.tsx` needs to exist as a file for Expo Router to register the route, even though it's never actually navigated to (the `tabPress` listener always calls `preventDefault()`). Create it as a no-op:

```tsx
export default function QuickAddPlaceholder() {
  return null;
}
```

- [ ] **Step 2: Add the `tabs.community` i18n key stub**

This is finalized properly in Task 18, but the layout above references `t('tabs.community')` immediately — add a temporary literal fallback so this compiles standalone if Task 18 hasn't run yet:
```tsx
options={{ title: t('tabs.community', { defaultValue: 'Comunidade' }) }}
```
(If executing tasks in written order, Task 18 will already have added the real key by the time a reviewer double-checks this — either way this line is correct.)

- [ ] **Step 3: Manual verification**

Start the app, confirm the tab bar shows Início/Turnos/(+ button)/Comunidade/Mais, confirm tapping `+` opens the `QuickAddSheet`, confirm tapping "Combustível"/"Despesas" inside it navigates to the existing fuel/expenses screens correctly, confirm those screens still have working back navigation.

- [ ] **Step 4: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/"app/(tabs)/_layout.tsx" app-motorista/"app/(tabs)/quickadd.tsx" && git commit -m "$(cat <<'EOF'
feat: restructure tab bar for Comunidade (Início·Turnos·+·Comunidade·Mais)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 17: i18n keys

**Files:**
- Modify: `locales/pt.json`, `locales/en.json`, `locales/es.json`

**Interfaces:**
- Produces: `tabs.community` (used by Task 16) and the `community.*` namespace (used by Tasks 19-25).

- [ ] **Step 1: Add keys to `locales/pt.json`**

Add `"community": "Comunidade"` to the existing `"tabs"` object, and a new top-level `"community"` object:
```json
"community": {
  "feed_title": "Comunidade",
  "my_posts": "Meus posts",
  "followers": "seguidores",
  "following": "seguindo",
  "follow": "Seguir",
  "unfollow": "Deixar de seguir",
  "block": "Bloquear",
  "unblock": "Desbloquear",
  "report": "Denunciar",
  "message": "Mensagem",
  "find_people": "Encontrar pessoas",
  "search_users_placeholder": "Buscar usuários...",
  "publish": "Publicar na comunidade",
  "no_posts_yet": "Você ainda não publicou nada.",
  "caption_placeholder": "Como foi seu dia?",
  "see_original": "Ver original",
  "see_translation": "Ver tradução",
  "like": "Curtir",
  "comment": "Comentar",
  "comments_title": "Comentários",
  "add_comment_placeholder": "Adicione um comentário...",
  "chat_title": "Mensagens",
  "chat_placeholder": "Mensagem...",
  "confirm_block_title": "Bloquear usuário?",
  "confirm_block_body": "Vocês deixarão de se ver na comunidade.",
  "confirm_report_title": "Denunciar post?",
  "confirm_report_body": "Este post não aparecerá mais para você."
}
```

- [ ] **Step 2: Add the equivalent keys to `locales/en.json`**

```json
"community": {
  "feed_title": "Community",
  "my_posts": "My posts",
  "followers": "followers",
  "following": "following",
  "follow": "Follow",
  "unfollow": "Unfollow",
  "block": "Block",
  "unblock": "Unblock",
  "report": "Report",
  "message": "Message",
  "find_people": "Find people",
  "search_users_placeholder": "Search users...",
  "publish": "Post to community",
  "no_posts_yet": "You haven't posted anything yet.",
  "caption_placeholder": "How was your day?",
  "see_original": "See original",
  "see_translation": "See translation",
  "like": "Like",
  "comment": "Comment",
  "comments_title": "Comments",
  "add_comment_placeholder": "Add a comment...",
  "chat_title": "Messages",
  "chat_placeholder": "Message...",
  "confirm_block_title": "Block user?",
  "confirm_block_body": "You'll no longer see each other in the community.",
  "confirm_report_title": "Report post?",
  "confirm_report_body": "This post will no longer appear for you."
}
```
Add `"community": "Community"` to `"tabs"`.

- [ ] **Step 3: Add the equivalent keys to `locales/es.json`**

```json
"community": {
  "feed_title": "Comunidad",
  "my_posts": "Mis posts",
  "followers": "seguidores",
  "following": "siguiendo",
  "follow": "Seguir",
  "unfollow": "Dejar de seguir",
  "block": "Bloquear",
  "unblock": "Desbloquear",
  "report": "Denunciar",
  "message": "Mensaje",
  "find_people": "Encontrar personas",
  "search_users_placeholder": "Buscar usuarios...",
  "publish": "Publicar en la comunidad",
  "no_posts_yet": "Todavía no has publicado nada.",
  "caption_placeholder": "¿Cómo fue tu día?",
  "see_original": "Ver original",
  "see_translation": "Ver traducción",
  "like": "Me gusta",
  "comment": "Comentar",
  "comments_title": "Comentarios",
  "add_comment_placeholder": "Añade un comentario...",
  "chat_title": "Mensajes",
  "chat_placeholder": "Mensaje...",
  "confirm_block_title": "¿Bloquear usuario?",
  "confirm_block_body": "Ya no se verán en la comunidad.",
  "confirm_report_title": "¿Denunciar post?",
  "confirm_report_body": "Este post ya no aparecerá para ti."
}
```
Add `"community": "Comunidad"` to `"tabs"`.

- [ ] **Step 4: Verify all three files still parse as valid JSON**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber/app-motorista" && node -e "require('./locales/pt.json'); require('./locales/en.json'); require('./locales/es.json'); console.log('ok')"
```
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/locales/pt.json app-motorista/locales/en.json app-motorista/locales/es.json && git commit -m "$(cat <<'EOF'
feat: add community.* i18n keys (pt/en/es)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 18: `PostCard` component

**Files:**
- Create: `src/components/community/PostCard.tsx`

**Interfaces:**
- Consumes: `CommunityPost` type + `toggleLike`, `recordView`, `getTranslatedCaption` (Task 13); `pickTranslationTargetLang` (Task 10).
- Produces: `<PostCard post={CommunityPost} viewerLocale={string} onPress={() => void} onAuthorPress={() => void} />`. Consumed by Tasks 20, 22.

- [ ] **Step 1: Implement**

```tsx
import React, { useEffect, useState } from 'react';
import { Image, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from 'react-i18next';
import { Colors, Radius, Spacing } from '../../theme';
import { toggleLike, recordView, getTranslatedCaption, type CommunityPost } from '../../services/communityPosts';
import { pickTranslationTargetLang } from '../../utils/communityTranslation';

export function PostCard({
  post, viewerId, viewerLocale, onPress, onAuthorPress,
}: {
  post: CommunityPost;
  viewerId: string;
  viewerLocale: string;
  onPress: () => void;
  onAuthorPress: () => void;
}) {
  const { t } = useTranslation();
  const [liked, setLiked] = useState(post.liked_by_me);
  const [likeCount, setLikeCount] = useState(post.likes_count);
  const [translated, setTranslated] = useState<string | null>(null);
  const [showingTranslation, setShowingTranslation] = useState(false);

  const targetLang = pickTranslationTargetLang(post.author.locale, viewerLocale);

  useEffect(() => {
    recordView(viewerId, post.id).catch(() => {});
  }, [post.id, viewerId]);

  async function handleLike() {
    const next = !liked;
    setLiked(next);
    setLikeCount((c) => c + (next ? 1 : -1));
    try {
      await toggleLike(viewerId, post.id, next);
    } catch {
      setLiked(!next);
      setLikeCount((c) => c + (next ? -1 : 1));
    }
  }

  async function handleToggleTranslation() {
    if (!targetLang) return;
    if (!showingTranslation && translated === null) {
      const text = await getTranslatedCaption(post.id, targetLang);
      setTranslated(text);
    }
    setShowingTranslation((v) => !v);
  }

  const { platforms, expenses_cents, metrics } = post.stats_snapshot;
  const displayedCaption = showingTranslation && translated !== null ? translated : post.caption;

  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.header} onPress={onAuthorPress} activeOpacity={0.8}>
        {post.author.avatar_url ? (
          <Image source={{ uri: post.author.avatar_url }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>{post.author.name.charAt(0).toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.authorName}>{post.author.name}</Text>
          <Text style={styles.authorLocation}>
            {[post.author.city, post.author.state, post.author.country].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity onPress={onPress} activeOpacity={0.9}>
        {!!displayedCaption && <Text style={styles.caption}>{displayedCaption}</Text>}
        {!!targetLang && (
          <TouchableOpacity onPress={handleToggleTranslation}>
            <Text style={styles.translateLink}>
              {showingTranslation ? t('community.see_original') : t('community.see_translation')}
            </Text>
          </TouchableOpacity>
        )}

        {post.photo_url && <Image source={{ uri: post.photo_url }} style={styles.photo} />}

        <View style={styles.statsRow}>
          {platforms.map((p) => (
            <View key={p.name} style={styles.statBox}>
              <Text style={styles.statLabel}>{p.name}</Text>
              <Text style={styles.statValue}>{(p.gross_cents / 100).toFixed(2)}</Text>
              <Text style={styles.statPct}>{p.pct.toFixed(2)}%</Text>
            </View>
          ))}
        </View>

        <View style={styles.metricsGrid}>
          <Metric label="R$/h" value={(metrics.avg_per_hour_cents / 100).toFixed(2)} />
          <Metric label="R$/km" value={(metrics.avg_per_km_cents / 100).toFixed(2)} />
          <Metric label="Corridas" value={String(metrics.rides_count)} />
        </View>
      </TouchableOpacity>

      <View style={styles.actionsRow}>
        <TouchableOpacity style={styles.action} onPress={handleLike}>
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={18} color={liked ? Colors.error : Colors.textSecondary} />
          <Text style={styles.actionText}>{likeCount}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.action} onPress={onPress}>
          <Ionicons name="chatbubble-outline" size={18} color={Colors.textSecondary} />
          <Text style={styles.actionText}>{post.comments_count}</Text>
        </TouchableOpacity>
        <View style={styles.action}>
          <Ionicons name="eye-outline" size={18} color={Colors.textSecondary} />
          <Text style={styles.actionText}>{post.views_count}</Text>
        </View>
      </View>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: Colors.surface, borderRadius: Radius.card, padding: Spacing.md, marginBottom: Spacing.md, borderWidth: 1, borderColor: Colors.border },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  avatar: { width: 40, height: 40, borderRadius: 20 },
  avatarFallback: { backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: Colors.onAccent, fontWeight: '700' },
  authorName: { color: Colors.textPrimary, fontWeight: '700', fontSize: 14 },
  authorLocation: { color: Colors.textSecondary, fontSize: 11 },
  caption: { color: Colors.textPrimary, fontSize: 14, marginBottom: Spacing.xs },
  translateLink: { color: Colors.brandBlue, fontSize: 12, marginBottom: Spacing.sm },
  photo: { width: '100%', height: 200, borderRadius: Radius.input, marginBottom: Spacing.sm },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
  statBox: { backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input, padding: Spacing.sm, minWidth: 90 },
  metricsGrid: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.sm },
  metricBox: { flex: 1, backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input, padding: Spacing.sm, alignItems: 'center' },
  statLabel: { color: Colors.textSecondary, fontSize: 11 },
  statValue: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  statPct: { color: Colors.success, fontSize: 11 },
  actionsRow: { flexDirection: 'row', gap: Spacing.lg, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm },
  action: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actionText: { color: Colors.textSecondary, fontSize: 12 },
});
```

- [ ] **Step 2: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/src/components/community/PostCard.tsx && git commit -m "$(cat <<'EOF'
feat: add PostCard component for Comunidade feed

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 19: Feed screen — `app/(tabs)/community.tsx`

**Files:**
- Create: `app/(tabs)/community.tsx`

**Interfaces:**
- Consumes: `getFeed`, `CommunityPost` (Task 13); `searchUsers` (Task 12); `PostCard` (Task 18).
- Produces: the "Comunidade" tab screen. Links to `/community/create-post` (Task 20), `/community/[userId]` (Task 21), `/community/post/[postId]` (Task 22), `/community/chats` (Task 23).

- [ ] **Step 1: Implement**

```tsx
import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, SafeAreaView, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { getFeed, type CommunityPost } from '@/src/services/communityPosts';
import { searchUsers, type CommunityProfile } from '@/src/services/community';
import { getProfile } from '@/src/services/profile';
import { PostCard } from '@/src/components/community/PostCard';

export default function CommunityScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [locale, setLocale] = useState('pt-BR');
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CommunityProfile[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id ?? null;
    setUserId(uid);
    if (!uid) return;
    const profile = await getProfile(uid);
    setLocale(profile?.locale ?? 'pt-BR');
    const feed = await getFeed(uid);
    setPosts(feed);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!userId || query.trim().length < 2) { setResults([]); return; }
    const handle = setTimeout(() => {
      searchUsers(query, userId).then(setResults).catch(() => {});
    }, 300);
    return () => clearTimeout(handle);
  }, [query, userId]);

  if (!userId) return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('community.feed_title')}</Text>
        <TouchableOpacity onPress={() => router.push('/community/chats')}>
          <Ionicons name="paper-plane-outline" size={22} color={Colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color={Colors.textSecondary} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('community.search_users_placeholder')}
          placeholderTextColor={Colors.textSecondary}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={(u) => u.user_id}
          horizontal
          style={{ maxHeight: 90, marginBottom: Spacing.sm }}
          contentContainerStyle={{ paddingHorizontal: Spacing.md, gap: Spacing.md }}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.resultItem} onPress={() => router.push(`/community/${item.user_id}`)}>
              <View style={styles.resultAvatar}><Text style={styles.resultInitial}>{item.name.charAt(0).toUpperCase()}</Text></View>
              <Text style={styles.resultName} numberOfLines={1}>{item.name}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <TouchableOpacity style={styles.publishRow} onPress={() => router.push('/community/create-post')}>
        <Ionicons name="add-circle" size={20} color={Colors.accent} />
        <Text style={styles.publishText}>{t('community.publish')}</Text>
      </TouchableOpacity>

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: Spacing.md }}
        refreshing={loading}
        onRefresh={load}
        renderItem={({ item }) => (
          <PostCard
            post={item}
            viewerId={userId}
            viewerLocale={locale}
            onPress={() => router.push(`/community/post/${item.id}`)}
            onAuthorPress={() => router.push(`/community/${item.user_id}`)}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.md, paddingTop: Spacing.md },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800' },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: Colors.surfaceAlt,
    borderRadius: Radius.input, margin: Spacing.md, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: 14 },
  resultItem: { alignItems: 'center', width: 64 },
  resultAvatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  resultInitial: { color: Colors.onAccent, fontWeight: '700' },
  resultName: { color: Colors.textPrimary, fontSize: 11, marginTop: 4 },
  publishRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginHorizontal: Spacing.md, marginBottom: Spacing.sm,
    backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input, padding: Spacing.md,
  },
  publishText: { color: Colors.textPrimary, fontWeight: '600', fontSize: 14 },
});
```

Note: this assumes `getProfile(userId): Promise<{ locale: string; ... }>` already exists in `src/services/profile.ts` (used elsewhere in the app, e.g. `app/_layout.tsx`) — confirm the exact export name/shape by reading that file before wiring this import; adjust the destructure if the field is named differently.

- [ ] **Step 2: Manual verification**

Run the app, open the Comunidade tab, confirm the feed loads (empty state is fine before Task 20 lets you create a post), confirm the search box filters as you type, confirm the publish row and chat icon navigate (targets are stubbed until Tasks 20/23 exist — expect a 404/route-not-found screen from Expo Router until then, which is expected mid-plan).

- [ ] **Step 3: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/"app/(tabs)/community.tsx" && git commit -m "$(cat <<'EOF'
feat: add Comunidade feed screen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 20: `app/community/create-post.tsx`

**Files:**
- Create: `app/community/create-post.tsx`

**Interfaces:**
- Consumes: `buildStatsSnapshotForDate`, `createPost` (Task 13); `expo-image-picker` (Task 11).
- Produces: the create-post flow, reachable from Task 19's publish row.

- [ ] **Step 1: Implement**

```tsx
import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, Text, TextInput, TouchableOpacity, View, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { buildStatsSnapshotForDate, createPost, type CommunityStatsSnapshot } from '@/src/services/communityPosts';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CreatePostScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [userId, setUserId] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<CommunityStatsSnapshot | null>(null);
  const [caption, setCaption] = useState('');
  const [photoUri, setPhotoUri] = useState<string | undefined>(undefined);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id;
      if (!uid) return;
      setUserId(uid);
      const snap = await buildStatsSnapshotForDate(uid, todayStr());
      setSnapshot(snap);
    });
  }, []);

  async function pickPhoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  }

  async function handlePublish() {
    if (!userId) return;
    setPublishing(true);
    try {
      await createPost(userId, { dateStr: todayStr(), caption, photoUri });
      router.back();
    } finally {
      setPublishing(false);
    }
  }

  if (!snapshot) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={Colors.accent} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="close" size={24} color={Colors.textPrimary} /></TouchableOpacity>
        <Text style={styles.headerTitle}>{t('community.publish')}</Text>
        <TouchableOpacity onPress={handlePublish} disabled={publishing}>
          {publishing ? <ActivityIndicator color={Colors.accent} /> : <Text style={styles.publishBtn}>{t('community.publish')}</Text>}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.md }}>
        <TextInput
          style={styles.captionInput}
          placeholder={t('community.caption_placeholder')}
          placeholderTextColor={Colors.textSecondary}
          value={caption}
          onChangeText={setCaption}
          multiline
        />

        <TouchableOpacity style={styles.photoPicker} onPress={pickPhoto}>
          {photoUri ? (
            <Image source={{ uri: photoUri }} style={styles.photoPreview} />
          ) : (
            <>
              <Ionicons name="camera-outline" size={22} color={Colors.textSecondary} />
              <Text style={{ color: Colors.textSecondary }}>Foto (opcional)</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.statsRow}>
          {snapshot.platforms.map((p) => (
            <View key={p.name} style={styles.statBox}>
              <Text style={styles.statLabel}>{p.name}</Text>
              <Text style={styles.statValue}>{(p.gross_cents / 100).toFixed(2)}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.previewNote}>
          Ganho do dia: R$ {(snapshot.metrics.earnings_today_cents / 100).toFixed(2)} · {snapshot.metrics.rides_count} corridas
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle: { color: Colors.textPrimary, fontWeight: '700', fontSize: 15 },
  publishBtn: { color: Colors.accent, fontWeight: '700' },
  captionInput: {
    color: Colors.textPrimary, backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input,
    padding: Spacing.md, minHeight: 80, textAlignVertical: 'top', marginBottom: Spacing.md,
  },
  photoPicker: {
    backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input, padding: Spacing.lg,
    alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md, minHeight: 100,
  },
  photoPreview: { width: '100%', height: 160, borderRadius: Radius.input },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.sm },
  statBox: { backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input, padding: Spacing.sm, minWidth: 90 },
  statLabel: { color: Colors.textSecondary, fontSize: 11 },
  statValue: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  previewNote: { color: Colors.textSecondary, fontSize: 12 },
});
```

- [ ] **Step 2: Manual verification**

From the Comunidade tab, tap "Publicar na comunidade", confirm today's stats preview loads, add a caption, optionally pick a photo, publish, and confirm the new post appears at the top of the feed after navigating back.

- [ ] **Step 3: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/app/community/create-post.tsx && git commit -m "$(cat <<'EOF'
feat: add create-post screen for Comunidade

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 21: `app/community/[userId].tsx` (other user's profile)

**Files:**
- Create: `app/community/[userId].tsx`

**Interfaces:**
- Consumes: `getCommunityProfile`, `isFollowing`, `followUser`, `unfollowUser`, `isBlocked`, `blockUser`, `unblockUser`, `hidePost` (Task 12); `getUserPosts` (Task 13); `getOrCreateConversation` (Task 14); `PostCard` (Task 18).

- [ ] **Step 1: Implement**

```tsx
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, Image, SafeAreaView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { getCommunityProfile, isFollowing, followUser, unfollowUser, isBlocked, blockUser, unblockUser, type CommunityProfile } from '@/src/services/community';
import { getUserPosts, type CommunityPost } from '@/src/services/communityPosts';
import { getOrCreateConversation } from '@/src/services/communityChat';
import { getProfile } from '@/src/services/profile';
import { PostCard } from '@/src/components/community/PostCard';

export default function UserProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { userId: targetUserId } = useLocalSearchParams<{ userId: string }>();
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [viewerLocale, setViewerLocale] = useState('pt-BR');
  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [following, setFollowing] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [posts, setPosts] = useState<CommunityPost[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id;
      if (!uid || !targetUserId) return;
      setViewerId(uid);
      const [viewerProfile, p, isFollow, isBlock, userPosts] = await Promise.all([
        getProfile(uid),
        getCommunityProfile(targetUserId),
        isFollowing(uid, targetUserId),
        isBlocked(uid, targetUserId),
        getUserPosts(uid, targetUserId),
      ]);
      setViewerLocale(viewerProfile?.locale ?? 'pt-BR');
      setProfile(p);
      setFollowing(isFollow);
      setBlocked(isBlock);
      setPosts(userPosts);
    });
  }, [targetUserId]);

  async function handleFollowToggle() {
    if (!viewerId || !targetUserId) return;
    if (following) { await unfollowUser(viewerId, targetUserId); setFollowing(false); }
    else { await followUser(viewerId, targetUserId); setFollowing(true); }
  }

  async function handleMessage() {
    if (!viewerId || !targetUserId) return;
    const conversationId = await getOrCreateConversation(viewerId, targetUserId);
    router.push(`/community/chat/${conversationId}`);
  }

  function handleBlockToggle() {
    if (!viewerId || !targetUserId) return;
    if (blocked) { unblockUser(viewerId, targetUserId).then(() => setBlocked(false)); return; }
    Alert.alert(t('community.confirm_block_title'), t('community.confirm_block_body'), [
      { text: 'Cancelar', style: 'cancel' },
      { text: t('community.block'), style: 'destructive', onPress: () => blockUser(viewerId, targetUserId).then(() => setBlocked(true)) },
    ]);
  }

  if (!profile) return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={24} color={Colors.textPrimary} /></TouchableOpacity>
        <Text style={styles.topBarTitle}>{profile.name}</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={posts}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: Spacing.md }}
        ListHeaderComponent={
          <View style={{ marginBottom: Spacing.md }}>
            {profile.cover_url && <Image source={{ uri: profile.cover_url }} style={styles.cover} />}
            <View style={styles.profileHeader}>
              {profile.avatar_url ? (
                <Image source={{ uri: profile.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarInitial}>{profile.name.charAt(0).toUpperCase()}</Text></View>
              )}
              <Text style={styles.name}>{profile.name}</Text>
              <Text style={styles.location}>{[profile.city, profile.state, profile.country].filter(Boolean).join(' · ')}</Text>
              <View style={styles.countsRow}>
                <Text style={styles.count}>{profile.followers_count} {t('community.followers')}</Text>
                <Text style={styles.count}>{profile.following_count} {t('community.following')}</Text>
              </View>
              <View style={styles.actionsRow}>
                <TouchableOpacity style={[styles.followBtn, following && styles.followingBtn]} onPress={handleFollowToggle}>
                  <Text style={styles.followBtnText}>{following ? t('community.unfollow') : t('community.follow')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconBtn} onPress={handleMessage}>
                  <Ionicons name="paper-plane-outline" size={18} color={Colors.textPrimary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconBtn} onPress={handleBlockToggle}>
                  <Ionicons name={blocked ? 'checkmark-circle-outline' : 'ban-outline'} size={18} color={Colors.error} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <PostCard
            post={item}
            viewerId={viewerId ?? ''}
            viewerLocale={viewerLocale}
            onPress={() => router.push(`/community/post/${item.id}`)}
            onAuthorPress={() => {}}
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  topBarTitle: { color: Colors.textPrimary, fontWeight: '700', fontSize: 15 },
  cover: { width: '100%', height: 120, borderRadius: Radius.card, marginBottom: -30 },
  profileHeader: { alignItems: 'center' },
  avatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: Colors.accent },
  avatarFallback: { backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: Colors.onAccent, fontSize: 24, fontWeight: '700' },
  name: { color: Colors.textPrimary, fontSize: 18, fontWeight: '700', marginTop: Spacing.sm },
  location: { color: Colors.textSecondary, fontSize: 12 },
  countsRow: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.sm },
  count: { color: Colors.textSecondary, fontSize: 12 },
  actionsRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  followBtn: { backgroundColor: Colors.success, borderRadius: Radius.button, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  followingBtn: { backgroundColor: Colors.surfaceAlt },
  followBtnText: { color: Colors.textPrimary, fontWeight: '700' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
});
```

- [ ] **Step 2: Manual verification**

From the feed's search results (Task 19) or a post's author name, navigate to another test user's profile, confirm follow/unfollow toggles and updates `followers_count`, confirm the message icon opens (or creates) a chat, confirm block/unblock works and that a blocked user's posts disappear from your own feed on next load (per the `community_posts` RLS policy from Task 3).

- [ ] **Step 3: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/app/community/[userId].tsx && git commit -m "$(cat <<'EOF'
feat: add community user profile screen (follow/DM/block)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 22: `app/community/post/[postId].tsx` (post detail + comments)

**Files:**
- Create: `app/community/post/[postId].tsx`

**Interfaces:**
- Consumes: `getComments`, `addComment` (Task 13); `hidePost` (Task 12); `PostCard` (Task 18).

- [ ] **Step 1: Implement**

```tsx
import React, { useEffect, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, SafeAreaView, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { getFeed, getComments, addComment, type CommunityPost, type PostComment } from '@/src/services/communityPosts';
import { hidePost } from '@/src/services/community';
import { getProfile } from '@/src/services/profile';
import { PostCard } from '@/src/components/community/PostCard';

export default function PostDetailScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const [viewerId, setViewerId] = useState<string | null>(null);
  const [viewerLocale, setViewerLocale] = useState('pt-BR');
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<PostComment[]>([]);
  const [commentText, setCommentText] = useState('');

  async function loadComments() {
    if (!postId) return;
    setComments(await getComments(postId));
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id;
      if (!uid || !postId) return;
      setViewerId(uid);
      const [viewerProfile, feed] = await Promise.all([getProfile(uid), getFeed(uid, { limit: 50 })]);
      setViewerLocale(viewerProfile?.locale ?? 'pt-BR');
      setPost(feed.find((p) => p.id === postId) ?? null);
      await loadComments();
    });
  }, [postId]);

  async function handleSendComment() {
    if (!viewerId || !postId || !commentText.trim()) return;
    await addComment(viewerId, postId, commentText.trim());
    setCommentText('');
    await loadComments();
  }

  function handleReport() {
    if (!viewerId || !postId) return;
    Alert.alert(t('community.confirm_report_title'), t('community.confirm_report_body'), [
      { text: 'Cancelar', style: 'cancel' },
      { text: t('community.report'), style: 'destructive', onPress: () => hidePost(viewerId, postId, 'reported').then(() => router.back()) },
    ]);
  }

  if (!post) return null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={24} color={Colors.textPrimary} /></TouchableOpacity>
          <Text style={styles.topBarTitle}>{t('community.comments_title')}</Text>
          <TouchableOpacity onPress={handleReport}><Ionicons name="flag-outline" size={20} color={Colors.error} /></TouchableOpacity>
        </View>

        <FlatList
          data={comments}
          keyExtractor={(c) => c.id}
          contentContainerStyle={{ padding: Spacing.md }}
          ListHeaderComponent={
            <PostCard post={post} viewerId={viewerId ?? ''} viewerLocale={viewerLocale} onPress={() => {}} onAuthorPress={() => router.push(`/community/${post.user_id}`)} />
          }
          renderItem={({ item }) => (
            <View style={styles.commentRow}>
              <Text style={styles.commentAuthor}>{item.author_name}</Text>
              <Text style={styles.commentBody}>{item.body}</Text>
            </View>
          )}
        />

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder={t('community.add_comment_placeholder')}
            placeholderTextColor={Colors.textSecondary}
            value={commentText}
            onChangeText={setCommentText}
          />
          <TouchableOpacity onPress={handleSendComment}><Ionicons name="send" size={20} color={Colors.accent} /></TouchableOpacity>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  topBarTitle: { color: Colors.textPrimary, fontWeight: '700', fontSize: 15 },
  commentRow: { backgroundColor: Colors.surfaceAlt, borderRadius: Radius.input, padding: Spacing.sm, marginBottom: Spacing.sm },
  commentAuthor: { color: Colors.textPrimary, fontWeight: '700', fontSize: 12 },
  commentBody: { color: Colors.textPrimary, fontSize: 13 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border },
  input: { flex: 1, color: Colors.textPrimary, backgroundColor: Colors.surfaceAlt, borderRadius: Radius.button, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
});
```

Note: reusing `getFeed(uid, { limit: 50 })` to locate a single post by id is a placeholder-free but not-ideal lookup; if this proves too slow/limited in manual testing, add a dedicated `getPostById(viewerId, postId)` to `communityPosts.ts` following the same `hydratePosts` helper — flagged here rather than silently left as a TODO, since the plan must ship something that actually works for the manual verification step below.

- [ ] **Step 2: Manual verification**

Open a post from the feed, add a comment, confirm it appears and `comments_count` increments on the card; confirm reporting the post navigates back and the post no longer appears in your own feed (via `hidden_posts`).

- [ ] **Step 3: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/app/community/post/[postId].tsx && git commit -m "$(cat <<'EOF'
feat: add post detail/comments screen for Comunidade

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 23: `app/community/chats.tsx` (conversation list)

**Files:**
- Create: `app/community/chats.tsx`

**Interfaces:**
- Consumes: `getConversations` (Task 14).

- [ ] **Step 1: Implement**

```tsx
import React, { useEffect, useState } from 'react';
import { FlatList, Image, SafeAreaView, Text, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Spacing } from '@/src/theme';
import { getConversations, type ChatConversation } from '@/src/services/communityChat';

export default function ChatsListScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [conversations, setConversations] = useState<ChatConversation[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      const uid = data.user?.id;
      if (!uid) return;
      setConversations(await getConversations(uid));
    });
  }, []);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={24} color={Colors.textPrimary} /></TouchableOpacity>
        <Text style={styles.topBarTitle}>{t('community.chat_title')}</Text>
        <View style={{ width: 24 }} />
      </View>
      <FlatList
        data={conversations}
        keyExtractor={(c) => c.id}
        contentContainerStyle={{ padding: Spacing.md }}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => router.push(`/community/chat/${item.id}`)}>
            {item.other_avatar_url ? (
              <Image source={{ uri: item.other_avatar_url }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, styles.avatarFallback]}><Text style={styles.avatarInitial}>{item.other_name.charAt(0).toUpperCase()}</Text></View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{item.other_name}</Text>
              <Text style={styles.lastMessage} numberOfLines={1}>{item.last_message ?? ''}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: Spacing.md },
  topBarTitle: { color: Colors.textPrimary, fontWeight: '700', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarFallback: { backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: Colors.onAccent, fontWeight: '700' },
  name: { color: Colors.textPrimary, fontWeight: '700', fontSize: 14 },
  lastMessage: { color: Colors.textSecondary, fontSize: 12 },
});
```

- [ ] **Step 2: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/app/community/chats.tsx && git commit -m "$(cat <<'EOF'
feat: add DM conversation list screen

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 24: `app/community/chat/[conversationId].tsx` (realtime chat)

**Files:**
- Create: `app/community/chat/[conversationId].tsx`

**Interfaces:**
- Consumes: `getMessages`, `sendMessage`, `subscribeToConversation` (Task 14).

- [ ] **Step 1: Implement**

```tsx
import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Image, KeyboardAvoidingView, Platform, SafeAreaView, Text, TextInput, TouchableOpacity, View, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import { supabase } from '@/src/lib/supabase';
import { Colors, Radius, Spacing } from '@/src/theme';
import { getMessages, sendMessage, subscribeToConversation, type ChatMessage } from '@/src/services/communityChat';

export default function ChatScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const [userId, setUserId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);

  useEffect(() => {
    if (!conversationId) return;
    supabase.auth.getUser().then(async ({ data }) => {
      setUserId(data.user?.id ?? null);
      setMessages(await getMessages(conversationId));
    });

    const unsubscribe = subscribeToConversation(conversationId, (msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    return unsubscribe;
  }, [conversationId]);

  async function handleSend() {
    if (!conversationId || !userId || !text.trim()) return;
    const body = text.trim();
    setText('');
    await sendMessage(conversationId, userId, { body });
  }

  async function handlePickImage() {
    if (!conversationId || !userId) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (!result.canceled) await sendMessage(conversationId, userId, { imageUri: result.assets[0].uri });
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SafeAreaView style={{ flex: 1, backgroundColor: Colors.background }}>
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={24} color={Colors.textPrimary} /></TouchableOpacity>
        </View>

        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: Spacing.md }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.sender_id === userId ? styles.bubbleMine : styles.bubbleTheirs]}>
              {item.image_url && <Image source={{ uri: item.image_url }} style={styles.bubbleImage} />}
              {item.body && <Text style={styles.bubbleText}>{item.body}</Text>}
            </View>
          )}
        />

        <View style={styles.inputRow}>
          <TouchableOpacity onPress={handlePickImage}><Ionicons name="image-outline" size={22} color={Colors.textSecondary} /></TouchableOpacity>
          <TextInput
            style={styles.input}
            placeholder={t('community.chat_placeholder')}
            placeholderTextColor={Colors.textSecondary}
            value={text}
            onChangeText={setText}
          />
          <TouchableOpacity onPress={handleSend}><Ionicons name="send" size={20} color={Colors.accent} /></TouchableOpacity>
        </View>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', padding: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.border },
  bubble: { maxWidth: '75%', borderRadius: Radius.input, padding: Spacing.sm, marginBottom: Spacing.sm },
  bubbleMine: { alignSelf: 'flex-end', backgroundColor: Colors.accent },
  bubbleTheirs: { alignSelf: 'flex-start', backgroundColor: Colors.surfaceAlt },
  bubbleText: { color: Colors.textPrimary, fontSize: 14 },
  bubbleImage: { width: 180, height: 180, borderRadius: Radius.input, marginBottom: 4 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, padding: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border },
  input: { flex: 1, color: Colors.textPrimary, backgroundColor: Colors.surfaceAlt, borderRadius: Radius.button, paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
});
```

- [ ] **Step 2: Manual verification**

Between two test devices/accounts logged in simultaneously, open the same conversation and confirm a message sent from one appears on the other **without reloading** (this is the Realtime subscription from Task 14 firing) — this is the key end-to-end proof that `ALTER PUBLICATION supabase_realtime ADD TABLE dm_messages` (Task 4) actually took effect. Also confirm image messages send/display, and confirm the receiving device gets a native push notification (Task 6) when the app is backgrounded.

- [ ] **Step 3: Commit**

```bash
cd "D:/1. Google Drive Bluesun/App Calculo Uber" && git add app-motorista/app/community/chat/[conversationId].tsx && git commit -m "$(cat <<'EOF'
feat: add realtime 1:1 chat screen for Comunidade

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-plan note (not a task)

This plan does not include: an admin moderation queue (explicitly deferred per the spec), avatar/cover editing UI (the `updateCommunityProfile`/`uploadCommunityImage` services exist from Tasks 11-12, but no screen calls them yet — wiring an "edit profile" entry point, likely from `more.tsx`, is a natural fast-follow once this ships and is worth a one-task addendum rather than scope creep here), and the separate Obsidian release-checklist items (Play Store translations, Stripe live webhook events, node_modules cleanup, MonthHistoryCard restyle, Android 15 deprecated APIs) — those stay tracked independently and are not blocked by or blocking this plan.
