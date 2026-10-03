create or replace function private.can_view_status(_status_id uuid, _viewer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select _viewer_id = auth.uid() and exists (
    select 1
    from public.status_posts p
    join public.profiles author_profile on author_profile.id = p.author_id
    where p.id = _status_id
      and (
        p.author_id = _viewer_id
        or (
          p.expires_at > now()
          and author_profile.status_visible
          and private.shares_conversation(p.author_id, _viewer_id)
          and case p.audience_mode
            when 'only' then _viewer_id = any(p.audience_ids)
            when 'except' then not (_viewer_id = any(p.audience_ids))
            else true
          end
        )
      )
  );
$$;
revoke all on function private.can_view_status(uuid, uuid) from public, anon;
grant execute on function private.can_view_status(uuid, uuid) to authenticated, service_role;

drop policy if exists "read own or shared statuses" on public.status_posts;
create policy "read visible statuses" on public.status_posts
  for select to authenticated using (
    private.can_view_status(id, auth.uid())
  );

drop policy if exists "auth read status media" on storage.objects;
create policy "auth read status media" on storage.objects
  for select to authenticated using (
    bucket_id = 'status' and exists (
      select 1 from public.status_posts p
      where p.media_url = name
        and private.can_view_status(p.id, auth.uid())
    )
  );

drop policy if exists "record own view" on public.status_views;
create policy "record own view" on public.status_views
  for insert to authenticated with check (
    viewer_id = auth.uid()
    and private.can_view_status(status_id, auth.uid())
  );

drop policy if exists "status reactions are visible to shared viewers" on public.status_reactions;
create policy "status reactions are visible to viewers" on public.status_reactions
  for select to authenticated using (
    user_id = auth.uid()
    or private.can_view_status(status_id, auth.uid())
  );

drop policy if exists "users manage their status reactions" on public.status_reactions;
create policy "users add visible status reactions" on public.status_reactions
  for insert to authenticated with check (
    user_id = auth.uid()
    and private.can_view_status(status_id, auth.uid())
  );
create policy "users update their visible status reactions" on public.status_reactions
  for update to authenticated using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and private.can_view_status(status_id, auth.uid())
  );
create policy "users remove their status reactions" on public.status_reactions
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "users send status replies" on public.status_replies;
create policy "users reply to visible statuses" on public.status_replies
  for insert to authenticated with check (
    sender_id = auth.uid()
    and private.can_view_status(status_id, auth.uid())
  );