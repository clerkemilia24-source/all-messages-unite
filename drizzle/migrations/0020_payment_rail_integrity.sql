alter table public.shop_orders
  add constraint shop_order_payment_rail_exclusive check (
    (payment_source = 'stripe' and wallet_transaction_id is null)
    or (payment_source = 'wallet' and stripe_session_id is null and wallet_transaction_id is not null)
  );

create or replace function private.guard_shop_payment_rail()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payment_source = 'wallet' and new.stripe_session_id is not null then
    raise exception 'An order with a Stripe session cannot be paid from Wallet';
  end if;
  if new.payment_source = 'stripe' and new.wallet_transaction_id is not null then
    raise exception 'A Wallet-paid order cannot be settled through Stripe';
  end if;
  if old.payment_source = 'wallet' and new.payment_source <> 'wallet' then
    raise exception 'Wallet payment source cannot be changed';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_shop_payment_rail() from public, anon, authenticated;
create trigger shop_order_payment_rail_guard
  before update of payment_source, stripe_session_id, wallet_transaction_id
  on public.shop_orders
  for each row execute function private.guard_shop_payment_rail();

alter publication supabase_realtime add table public.wallet_transactions;