import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  Loader2,
  Minus,
  PackageCheck,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Store,
  Trash2,
  Truck,
  Wallet as WalletIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { BottomNav } from "@/components/BottomNav";
import { ChatAvatar } from "@/components/RemoteImage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getMyShopListings,
  getShopCart,
  getShopCatalog,
  getShopCategories,
  getShopOrder,
  getShopOrders,
  removeShopCartItem,
  setShopCartItem,
  createShopCheckout,
  createShopWalletPayment,
  submitShopProduct,
  updateShopOrderFulfillment,
  confirmShopOrderDelivery,
  refundWalletShopOrder,
} from "@/lib/shop.functions";

export const Route = createFileRoute("/shop")({
  head: () => ({
    meta: [
      { title: "Shop — Ripple" },
      { name: "description", content: "The Ripple shop." },
      { property: "og:title", content: "Shop — Ripple" },
      { property: "og:description", content: "The Ripple shop." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ShopPage,
});

function ShopPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [sort, setSort] = useState<"newest" | "price-low" | "price-high">("newest");
  const [categories, setCategories] = useState<Awaited<ReturnType<typeof getShopCategories>>>([]);
  const [products, setProducts] = useState<Awaited<ReturnType<typeof getShopCatalog>> | null>(null);
  const [myListings, setMyListings] = useState<Awaited<ReturnType<typeof getMyShopListings>>>([]);
  const [cartItems, setCartItems] = useState<Awaited<ReturnType<typeof getShopCart>>>([]);
  const [orders, setOrders] = useState<Awaited<ReturnType<typeof getShopOrders>>>([]);
  const [loadError, setLoadError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [listingOpen, setListingOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cartBusyId, setCartBusyId] = useState<string | null>(null);
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutKey, setCheckoutKey] = useState<string | null>(null);
  const [walletActionKeys, setWalletActionKeys] = useState<Record<string, string>>({});
  const [orderBusyId, setOrderBusyId] = useState<string | null>(null);
  const [tracking, setTracking] = useState<Record<string, { carrier: string; number: string }>>({});
  const [shippingAddress, setShippingAddress] = useState({
    name: "",
    address1: "",
    address2: "",
    city: "",
    region: "",
    postal_code: "",
    country: "US",
  });
  const [checkoutNotice, setCheckoutNotice] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [listingCategory, setListingCategory] = useState("");
  const [price, setPrice] = useState("");
  const [inventoryCount, setInventoryCount] = useState("1");
  const [condition, setCondition] = useState<"new" | "used" | "refurbished">("new");

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setProducts(null);
    setLoadError(false);
    void Promise.all([
      getShopCategories(),
      getShopCatalog({ data: { query, categoryId: categoryId || null, sort } }),
      getMyShopListings(),
      getShopCart(),
      getShopOrders(),
    ])
      .then(([nextCategories, nextProducts, nextListings, nextCart, nextOrders]) => {
        if (!active) return;
        setCategories(nextCategories);
        setProducts(nextProducts);
        setMyListings(nextListings);
        setCartItems(nextCart);
        setOrders(nextOrders);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [user, query, categoryId, sort, refreshKey]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("shop-user-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "shop_orders" }, () => {
        setRefreshKey((current) => current + 1);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const url = new URL(window.location.href);
    const checkout = url.searchParams.get("checkout");
    const orderId = url.searchParams.get("order_id");
    if (checkout === "cancelled") {
      setCheckoutNotice(
        "Checkout closed. The reserved order is awaiting Stripe expiration confirmation.",
      );
    } else if (checkout === "pending" && orderId) {
      void getShopOrder({ data: { orderId } })
        .then((order) => {
          setCheckoutNotice(
            order.status === "paid"
              ? "Stripe settlement confirmed. Your order is paid."
              : "Order payment is awaiting verified Stripe settlement.",
          );
          setRefreshKey((current) => current + 1);
        })
        .catch(() => {
          setCheckoutNotice("Order payment status could not be checked. Retry from order history.");
        });
    }
    if (checkout) {
      url.searchParams.delete("checkout");
      url.searchParams.delete("order_id");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [user]);

  async function createListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericPrice = Number(price);
    const numericInventory = Number(inventoryCount);
    if (
      !Number.isFinite(numericPrice) ||
      numericPrice <= 0 ||
      !Number.isInteger(numericInventory)
    ) {
      toast.error("Enter a valid price and inventory quantity.");
      return;
    }
    setSubmitting(true);
    try {
      await submitShopProduct({
        data: {
          title,
          description: description.trim() || null,
          categoryId: listingCategory,
          priceMinor: Math.round(numericPrice * 100),
          inventoryCount: numericInventory,
          condition,
        },
      });
      toast.success("Listing submitted for review");
      setTitle("");
      setDescription("");
      setPrice("");
      setInventoryCount("1");
      setListingOpen(false);
      setRefreshKey((current) => current + 1);
    } catch {
      toast.error("The listing could not be submitted. Check the details and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function addToCart(productId: string, quantity = 1) {
    setCartBusyId(productId);
    try {
      await setShopCartItem({ data: { productId, quantity } });
      toast.success("Cart updated");
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update the cart.");
    } finally {
      setCartBusyId(null);
    }
  }

  async function changeCartQuantity(productId: string, quantity: number) {
    if (quantity < 1) {
      await removeFromCart(productId);
      return;
    }
    await addToCart(productId, quantity);
  }

  async function removeFromCart(productId: string) {
    setCartBusyId(productId);
    try {
      await removeShopCartItem({ data: { productId } });
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove that cart item.");
    } finally {
      setCartBusyId(null);
    }
  }

  async function beginCheckout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCheckoutBusy(true);
    const idempotencyKey = checkoutKey ?? crypto.randomUUID();
    setCheckoutKey(idempotencyKey);
    try {
      const result = await createShopCheckout({
        data: {
          idempotencyKey,
          shippingAddress: {
            ...shippingAddress,
            address2: shippingAddress.address2.trim() || null,
          },
        },
      });
      if (result.status === "paid") {
        setCheckoutNotice("This order is already paid in the server ledger.");
        setCheckoutKey(null);
        setRefreshKey((current) => current + 1);
      } else if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Checkout could not start.");
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function payWithWallet() {
    setCheckoutBusy(true);
    const idempotencyKey = checkoutKey ?? crypto.randomUUID();
    setCheckoutKey(idempotencyKey);
    try {
      const result = await createShopWalletPayment({
        data: {
          idempotencyKey,
          shippingAddress: {
            ...shippingAddress,
            address2: shippingAddress.address2.trim() || null,
          },
        },
      });
      if (result.status !== "posted") throw new Error("Wallet purchase did not settle.");
      toast.success("Purchase paid from Wallet");
      setCheckoutNotice(
        "Wallet payment posted. Seller funds are pending until delivery is confirmed.",
      );
      setCheckoutKey(null);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Wallet checkout failed.");
    } finally {
      setCheckoutBusy(false);
    }
  }

  async function confirmDelivery(orderId: string) {
    const idempotencyKey = walletActionKeys[orderId] ?? crypto.randomUUID();
    setWalletActionKeys((current) => ({ ...current, [orderId]: idempotencyKey }));
    setOrderBusyId(orderId);
    try {
      await confirmShopOrderDelivery({ data: { orderId, idempotencyKey } });
      toast.success("Delivery confirmed and seller earnings released");
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delivery could not be confirmed.");
    } finally {
      setOrderBusyId(null);
    }
  }

  async function refundOrder(orderId: string) {
    if (
      !window.confirm(
        "Refund this Wallet-paid order? The order will be cancelled and inventory restored.",
      )
    ) {
      return;
    }
    const idempotencyKey = walletActionKeys[orderId] ?? crypto.randomUUID();
    setWalletActionKeys((current) => ({ ...current, [orderId]: idempotencyKey }));
    setOrderBusyId(orderId);
    try {
      await refundWalletShopOrder({ data: { orderId, idempotencyKey } });
      toast.success("Wallet refund posted");
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Wallet refund failed.");
    } finally {
      setOrderBusyId(null);
    }
  }

  async function fulfillOrder(orderId: string, status: "processing" | "shipped" | "delivered") {
    const details = tracking[orderId] ?? { carrier: "", number: "" };
    setOrderBusyId(orderId);
    try {
      await updateShopOrderFulfillment({
        data: {
          orderId,
          nextStatus: status,
          trackingCarrier: status === "shipped" ? details.carrier : null,
          trackingNumber: status === "shipped" ? details.number : null,
        },
      });
      toast.success("Order status updated");
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Order status could not be updated.");
    } finally {
      setOrderBusyId(null);
    }
  }

  const cartSellerIds = new Set(
    cartItems
      .map((item) => item.product?.seller_id)
      .filter((sellerId): sellerId is string => !!sellerId),
  );
  const cartSubtotal = cartItems.reduce(
    (total, item) => total + (item.product?.price_minor ?? 0) * item.quantity,
    0,
  );
  const cartHasUnavailableItem = cartItems.some(
    (item) => !item.product || item.product.moderation_status !== "approved",
  );

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col bg-background text-foreground">
      <header className="liquid-panel sticky top-0 z-10 space-y-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-[2rem] font-bold">Shop</h1>
          <div className="flex items-center gap-2">
            <Button
              variant={cartOpen ? "default" : "secondary"}
              onClick={() => {
                setCartOpen((open) => !open);
                setListingOpen(false);
              }}
            >
              <ShoppingCart /> Cart{cartItems.length > 0 ? ` (${cartItems.length})` : ""}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setListingOpen((open) => !open);
                setCartOpen(false);
              }}
            >
              {listingOpen ? <Store /> : <Plus />}
              {listingOpen ? "Browse" : "Sell"}
            </Button>
          </div>
        </div>
        <label className="flex items-center gap-2 rounded-xl bg-secondary px-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search products"
            aria-label="Search products"
            className="border-0 shadow-none focus-visible:ring-0"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            aria-label="Filter by category"
            className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
            aria-label="Sort products"
            className="h-10 min-w-0 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="newest">Recently added</option>
            <option value="price-low">Price: low to high</option>
            <option value="price-high">Price: high to low</option>
          </select>
        </div>
      </header>

      {checkoutNotice && (
        <p role="status" className="mx-4 mt-3 rounded-md bg-secondary px-3 py-2 text-sm">
          {checkoutNotice}
        </p>
      )}

      {cartOpen ? (
        <section className="flex-1 space-y-5 px-4 py-5">
          <div>
            <h2 className="text-lg font-semibold">Your cart</h2>
            {cartSellerIds.size > 1 && (
              <p className="mt-1 text-sm text-amber-700">
                Checkout is currently limited to one seller. Remove items from other sellers first.
              </p>
            )}
          </div>
          {cartItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Your cart is empty.</p>
          ) : (
            <ul className="divide-y divide-border">
              {cartItems.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {item.product?.title ?? "Unavailable product"}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {item.product
                        ? formatPrice(item.product.price_minor, item.product.currency)
                        : "No longer available"}
                    </span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Decrease quantity of ${item.product?.title ?? "unavailable product"}`}
                    disabled={cartBusyId === item.product_id}
                    onClick={() => void changeCartQuantity(item.product_id, item.quantity - 1)}
                  >
                    <Minus />
                  </Button>
                  <span className="w-8 text-center text-sm">{item.quantity}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Increase quantity of ${item.product?.title ?? "unavailable product"}`}
                    disabled={cartBusyId === item.product_id}
                    onClick={() => void changeCartQuantity(item.product_id, item.quantity + 1)}
                  >
                    <Plus />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${item.product?.title ?? "unavailable product"} from cart`}
                    disabled={cartBusyId === item.product_id}
                    onClick={() => void removeFromCart(item.product_id)}
                  >
                    {cartBusyId === item.product_id ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <Trash2 />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-between border-t border-border pt-3 font-semibold">
            <span>Estimated total</span>
            <span>{formatPrice(cartSubtotal, "USD")}</span>
          </div>

          <form
            onSubmit={(event) => void beginCheckout(event)}
            className="space-y-3 border-t border-border pt-4"
          >
            <h3 className="font-semibold">Delivery address</h3>
            <Input
              value={shippingAddress.name}
              onChange={(event) => {
                setCheckoutKey(null);
                setShippingAddress({ ...shippingAddress, name: event.target.value });
              }}
              placeholder="Recipient name"
              aria-label="Recipient name"
              maxLength={120}
              required
            />
            <Input
              value={shippingAddress.address1}
              onChange={(event) => {
                setCheckoutKey(null);
                setShippingAddress({ ...shippingAddress, address1: event.target.value });
              }}
              placeholder="Address"
              aria-label="Delivery address"
              maxLength={200}
              required
            />
            <Input
              value={shippingAddress.address2}
              onChange={(event) =>
                setShippingAddress({ ...shippingAddress, address2: event.target.value })
              }
              placeholder="Apartment, suite, etc. (optional)"
              aria-label="Address line 2"
              maxLength={200}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={shippingAddress.city}
                onChange={(event) =>
                  setShippingAddress({ ...shippingAddress, city: event.target.value })
                }
                placeholder="City"
                aria-label="City"
                required
              />
              <Input
                value={shippingAddress.region}
                onChange={(event) =>
                  setShippingAddress({ ...shippingAddress, region: event.target.value })
                }
                placeholder="State / region"
                aria-label="State or region"
                required
              />
              <Input
                value={shippingAddress.postal_code}
                onChange={(event) =>
                  setShippingAddress({ ...shippingAddress, postal_code: event.target.value })
                }
                placeholder="Postal code"
                aria-label="Postal code"
                required
              />
              <Input
                value={shippingAddress.country}
                onChange={(event) =>
                  setShippingAddress({
                    ...shippingAddress,
                    country: event.target.value.toUpperCase(),
                  })
                }
                placeholder="Country code"
                aria-label="Two-letter country code"
                minLength={2}
                maxLength={2}
                required
              />
            </div>
            <Button
              type="submit"
              disabled={
                checkoutBusy ||
                cartItems.length === 0 ||
                cartSellerIds.size !== 1 ||
                cartHasUnavailableItem
              }
            >
              {checkoutBusy ? <Loader2 className="animate-spin" /> : <ShoppingCart />}
              Continue to secure checkout
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={
                checkoutBusy ||
                cartItems.length === 0 ||
                cartSellerIds.size !== 1 ||
                cartHasUnavailableItem
              }
              onClick={() => void payWithWallet()}
            >
              {checkoutBusy ? <Loader2 className="animate-spin" /> : <WalletIcon />}
              Pay with Wallet
            </Button>
            <p className="text-xs text-muted-foreground">
              Stripe checkout reserves inventory until Stripe confirms settlement. Wallet purchases
              debit available funds immediately and keep seller earnings pending until delivery.
            </p>
          </form>

          <section className="border-t border-border pt-4">
            <h3 className="font-semibold">Order history</h3>
            {orders.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">No orders yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {orders.map((order) => (
                  <li key={order.id} className="py-3">
                    <div className="flex justify-between gap-3 text-sm">
                      <span className="capitalize">{order.status.replaceAll("_", " ")}</span>
                      <span>{formatPrice(order.total_minor, order.currency)}</span>
                    </div>
                    {order.items.map((item) => (
                      <p key={item.id} className="mt-1 text-xs text-muted-foreground">
                        {item.quantity} × {item.title_snapshot}
                      </p>
                    ))}
                    {order.tracking_number && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {order.tracking_carrier}: {order.tracking_number}
                      </p>
                    )}
                    {order.buyer_id === user?.id && order.payment_source === "wallet" && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(order.status === "paid" || order.status === "processing") && (
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={orderBusyId === order.id}
                            onClick={() => void refundOrder(order.id)}
                          >
                            {orderBusyId === order.id ? <Loader2 className="animate-spin" /> : null}
                            Refund before shipment
                          </Button>
                        )}
                        {order.status === "shipped" && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={orderBusyId === order.id}
                            onClick={() => void confirmDelivery(order.id)}
                          >
                            {orderBusyId === order.id ? <Loader2 className="animate-spin" /> : null}
                            Confirm delivery and release seller funds
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>
      ) : listingOpen ? (
        <section className="flex-1 space-y-5 px-4 py-5">
          <div>
            <h2 className="text-lg font-semibold">Create a listing</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Listings are reviewed before they appear in the catalog.
            </p>
          </div>
          <form onSubmit={(event) => void createListing(event)} className="space-y-3">
            <Input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Product name"
              aria-label="Product name"
              minLength={2}
              maxLength={160}
              required
            />
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Description"
              aria-label="Product description"
              maxLength={5000}
              rows={4}
              className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
            <select
              value={listingCategory}
              onChange={(event) => setListingCategory(event.target.value)}
              aria-label="Product category"
              required
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="" disabled>
                Choose a category
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1 text-sm">
                <span>Price (USD)</span>
                <Input
                  type="number"
                  min="0.01"
                  max="1000000"
                  step="0.01"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  required
                />
              </label>
              <label className="space-y-1 text-sm">
                <span>Available quantity</span>
                <Input
                  type="number"
                  min="0"
                  max="1000000"
                  step="1"
                  value={inventoryCount}
                  onChange={(event) => setInventoryCount(event.target.value)}
                  required
                />
              </label>
            </div>
            <select
              value={condition}
              onChange={(event) => setCondition(event.target.value as typeof condition)}
              aria-label="Product condition"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="new">New</option>
              <option value="used">Used</option>
              <option value="refurbished">Refurbished</option>
            </select>
            <Button type="submit" disabled={submitting || categories.length === 0}>
              {submitting ? <Loader2 className="animate-spin" /> : <PackageCheck />}
              Submit for review
            </Button>
          </form>

          <section className="border-t border-border pt-4">
            <h3 className="font-semibold">Your listings</h3>
            {myListings.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">You have no listings yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {myListings.map((listing) => (
                  <li key={listing.id} className="flex items-center justify-between gap-3 py-3">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{listing.title}</span>
                      <span className="text-xs text-muted-foreground">
                        {listing.inventory_count} available
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {listing.moderation_status.replaceAll("_", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="border-t border-border pt-4">
            <h3 className="font-semibold">Seller orders</h3>
            {orders.filter((order) => order.seller_id === user?.id).length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">No customer orders yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {orders
                  .filter((order) => order.seller_id === user?.id)
                  .map((order) => (
                    <li key={order.id} className="space-y-2 py-4">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="capitalize">{order.status.replaceAll("_", " ")}</span>
                        <span className="font-semibold">
                          {formatPrice(order.total_minor, order.currency)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">Order {order.id}</p>
                      {order.items.map((item) => (
                        <p key={item.id} className="text-sm">
                          {item.quantity} × {item.title_snapshot}
                        </p>
                      ))}
                      {order.status === "paid" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={orderBusyId === order.id}
                          onClick={() => void fulfillOrder(order.id, "processing")}
                        >
                          {orderBusyId === order.id ? <Loader2 className="animate-spin" /> : null}
                          Mark processing
                        </Button>
                      )}
                      {(order.status === "paid" || order.status === "processing") && (
                        <div className="space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <Input
                              value={tracking[order.id]?.carrier ?? ""}
                              onChange={(event) =>
                                setTracking((current) => ({
                                  ...current,
                                  [order.id]: {
                                    carrier: event.target.value,
                                    number: current[order.id]?.number ?? "",
                                  },
                                }))
                              }
                              placeholder="Carrier"
                              aria-label="Shipping carrier"
                              maxLength={80}
                            />
                            <Input
                              value={tracking[order.id]?.number ?? ""}
                              onChange={(event) =>
                                setTracking((current) => ({
                                  ...current,
                                  [order.id]: {
                                    carrier: current[order.id]?.carrier ?? "",
                                    number: event.target.value,
                                  },
                                }))
                              }
                              placeholder="Tracking number"
                              aria-label="Tracking number"
                              maxLength={160}
                            />
                          </div>
                          <Button
                            size="sm"
                            disabled={
                              orderBusyId === order.id ||
                              !tracking[order.id]?.carrier.trim() ||
                              !tracking[order.id]?.number.trim()
                            }
                            onClick={() => void fulfillOrder(order.id, "shipped")}
                          >
                            {orderBusyId === order.id ? (
                              <Loader2 className="animate-spin" />
                            ) : (
                              <Truck />
                            )}
                            Mark shipped
                          </Button>
                        </div>
                      )}
                      {order.status === "shipped" && (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={orderBusyId === order.id}
                          onClick={() => void fulfillOrder(order.id, "delivered")}
                        >
                          Mark delivered
                        </Button>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </section>
      ) : loadError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
          <p className="font-medium">Shop could not load.</p>
          <Button variant="secondary" onClick={() => setRefreshKey((current) => current + 1)}>
            <RefreshCw /> Retry
          </Button>
        </div>
      ) : products === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : products.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 text-center">
          <Store className="h-9 w-9 text-muted-foreground" />
          <h2 className="font-semibold">No products found</h2>
          <p className="text-sm text-muted-foreground">
            Try a different search or category. Approved in-stock listings appear here.
          </p>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-border px-4">
          {products.map((product) => (
            <li key={product.id} className="flex gap-3 py-4">
              <div className="grid h-16 w-16 shrink-0 place-items-center rounded-md bg-secondary">
                <PackageCheck className="h-6 w-6 text-muted-foreground" />
              </div>
              <article className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{product.categoryName}</p>
                <h2 className="truncate font-semibold">{product.title}</h2>
                {product.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {product.description}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <ChatAvatar
                    name={product.seller?.display_name ?? "Seller"}
                    path={product.seller?.avatar_url ?? null}
                    size={22}
                  />
                  <span className="truncate text-xs text-muted-foreground">
                    {product.seller?.display_name ?? "Seller"} · {product.condition} ·{" "}
                    {product.inventory_count} in stock
                  </span>
                </div>
              </article>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <p className="text-right text-sm font-semibold">
                  {formatPrice(product.price_minor, product.currency)}
                </p>
                <Button
                  size="icon"
                  variant="secondary"
                  aria-label={`Add ${product.title} to cart`}
                  disabled={cartBusyId === product.id}
                  onClick={() => void addToCart(product.id)}
                >
                  {cartBusyId === product.id ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ShoppingCart />
                  )}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <BottomNav />
    </main>
  );
}

function formatPrice(priceMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
      priceMinor / 100,
    );
  } catch {
    return `${currency} ${(priceMinor / 100).toFixed(2)}`;
  }
}
