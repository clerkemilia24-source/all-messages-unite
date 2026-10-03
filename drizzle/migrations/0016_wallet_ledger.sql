create table public.wallet_limits (
  currency text primary key check (currency ~ '^[A-Z]{3}$'),
  enabled boolean not null default false,
  max_transfer_minor bigint not null check (max_transfer_minor > 0),
  daily_transfer_minor bigint not null check (daily_transfer_minor >= max_transfer_minor),
  max_funding_minor bigint not null check (max_funding_minor > 0),
  updated_at timestamptz not null default now()
);
alter table public.wallet_limits enable row level security;
grant select on public.wallet_limits to authenticated;
grant all on public.wallet_limits to service_role;
create policy "users read enabled wallet limits" on public.wallet_limits
  for select to authenticated using (enabled);

insert into public.wallet_limits
  (currency, enabled, max_transfer_minor, daily_transfer_minor, max_funding_minor)
values ('USD', true, 100000, 500000, 500000)
on conflict (currency) do nothing;

create table public.wallet_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete restrict,
  account_code text,
  account_type text not null check (account_type in ('user', 'provider_clearing', 'treasury', 'fee')),
  currency text not null references public.wallet_limits(currency),
  status text not null default 'active' check (status in ('active', 'frozen', 'closed')),
  created_at timestamptz not null default now(),
  constraint wallet_accounts_owner_shape check (
    (account_type = 'user' and owner_id is not null and account_code is null)
    or (account_type <> 'user' and owner_id is null and account_code is not null)
  )
);
create unique index wallet_user_account_currency on public.wallet_accounts(owner_id, currency)
  where account_type = 'user';
create unique index wallet_system_account_currency on public.wallet_accounts(account_code, currency)
  where account_type <> 'user';
create index wallet_accounts_owner on public.wallet_accounts(owner_id, currency)
  where owner_id is not null;
alter table public.wallet_accounts enable row level security;
grant select on public.wallet_accounts to authenticated;
grant all on public.wallet_accounts to service_role;
create policy "users read their wallet accounts" on public.wallet_accounts
  for select to authenticated using (owner_id = auth.uid());

create table public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete restrict,
  recipient_id uuid references auth.users(id) on delete restrict,
  transaction_type text not null
    check (transaction_type in ('transfer', 'funding', 'withdrawal', 'refund', 'reversal', 'payout')),
  status text not null default 'pending'
    check (status in ('pending', 'posted', 'failed', 'reversed')),
  currency text not null references public.wallet_limits(currency),
  amount_minor bigint not null check (amount_minor > 0),
  idempotency_key uuid not null,
  provider text,
  provider_reference text,
  reverses_transaction_id uuid references public.wallet_transactions(id),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (sender_id, idempotency_key),
  unique (provider, provider_reference),
  constraint wallet_transaction_shape check (
    (transaction_type = 'transfer' and recipient_id is not null and recipient_id <> sender_id)
    or (transaction_type <> 'transfer')
  )
);
create index wallet_transactions_sender on public.wallet_transactions (sender_id, created_at desc);
create index wallet_transactions_recipient on public.wallet_transactions (recipient_id, created_at desc);
alter table public.wallet_transactions enable row level security;
grant select on public.wallet_transactions to authenticated;
grant all on public.wallet_transactions to service_role;
create policy "users read their wallet transactions" on public.wallet_transactions
  for select to authenticated using (sender_id = auth.uid() or recipient_id = auth.uid());

create table public.wallet_entries (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.wallet_transactions(id) on delete restrict,
  account_id uuid not null references public.wallet_accounts(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  direction text not null check (direction in ('debit', 'credit')),
  bucket text not null check (bucket in ('available', 'pending')),
  created_at timestamptz not null default now()
);
create index wallet_entries_account_bucket on public.wallet_entries (account_id, bucket, created_at desc);
create index wallet_entries_transaction on public.wallet_entries (transaction_id);
alter table public.wallet_entries enable row level security;
grant select on public.wallet_entries to authenticated;
grant all on public.wallet_entries to service_role;
create policy "users read entries for their wallet accounts" on public.wallet_entries
  for select to authenticated using (exists (
    select 1 from public.wallet_accounts a
    where a.id = account_id and a.owner_id = auth.uid()
  ));

create table public.wallet_provider_events (
  provider text not null,
  event_id text not null,
  event_type text not null,
  transaction_id uuid references public.wallet_transactions(id),
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'ignored', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_code text,
  primary key (provider, event_id)
);
alter table public.wallet_provider_events enable row level security;
grant all on public.wallet_provider_events to service_role;

create table public.wallet_payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_method_id text not null,
  method_type text not null check (method_type in ('card', 'bank_account')),
  brand text,
  last_four text check (last_four is null or last_four ~ '^[0-9]{4}$'),
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active', 'detached')),
  created_at timestamptz not null default now(),
  unique (provider, provider_method_id)
);
alter table public.wallet_payment_methods enable row level security;
grant select on public.wallet_payment_methods to authenticated;
grant all on public.wallet_payment_methods to service_role;
create policy "users read their payment methods" on public.wallet_payment_methods
  for select to authenticated using (user_id = auth.uid());

create or replace function public.ensure_wallet_account(_currency text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer uuid := auth.uid();
  wallet_id uuid;
begin
  if viewer is null then raise exception 'Authentication required'; end if;
  if _currency !~ '^[A-Z]{3}$' then raise exception 'Unsupported currency'; end if;
  if not exists (
    select 1 from public.wallet_limits l where l.currency = _currency and l.enabled
  ) then raise exception 'Wallet is unavailable for this currency'; end if;

  insert into public.wallet_accounts (owner_id, account_type, currency)
  values (viewer, 'user', _currency)
  on conflict do nothing;
  select a.id into wallet_id
  from public.wallet_accounts a
  where a.owner_id = viewer and a.account_type = 'user' and a.currency = _currency;
  return wallet_id;
end;
$$;
revoke all on function public.ensure_wallet_account(text) from public, anon;
grant execute on function public.ensure_wallet_account(text) to authenticated;

create or replace function public.get_wallet_balances(_currency text)
returns table(available_minor bigint, pending_minor bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(case when e.bucket = 'available' and e.direction = 'credit' then e.amount_minor
      when e.bucket = 'available' then -e.amount_minor else 0 end), 0)::bigint,
    coalesce(sum(case when e.bucket = 'pending' and e.direction = 'credit' then e.amount_minor
      when e.bucket = 'pending' then -e.amount_minor else 0 end), 0)
      + coalesce((
        select sum(t.amount_minor)
        from public.wallet_transactions t
        where t.sender_id = auth.uid()
          and t.transaction_type = 'funding'
          and t.status = 'pending'
          and t.provider_reference is not null
          and t.currency = _currency
      ), 0)::bigint
  from public.wallet_accounts a
  left join public.wallet_entries e on e.account_id = a.id
  where auth.uid() is not null
    and a.owner_id = auth.uid()
    and a.account_type = 'user'
    and a.currency = _currency;
$$;
revoke all on function public.get_wallet_balances(text) from public, anon;
grant execute on function public.get_wallet_balances(text) to authenticated;

create or replace function public.send_wallet_transfer(
  _recipient_id uuid,
  _amount_minor bigint,
  _currency text,
  _idempotency_key uuid
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
  sender_status text;
  recipient_status text;
  available_balance bigint;
  transferred_today bigint;
  max_transfer bigint;
  daily_limit bigint;
  existing public.wallet_transactions%rowtype;
  created_transaction uuid;
begin
  if viewer is null then raise exception 'Authentication required'; end if;
  if _recipient_id is null or _recipient_id = viewer then raise exception 'Recipient is invalid'; end if;
  if _amount_minor is null or _amount_minor <= 0 then raise exception 'Amount must be positive'; end if;
  if _idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if _currency !~ '^[A-Z]{3}$' then raise exception 'Unsupported currency'; end if;

  perform pg_advisory_xact_lock(hashtextextended(viewer::text || ':' || _idempotency_key::text, 0));
  select * into existing from public.wallet_transactions t
  where t.sender_id = viewer and t.idempotency_key = _idempotency_key;
  if found then
    if existing.transaction_type <> 'transfer'
      or existing.recipient_id <> _recipient_id
      or existing.amount_minor <> _amount_minor
      or existing.currency <> _currency then
      raise exception 'Idempotency key was already used for a different transfer';
    end if;
    return query select existing.id, existing.status;
    return;
  end if;

  select l.max_transfer_minor, l.daily_transfer_minor into max_transfer, daily_limit
  from public.wallet_limits l where l.currency = _currency and l.enabled;
  if not found then raise exception 'Wallet transfers are unavailable for this currency'; end if;
  if _amount_minor > max_transfer then raise exception 'Transfer exceeds the per-transaction limit'; end if;

  sender_account := public.ensure_wallet_account(_currency);
  insert into public.wallet_accounts (owner_id, account_type, currency)
  values (_recipient_id, 'user', _currency)
  on conflict do nothing;
  select a.id, a.status into recipient_account, recipient_status
  from public.wallet_accounts a
  where a.owner_id = _recipient_id and a.account_type = 'user' and a.currency = _currency;
  if recipient_account is null then raise exception 'Recipient wallet is unavailable'; end if;

  perform a.id from public.wallet_accounts a
  where a.id in (sender_account, recipient_account)
  order by a.id for update;
  select a.status into sender_status from public.wallet_accounts a where a.id = sender_account;
  select a.status into recipient_status from public.wallet_accounts a where a.id = recipient_account;
  if sender_status <> 'active' or recipient_status <> 'active' then
    raise exception 'Wallet account is unavailable';
  end if;

  select coalesce(sum(case when e.direction = 'credit' then e.amount_minor else -e.amount_minor end), 0)
    into available_balance
  from public.wallet_entries e
  where e.account_id = sender_account and e.bucket = 'available';
  if available_balance < _amount_minor then raise exception 'Insufficient available funds'; end if;

  select coalesce(sum(t.amount_minor), 0) into transferred_today
  from public.wallet_transactions t
  where t.sender_id = viewer and t.transaction_type = 'transfer' and t.status = 'posted'
    and t.currency = _currency and t.created_at >= date_trunc('day', now());
  if transferred_today + _amount_minor > daily_limit then
    raise exception 'Transfer exceeds the daily limit';
  end if;

  insert into public.wallet_transactions (
    sender_id, recipient_id, transaction_type, status, currency, amount_minor, idempotency_key
  ) values (
    viewer, _recipient_id, 'transfer', 'pending', _currency, _amount_minor, _idempotency_key
  ) returning id into created_transaction;

  insert into public.wallet_entries (transaction_id, account_id, amount_minor, direction, bucket)
  values
    (created_transaction, sender_account, _amount_minor, 'debit', 'available'),
    (created_transaction, recipient_account, _amount_minor, 'credit', 'available');

  update public.wallet_transactions t
  set status = 'posted', settled_at = now()
  where t.id = created_transaction;
  return query select created_transaction, 'posted'::text;
end;
$$;
revoke all on function public.send_wallet_transfer(uuid, bigint, text, uuid) from public, anon;
grant execute on function public.send_wallet_transfer(uuid, bigint, text, uuid) to authenticated;

create or replace function private.check_wallet_entry_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  account_currency text;
  transaction_currency text;
begin
  select a.currency into account_currency from public.wallet_accounts a where a.id = new.account_id;
  select t.currency into transaction_currency from public.wallet_transactions t where t.id = new.transaction_id;
  if account_currency is null or account_currency <> transaction_currency then
    raise exception 'Wallet entry currency does not match its transaction';
  end if;
  return new;
end;
$$;
revoke all on function private.check_wallet_entry_currency() from public, anon, authenticated;
create trigger wallet_entry_currency
  before insert on public.wallet_entries
  for each row execute function private.check_wallet_entry_currency();

create or replace function private.assert_wallet_transaction_balanced(_transaction_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  entry_count bigint;
  balance bigint;
begin
  if not exists (
    select 1 from public.wallet_transactions t
    where t.id = _transaction_id and t.status = 'posted'
  ) then return; end if;
  select count(*), coalesce(sum(case when e.direction = 'debit' then e.amount_minor else -e.amount_minor end), 0)
    into entry_count, balance
  from public.wallet_entries e where e.transaction_id = _transaction_id;
  if entry_count < 2 or balance <> 0 then
    raise exception 'Posted wallet transaction must have balanced ledger entries';
  end if;
end;
$$;
revoke all on function private.assert_wallet_transaction_balanced(uuid) from public, anon, authenticated;

create or replace function private.check_wallet_entries_balanced()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_wallet_transaction_balanced(new.transaction_id);
  return null;
end;
$$;
revoke all on function private.check_wallet_entries_balanced() from public, anon, authenticated;
create constraint trigger wallet_entries_balanced
  after insert on public.wallet_entries
  deferrable initially deferred
  for each row execute function private.check_wallet_entries_balanced();

create or replace function private.check_posted_wallet_transaction_balanced()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.assert_wallet_transaction_balanced(new.id);
  return null;
end;
$$;
revoke all on function private.check_posted_wallet_transaction_balanced() from public, anon, authenticated;
create constraint trigger wallet_transaction_balanced
  after insert or update on public.wallet_transactions
  deferrable initially deferred
  for each row execute function private.check_posted_wallet_transaction_balanced();

create or replace function public.begin_wallet_funding(
  _amount_minor bigint,
  _currency text,
  _idempotency_key uuid
)
returns table(transaction_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  viewer uuid := auth.uid();
  max_funding bigint;
  existing public.wallet_transactions%rowtype;
  created_transaction uuid;
begin
  if viewer is null then raise exception 'Authentication required'; end if;
  if _amount_minor is null or _amount_minor <= 0 then raise exception 'Amount must be positive'; end if;
  if _idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if _currency !~ '^[A-Z]{3}$' then raise exception 'Unsupported currency'; end if;

  perform pg_advisory_xact_lock(hashtextextended(viewer::text || ':' || _idempotency_key::text, 0));
  select * into existing from public.wallet_transactions t
  where t.sender_id = viewer and t.idempotency_key = _idempotency_key;
  if found then
    if existing.transaction_type <> 'funding'
      or existing.amount_minor <> _amount_minor
      or existing.currency <> _currency then
      raise exception 'Idempotency key was already used for a different transaction';
    end if;
    return query select existing.id, existing.status;
    return;
  end if;

  select l.max_funding_minor into max_funding
  from public.wallet_limits l where l.currency = _currency and l.enabled;
  if not found then raise exception 'Wallet funding is unavailable for this currency'; end if;
  if _amount_minor > max_funding then raise exception 'Funding amount exceeds the configured limit'; end if;
  perform public.ensure_wallet_account(_currency);

  insert into public.wallet_transactions (
    sender_id, transaction_type, status, currency, amount_minor, idempotency_key, provider
  ) values (
    viewer, 'funding', 'pending', _currency, _amount_minor, _idempotency_key, 'stripe'
  ) returning id into created_transaction;
  return query select created_transaction, 'pending'::text;
end;
$$;
revoke all on function public.begin_wallet_funding(bigint, text, uuid) from public, anon;
grant execute on function public.begin_wallet_funding(bigint, text, uuid) to authenticated;

create or replace function public.attach_wallet_funding_session(_transaction_id uuid, _session_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or _session_id is null or char_length(_session_id) > 255 then
    raise exception 'Invalid wallet checkout session';
  end if;
  update public.wallet_transactions t
  set provider_reference = _session_id
  where t.id = _transaction_id
    and t.sender_id = auth.uid()
    and t.transaction_type = 'funding'
    and t.provider = 'stripe'
    and t.status = 'pending'
    and (t.provider_reference is null or t.provider_reference = _session_id);
  return found;
end;
$$;
revoke all on function public.attach_wallet_funding_session(uuid, text) from public, anon;
grant execute on function public.attach_wallet_funding_session(uuid, text) to authenticated;

create or replace function public.settle_wallet_funding(
  _event_id text,
  _event_type text,
  _transaction_id uuid,
  _session_id text,
  _amount_minor bigint,
  _currency text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  wallet_transaction public.wallet_transactions%rowtype;
  user_account uuid;
  clearing_account uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  if _event_id is null or _event_type is null or _session_id is null then
    raise exception 'Invalid provider event';
  end if;

  insert into public.wallet_provider_events (provider, event_id, event_type, transaction_id)
  values ('stripe', _event_id, _event_type, _transaction_id)
  on conflict (provider, event_id) do nothing;
  if not found then return true; end if;

  select * into wallet_transaction from public.wallet_transactions t
  where t.id = _transaction_id for update;
  if not found or wallet_transaction.transaction_type <> 'funding'
    or wallet_transaction.provider <> 'stripe' then
    raise exception 'Funding transaction not found';
  end if;
  if wallet_transaction.amount_minor <> _amount_minor
    or wallet_transaction.currency <> upper(_currency) then
    raise exception 'Provider amount does not match the pending funding transaction';
  end if;
  if wallet_transaction.provider_reference is not null
    and wallet_transaction.provider_reference <> _session_id then
    raise exception 'Provider session does not match the pending transaction';
  end if;

  if wallet_transaction.status = 'posted' then
    update public.wallet_provider_events e
    set processing_status = 'processed', processed_at = now()
    where e.provider = 'stripe' and e.event_id = _event_id;
    return true;
  end if;
  if wallet_transaction.status <> 'pending' then
    raise exception 'Funding transaction is not pending';
  end if;

  insert into public.wallet_accounts (account_code, account_type, currency)
  values ('stripe-clearing:' || wallet_transaction.currency, 'provider_clearing', wallet_transaction.currency)
  on conflict do nothing;
  select a.id into user_account from public.wallet_accounts a
  where a.owner_id = wallet_transaction.sender_id
    and a.account_type = 'user' and a.currency = wallet_transaction.currency;
  select a.id into clearing_account from public.wallet_accounts a
  where a.account_code = 'stripe-clearing:' || wallet_transaction.currency
    and a.account_type = 'provider_clearing' and a.currency = wallet_transaction.currency;
  if user_account is null or clearing_account is null then raise exception 'Wallet ledger account is missing'; end if;

  perform a.id from public.wallet_accounts a
  where a.id in (user_account, clearing_account)
  order by a.id for update;
  update public.wallet_transactions t
  set status = 'posted', provider_reference = _session_id, settled_at = now()
  where t.id = _transaction_id and t.status = 'pending';
  if not found then raise exception 'Funding transaction changed during settlement'; end if;
  insert into public.wallet_entries (transaction_id, account_id, amount_minor, direction, bucket)
  values
    (_transaction_id, clearing_account, _amount_minor, 'debit', 'available'),
    (_transaction_id, user_account, _amount_minor, 'credit', 'available');
  update public.wallet_provider_events e
  set processing_status = 'processed', processed_at = now()
  where e.provider = 'stripe' and e.event_id = _event_id;
  return true;
end;
$$;
revoke all on function public.settle_wallet_funding(text, text, uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.settle_wallet_funding(text, text, uuid, text, bigint, text) to service_role;

create or replace function public.fail_wallet_funding(
  _event_id text,
  _event_type text,
  _transaction_id uuid,
  _session_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  wallet_transaction public.wallet_transactions%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  insert into public.wallet_provider_events (provider, event_id, event_type, transaction_id)
  values ('stripe', _event_id, _event_type, _transaction_id)
  on conflict (provider, event_id) do nothing;
  if not found then return true; end if;

  select * into wallet_transaction from public.wallet_transactions t
  where t.id = _transaction_id for update;
  if not found or wallet_transaction.transaction_type <> 'funding'
    or wallet_transaction.provider <> 'stripe' then
    raise exception 'Funding transaction not found';
  end if;
  if wallet_transaction.provider_reference is not null
    and wallet_transaction.provider_reference <> _session_id then
    raise exception 'Provider session does not match the pending transaction';
  end if;
  update public.wallet_transactions t
  set status = 'failed', provider_reference = coalesce(provider_reference, _session_id)
  where t.id = _transaction_id and t.status = 'pending';
  update public.wallet_provider_events e
  set processing_status = 'processed', processed_at = now()
  where e.provider = 'stripe' and e.event_id = _event_id;
  return true;
end;
$$;
revoke all on function public.fail_wallet_funding(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.fail_wallet_funding(text, text, uuid, text) to service_role;