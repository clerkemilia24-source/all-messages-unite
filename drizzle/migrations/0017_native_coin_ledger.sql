create table public.coin_policy (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  transfer_fee_bps integer not null default 0 check (transfer_fee_bps between 0 and 10000),
  max_transfer_minor bigint not null default 1000000 check (max_transfer_minor > 0),
  max_supply bigint not null default 1000000000000 check (max_supply > 0),
  updated_at timestamptz not null default now()
);
alter table public.coin_policy enable row level security;
grant select on public.coin_policy to authenticated;
grant all on public.coin_policy to service_role;
create policy "users read coin policy" on public.coin_policy
  for select to authenticated using (enabled);
insert into public.coin_policy (id, enabled, transfer_fee_bps) values (true, true, 0)
on conflict (id) do nothing;

create table public.coin_supply (
  id boolean primary key default true check (id),
  total_minted bigint not null default 0 check (total_minted >= 0),
  total_burned bigint not null default 0 check (total_burned >= 0 and total_burned <= total_minted),
  updated_at timestamptz not null default now()
);
alter table public.coin_supply enable row level security;
grant select on public.coin_supply to authenticated;
grant all on public.coin_supply to service_role;
create policy "users read public coin supply" on public.coin_supply for select to authenticated using (true);
insert into public.coin_supply (id) values (true) on conflict (id) do nothing;

create table public.coin_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete restrict,
  account_code text,
  account_type text not null check (account_type in ('user', 'treasury', 'fee')),
  status text not null default 'active' check (status in ('active', 'frozen', 'closed')),
  created_at timestamptz not null default now(),
  constraint coin_accounts_owner_shape check (
    (account_type = 'user' and owner_id is not null and account_code is null)
    or (account_type <> 'user' and owner_id is null and account_code is not null)
  )
);
create unique index coin_user_account on public.coin_accounts(owner_id) where account_type = 'user';
create unique index coin_system_account on public.coin_accounts(account_code) where account_type <> 'user';
alter table public.coin_accounts enable row level security;
grant select on public.coin_accounts to authenticated;
grant all on public.coin_accounts to service_role;
create policy "users read their coin accounts" on public.coin_accounts
  for select to authenticated using (owner_id = auth.uid());

create table public.coin_transactions (
  id uuid primary key default gen_random_uuid(),
  initiator_id uuid references auth.users(id) on delete restrict,
  recipient_id uuid references auth.users(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('transfer', 'issuance', 'burn', 'gift', 'purchase', 'reward')),
  status text not null default 'posted' check (status in ('posted', 'failed', 'reversed')),
  amount_minor bigint not null check (amount_minor > 0),
  fee_minor bigint not null default 0 check (fee_minor >= 0),
  idempotency_key uuid not null unique,
  reference_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint coin_transaction_shape check (
    (transaction_type = 'issuance' and initiator_id is null and recipient_id is not null)
    or (transaction_type = 'burn' and initiator_id is not null and recipient_id is null)
    or (transaction_type not in ('issuance', 'burn') and initiator_id is not null and recipient_id is not null)
  )
);
create index coin_transactions_initiator on public.coin_transactions (initiator_id, created_at desc);
create index coin_transactions_recipient on public.coin_transactions (recipient_id, created_at desc);
alter table public.coin_transactions enable row level security;
grant select on public.coin_transactions to authenticated;
grant all on public.coin_transactions to service_role;
create policy "users read their coin transactions" on public.coin_transactions
  for select to authenticated using (initiator_id = auth.uid() or recipient_id = auth.uid());

create table public.coin_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.coin_transactions(id) on delete restrict,
  account_id uuid not null references public.coin_accounts(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  direction text not null check (direction in ('debit', 'credit')),
  created_at timestamptz not null default now()
);
create index coin_entries_account on public.coin_entries (account_id, created_at desc);
create index coin_entries_transaction on public.coin_entries (transaction_id);
alter table public.coin_entries enable row level security;
grant select on public.coin_entries to authenticated;
grant all on public.coin_entries to service_role;
create policy "users read entries for their coin accounts" on public.coin_entries
  for select to authenticated using (exists (
    select 1 from public.coin_accounts a where a.id = account_id and a.owner_id = auth.uid()
  ));

create or replace function public.ensure_coin_account()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer uuid := auth.uid();
  account_id uuid;
begin
  if viewer is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.coin_policy p where p.id and p.enabled) then
    raise exception 'Coin transfers are unavailable';
  end if;
  insert into public.coin_accounts (owner_id, account_type)
  values (viewer, 'user') on conflict do nothing;
  select a.id into account_id from public.coin_accounts a
  where a.owner_id = viewer and a.account_type = 'user';
  return account_id;
end;
$$;
revoke all on function public.ensure_coin_account() from public, anon;
grant execute on function public.ensure_coin_account() to authenticated;

create or replace function public.get_coin_balance()
returns table(available_minor bigint, total_minted bigint, total_burned bigint)
language sql stable security definer set search_path = '' as $$
  select
    coalesce(sum(case when e.direction = 'credit' then e.amount_minor else -e.amount_minor end), 0)::bigint,
    s.total_minted,
    s.total_burned
  from public.coin_accounts a
  left join public.coin_entries e on e.account_id = a.id
  cross join public.coin_supply s
  where auth.uid() is not null and a.owner_id = auth.uid() and a.account_type = 'user' and s.id
  group by s.total_minted, s.total_burned;
$$;
revoke all on function public.get_coin_balance() from public, anon;
grant execute on function public.get_coin_balance() to authenticated;

create or replace function public.transfer_coin(
  _recipient_id uuid,
  _amount_minor bigint,
  _idempotency_key uuid,
  _transaction_type text default 'transfer',
  _reference_id uuid default null
)
returns table(transaction_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer uuid := auth.uid();
  sender_account uuid;
  recipient_account uuid;
  fee_account uuid;
  sender_balance bigint;
  fee_bps integer;
  max_amount bigint;
  fee_amount bigint;
  existing public.coin_transactions%rowtype;
  new_transaction uuid;
begin
  if viewer is null then raise exception 'Authentication required'; end if;
  if _recipient_id is null or _recipient_id = viewer then raise exception 'Recipient is invalid'; end if;
  if _transaction_type not in ('transfer', 'gift', 'purchase', 'reward') then
    raise exception 'Invalid Coin transfer type';
  end if;
  if _amount_minor is null or _amount_minor <= 0 or _idempotency_key is null then
    raise exception 'Amount and idempotency key are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(viewer::text || ':' || _idempotency_key::text, 0));
  select * into existing from public.coin_transactions t where t.idempotency_key = _idempotency_key;
  if found then
    if existing.initiator_id <> viewer or existing.recipient_id <> _recipient_id
      or existing.amount_minor <> _amount_minor or existing.transaction_type <> _transaction_type then
      raise exception 'Idempotency key was already used for a different Coin transaction';
    end if;
    return query select existing.id, existing.status;
    return;
  end if;

  select p.transfer_fee_bps, p.max_transfer_minor into fee_bps, max_amount
  from public.coin_policy p where p.id and p.enabled;
  if not found then raise exception 'Coin transfers are unavailable'; end if;
  if _amount_minor > max_amount then raise exception 'Coin transfer exceeds the configured limit'; end if;
  sender_account := public.ensure_coin_account();
  insert into public.coin_accounts (owner_id, account_type) values (_recipient_id, 'user') on conflict do nothing;
  select a.id into recipient_account from public.coin_accounts a
  where a.owner_id = _recipient_id and a.account_type = 'user';

  fee_amount := (_amount_minor * fee_bps + 9999) / 10000;
  if fee_amount > 0 then
    insert into public.coin_accounts (account_code, account_type)
    values ('coin-fees', 'fee') on conflict do nothing;
    select a.id into fee_account from public.coin_accounts a
    where a.account_code = 'coin-fees' and a.account_type = 'fee';
  end if;

  perform a.id from public.coin_accounts a
  where a.id in (sender_account, recipient_account, fee_account)
  order by a.id for update;
  select coalesce(sum(case when e.direction = 'credit' then e.amount_minor else -e.amount_minor end), 0)
    into sender_balance
  from public.coin_entries e where e.account_id = sender_account;
  if sender_balance < _amount_minor + fee_amount then raise exception 'Insufficient Coin balance'; end if;

  insert into public.coin_transactions (
    initiator_id, recipient_id, transaction_type, amount_minor, fee_minor, idempotency_key, reference_id
  ) values (
    viewer, _recipient_id, _transaction_type, _amount_minor, fee_amount, _idempotency_key, _reference_id
  ) returning id into new_transaction;
  insert into public.coin_entries (transaction_id, account_id, amount_minor, direction)
  values
    (new_transaction, sender_account, _amount_minor + fee_amount, 'debit'),
    (new_transaction, recipient_account, _amount_minor, 'credit');
  if fee_amount > 0 then
    insert into public.coin_entries (transaction_id, account_id, amount_minor, direction)
    values (new_transaction, fee_account, fee_amount, 'credit');
  end if;
  return query select new_transaction, 'posted'::text;
end;
$$;
revoke all on function public.transfer_coin(uuid, bigint, uuid, text, uuid) from public, anon;
grant execute on function public.transfer_coin(uuid, bigint, uuid, text, uuid) to authenticated;

create or replace function public.issue_coin(_recipient_id uuid, _amount_minor bigint, _idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  recipient_account uuid;
  treasury_account uuid;
  max_supply bigint;
  minted bigint;
  transaction_id uuid;
  existing public.coin_transactions%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  if _recipient_id is null or _amount_minor is null or _amount_minor <= 0 or _idempotency_key is null then
    raise exception 'Invalid Coin issuance request';
  end if;
  select * into existing from public.coin_transactions t where t.idempotency_key = _idempotency_key;
  if found then
    if existing.transaction_type <> 'issuance' or existing.recipient_id <> _recipient_id
      or existing.amount_minor <> _amount_minor then
      raise exception 'Idempotency key was already used for a different Coin transaction';
    end if;
    return existing.id;
  end if;
  select p.max_supply into max_supply from public.coin_policy p where p.id and p.enabled for update;
  if not found then raise exception 'Coin issuance is disabled'; end if;
  select s.total_minted into minted from public.coin_supply s where s.id for update;
  if minted + _amount_minor > max_supply then raise exception 'Coin supply cap would be exceeded'; end if;

  insert into public.coin_accounts (owner_id, account_type) values (_recipient_id, 'user') on conflict do nothing;
  insert into public.coin_accounts (account_code, account_type) values ('coin-treasury', 'treasury') on conflict do nothing;
  select a.id into recipient_account from public.coin_accounts a where a.owner_id = _recipient_id and a.account_type = 'user';
  select a.id into treasury_account from public.coin_accounts a where a.account_code = 'coin-treasury' and a.account_type = 'treasury';
  perform a.id from public.coin_accounts a where a.id in (recipient_account, treasury_account) order by a.id for update;

  insert into public.coin_transactions (transaction_type, amount_minor, idempotency_key, recipient_id)
  values ('issuance', _amount_minor, _idempotency_key, _recipient_id)
  returning id into transaction_id;
  insert into public.coin_entries (transaction_id, account_id, amount_minor, direction)
  values
    (transaction_id, treasury_account, _amount_minor, 'debit'),
    (transaction_id, recipient_account, _amount_minor, 'credit');
  update public.coin_supply set total_minted = total_minted + _amount_minor, updated_at = now() where id;
  return transaction_id;
end;
$$;
revoke all on function public.issue_coin(uuid, bigint, uuid) from public, anon, authenticated;
grant execute on function public.issue_coin(uuid, bigint, uuid) to service_role;

create or replace function public.burn_coin(_amount_minor bigint, _idempotency_key uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer uuid := auth.uid();
  user_account uuid;
  treasury_account uuid;
  balance bigint;
  transaction_id uuid;
  existing public.coin_transactions%rowtype;
begin
  if viewer is null then raise exception 'Authentication required'; end if;
  if _amount_minor is null or _amount_minor <= 0 or _idempotency_key is null then
    raise exception 'Invalid Coin burn request';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(viewer::text || ':' || _idempotency_key::text, 0));
  select * into existing from public.coin_transactions t where t.idempotency_key = _idempotency_key;
  if found then
    if existing.initiator_id <> viewer or existing.transaction_type <> 'burn'
      or existing.amount_minor <> _amount_minor then
      raise exception 'Idempotency key was already used for a different Coin transaction';
    end if;
    return existing.id;
  end if;
  user_account := public.ensure_coin_account();
  insert into public.coin_accounts (account_code, account_type) values ('coin-treasury', 'treasury') on conflict do nothing;
  select a.id into treasury_account from public.coin_accounts a
  where a.account_code = 'coin-treasury' and a.account_type = 'treasury';
  perform a.id from public.coin_accounts a where a.id in (user_account, treasury_account) order by a.id for update;
  select coalesce(sum(case when e.direction = 'credit' then e.amount_minor else -e.amount_minor end), 0)
    into balance from public.coin_entries e where e.account_id = user_account;
  if balance < _amount_minor then raise exception 'Insufficient Coin balance'; end if;

  insert into public.coin_transactions (initiator_id, transaction_type, amount_minor, idempotency_key)
  values (viewer, 'burn', _amount_minor, _idempotency_key) returning id into transaction_id;
  insert into public.coin_entries (transaction_id, account_id, amount_minor, direction)
  values
    (transaction_id, user_account, _amount_minor, 'debit'),
    (transaction_id, treasury_account, _amount_minor, 'credit');
  update public.coin_supply set total_burned = total_burned + _amount_minor, updated_at = now()
  where id and total_burned + _amount_minor <= total_minted;
  if not found then raise exception 'Coin supply invariant failed'; end if;
  return transaction_id;
end;
$$;
revoke all on function public.burn_coin(bigint, uuid) from public, anon;
grant execute on function public.burn_coin(bigint, uuid) to authenticated;

create or replace function private.assert_coin_transaction_balanced(_transaction_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  entry_count bigint;
  balance bigint;
begin
  if not exists (select 1 from public.coin_transactions t where t.id = _transaction_id and t.status = 'posted') then
    return;
  end if;
  select count(*), coalesce(sum(case when e.direction = 'debit' then e.amount_minor else -e.amount_minor end), 0)
    into entry_count, balance from public.coin_entries e where e.transaction_id = _transaction_id;
  if entry_count < 2 or balance <> 0 then raise exception 'Coin transaction entries must balance'; end if;
end;
$$;
revoke all on function private.assert_coin_transaction_balanced(uuid) from public, anon, authenticated;

create or replace function private.check_coin_entries_balanced()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_coin_transaction_balanced(new.transaction_id);
  return null;
end;
$$;
revoke all on function private.check_coin_entries_balanced() from public, anon, authenticated;
create constraint trigger coin_entries_balanced
  after insert on public.coin_entries deferrable initially deferred
  for each row execute function private.check_coin_entries_balanced();

create or replace function private.check_posted_coin_transaction_balanced()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_coin_transaction_balanced(new.id);
  return null;
end;
$$;
revoke all on function private.check_posted_coin_transaction_balanced() from public, anon, authenticated;
create constraint trigger coin_transaction_balanced
  after insert or update on public.coin_transactions deferrable initially deferred
  for each row execute function private.check_posted_coin_transaction_balanced();