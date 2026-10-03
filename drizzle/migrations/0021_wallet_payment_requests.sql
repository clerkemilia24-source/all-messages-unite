create table public.wallet_payment_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete restrict,
  payer_id uuid references auth.users(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null references public.wallet_limits(currency),
  note text check (note is null or char_length(note) <= 280),
  status text not null default 'open' check (status in ('open', 'paid', 'cancelled', 'expired')),
  idempotency_key uuid not null,
  settled_transaction_id uuid references public.wallet_transactions(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  unique (requester_id, idempotency_key),
  constraint wallet_request_participants check (payer_id is null or payer_id <> requester_id)
);
create index wallet_payment_requests_requester on public.wallet_payment_requests (requester_id, created_at desc);
create index wallet_payment_requests_payer on public.wallet_payment_requests (payer_id, created_at desc);
create index wallet_payment_requests_open on public.wallet_payment_requests (expires_at) where status = 'open';
alter table public.wallet_payment_requests enable row level security;
grant select on public.wallet_payment_requests to authenticated;
grant all on public.wallet_payment_requests to service_role;
create policy "users read their wallet requests" on public.wallet_payment_requests
  for select to authenticated using (requester_id = auth.uid() or payer_id = auth.uid());

create or replace function public.create_wallet_payment_request(
  _payer_id uuid,
  _amount_minor bigint,
  _currency text,
  _note text,
  _idempotency_key uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester uuid := auth.uid();
  max_amount bigint;
  existing public.wallet_payment_requests%rowtype;
  request_id uuid;
begin
  if requester is null then raise exception 'Authentication required'; end if;
  if _payer_id = requester then raise exception 'You cannot request money from yourself'; end if;
  if _amount_minor is null or _amount_minor <= 0 or _idempotency_key is null then
    raise exception 'Amount and idempotency key are required';
  end if;
  if _note is not null and char_length(_note) > 280 then raise exception 'Request note is too long'; end if;
  select l.max_transfer_minor into max_amount from public.wallet_limits l
  where l.currency = _currency and l.enabled;
  if not found then raise exception 'Wallet requests are unavailable for this currency'; end if;
  if _amount_minor > max_amount then raise exception 'Request exceeds the Wallet transaction limit'; end if;

  perform pg_advisory_xact_lock(hashtextextended(requester::text || ':' || _idempotency_key::text, 0));
  select * into existing from public.wallet_payment_requests r
  where r.requester_id = requester and r.idempotency_key = _idempotency_key;
  if found then
    if existing.payer_id is distinct from _payer_id
      or existing.amount_minor <> _amount_minor
      or existing.currency <> _currency then
      raise exception 'Idempotency key was already used for a different payment request';
    end if;
    return existing.id;
  end if;

  insert into public.wallet_payment_requests (
    requester_id, payer_id, amount_minor, currency, note, idempotency_key
  ) values (
    requester, _payer_id, _amount_minor, _currency, nullif(btrim(_note), ''), _idempotency_key
  ) returning id into request_id;
  return request_id;
end;
$$;
revoke all on function public.create_wallet_payment_request(uuid, bigint, text, text, uuid) from public, anon;
grant execute on function public.create_wallet_payment_request(uuid, bigint, text, text, uuid) to authenticated;

create or replace function public.pay_wallet_payment_request(_request_id uuid, _idempotency_key uuid)
returns table(request_id uuid, transaction_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  payer uuid := auth.uid();
  request_row public.wallet_payment_requests%rowtype;
  result_row record;
begin
  if payer is null then raise exception 'Authentication required'; end if;
  if _idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  select * into request_row from public.wallet_payment_requests r where r.id = _request_id for update;
  if not found then raise exception 'Payment request is unavailable'; end if;
  if request_row.status = 'paid' then
    if request_row.payer_id <> payer then raise exception 'Payment request has already been paid'; end if;
    return query select request_row.id, request_row.settled_transaction_id, 'posted'::text;
    return;
  end if;
  if request_row.status <> 'open' or request_row.expires_at <= now() then
    raise exception 'Payment request is no longer open';
  end if;
  if request_row.requester_id = payer or (request_row.payer_id is not null and request_row.payer_id <> payer) then
    raise exception 'You cannot pay this request';
  end if;

  select * into result_row from public.send_wallet_transfer(
    request_row.requester_id,
    request_row.amount_minor,
    request_row.currency,
    _idempotency_key
  );
  update public.wallet_payment_requests r
  set status = 'paid', payer_id = payer, settled_transaction_id = result_row.transaction_id
  where r.id = request_row.id and r.status = 'open';
  return query select request_row.id, result_row.transaction_id, result_row.status;
end;
$$;
revoke all on function public.pay_wallet_payment_request(uuid, uuid) from public, anon;
grant execute on function public.pay_wallet_payment_request(uuid, uuid) to authenticated;

create or replace function public.cancel_wallet_payment_request(_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.wallet_payment_requests r set status = 'cancelled'
  where r.id = _request_id and r.requester_id = auth.uid() and r.status = 'open';
  return found;
end;
$$;
revoke all on function public.cancel_wallet_payment_request(uuid) from public, anon;
grant execute on function public.cancel_wallet_payment_request(uuid) to authenticated;

create or replace function public.expire_wallet_payment_requests()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare expired_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  update public.wallet_payment_requests r set status = 'expired'
  where r.status = 'open' and r.expires_at <= now();
  get diagnostics expired_count = row_count;
  return expired_count;
end;
$$;
revoke all on function public.expire_wallet_payment_requests() from public, anon, authenticated;
grant execute on function public.expire_wallet_payment_requests() to service_role;