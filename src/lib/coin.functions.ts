import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getCoinOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error: accountError } = await context.supabase.rpc("ensure_coin_account");
    if (accountError) throw new Error("Could not open the Coin account.");
    const [balanceResult, transactionsResult] = await Promise.all([
      context.supabase.rpc("get_coin_balance"),
      context.supabase
        .from("coin_transactions")
        .select(
          "id, initiator_id, recipient_id, transaction_type, status, amount_minor, fee_minor, created_at",
        )
        .or(`initiator_id.eq.${context.userId},recipient_id.eq.${context.userId}`)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (balanceResult.error || transactionsResult.error) {
      throw new Error("Could not load Coin activity.");
    }
    return {
      balanceMinor: balanceResult.data?.[0]?.available_minor ?? 0,
      totalMinted: balanceResult.data?.[0]?.total_minted ?? 0,
      totalBurned: balanceResult.data?.[0]?.total_burned ?? 0,
      transactions: transactionsResult.data ?? [],
    };
  });

export const transferCoin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        recipientUsername: z.string().trim().min(1).max(32),
        amountMinor: z.number().int().min(1).max(1_000_000),
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
      throw new Error("Choose a valid Coin recipient.");
    }
    const { data: result, error } = await context.supabase.rpc("transfer_coin", {
      _recipient_id: recipient.id,
      _amount_minor: data.amountMinor,
      _idempotency_key: data.idempotencyKey,
      _transaction_type: "transfer",
      _reference_id: null,
    });
    if (error || !result?.[0]) throw new Error(error?.message ?? "Coin transfer failed.");
    return result[0];
  });
