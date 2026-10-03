create table public.shop_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.shop_categories enable row level security;
grant select on public.shop_categories to authenticated;
grant all on public.shop_categories to service_role;
create policy "users read active shop categories" on public.shop_categories
  for select to authenticated using (is_active);

insert into public.shop_categories (name, slug) values
  ('Electronics', 'electronics'),
  ('Home and kitchen', 'home-kitchen'),
  ('Clothing', 'clothing'),
  ('Shoes', 'shoes'),
  ('Beauty and personal care', 'beauty'),
  ('Sports and outdoors', 'sports-outdoors'),
  ('Books and media', 'books-media'),
  ('Toys and games', 'toys-games'),
  ('Food and grocery', 'food-grocery'),
  ('Other', 'other')
on conflict (slug) do nothing;

create table public.shop_products (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid not null references public.shop_categories(id),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  description text check (description is null or char_length(description) <= 5000),
  price_minor bigint not null check (price_minor > 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  inventory_count integer not null default 0 check (inventory_count >= 0),
  condition text not null default 'new' check (condition in ('new', 'used', 'refurbished')),
  moderation_status text not null default 'pending_review'
    check (moderation_status in ('pending_review', 'approved', 'rejected', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index shop_products_catalog on public.shop_products (category_id, created_at desc)
  where moderation_status = 'approved' and inventory_count > 0;
create index shop_products_seller on public.shop_products (seller_id, created_at desc);
create index shop_products_price on public.shop_products (price_minor)
  where moderation_status = 'approved' and inventory_count > 0;

alter table public.shop_products enable row level security;
grant select on public.shop_products to authenticated;
grant insert (seller_id, category_id, title, description, price_minor, currency, inventory_count, condition)
  on public.shop_products to authenticated;
grant update (category_id, title, description, price_minor, currency, inventory_count, condition, updated_at)
  on public.shop_products to authenticated;
grant delete on public.shop_products to authenticated;
grant all on public.shop_products to service_role;

create policy "read available products or own listings" on public.shop_products
  for select to authenticated using (
    seller_id = auth.uid()
    or (moderation_status = 'approved' and inventory_count > 0)
  );
create policy "sellers submit product listings for review" on public.shop_products
  for insert to authenticated with check (
    seller_id = auth.uid()
    and moderation_status = 'pending_review'
    and exists (
      select 1 from public.shop_categories c
      where c.id = category_id and c.is_active
    )
  );
create policy "sellers edit unapproved listings" on public.shop_products
  for update to authenticated using (
    seller_id = auth.uid() and moderation_status in ('pending_review', 'rejected')
  ) with check (
    seller_id = auth.uid() and moderation_status in ('pending_review', 'rejected')
  );
create policy "sellers delete unapproved listings" on public.shop_products
  for delete to authenticated using (
    seller_id = auth.uid() and moderation_status in ('pending_review', 'rejected')
  );

create or replace function public.touch_shop_product_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.touch_shop_product_updated_at() from public, anon, authenticated;
create trigger shop_products_updated_at
  before update on public.shop_products
  for each row execute function public.touch_shop_product_updated_at();