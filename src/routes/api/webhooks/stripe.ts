import { createFileRoute } from "@tanstack/react-router";

type RuntimeEnvironment = Record<string, unknown>;
type StripeCheckoutSession = {
  id?: unknown;
  metadata?: Record<string, string> | null;
  amount_total?: unknown;
  currency?: unknown;
  payment_status?: unknown;
};
type StripeEvent = {
  id?: unknown;
  type?: unknown;
  data?: { object?: StripeCheckoutSession };
};

function getEnvironmentValue(name: string) {
  const runtimeEnvironment = (globalThis as typeof globalThis & { __env__?: RuntimeEnvironment })
    .__env__;
  return (process.env[name] ?? runtimeEnvironment?.[name]) as string | undefined;
}

function toHex(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function verifyStripeSignature(body: string, header: string, secret: string) {
  const parts = header.split(",").map((part) => part.split("=", 2));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !/^\d+$/.test(timestamp) || signatures.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const expected = toHex(digest);
  return signatures.some((signature) => constantTimeEqual(signature, expected));
}

async function handleStripeWebhook(request: Request) {
  const secret = getEnvironmentValue("STRIPE_WEBHOOK_SECRET")?.trim();
  if (!secret) return Response.json({ error: "Webhook is not configured." }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing Stripe signature." }, { status: 400 });

  const rawBody = await request.text();
  if (!(await verifyStripeSignature(rawBody, signature, secret))) {
    return Response.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody) as StripeEvent;
  } catch {
    return Response.json({ error: "Invalid Stripe event." }, { status: 400 });
  }
  if (typeof event.id !== "string" || typeof event.type !== "string") {
    return Response.json({ error: "Invalid Stripe event envelope." }, { status: 400 });
  }
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
      "checkout.session.async_payment_failed",
      "checkout.session.expired",
    ].includes(event.type)
  ) {
    return Response.json({ received: true });
  }

  const session = event.data?.object;
  const walletTransactionId = session?.metadata?.["wallet_transaction_id"];
  const shopOrderId = session?.metadata?.["shop_order_id"];
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const isWalletFunding =
    typeof walletTransactionId === "string" && uuidPattern.test(walletTransactionId);
  const isShopOrder = typeof shopOrderId === "string" && uuidPattern.test(shopOrderId);
  if (typeof session?.id !== "string" || isWalletFunding === isShopOrder) {
    return Response.json({ received: true, ignored: true });
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  let error: { message: string } | null = null;
  if (
    event.type === "checkout.session.async_payment_failed" ||
    event.type === "checkout.session.expired"
  ) {
    if (isWalletFunding) {
      ({ error } = await supabaseAdmin.rpc("fail_wallet_funding", {
        _event_id: event.id,
        _event_type: event.type,
        _transaction_id: walletTransactionId as string,
        _session_id: session.id,
      }));
    } else {
      ({ error } = await supabaseAdmin.rpc("fail_shop_order", {
        _event_id: event.id,
        _event_type: event.type,
        _order_id: shopOrderId as string,
        _session_id: session.id,
      }));
    }
  } else {
    if (session.payment_status !== "paid") return Response.json({ received: true, pending: true });
    if (
      typeof session.amount_total !== "number" ||
      !Number.isSafeInteger(session.amount_total) ||
      typeof session.currency !== "string" ||
      !/^[a-z]{3}$/i.test(session.currency)
    ) {
      return Response.json({ error: "Invalid settled amount." }, { status: 400 });
    }
    if (isWalletFunding) {
      ({ error } = await supabaseAdmin.rpc("settle_wallet_funding", {
        _event_id: event.id,
        _event_type: event.type,
        _transaction_id: walletTransactionId as string,
        _session_id: session.id,
        _amount_minor: session.amount_total,
        _currency: session.currency.toUpperCase(),
      }));
    } else {
      ({ error } = await supabaseAdmin.rpc("settle_shop_order", {
        _event_id: event.id,
        _event_type: event.type,
        _order_id: shopOrderId as string,
        _session_id: session.id,
        _amount_minor: session.amount_total,
        _currency: session.currency.toUpperCase(),
      }));
    }
  }
  if (error) {
    console.error("[commerce] Stripe webhook processing failed", {
      eventId: event.id,
      error: error.message,
    });
    return Response.json({ error: "Settlement processing failed." }, { status: 500 });
  }
  return Response.json({ received: true });
}

export const Route = createFileRoute("/api/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => handleStripeWebhook(request),
    },
  },
});
