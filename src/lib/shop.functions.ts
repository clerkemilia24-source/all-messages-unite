// @ts-nocheck -- references tables from database updates not yet applied; remove once types are regenerated
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type RuntimeEnvironment = Record<string, unknown>;

function getEnvironmentValue(name: string) {
  const runtimeEnvironment = (globalThis as typeof globalThis & { __env__?: RuntimeEnvironment })
    .__env__;
  return (process.env[name] ?? runtimeEnvironment?.[name]) as string | undefined;
}

const catalogInput = z.object({
  query: z.string().trim().max(100).default(""),
  categoryId: z.string().uuid().nullable().default(null),
  sort: z.enum(["newest", "price-low", "price-high"]).default("newest"),
});

export const getShopCategories = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("shop_categories")
      .select("id, name, slug")
      .order("name");
    if (error) throw new Error("Could not load shop categories.");
    return data ?? [];
  });

export const getShopCatalog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => catalogInput.parse(input))
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("shop_products")
      .select(
        "id, seller_id, category_id, title, description, price_minor, currency, inventory_count, condition, created_at",
      )
      .eq("moderation_status", "approved")
      .gt("inventory_count", 0)
      .limit(48);

    if (data.categoryId) query = query.eq("category_id", data.categoryId);
    const term = data.query.replace(/[,%()\\]/g, " ").trim();
    if (term) query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
    if (data.sort === "price-low") query = query.order("price_minor", { ascending: true });
    else if (data.sort === "price-high") query = query.order("price_minor", { ascending: false });
    else query = query.order("created_at", { ascending: false });

    const { data: products, error } = await query;
    if (error) throw new Error("Could not load shop products.");
    if (!products?.length) return [];

    const sellerIds = Array.from(new Set(products.map((product) => product.seller_id)));
    const categoryIds = Array.from(new Set(products.map((product) => product.category_id)));
    const [{ data: sellers, error: sellersError }, { data: categories, error: categoriesError }] =
      await Promise.all([
        context.supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", sellerIds),
        context.supabase.from("shop_categories").select("id, name").in("id", categoryIds),
      ]);
    if (sellersError || categoriesError) throw new Error("Could not load product details.");

    const sellerMap = new Map((sellers ?? []).map((seller) => [seller.id, seller]));
    const categoryMap = new Map((categories ?? []).map((category) => [category.id, category.name]));
    return products.map((product) => ({
      ...product,
      seller: sellerMap.get(product.seller_id) ?? null,
      categoryName: categoryMap.get(product.category_id) ?? "Other",
    }));
  });

export const getMyShopListings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("shop_products")
      .select("id, title, price_minor, currency, inventory_count, moderation_status, created_at")
      .eq("seller_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error("Could not load your listings.");
    return data ?? [];
  });

export const submitShopProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        title: z.string().trim().min(2).max(160),
        description: z.string().trim().max(5000).nullable(),
        categoryId: z.string().uuid(),
        priceMinor: z.number().int().min(1).max(100_000_000),
        inventoryCount: z.number().int().min(0).max(1_000_000),
        condition: z.enum(["new", "used", "refurbished"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: product, error } = await context.supabase
      .from("shop_products")
      .insert({
        seller_id: context.userId,
        category_id: data.categoryId,
        title: data.title,
        description: data.description || null,
        price_minor: data.priceMinor,
        currency: "USD",
        inventory_count: data.inventoryCount,
        condition: data.condition,
      })
      .select("id, moderation_status")
      .single();
    if (error || !product) throw new Error("Could not submit this listing for review.");
    return product;
  });

export const getShopCart = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: items, error } = await context.supabase
      .from("shop_cart_items")
      .select("id, product_id, quantity")
      .eq("buyer_id", context.userId)
      .order("created_at", { ascending: true });
    if (error) throw new Error("Could not load your cart.");
    if (!items?.length) return [];

    const productIds = items.map((item) => item.product_id);
    const { data: products, error: productsError } = await context.supabase
      .from("shop_products")
      .select("id, seller_id, title, price_minor, currency, inventory_count, moderation_status")
      .in("id", productIds);
    if (productsError) throw new Error("Could not load cart item details.");
    const productMap = new Map((products ?? []).map((product) => [product.id, product]));
    return items.map((item) => ({ ...item, product: productMap.get(item.product_id) ?? null }));
  });

export const setShopCartItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(100) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: cartItemId, error } = await context.supabase.rpc("set_shop_cart_item", {
      _product_id: data.productId,
      _quantity: data.quantity,
    });
    if (error || !cartItemId) throw new Error(error?.message ?? "Could not update the cart.");
    return { id: cartItemId };
  });

export const removeShopCartItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ productId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: removed, error } = await context.supabase.rpc("remove_shop_cart_item", {
      _product_id: data.productId,
    });
    if (error || !removed) throw new Error("Could not remove this item from the cart.");
    return { removed: true };
  });

const shippingAddressInput = z.object({
  name: z.string().trim().min(1).max(120),
  address1: z.string().trim().min(1).max(200),
  address2: z.string().trim().max(200).nullable(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().min(1).max(100),
  postal_code: z.string().trim().min(1).max(32),
  country: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/),
});

export const createShopCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ idempotencyKey: z.string().uuid(), shippingAddress: shippingAddressInput })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const secretKey = getEnvironmentValue("STRIPE_SECRET_KEY")?.trim();
    const publicAppUrl = getEnvironmentValue("PUBLIC_APP_URL")?.trim();
    if (!secretKey) throw new Error("Shop checkout is unavailable: STRIPE_SECRET_KEY is missing.");
    if (!publicAppUrl) throw new Error("Shop checkout is unavailable: PUBLIC_APP_URL is missing.");

    let appOrigin: string;
    try {
      const url = new URL(publicAppUrl);
      if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
        throw new Error("invalid protocol");
      }
      appOrigin = url.origin;
    } catch {
      throw new Error("Shop checkout is unavailable: PUBLIC_APP_URL is invalid.");
    }

    const { data: created, error: createError } = await context.supabase.rpc(
      "create_shop_order_from_cart",
      {
        _idempotency_key: data.idempotencyKey,
        _shipping_address: data.shippingAddress,
      },
    );
    const order = created?.[0];
    if (createError || !order)
      throw new Error(createError?.message ?? "Could not reserve this order.");
    if (order.status === "paid")
      return { status: "paid" as const, checkoutUrl: null, orderId: order.order_id };
    if (order.status !== "pending_payment")
      throw new Error("This order is no longer awaiting payment.");

    const [{ data: orderRow, error: orderError }, { data: items, error: itemsError }] =
      await Promise.all([
        context.supabase
          .from("shop_orders")
          .select("reservation_expires_at, total_minor, currency")
          .eq("id", order.order_id)
          .single(),
        context.supabase
          .from("shop_order_items")
          .select("title_snapshot, quantity, unit_price_minor, currency")
          .eq("order_id", order.order_id),
      ]);
    if (orderError || itemsError || !orderRow || !items?.length) {
      throw new Error("Could not prepare reserved order items.");
    }

    const parameters = new URLSearchParams({
      mode: "payment",
      success_url: `${appOrigin}/shop?checkout=pending&order_id=${order.order_id}`,
      cancel_url: `${appOrigin}/shop?checkout=cancelled&order_id=${order.order_id}`,
      client_reference_id: order.order_id,
      "metadata[shop_order_id]": order.order_id,
      "metadata[buyer_id]": context.userId,
    });
    const expiresAt = Math.floor(new Date(orderRow.reservation_expires_at).getTime() / 1000);
    parameters.set("expires_at", String(expiresAt));
    items.forEach((item, index) => {
      parameters.set(`line_items[${index}][quantity]`, String(item.quantity));
      parameters.set(`line_items[${index}][price_data][currency]`, item.currency.toLowerCase());
      parameters.set(
        `line_items[${index}][price_data][unit_amount]`,
        String(item.unit_price_minor),
      );
      parameters.set(`line_items[${index}][price_data][product_data][name]`, item.title_snapshot);
    });

    let response: Response;
    try {
      response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${secretKey}`,
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": `ripple-shop-order-${order.order_id}`,
        },
        body: parameters,
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
    } catch {
      throw new Error("Stripe could not be reached. Retry this checkout safely.");
    }

    let session: { id?: unknown; url?: unknown; error?: { message?: unknown } };
    try {
      session = (await response.json()) as typeof session;
    } catch {
      throw new Error("Stripe returned an invalid checkout response.");
    }
    if (!response.ok || typeof session.id !== "string" || typeof session.url !== "string") {
      throw new Error(
        typeof session.error?.message === "string"
          ? session.error.message
          : "Stripe checkout could not be created.",
      );
    }
    const checkoutUrl = new URL(session.url);
    if (checkoutUrl.protocol !== "https:")
      throw new Error("Stripe returned an insecure checkout URL.");
    const { data: attached, error: attachError } = await context.supabase.rpc(
      "attach_shop_checkout_session",
      { _order_id: order.order_id, _session_id: session.id },
    );
    if (attachError || attached !== true) {
      throw new Error(
        "The checkout session could not be linked to the reserved order. Retry safely.",
      );
    }
    return {
      status: "pending_payment" as const,
      checkoutUrl: checkoutUrl.toString(),
      orderId: order.order_id,
    };
  });

export const createShopWalletPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ idempotencyKey: z.string().uuid(), shippingAddress: shippingAddressInput })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("create_shop_order_with_wallet", {
      _idempotency_key: data.idempotencyKey,
      _shipping_address: data.shippingAddress,
    });
    if (error || !result?.[0]) {
      throw new Error(error?.message ?? "Wallet checkout could not be completed.");
    }
    if (result[0].status !== "posted") {
      throw new Error("Wallet order payment was not posted.");
    }
    return result[0];
  });

export const getShopOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: orders, error } = await context.supabase
      .from("shop_orders")
      .select(
        "id, buyer_id, seller_id, status, payment_source, currency, subtotal_minor, total_minor, reservation_expires_at, tracking_carrier, tracking_number, created_at, paid_at, shipped_at, delivered_at",
      )
      .or(`buyer_id.eq.${context.userId},seller_id.eq.${context.userId}`)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error("Could not load shop orders.");
    if (!orders?.length) return [];
    const ids = orders.map((order) => order.id);
    const { data: items, error: itemsError } = await context.supabase
      .from("shop_order_items")
      .select("id, order_id, title_snapshot, quantity, unit_price_minor, currency")
      .in("order_id", ids);
    if (itemsError) throw new Error("Could not load order items.");
    const itemGroups = new Map<string, typeof items>();
    for (const item of items ?? []) {
      itemGroups.set(item.order_id, [...(itemGroups.get(item.order_id) ?? []), item]);
    }
    return orders.map((order) => ({ ...order, items: itemGroups.get(order.id) ?? [] }));
  });

export const updateShopOrderFulfillment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        orderId: z.string().uuid(),
        nextStatus: z.enum(["processing", "shipped", "delivered"]),
        trackingCarrier: z.string().trim().max(80).nullable(),
        trackingNumber: z.string().trim().max(160).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: updated, error } = await context.supabase.rpc("update_shop_order_fulfillment", {
      _order_id: data.orderId,
      _next_status: data.nextStatus,
      _tracking_carrier: data.trackingCarrier,
      _tracking_number: data.trackingNumber,
    });
    if (error || !updated) throw new Error("This seller order could not be updated.");
    return { status: data.nextStatus };
  });

export const getShopOrder = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: order, error } = await context.supabase
      .from("shop_orders")
      .select(
        "id, buyer_id, seller_id, status, currency, subtotal_minor, total_minor, shipping_address, tracking_carrier, tracking_number, created_at, paid_at, shipped_at, delivered_at",
      )
      .eq("id", data.orderId)
      .maybeSingle();
    if (error || !order) throw new Error("This order is unavailable.");
    const { data: items, error: itemsError } = await context.supabase
      .from("shop_order_items")
      .select("id, product_id, title_snapshot, quantity, unit_price_minor, currency")
      .eq("order_id", order.id);
    if (itemsError) throw new Error("Could not load order items.");
    return { ...order, items: items ?? [] };
  });

export const confirmShopOrderDelivery = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ orderId: z.string().uuid(), idempotencyKey: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("confirm_shop_order_delivery", {
      _order_id: data.orderId,
      _idempotency_key: data.idempotencyKey,
    });
    if (error || !result?.[0]) {
      throw new Error(error?.message ?? "Delivery could not be confirmed.");
    }
    return result[0];
  });

export const refundWalletShopOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ orderId: z.string().uuid(), idempotencyKey: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("refund_wallet_shop_order", {
      _order_id: data.orderId,
      _idempotency_key: data.idempotencyKey,
    });
    if (error || !result?.[0]) throw new Error(error?.message ?? "Wallet refund failed.");
    return result[0];
  });
