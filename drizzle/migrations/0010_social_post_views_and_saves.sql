create table public.social_post_views (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_on date not null default (timezone('utc', now()))::date,
  primary key (post_id, viewer_id, viewed_on)
);
create index social_post_views_post_day on public.social_post_views (post_id, viewed_on desc);
alter table public.social_post_views enable row level security;

create table public.social_post_saves (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.social_post_saves enable row level security;
grant select, insert, delete on public.social_post_saves to authenticated;
grant all on public.social_post_saves to service_role;
create policy "users read their visible saved posts" on public.social_post_saves
  for select to authenticated using (
    user_id = auth.uid() and exists (
      select 1 from public.social_posts p where p.id = post_id
    )
  );
create policy "users save visible posts" on public.social_post_saves
  for insert to authenticated with check (
    user_id = auth.uid() and exists (
      select 1 from public.social_posts p where p.id = post_id
    )
  );
create policy "users unsave their posts" on public.social_post_saves
  for delete to authenticated using (user_id = auth.uid());

create or replace function public.record_social_post_view(_post_id uuid)
returns boolean language plpgsql security definer
set search_path = public, private, pg_temp as $$
declare
  viewer uuid := auth.uid();
begin
  if viewer is null then
    raise exception 'Authentication required';
  end if;

  insert into public.social_post_views (post_id, viewer_id)
  select p.id, viewer
  from public.social_posts p
  where p.id = _post_id
    and p.moderation_status = 'approved'
    and p.author_id <> viewer
    and (
      p.visibility = 'public'
      or exists (
        select 1 from public.social_follows f
        where f.follower_id = viewer and f.following_id = p.author_id
      )
    )
  on conflict (post_id, viewer_id, viewed_on) do nothing;

  return found;
end;
$$;
revoke all on function public.record_social_post_view(uuid) from public, anon;
grant execute on function public.record_social_post_view(uuid) to authenticated;

create or replace function public.get_social_post_view_counts(_post_ids uuid[])
returns table(post_id uuid, view_count bigint)
language sql stable security definer
set search_path = public, private, pg_temp as $$
  select p.id, count(v.viewer_id)
  from public.social_posts p
  left join public.social_post_views v on v.post_id = p.id
  where auth.uid() is not null
    and p.id = any(_post_ids)
    and p.moderation_status = 'approved'
    and (
      p.author_id = auth.uid()
      or p.visibility = 'public'
      or exists (
        select 1 from public.social_follows f
        where f.follower_id = auth.uid() and f.following_id = p.author_id
      )
    )
  group by p.id;
$$;
revoke all on function public.get_social_post_view_counts(uuid[]) from public, anon;
grant execute on function public.get_social_post_view_counts(uuid[]) to authenticated;