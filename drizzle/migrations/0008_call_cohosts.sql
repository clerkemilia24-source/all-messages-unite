create table public.call_cohosts (
  call_id uuid not null references public.call_sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (call_id, user_id)
);

grant select on public.call_cohosts to authenticated;
grant all on public.call_cohosts to service_role;
alter table public.call_cohosts enable row level security;

create policy "conversation members read call cohosts" on public.call_cohosts
  for select to authenticated using (
    exists (
      select 1 from public.call_sessions c
      where c.id = call_id and private.is_member(c.conversation_id, auth.uid())
    )
  );

create or replace function public.set_call_cohost(_call_id uuid, _user_id uuid, _is_cohost boolean)
returns void language plpgsql security definer set search_path = public, private, pg_temp as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.call_sessions c
    where c.id = _call_id and c.initiator_id = auth.uid()
      and c.status in ('ringing', 'accepted')
  ) then
    raise exception 'Only the active call host may change co-hosts';
  end if;

  if not exists (
    select 1 from public.call_sessions c
    join public.conversation_members m on m.conversation_id = c.conversation_id
    where c.id = _call_id and m.user_id = _user_id
  ) then
    raise exception 'Co-host must be a member of the call conversation';
  end if;

  if _is_cohost then
    insert into public.call_cohosts (call_id, user_id)
    values (_call_id, _user_id)
    on conflict (call_id, user_id) do nothing;
  else
    delete from public.call_cohosts where call_id = _call_id and user_id = _user_id;
  end if;
end;
$$;

revoke all on function public.set_call_cohost(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_call_cohost(uuid, uuid, boolean) to authenticated;

alter table public.call_cohosts replica identity full;
alter publication supabase_realtime add table public.call_cohosts;