import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type RuntimeEnvironment = Record<string, unknown>;

function getEnvironmentValue(name: string) {
  const runtimeEnvironment = (globalThis as typeof globalThis & { __env__?: RuntimeEnvironment })
    .__env__;
  return (process.env[name] ?? runtimeEnvironment?.[name]) as string | undefined;
}

const transactionIdInput = z.object({ transactionId: z.string().uuid() });

export const getWalletOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: walletId, error: accountError } = await context.supabase.rpc(
      "ensure_wallet_account",
      {
        _currency: "USD",
      },
    );
    if (accountError || !walletId) throw new Error("Could not open the USD wallet account.");

    const [
      { data: balances, error: balanceError },
      { data: transactions, error: transactionsError },
      { data: requests, error: requestsError },
    ] = await Promise.all([
      context.supabase.rpc("get_wallet_balances", { _currency: "USD" }),
      context.supabase
        .from("wallet_transactions")
        .select(
          "id, sender_id, recipient_id, transaction_type, status, currency, amount_minor, created_at, settled_at",
        )
        .or(`sender_id.eq.${context.userId},recipient_id.eq.${context.userId}`)
        .order("created_at", { ascending: false })
        .limit(50),
      context.supabase
        .from("wallet_payment_requests")
        .select(
          "id, requester_id, payer_id, amount_minor, currency, note, status, expires_at, created_at",
        )
        .or(`requester_id.eq.${context.userId},payer_id.eq.${context.userId}`)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (balanceError || transactionsError || requestsError) {
      throw new Error("Could not load wallet activity.");
    }
    return {
      walletId,
      availableMinor: balances?.[0]?.available_minor ?? 0,
      pendingMinor: balances?.[0]?.pending_minor ?? 0,
      transactions: transactions ?? [],
      requests: requests ?? [],
    };
  });

export const getWalletTransaction = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => transactionIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: transaction, error } = await context.supabase
      .from("wallet_transactions")
      .select(
        "id, sender_id, recipient_id, transaction_type, status, currency, amount_minor, provider, created_at, settled_at, reverses_transaction_id",
      )
      .eq("id", data.transactionId)
      .maybeSingle();
    if (error || !transaction) throw new Error("This wallet transaction is unavailable.");
    return transaction;
  });

export const sendWalletTransfer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        recipientUsername: z.string().trim().min(1).max(32),
        amountMinor: z.number().int().min(1).max(100_000),
        idempotencyKey: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: recipient, error: recipientError } = await context.supabase
      .from("profiles")
      .select("id")
      .eq("username", data.recipientUsername)
      .maybeSingle();
    if (recipientError || !recipient || recipient.id === context.userId) {
      throw new Error("Choose a valid recipient.");
    }
    const { data: result, error } = await context.supabase.rpc("send_wallet_transfer", {
      _recipient_id: recipient.id,
      _amount_minor: data.amountMinor,
      _currency: "USD",
      _idempotency_key: data.idempotencyKey,
    });
    if (error || !result?.[0]) {
      throw new Error(error?.message ?? "The transfer could not be completed.");
    }
    return result[0];
  });
export const createWalletPaymentRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        payerUsername: z.string().trim().max(32).nullable(),
        amountMinor: z.number().int().min(1).max(100_000),
        currency: z.literal("USD"),
        note: z.string().trim().max(280).nullable(),
        idempotencyKey: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    let payerId: string | null = null;
    if (data.payerUsername) {
      const { data: payer, error } = await context.supabase
        .from("profiles")
        .select("id")
        .eq("username", data.payerUsername.replace(/^@/, ""))
        .maybeSingle();
      if (error || !payer || payer.id === context.userId) {
        throw new Error("Choose a valid Wallet payer.");
      }
      payerId = payer.id;
    }
    const { data: requestId, error } = await context.supabase.rpc("create_wallet_payment_request", {
      _payer_id: payerId,
      _amount_minor: data.amountMinor,
      _currency: data.currency,
      _note: data.note,
      _idempotency_key: data.idempotencyKey,
    });
    if (error || !requestId) throw new Error(error?.message ?? "Could not create payment request.");
    return { id: requestId };
  });

export const payWalletPaymentRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ requestId: z.string().uuid(), idempotencyKey: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: result, error } = await context.supabase.rpc("pay_wallet_payment_request", {
      _request_id: data.requestId,
      _idempotency_key: data.idempotencyKey,
    });
    if (error || !result?.[0])
      throw new Error(error?.message ?? "Payment request could not be paid.");
    return result[0];
  });

export const cancelWalletPaymentRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: cancelled, error } = await context.supabase.rpc("cancel_wallet_payment_request", {
      _request_id: data.requestId,
    });
    if (error || !cancelled)
      throw new Error(error?.message ?? "Payment request could not be cancelled.");
    return { cancelled: true };
  });

export const createWalletFundingCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        amountMinor: z.number().int().min(100).max(500_000),
        idempotencyKey: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const secretKey = getEnvironmentValue("STRIPE_SECRET_KEY")?.trim();
    const publicAppUrl = getEnvironmentValue("PUBLIC_APP_URL")?.trim();
    if (!secretKey) throw new Error("Wallet funding is unavailable: STRIPE_SECRET_KEY is missing.");
    if (!publicAppUrl) throw new Error("Wallet funding is unavailable: PUBLIC_APP_URL is missing.");

    let appOrigin: string;
    try {
      const url = new URL(publicAppUrl);
      if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
        throw new Error("invalid protocol");
      }
      appOrigin = url.origin;
    } catch {
      throw new Error("Wallet funding is unavailable: PUBLIC_APP_URL is invalid.");
    }

    const { data: started, error: startError } = await context.supabase.rpc(
      "begin_wallet_funding",
      {
        _amount_minor: data.amountMinor,
        _currency: "USD",
        _idempotency_key: data.idempotencyKey,
      },
    );
    const transaction = started?.[0];
    if (startError || !transaction)
      throw new Error("A pending funding transaction could not be created.");
    if (transaction.status === "posted") return { status: "posted" as const, checkoutUrl: null };
    if (transaction.status !== "pending")
      throw new Error("This funding attempt is no longer active.");

    const parameters = new URLSearchParams({
      mode: "payment",
      success_url: `${appOrigin}/wallet?funding=pending&transaction_id=${transaction.transaction_id}`,
      cancel_url: `${appOrigin}/wallet?funding=cancelled&transaction_id=${transaction.transaction_id}`,
      client_reference_id: transaction.transaction_id,
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": String(data.amountMinor),
      "line_items[0][price_data][product_data][name]": "Ripple wallet funding",
      "metadata[wallet_transaction_id]": transaction.transaction_id,
      "metadata[user_id]": context.userId,
      "payment_intent_data[metadata][wallet_transaction_id]": transaction.transaction_id,
      "payment_intent_data[metadata][user_id]": context.userId,
    });

    let response: Response;
    try {
      response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${secretKey}`,
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": `ripple-wallet-funding-${transaction.transaction_id}`,
        },
        body: parameters,
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
    } catch {
      throw new Error("Stripe could not be reached. Retry this funding attempt safely.");
    }

    let session: { id?: unknown; url?: unknown; error?: { message?: unknown } };
    try {
      session = (await response.json()) as typeof session;
    } catch {
      throw new Error("Stripe returned an invalid checkout response.");
    }
    if (!response.ok || typeof session.id !== "string" || typeof session.url !== "string") {
      const message = typeof session.error?.message === "string" ? session.error.message : null;
      throw new Error(message ?? "Stripe checkout could not be created.");
    }
    const checkoutUrl = new URL(session.url);
    if (checkoutUrl.protocol !== "https:")
      throw new Error("Stripe returned an insecure checkout URL.");

    const { data: attached, error: attachError } = await context.supabase.rpc(
      "attach_wallet_funding_session",
      { _transaction_id: transaction.transaction_id, _session_id: session.id },
    );
    if (attachError || attached !== true) {
      throw new Error(
        "The Stripe session could not be linked to the pending transaction. Retry safely.",
      );
    }
    return { status: "pending" as const, checkoutUrl: checkoutUrl.toString() };
  });
