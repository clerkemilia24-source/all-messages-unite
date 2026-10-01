create table public.social_follows (
  follower_id uuid not null references auth.users(id) on delete cascade,
  following_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint social_follows_no_self check (follower_id <> following_id)
);
create index social_follows_following on public.social_follows (following_id, created_at desc);
alter table public.social_follows enable row level security;
grant select, insert, delete on public.social_follows to authenticated;
grant all on public.social_follows to service_role;
create policy "users see their follow edges" on public.social_follows
  for select to authenticated using (follower_id = auth.uid() or following_id = auth.uid());
create policy "users follow other accounts" on public.social_follows
  for insert to authenticated with check (follower_id = auth.uid() and follower_id <> following_id);
create policy "users unfollow accounts" on public.social_follows
  for delete to authenticated using (follower_id = auth.uid());

create table public.social_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  body text,
  media_path text,
  media_type text,
  visibility text not null default 'public' check (visibility in ('public', 'followers')),
  moderation_status text not null default 'pending'
    check (moderation_status in ('pending', 'approved', 'blocked', 'review')),
  repost_of uuid references public.social_posts(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint social_posts_has_content check (
    nullif(btrim(body), '') is not null or media_path is not null or repost_of is not null
  )
);
create index social_posts_feed on public.social_posts (created_at desc)
  where moderation_status = 'approved';
create index social_posts_author on public.social_posts (author_id, created_at desc);
alter table public.social_posts enable row level security;
grant select, delete on public.social_posts to authenticated;
grant all on public.social_posts to service_role;
create policy "read approved visible social posts" on public.social_posts
  for select to authenticated using (
    moderation_status = 'approved' and (
      author_id = auth.uid() or visibility = 'public' or exists (
        select 1 from public.social_follows f
        where f.follower_id = auth.uid() and f.following_id = author_id
      )
    )
  );
create policy "authors delete their social posts" on public.social_posts
  for delete to authenticated using (author_id = auth.uid());

create table public.social_post_likes (
  post_id uuid not null references public.social_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
alter table public.social_post_likes enable row level security;
grant select, insert, delete on public.social_post_likes to authenticated;
grant all on public.social_post_likes to service_role;
create policy "read likes for visible posts" on public.social_post_likes
  for select to authenticated using (exists (
    select 1 from public.social_posts p where p.id = post_id
  ));
create policy "users like visible posts" on public.social_post_likes
  for insert to authenticated with check (
    user_id = auth.uid() and exists (select 1 from public.social_posts p where p.id = post_id)
  );
create policy "users remove their likes" on public.social_post_likes
  for delete to authenticated using (user_id = auth.uid());

create table public.social_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  moderation_status text not null default 'pending'
    check (moderation_status in ('pending', 'approved', 'blocked', 'review')),
  created_at timestamptz not null default now()
);
create index social_post_comments_post on public.social_post_comments (post_id, created_at);
alter table public.social_post_comments enable row level security;
grant select, delete on public.social_post_comments to authenticated;
grant all on public.social_post_comments to service_role;
create policy "read approved comments on visible posts" on public.social_post_comments
  for select to authenticated using (
    moderation_status = 'approved' and exists (
      select 1 from public.social_posts p where p.id = post_id
    )
  );
create policy "authors delete their comments" on public.social_post_comments
  for delete to authenticated using (author_id = auth.uid());

create table public.social_post_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam', 'harassment', 'violence', 'sexual', 'other')),
  details text,
  created_at timestamptz not null default now(),
  unique (post_id, reporter_id)
);
alter table public.social_post_reports enable row level security;
grant select on public.social_post_reports to authenticated;
grant all on public.social_post_reports to service_role;
create policy "reporters see their own reports" on public.social_post_reports
  for select to authenticated using (reporter_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'feed-review', 'feed-review', false, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/quicktime']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "users upload feed media to private review" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'feed-review' and owner = auth.uid()
    and (storage.foldername(name))[1] = auth.uid()::text
  );
create policy "users delete their private feed media" on storage.objects
  for delete to authenticated using (
    bucket_id = 'feed-review' and owner = auth.uid()
  );