alter table public.wallet_transactions
  drop constraint if exists wallet_transactions_transaction_type_check;
alter table public.wallet_transactions
  add constraint wallet_transactions_transaction_type_check
  check (transaction_type in (
    'transfer', 'funding', 'withdrawal', 'refund', 'reversal', 'payout',
    'purchase', 'seller_earning', 'gift', 'subscription', 'reward'
  ));

alter table public.shop_orders
  add column payment_source text not null default 'stripe'
    check (payment_source in ('stripe', 'wallet')),
  add column wallet_transaction_id uuid references public.wallet_transactions(id);
create unique index shop_orders_wallet_transaction_unique
  on public.shop_orders(wallet_transaction_id) where wallet_transaction_id is not null;
create unique index wallet_shop_purchase_once
  on public.wallet_transactions ((metadata->>'shop_order_id'))
  where transaction_type = 'purchase';
create unique index wallet_shop_earning_once
  on public.wallet_transactions ((metadata->>'shop_order_id'))
  where transaction_type = 'seller_earning';
create unique index wallet_shop_refund_once
  on public.wallet_transactions (reverses_transaction_id)
  where transaction_type = 'refund' and reverses_transaction_id is not null;

create or replace function public.pay_shop_order_with_wallet(
  _order_id uuid,
  _idempotency_key uuid
)
returns table(order_id uuid, wallet_transaction_id uuid, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  buyer uuid := auth.uid();
  order_row public.shop_orders%rowtype;
  existing public.wallet_transactions%rowtype;
  buyer_account uuid;
  seller_account uuid;
  buyer_status text;
  seller_status text;
  buyer_balance bigint;
  daily_spend bigint;
  max_spend bigint;
  daily_limit bigint;
  created_transaction uuid;
begin
  if buyer is null then raise exception 'Authentication required'; end if;
  if _idempotency_key is null then raise exception 'Idempotency key is required'; end if;

  perform pg_advisory_xact_lock(hashtextextended(buyer::text || ':' || _idempotency_key::text, 0));
  select * into order_row from public.shop_orders o where o.id = _order_id for update;
  if not found or order_row.buyer_id <> buyer then raise exception 'Order is unavailable'; end if;

  select * into existing from public.wallet_transactions t
  where t.sender_id = buyer and t.idempotency_key = _idempotency_key;
  if found then
    if existing.transaction_type <> 'purchase'
      or existing.metadata->>'shop_order_id' <> _order_id::text then
      raise exception 'Idempotency key was already used for a different transaction';
    end if;
    return query select order_row.id, existing.id, existing.status;
    return;
  end if;

  if order_row.status <> 'pending_payment' or order_row.reservation_expires_at <= now() then
    raise exception 'Order is not available for Wallet payment';
  end if;
  if order_row.payment_source <> 'stripe' or order_row.wallet_transaction_id is not null then
    raise exception 'Order already has a payment attempt';
  end if;

  select l.max_transfer_minor, l.daily_transfer_minor into max_spend, daily_limit
  from public.wallet_limits l where l.currency = order_row.currency and l.enabled;
  if not found then raise exception 'Wallet checkout is unavailable for this currency'; end if;
  if order_row.total_minor > max_spend then raise exception 'Order exceeds the Wallet purchase limit'; end if;

  buyer_account := public.ensure_wallet_account(order_row.currency);
  insert into public.wallet_accounts (owner_id, account_type, currency)
  values (order_row.seller_id, 'user', order_row.currency)
  on conflict do nothing;
  select a.id into seller_account from public.wallet_accounts a
  where a.owner_id = order_row.seller_id and a.account_type = 'user' and a.currency = order_row.currency;
  if seller_account is null then raise exception 'Seller Wallet is unavailable'; end if;

  perform a.id from public.wallet_accounts a
  where a.id in (buyer_account, seller_account)
  order by a.id for update;
  select a.status into buyer_status from public.wallet_accounts a where a.id = buyer_account;
  select a.status into seller_status from public.wallet_accounts a where a.id = seller_account;
  if buyer_status <> 'active' or seller_status <> 'active' then
    raise exception 'A Wallet account is unavailable';
  end if;

  select coalesce(sum(case when e.direction = 'credit' then e.amount_minor else -e.amount_minor end), 0)
    into buyer_balance
  from public.wallet_entries e where e.account_id = buyer_account and e.bucket = 'available';
  if buyer_balance < order_row.total_minor then raise exception 'Insufficient available Wallet balance'; end if;

  select coalesce(sum(t.amount_minor), 0) into daily_spend
  from public.wallet_transactions t
  where t.sender_id = buyer and t.status = 'posted'
    and t.transaction_type in ('transfer', 'purchase')
    and t.currency = order_row.currency
    and t.created_at >= date_trunc('day', now());
  if daily_spend + order_row.total_minor > daily_limit then
    raise exception 'Wallet purchase exceeds the daily limit';
  end if;

  insert into public.wallet_transactions (
    sender_id, recipient_id, transaction_type, status, currency, amount_minor,
    idempotency_key, metadata, settled_at
  ) values (
    buyer, order_row.seller_id, 'purchase', 'posted', order_row.currency,
    order_row.total_minor, _idempotency_key,
    jsonb_build_object('shop_order_id', order_row.id, 'seller_status', 'pending'), now()
  ) returning id into created_transaction;
  insert into public.wallet_entries (transaction_id, account_id, amount_minor, direction, bucket)
  values
    (created_transaction, buyer_account, order_row.total_minor, 'debit', 'available'),
    (created_transaction, seller_account, order_row.total_minor, 'credit', 'pending');

  update public.shop_orders o
  set status = 'paid', payment_source = 'wallet', wallet_transaction_id = created_transaction,
      paid_at = now(), updated_at = now()
  where o.id = order_row.id and o.status = 'pending_payment';
  if not found then raise exception 'Order payment state changed'; end if;
  return query select order_row.id, created_transaction, 'posted'::text;
end;
$$;
revoke all on function public.pay_shop_order_with_wallet(uuid, uuid) from public, anon;
grant execute on function public.pay_shop_order_with_wallet(uuid, uuid) to authenticated;

create or replace function public.create_shop_order_with_wallet(
  _idempotency_key uuid,
  _shipping_address jsonb
)
returns table(order_id uuid, wallet_transaction_id uuid, status text, total_minor bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  buyer uuid := auth.uid();
  order_result record;
  existing_transaction public.wallet_transactions%rowtype;
  payment_result record;
begin
  if buyer is null then raise exception 'Authentication required'; end if;
  if _idempotency_key is null then raise exception 'Idempotency key is required'; end if;

  select * into existing_transaction from public.wallet_transactions t
  where t.sender_id = buyer and t.idempotency_key = _idempotency_key;
  if found then
    if existing_transaction.transaction_type <> 'purchase' then
      raise exception 'Idempotency key was already used for a different transaction';
    end if;
    select o.id, o.total_minor into order_result
    from public.shop_orders o where o.id = (existing_transaction.metadata->>'shop_order_id')::uuid;
    if not found then raise exception 'Paid order is unavailable'; end if;
    return query select order_result.id, existing_transaction.id, existing_transaction.status, order_result.total_minor;
    return;
  end if;

  select * into order_result from public.create_shop_order_from_cart(_idempotency_key, _shipping_address);
  select * into payment_result from public.pay_shop_order_with_wallet(order_result.order_id, _idempotency_key);
  return query select order_result.order_id, payment_result.wallet_transaction_id, payment_result.status, order_result.total_minor;
end;
$$;
revoke all on function public.create_shop_order_with_wallet(uuid, jsonb) from public, anon;
grant execute on function public.create_shop_order_with_wallet(uuid, jsonb) to authenticated;

create or replace function public.confirm_shop_order_delivery(_order_id uuid, _idempotency_key uuid)
returns table(order_id uuid, status text, earning_transaction_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  buyer uuid := auth.uid();
  order_row public.shop_orders%rowtype;
  seller_account uuid;
  existing public.wallet_transactions%rowtype;
  earning_transaction uuid;
begin
  if buyer is null then raise exception 'Authentication required'; end if;
  if _idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  select * into order_row from public.shop_orders o where o.id = _order_id for update;
  if not found or order_row.buyer_id <> buyer then raise exception 'Order is unavailable'; end if;

  select * into existing from public.wallet_transactions t
  where t.transaction_type = 'seller_earning' and t.metadata->>'shop_order_id' = _order_id::text;
  if found then return query select order_row.id, order_row.status, existing.id; return; end if;
  if order_row.status <> 'shipped' then raise exception 'Only shipped orders can be confirmed delivered'; end if;

  if order_row.payment_source = 'wallet' then
    select a.id into seller_account from public.wallet_accounts a
    where a.owner_id = order_row.seller_id
      and a.account_type = 'user'
      and a.currency = order_row.currency;
    if seller_account is null then raise exception 'Seller Wallet is unavailable'; end if;
    perform a.id from public.wallet_accounts a where a.id = seller_account for update;
    if coalesce((
      select sum(case when e.direction = 'credit' then e.amount_minor else -e.amount_minor end)
      from public.wallet_entries e where e.account_id = seller_account and e.bucket = 'pending'
    ), 0) < order_row.total_minor then
      raise exception 'Seller pending balance is unavailable for delivery settlement';
    end if;

    insert into public.wallet_transactions (
      sender_id, recipient_id, transaction_type, status, currency, amount_minor,
      idempotency_key, metadata, settled_at
    ) values (
      order_row.seller_id, order_row.seller_id, 'seller_earning', 'posted', order_row.currency,
      order_row.total_minor, _idempotency_key,
      jsonb_build_object('shop_order_id', order_row.id, 'source', 'wallet_shop_order'), now()
    ) returning id into earning_transaction;
    insert into public.wallet_entries (transaction_id, account_id, amount_minor, direction, bucket)
    values
      (earning_transaction, seller_account, order_row.total_minor, 'debit', 'pending'),
      (earning_transaction, seller_account, order_row.total_minor, 'credit', 'available');
  end if;

  update public.shop_orders o set status = 'delivered', delivered_at = now(), updated_at = now()
  where o.id = order_row.id and o.status = 'shipped';
  return query select order_row.id, 'delivered'::text, earning_transaction;
end;
$$;
revoke all on function public.confirm_shop_order_delivery(uuid, uuid) from public, anon;
grant execute on function public.confirm_shop_order_delivery(uuid, uuid) to authenticated;

create or replace function public.refund_wallet_shop_order(_order_id uuid, _idempotency_key uuid)
returns table(order_id uuid, status text, refund_transaction_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  buyer uuid := auth.uid();
  order_row public.shop_orders%rowtype;
  purchase public.wallet_transactions%rowtype;
  seller_account uuid;
  buyer_account uuid;
  seller_pending bigint;
  existing public.wallet_transactions%rowtype;
  refund_transaction uuid;
begin
  if buyer is null then raise exception 'Authentication required'; end if;
  if _idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  select * into order_row from public.shop_orders o where o.id = _order_id for update;
  if not found or order_row.buyer_id <> buyer then raise exception 'Order is unavailable'; end if;
  if order_row.payment_source <> 'wallet' or order_row.wallet_transaction_id is null then
    raise exception 'This order was not paid from Wallet';
  end if;

  select * into existing from public.wallet_transactions t
  where t.transaction_type = 'refund' and t.reverses_transaction_id = order_row.wallet_transaction_id;
  if found then return query select order_row.id, 'refunded'::text, existing.id; return; end if;
  if order_row.status not in ('paid', 'processing') then
    raise exception 'Wallet refund is unavailable after shipment or delivery';
  end if;

  select * into purchase from public.wallet_transactions t
  where t.id = order_row.wallet_transaction_id and t.transaction_type = 'purchase';
  if not found then raise exception 'Original Wallet purchase is missing'; end if;

  buyer_account := public.ensure_wallet_account(order_row.currency);
  select a.id into seller_account from public.wallet_accounts a
  where a.owner_id = order_row.seller_id and a.account_type = 'user' and a.currency = order_row.currency;
  if seller_account is null then raise exception 'Seller Wallet is unavailable'; end if;
  perform a.id from public.wallet_accounts a where a.id in (buyer_account, seller_account) order by a.id for update;
  select coalesce(sum(case when e.direction = 'credit' then e.amount_minor else -e.amount_minor end), 0)
  into seller_pending from public.wallet_entries e
  where e.account_id = seller_account and e.bucket = 'pending';
  if seller_pending < order_row.total_minor then raise exception 'Seller pending funds are unavailable for refund'; end if;

  insert into public.wallet_transactions (
    sender_id, recipient_id, transaction_type, status, currency, amount_minor,
    idempotency_key, reverses_transaction_id, metadata, settled_at
  ) values (
    order_row.seller_id, buyer, 'refund', 'posted', order_row.currency,
    order_row.total_minor, _idempotency_key, purchase.id,
    jsonb_build_object('shop_order_id', order_row.id), now()
  ) returning id into refund_transaction;
  insert into public.wallet_entries (transaction_id, account_id, amount_minor, direction, bucket)
  values
    (refund_transaction, seller_account, order_row.total_minor, 'debit', 'pending'),
    (refund_transaction, buyer_account, order_row.total_minor, 'credit', 'available');

  update public.shop_orders o set status = 'refunded', updated_at = now()
  where o.id = order_row.id and o.status in ('paid', 'processing');
  update public.shop_products p set inventory_count = p.inventory_count + i.quantity
  from public.shop_order_items i where i.order_id = order_row.id and p.id = i.product_id;
  return query select order_row.id, 'refunded'::text, refund_transaction;
end;
$$;
revoke all on function public.refund_wallet_shop_order(uuid, uuid) from public, anon;
grant execute on function public.refund_wallet_shop_order(uuid, uuid) to authenticated;

create or replace function public.update_shop_order_fulfillment(
  _order_id uuid,
  _next_status text,
  _tracking_carrier text,
  _tracking_number text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if _next_status not in ('processing', 'shipped') then raise exception 'Invalid seller fulfillment status'; end if;
  if _next_status = 'shipped' and (
    char_length(coalesce(_tracking_carrier, '')) not between 1 and 80
    or char_length(coalesce(_tracking_number, '')) not between 1 and 160
  ) then raise exception 'Carrier and tracking number are required'; end if;

  update public.shop_orders o
  set status = _next_status,
      tracking_carrier = case when _next_status = 'shipped' then _tracking_carrier else tracking_carrier end,
      tracking_number = case when _next_status = 'shipped' then _tracking_number else tracking_number end,
      shipped_at = case when _next_status = 'shipped' then now() else shipped_at end,
      updated_at = now()
  where o.id = _order_id and o.seller_id = auth.uid()
    and (
      (o.status = 'paid' and _next_status = 'processing')
      or (o.status in ('paid', 'processing') and _next_status = 'shipped')
    );
  return found;
end;
$$;