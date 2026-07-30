-- Comunidade: quem pode comentar nos posts de cada motorista, + UPDATE policy
-- que faltava em community_posts (necessária pra editar posts e também corrige
-- um bug silencioso: createPost() já tentava dar UPDATE no photo_url logo após
-- o INSERT, mas não havia policy de UPDATE — a foto nunca era anexada).

ALTER TABLE community_profiles
  ADD COLUMN comments_permission text NOT NULL DEFAULT 'everyone'
    CHECK (comments_permission IN ('everyone', 'followers', 'nobody'));

CREATE POLICY "community_posts: editar proprio"
  ON community_posts FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE OR REPLACE FUNCTION fn_can_comment(p_post_id uuid, p_commenter uuid) RETURNS boolean
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_owner uuid;
  v_permission text;
BEGIN
  SELECT user_id INTO v_owner FROM community_posts WHERE id = p_post_id;
  IF v_owner IS NULL THEN RETURN false; END IF;
  IF v_owner = p_commenter THEN RETURN true; END IF;

  SELECT comments_permission INTO v_permission FROM community_profiles WHERE user_id = v_owner;
  v_permission := COALESCE(v_permission, 'everyone');

  IF v_permission = 'nobody' THEN RETURN false; END IF;
  IF v_permission = 'everyone' THEN RETURN true; END IF;
  IF v_permission = 'followers' THEN
    RETURN EXISTS (SELECT 1 FROM user_follows WHERE follower_id = p_commenter AND followed_id = v_owner);
  END IF;
  RETURN false;
END;
$$;

DROP POLICY IF EXISTS "post_comments: comentar" ON post_comments;
CREATE POLICY "post_comments: respeita permissao do autor"
  ON post_comments FOR INSERT
  WITH CHECK (user_id = auth.uid() AND fn_can_comment(post_id, auth.uid()));
