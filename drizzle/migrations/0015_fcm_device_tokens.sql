create table public.push_device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  installation_id uuid not null,
  token text not null unique check (char_length(token) between 100 and 4096),
  platform text not null default 'web' check (platform = 'web'),
  user_agent text check (user_agent is null or char_length(user_agent) <= 512),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, installation_id)
);
create index push_device_tokens_user on public.push_device_tokens (user_id, last_seen_at desc);
alter table public.push_device_tokens enable row level security;
grant select, delete on public.push_device_tokens to authenticated;
grant insert (user_id, installation_id, token, platform, user_agent) on public.push_device_tokens to authenticated;
grant update (token, platform, user_agent, last_seen_at) on public.push_device_tokens to authenticated;
grant all on public.push_device_tokens to service_role;
create policy "users read their push devices" on public.push_device_tokens
  for select to authenticated using (user_id = auth.uid());
create policy "users register their push devices" on public.push_device_tokens
  for insert to authenticated with check (user_id = auth.uid());
create policy "users refresh their push devices" on public.push_device_tokens
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users remove their push devices" on public.push_device_tokens
  for delete to authenticated using (user_id = auth.uid());