create table public.live_streams (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 2 and 160),
  room_name text not null unique,
  status text not null default 'starting'
    check (status in ('starting', 'live', 'ended')),
  chat_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  constraint live_stream_lifecycle check (
    (status = 'starting' and started_at is null and ended_at is null)
    or (status = 'live' and started_at is not null and ended_at is null)
    or (status = 'ended' and ended_at is not null)
  )
);
create index live_streams_discovery on public.live_streams (started_at desc)
  where status = 'live';
create index live_streams_host on public.live_streams (host_id, created_at desc);
create unique index live_streams_one_open_per_host on public.live_streams (host_id)
  where status in ('starting', 'live');
alter table public.live_streams enable row level security;
grant select, insert on public.live_streams to authenticated;
grant all on public.live_streams to service_role;
create policy "read live streams or own sessions" on public.live_streams
  for select to authenticated using (status = 'live' or host_id = auth.uid());
create policy "hosts create starting streams" on public.live_streams
  for insert to authenticated with check (
    host_id = auth.uid() and status = 'starting' and started_at is null and ended_at is null
  );

create or replace function public.set_live_stream_status(_stream_id uuid, _next_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if _next_status not in ('live', 'ended') then
    raise exception 'Invalid live stream transition';
  end if;

  update public.live_streams
  set status = _next_status,
      started_at = case when _next_status = 'live' then now() else started_at end,
      ended_at = case when _next_status = 'ended' then now() else null end
  where id = _stream_id
    and host_id = auth.uid()
    and (
      (status = 'starting' and _next_status in ('live', 'ended'))
      or (status = 'live' and _next_status = 'ended')
    );
  return found;
end;
$$;
revoke all on function public.set_live_stream_status(uuid, text) from public, anon;
grant execute on function public.set_live_stream_status(uuid, text) to authenticated;

create table public.live_chat_messages (
  id uuid primary key default gen_random_uuid(),
  stream_id uuid not null references public.live_streams(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index live_chat_stream on public.live_chat_messages (stream_id, created_at desc);
alter table public.live_chat_messages enable row level security;
grant select, insert, delete on public.live_chat_messages to authenticated;
grant all on public.live_chat_messages to service_role;
create policy "read chat for live streams or host" on public.live_chat_messages
  for select to authenticated using (
    exists (
      select 1 from public.live_streams s
      where s.id = stream_id and (s.status = 'live' or s.host_id = auth.uid())
    )
  );
create policy "viewers send chat to live streams" on public.live_chat_messages
  for insert to authenticated with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.live_streams s
      where s.id = stream_id and s.status = 'live' and s.chat_enabled
    )
  );
create policy "hosts moderate live chat" on public.live_chat_messages
  for delete to authenticated using (
    sender_id = auth.uid()
    or exists (
      select 1 from public.live_streams s
      where s.id = stream_id and s.host_id = auth.uid()
    )
  );

alter publication supabase_realtime add table public.live_streams;
alter publication supabase_realtime add table public.live_chat_messages;