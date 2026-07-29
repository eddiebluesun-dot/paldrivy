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
