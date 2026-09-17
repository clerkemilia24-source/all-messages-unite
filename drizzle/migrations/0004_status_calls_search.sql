-- helper: do two users share a conversation?
create or replace function private.shares_conversation(_a uuid, _b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.conversation_members x
    join public.conversation_members y on y.conversation_id = x.conversation_id
    where x.user_id = _a and y.user_id = _b
  );
$$;
revoke all on function private.shares_conversation(uuid, uuid) from public;
grant execute on function private.shares_conversation(uuid, uuid) to authenticated, service_role;

-- message search index
create extension if not exists pg_trgm with schema public;
create index if not exists messages_body_trgm on public.messages using gin (body public.gin_trgm_ops);
create index if not exists messages_conversation_created on public.messages (conversation_id, created_at desc);

-- status posts
create table public.status_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('photo','video','text')),
  media_url text,
  media_type text,
  body text,
  background text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index status_posts_author_created on public.status_posts (author_id, created_at desc);
create index status_posts_expires on public.status_posts (expires_at);

grant select, insert, delete on public.status_posts to authenticated;
grant all on public.status_posts to service_role;
alter table public.status_posts enable row level security;

create policy "read own or shared statuses" on public.status_posts for select to authenticated
using (author_id = auth.uid() or (expires_at > now() and private.shares_conversation(author_id, auth.uid())));
create policy "insert own status" on public.status_posts for insert to authenticated
with check (author_id = auth.uid());
create policy "delete own status" on public.status_posts for delete to authenticated
using (author_id = auth.uid());

-- status views
create table public.status_views (
  status_id uuid not null references public.status_posts(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (status_id, viewer_id)
);
grant select, insert on public.status_views to authenticated;
grant all on public.status_views to service_role;
alter table public.status_views enable row level security;

create policy "author or viewer reads views" on public.status_views for select to authenticated
using (viewer_id = auth.uid() or exists (select 1 from public.status_posts p where p.id = status_id and p.author_id = auth.uid()));
create policy "record own view" on public.status_views for insert to authenticated
with check (viewer_id = auth.uid() and exists (
  select 1 from public.status_posts p where p.id = status_id and p.expires_at > now()
    and (p.author_id = auth.uid() or private.shares_conversation(p.author_id, auth.uid()))
));

-- calls
create table public.call_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  room_name text not null unique,
  initiator_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('audio','video')),
  status text not null default 'ringing' check (status in ('ringing','accepted','declined','missed','ended')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz
);
create index call_sessions_conversation_created on public.call_sessions (conversation_id, created_at desc);

grant select, insert, update on public.call_sessions to authenticated;
grant all on public.call_sessions to service_role;
alter table public.call_sessions enable row level security;

create policy "members read calls" on public.call_sessions for select to authenticated
using (private.is_member(conversation_id, auth.uid()));
create policy "members start calls" on public.call_sessions for insert to authenticated
with check (initiator_id = auth.uid() and private.is_member(conversation_id, auth.uid()));
create policy "members update calls" on public.call_sessions for update to authenticated
using (private.is_member(conversation_id, auth.uid()))
with check (private.is_member(conversation_id, auth.uid()));

alter table public.status_posts replica identity full;
alter table public.call_sessions replica identity full;
alter publication supabase_realtime add table public.status_posts;
alter publication supabase_realtime add table public.status_views;
alter publication supabase_realtime add table public.call_sessions;