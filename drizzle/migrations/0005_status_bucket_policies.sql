create policy "auth read status media" on storage.objects for select to authenticated
using (
  bucket_id = 'status' and exists (
    select 1 from public.status_posts p
    where p.media_url = name and p.expires_at > now()
      and (p.author_id = auth.uid() or private.shares_conversation(p.author_id, auth.uid()))
  )
);

create policy "auth upload own status media" on storage.objects for insert to authenticated
with check (bucket_id = 'status' and owner = auth.uid() and (storage.foldername(name))[1] = auth.uid()::text);

create policy "auth delete own status media" on storage.objects for delete to authenticated
using (bucket_id = 'status' and owner = auth.uid());