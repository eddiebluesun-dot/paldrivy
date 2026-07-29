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
