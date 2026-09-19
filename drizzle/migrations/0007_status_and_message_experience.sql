-- Stage 2 status interactions and richer message metadata.
-- Calling tables and policies are intentionally unchanged.
alter table public.status_posts
  add column if not exists audience_mode text not null default 'contacts'
    check (audience_mode in ('contacts', 'except', 'only')),
  add column if not exists audience_ids uuid[] not null default '{}',
  add column if not exists is_highlighted boolean not null default false;

alter table public.messages
  add column if not exists attachment_name text,
  add column if not exists attachment_size bigint,
  add column if not exists media_duration integer,
  add column if not exists media_kind text;

create table public.status_reactions (
  status_id uuid not null references public.status_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (status_id, user_id)
);

grant select, insert, update, delete on public.status_reactions to authenticated;
alter table public.status_reactions enable row level security;
create policy "status reactions are visible to shared viewers" on public.status_reactions
  for select to authenticated using (
    user_id = auth.uid() or exists (
      select 1 from public.status_posts p
      where p.id = status_id and (p.author_id = auth.uid() or private.shares_conversation(p.author_id, auth.uid()))
    )
  );
create policy "users manage their status reactions" on public.status_reactions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.status_replies (
  id uuid primary key default gen_random_uuid(),
  status_id uuid not null references public.status_posts(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

grant select, insert on public.status_replies to authenticated;
alter table public.status_replies enable row level security;
create policy "status replies are private to author and sender" on public.status_replies
  for select to authenticated using (
    sender_id = auth.uid() or exists (select 1 from public.status_posts p where p.id = status_id and p.author_id = auth.uid())
  );
create policy "users send status replies" on public.status_replies
  for insert to authenticated with check (sender_id = auth.uid());

create table public.status_mutes (
  user_id uuid not null references auth.users(id) on delete cascade,
  muted_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, muted_user_id)
);

grant select, insert, delete on public.status_mutes to authenticated;
alter table public.status_mutes enable row level security;
create policy "users manage their status mutes" on public.status_mutes
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create table public.status_highlights (
  user_id uuid not null references auth.users(id) on delete cascade,
  status_id uuid not null references public.status_posts(id) on delete cascade,
  saved_at timestamptz not null default now(),
  primary key (user_id, status_id)
);

grant select, insert, delete on public.status_highlights to authenticated;
alter table public.status_highlights enable row level security;
create policy "users manage their highlights" on public.status_highlights
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

alter publication supabase_realtime add table public.status_reactions;
alter publication supabase_realtime add table public.status_replies;
