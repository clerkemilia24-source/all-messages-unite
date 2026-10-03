create table public.shop_cart_items (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete cascade,
  product_id uuid not null references public.shop_products(id) on delete cascade,
  quantity integer not null check (quantity between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (buyer_id, product_id)
);
create index shop_cart_items_buyer on public.shop_cart_items (buyer_id, created_at desc);
alter table public.shop_cart_items enable row level security;
grant select on public.shop_cart_items to authenticated;
grant all on public.shop_cart_items to service_role;
create policy "buyers read their cart" on public.shop_cart_items
  for select to authenticated using (buyer_id = auth.uid());

create table public.shop_orders (
  id uuid primary key default gen_random_uuid(),
  buyer_id uuid not null references auth.users(id) on delete restrict,
  seller_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded', 'disputed')),
  currency text not null check (currency = 'USD'),
  subtotal_minor bigint not null check (subtotal_minor > 0),
  total_minor bigint not null check (total_minor = subtotal_minor),
  idempotency_key uuid not null,
  stripe_session_id text unique,
  reservation_expires_at timestamptz not null,
  shipping_address jsonb not null,
  tracking_carrier text,
  tracking_number text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (buyer_id, idempotency_key),
  constraint shop_order_shipping_address check (
    jsonb_typeof(shipping_address) = 'object'
    and char_length(coalesce(shipping_address->>'name', '')) between 1 and 120
    and char_length(coalesce(shipping_address->>'address1', '')) between 1 and 200
    and char_length(coalesce(shipping_address->>'city', '')) between 1 and 100
    and char_length(coalesce(shipping_address->>'region', '')) between 1 and 100
    and char_length(coalesce(shipping_address->>'postal_code', '')) between 1 and 32
    and (shipping_address->>'country') ~ '^[A-Z]{2}$'
  )
);
create index shop_orders_buyer on public.shop_orders (buyer_id, created_at desc);
create index shop_orders_seller on public.shop_orders (seller_id, created_at desc);
create index shop_orders_expiring on public.shop_orders (reservation_expires_at)
  where status = 'pending_payment';
alter table public.shop_orders enable row level security;
grant select on public.shop_orders to authenticated;
grant all on public.shop_orders to service_role;
create policy "buyers and sellers read their orders" on public.shop_orders
  for select to authenticated using (buyer_id = auth.uid() or seller_id = auth.uid());

create table public.shop_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.shop_orders(id) on delete restrict,
  product_id uuid not null references public.shop_products(id) on delete restrict,
  title_snapshot text not null,
  quantity integer not null check (quantity between 1 and 100),
  unit_price_minor bigint not null check (unit_price_minor > 0),
  currency text not null check (currency = 'USD'),
  created_at timestamptz not null default now(),
  unique (order_id, product_id)
);
create index shop_order_items_order on public.shop_order_items (order_id);
alter table public.shop_order_items enable row level security;
grant select on public.shop_order_items to authenticated;
grant all on public.shop_order_items to service_role;
create policy "buyers and sellers read order items" on public.shop_order_items
  for select to authenticated using (exists (
    select 1 from public.shop_orders o
    where o.id = order_id and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
  ));

create table public.shop_checkout_events (
  provider text not null,
  event_id text not null,
  event_type text not null,
  order_id uuid references public.shop_orders(id),
  processing_status text not null default 'received'
    check (processing_status in ('received', 'processed', 'failed')),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (provider, event_id)
);
alter table public.shop_checkout_events enable row level security;
grant all on public.shop_checkout_events to service_role;

create or replace function public.set_shop_cart_item(_product_id uuid, _quantity integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  buyer uuid := auth.uid();
  cart_item_id uuid;
  stock integer;
begin
  if buyer is null then raise exception 'Authentication required'; end if;
  if _quantity is null or _quantity < 1 or _quantity > 100 then raise exception 'Invalid cart quantity'; end if;
  select p.inventory_count into stock from public.shop_products p
  where p.id = _product_id and p.moderation_status = 'approved' for share;
  if not found or stock < _quantity then raise exception 'Product is unavailable in the requested quantity'; end if;

  insert into public.shop_cart_items (buyer_id, product_id, quantity)
  values (buyer, _product_id, _quantity)
  on conflict (buyer_id, product_id) do update
  set quantity = excluded.quantity, updated_at = now()
  returning id into cart_item_id;
  return cart_item_id;
end;
$$;
revoke all on function public.set_shop_cart_item(uuid, integer) from public, anon;
grant execute on function public.set_shop_cart_item(uuid, integer) to authenticated;

create or replace function public.remove_shop_cart_item(_product_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  delete from public.shop_cart_items c where c.buyer_id = auth.uid() and c.product_id = _product_id;
  return found;
end;
$$;
revoke all on function public.remove_shop_cart_item(uuid) from public, anon;
grant execute on function public.remove_shop_cart_item(uuid) to authenticated;

create or replace function public.create_shop_order_from_cart(
  _idempotency_key uuid,
  _shipping_address jsonb
)
returns table(order_id uuid, status text, total_minor bigint, reservation_expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  buyer uuid := auth.uid();
  existing public.shop_orders%rowtype;
  cart_count bigint;
  product_count bigint;
  seller_count bigint;
  order_seller uuid;
  order_total bigint;
  created_order uuid;
  expires timestamptz;
begin
  if buyer is null then raise exception 'Authentication required'; end if;
  if _idempotency_key is null then raise exception 'Idempotency key is required'; end if;
  if jsonb_typeof(_shipping_address) <> 'object'
    or char_length(coalesce(_shipping_address->>'name', '')) not between 1 and 120
    or char_length(coalesce(_shipping_address->>'address1', '')) not between 1 and 200
    or char_length(coalesce(_shipping_address->>'city', '')) not between 1 and 100
    or char_length(coalesce(_shipping_address->>'region', '')) not between 1 and 100
    or char_length(coalesce(_shipping_address->>'postal_code', '')) not between 1 and 32
    or (_shipping_address->>'country') !~ '^[A-Z]{2}$' then
    raise exception 'Shipping address is incomplete';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(buyer::text || ':' || _idempotency_key::text, 0));
  select * into existing from public.shop_orders o
  where o.buyer_id = buyer and o.idempotency_key = _idempotency_key;
  if found then
    if existing.shipping_address <> _shipping_address then
      raise exception 'Idempotency key was already used for a different shipping address';
    end if;
    return query select existing.id, existing.status, existing.total_minor, existing.reservation_expires_at;
    return;
  end if;

  select count(*) into cart_count from public.shop_cart_items c where c.buyer_id = buyer;
  if cart_count = 0 then raise exception 'Cart is empty'; end if;
  perform p.id from public.shop_products p
  join public.shop_cart_items c on c.product_id = p.id
  where c.buyer_id = buyer
  order by p.id for update of p;

  select count(*), count(distinct p.seller_id),
    coalesce(sum(p.price_minor * c.quantity), 0)
  into product_count, seller_count, order_total
  from public.shop_cart_items c
  join public.shop_products p on p.id = c.product_id
  where c.buyer_id = buyer
    and p.moderation_status = 'approved'
    and p.currency = 'USD'
    and p.inventory_count >= c.quantity
    and p.seller_id <> buyer;
  if product_count <> cart_count then raise exception 'A cart item is unavailable or out of stock'; end if;
  if seller_count <> 1 then raise exception 'Checkout currently requires products from one seller'; end if;
  if order_total <= 0 or order_total > 100000000 then raise exception 'Order total is outside checkout limits'; end if;
  select p.seller_id into order_seller
  from public.shop_cart_items c
  join public.shop_products p on p.id = c.product_id
  where c.buyer_id = buyer
  limit 1;

  expires := now() + interval '31 minutes';
  insert into public.shop_orders (
    buyer_id, seller_id, status, currency, subtotal_minor, total_minor,
    idempotency_key, reservation_expires_at, shipping_address
  ) values (
    buyer, order_seller, 'pending_payment', 'USD', order_total, order_total,
    _idempotency_key, expires, _shipping_address
  ) returning id into created_order;

  insert into public.shop_order_items (order_id, product_id, title_snapshot, quantity, unit_price_minor, currency)
  select created_order, p.id, p.title, c.quantity, p.price_minor, p.currency
  from public.shop_cart_items c
  join public.shop_products p on p.id = c.product_id
  where c.buyer_id = buyer;

  update public.shop_products p
  set inventory_count = p.inventory_count - c.quantity
  from public.shop_cart_items c
  where c.buyer_id = buyer and c.product_id = p.id;
  delete from public.shop_cart_items c where c.buyer_id = buyer;
  return query select created_order, 'pending_payment'::text, order_total, expires;
end;
$$;
revoke all on function public.create_shop_order_from_cart(uuid, jsonb) from public, anon;
grant execute on function public.create_shop_order_from_cart(uuid, jsonb) to authenticated;

create or replace function public.attach_shop_checkout_session(_order_id uuid, _session_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or _session_id is null or char_length(_session_id) > 255 then
    raise exception 'Invalid checkout session';
  end if;
  update public.shop_orders o set stripe_session_id = _session_id
  where o.id = _order_id and o.buyer_id = auth.uid() and o.status = 'pending_payment'
    and o.reservation_expires_at > now()
    and (o.stripe_session_id is null or o.stripe_session_id = _session_id);
  return found;
end;
$$;
revoke all on function public.attach_shop_checkout_session(uuid, text) from public, anon;
grant execute on function public.attach_shop_checkout_session(uuid, text) to authenticated;

create or replace function public.settle_shop_order(
  _event_id text,
  _event_type text,
  _order_id uuid,
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
  order_row public.shop_orders%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  insert into public.shop_checkout_events (provider, event_id, event_type, order_id)
  values ('stripe', _event_id, _event_type, _order_id)
  on conflict (provider, event_id) do nothing;
  if not found then return true; end if;

  select * into order_row from public.shop_orders o where o.id = _order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if order_row.total_minor <> _amount_minor or order_row.currency <> upper(_currency) then
    raise exception 'Provider amount does not match the order';
  end if;
  if order_row.stripe_session_id is not null and order_row.stripe_session_id <> _session_id then
    raise exception 'Provider session does not match the order';
  end if;
  if order_row.status = 'paid' then
    update public.shop_checkout_events e set processing_status = 'processed', processed_at = now()
    where e.provider = 'stripe' and e.event_id = _event_id;
    return true;
  end if;
  if order_row.status <> 'pending_payment' then raise exception 'Order cannot be settled'; end if;

  update public.shop_orders o set status = 'paid', stripe_session_id = _session_id, paid_at = now(), updated_at = now()
  where o.id = _order_id and o.status = 'pending_payment';
  update public.shop_checkout_events e set processing_status = 'processed', processed_at = now()
  where e.provider = 'stripe' and e.event_id = _event_id;
  return true;
end;
$$;
revoke all on function public.settle_shop_order(text, text, uuid, text, bigint, text) from public, anon, authenticated;
grant execute on function public.settle_shop_order(text, text, uuid, text, bigint, text) to service_role;

create or replace function public.fail_shop_order(_event_id text, _event_type text, _order_id uuid, _session_id text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  order_row public.shop_orders%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  insert into public.shop_checkout_events (provider, event_id, event_type, order_id)
  values ('stripe', _event_id, _event_type, _order_id)
  on conflict (provider, event_id) do nothing;
  if not found then return true; end if;

  select * into order_row from public.shop_orders o where o.id = _order_id for update;
  if not found then raise exception 'Order not found'; end if;
  if order_row.stripe_session_id is not null and order_row.stripe_session_id <> _session_id then
    raise exception 'Provider session does not match the order';
  end if;
  if order_row.status = 'pending_payment' then
    update public.shop_orders o
    set status = 'cancelled', stripe_session_id = coalesce(stripe_session_id, _session_id), updated_at = now()
    where o.id = _order_id and o.status = 'pending_payment';
    update public.shop_products p
    set inventory_count = p.inventory_count + i.quantity
    from public.shop_order_items i
    where i.order_id = _order_id and p.id = i.product_id;
  end if;
  update public.shop_checkout_events e set processing_status = 'processed', processed_at = now()
  where e.provider = 'stripe' and e.event_id = _event_id;
  return true;
end;
$$;
revoke all on function public.fail_shop_order(text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.fail_shop_order(text, text, uuid, text) to service_role;

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
  if _next_status not in ('processing', 'shipped', 'delivered') then raise exception 'Invalid fulfillment status'; end if;
  if _next_status = 'shipped' and (
    char_length(coalesce(_tracking_carrier, '')) not between 1 and 80
    or char_length(coalesce(_tracking_number, '')) not between 1 and 160
  ) then raise exception 'Carrier and tracking number are required'; end if;

  update public.shop_orders o
  set status = _next_status,
      tracking_carrier = case when _next_status = 'shipped' then _tracking_carrier else tracking_carrier end,
      tracking_number = case when _next_status = 'shipped' then _tracking_number else tracking_number end,
      shipped_at = case when _next_status = 'shipped' then now() else shipped_at end,
      delivered_at = case when _next_status = 'delivered' then now() else delivered_at end,
      updated_at = now()
  where o.id = _order_id and o.seller_id = auth.uid()
    and (
      (o.status = 'paid' and _next_status = 'processing')
      or (o.status in ('paid', 'processing') and _next_status = 'shipped')
      or (o.status = 'shipped' and _next_status = 'delivered')
    );
  return found;
end;
$$;
revoke all on function public.update_shop_order_fulfillment(uuid, text, text, text) from public, anon;
grant execute on function public.update_shop_order_fulfillment(uuid, text, text, text) to authenticated;

create or replace function public.release_expired_shop_reservations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expired_order record;
  released integer := 0;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  for expired_order in
    select o.id
    from public.shop_orders o
    where o.status = 'pending_payment' and o.reservation_expires_at <= now()
    order by o.reservation_expires_at
    limit 100
    for update skip locked
  loop
    update public.shop_orders o
    set status = 'cancelled', updated_at = now()
    where o.id = expired_order.id and o.status = 'pending_payment';
    if found then
      update public.shop_products p
      set inventory_count = p.inventory_count + i.quantity
      from public.shop_order_items i
      where i.order_id = expired_order.id and p.id = i.product_id;
      released := released + 1;
    end if;
  end loop;
  return released;
end;
$$;
revoke all on function public.release_expired_shop_reservations() from public, anon, authenticated;
grant execute on function public.release_expired_shop_reservations() to service_role;

alter publication supabase_realtime add table public.shop_orders;