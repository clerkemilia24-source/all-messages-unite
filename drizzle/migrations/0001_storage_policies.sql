CREATE POLICY "auth read attachments" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'attachments');
CREATE POLICY "auth upload attachments" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'attachments' AND owner = auth.uid());
CREATE POLICY "auth delete own attachments" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'attachments' AND owner = auth.uid());

CREATE POLICY "auth read avatars" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars');
CREATE POLICY "auth upload avatars" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND owner = auth.uid());
CREATE POLICY "auth update own avatars" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid());
CREATE POLICY "auth delete own avatars" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND owner = auth.uid());