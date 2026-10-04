// @ts-nocheck -- references tables from database updates not yet applied; remove once types are regenerated
import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  Copy,
  Loader2,
  QrCode,
  RefreshCw,
  Wallet as WalletIcon,
} from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  cancelWalletPaymentRequest,
  createWalletPaymentRequest,
  createWalletFundingCheckout,
  getWalletOverview,
  getWalletTransaction,
  payWalletPaymentRequest,
  sendWalletTransfer,
} from "@/lib/wallet.functions";

export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet — Ripple" },
      { name: "description", content: "View settled and pending wallet activity." },
      { property: "og:title", content: "Wallet — Ripple" },
      { property: "og:description", content: "View settled and pending wallet activity on Ripple." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WalletPage,
});

type WalletOverview = Awaited<ReturnType<typeof getWalletOverview>>;

function WalletPage() {
  const { user, profile, loading } = useAuth();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<WalletOverview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fundingAmount, setFundingAmount] = useState("");
  const [fundingKey, setFundingKey] = useState<string | null>(null);
  const [transferRecipient, setTransferRecipient] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [transferKey, setTransferKey] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"fund" | "send" | null>(null);
  const [notice, setNotice] = useState("");
  const [receiveQr, setReceiveQr] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<"wallet" | "username" | null>(null);
  const [requestPayer, setRequestPayer] = useState("");
  const [requestAmount, setRequestAmount] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const [requestBusy, setRequestBusy] = useState(false);
  const [requestActionId, setRequestActionId] = useState<string | null>(null);
  const [requestActionKeys, setRequestActionKeys] = useState<Record<string, string>>({});
  const walletId = overview?.walletId;

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setOverview(null);
    setLoadError(false);
    void getWalletOverview()
      .then((result) => {
        if (active) setOverview(result);
      })
      .catch(() => {
        if (active) setLoadError(true);
      });
    return () => {
      active = false;
    };
  }, [user, refreshKey]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("wallet-user-transactions")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wallet_transactions" },
        () => {
          setRefreshKey((current) => current + 1);
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "wallet_payment_requests" },
        () => {
          setRefreshKey((current) => current + 1);
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user]);

  useEffect(() => {
    if (!walletId || !profile?.username) return;
    let active = true;
    const receiveUrl = new URL("/wallet", window.location.origin);
    receiveUrl.searchParams.set("recipient", profile.username);
    void QRCode.toDataURL(receiveUrl.toString(), {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 192,
    })
      .then((image) => {
        if (active) setReceiveQr(image);
      })
      .catch(() => {
        if (active) setReceiveQr(null);
      });
    return () => {
      active = false;
    };
  }, [walletId, profile?.username]);

  useEffect(() => {
    const recipient = new URL(window.location.href).searchParams.get("recipient");
    if (recipient) setTransferRecipient(recipient.replace(/^@/, ""));
  }, []);

  useEffect(() => {
    if (!user) return;
    const url = new URL(window.location.href);
    const fundingState = url.searchParams.get("funding");
    const transactionId = url.searchParams.get("transaction_id");
    if (!fundingState || !transactionId) return;
    if (fundingState === "cancelled") {
      setNotice("Checkout closed. No funds were added unless Stripe later confirms settlement.");
    } else if (/^[0-9a-f-]{36}$/i.test(transactionId)) {
      void getWalletTransaction({ data: { transactionId } })
        .then((transaction) => {
          if (transaction.status === "posted") {
            setNotice("Stripe settlement confirmed. Your available balance has been updated.");
          } else {
            setNotice("Payment is awaiting verified Stripe settlement. Your balance is unchanged.");
          }
          setRefreshKey((current) => current + 1);
        })
        .catch(() =>
          setNotice("Funding status could not be checked. Retry from transaction history."),
        );
    }
    url.searchParams.delete("funding");
    url.searchParams.delete("transaction_id");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [user]);

  async function fundWallet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(fundingAmount);
    if (!Number.isFinite(value) || value < 1 || value > 5000) {
      toast.error("Enter a funding amount from $1 to $5,000.");
      return;
    }
    const idempotencyKey = fundingKey ?? crypto.randomUUID();
    setFundingKey(idempotencyKey);
    setBusyAction("fund");
    try {
      const result = await createWalletFundingCheckout({
        data: { amountMinor: Math.round(value * 100), idempotencyKey },
      });
      if (result.status === "posted") {
        setNotice("Funding is already settled in the ledger.");
        setFundingAmount("");
        setFundingKey(null);
        setRefreshKey((current) => current + 1);
      } else if (result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Wallet funding could not start.");
    } finally {
      setBusyAction(null);
    }
  }

  async function sendTransfer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = Number(transferAmount);
    if (!Number.isFinite(value) || value <= 0 || value > 1000) {
      toast.error("Enter a transfer amount from $0.01 to $1,000.");
      return;
    }
    const idempotencyKey = transferKey ?? crypto.randomUUID();
    setTransferKey(idempotencyKey);
    setBusyAction("send");
    try {
      const transaction = await sendWalletTransfer({
        data: {
          recipientUsername: transferRecipient.replace(/^@/, ""),
          amountMinor: Math.round(value * 100),
          idempotencyKey,
        },
      });
      if (transaction.status !== "posted") {
        toast.error("The transfer is not posted. Check its status before retrying.");
        return;
      }
      toast.success("Transfer posted to the ledger");
      setTransferRecipient("");
      setTransferAmount("");
      setTransferKey(null);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Transfer could not be completed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function copyReceiveValue(value: string, field: "wallet" | "username") {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1500);
      toast.success(field === "wallet" ? "Wallet ID copied" : "Username copied");
    } catch {
      toast.error("Clipboard access is unavailable in this browser.");
    }
  }

  async function createPaymentRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amount = Number(requestAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) {
      toast.error("Enter a request amount from $0.01 to $1,000.");
      return;
    }
    const idempotencyKey = requestKey ?? crypto.randomUUID();
    setRequestKey(idempotencyKey);
    setRequestBusy(true);
    try {
      await createWalletPaymentRequest({
        data: {
          payerUsername: requestPayer.trim().replace(/^@/, "") || null,
          amountMinor: Math.round(amount * 100),
          currency: "USD",
          note: requestNote.trim() || null,
          idempotencyKey,
        },
      });
      toast.success("Payment request created");
      setRequestPayer("");
      setRequestAmount("");
      setRequestNote("");
      setRequestKey(null);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Payment request failed.");
    } finally {
      setRequestBusy(false);
    }
  }

  async function payRequest(requestId: string) {
    const idempotencyKey = requestActionKeys[requestId] ?? crypto.randomUUID();
    setRequestActionKeys((current) => ({ ...current, [requestId]: idempotencyKey }));
    setRequestActionId(requestId);
    try {
      const result = await payWalletPaymentRequest({ data: { requestId, idempotencyKey } });
      if (result.status !== "posted") throw new Error("The request payment was not posted.");
      toast.success("Requested payment posted to the ledger");
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Request payment failed.");
    } finally {
      setRequestActionId(null);
    }
  }

  async function cancelRequest(requestId: string) {
    setRequestActionId(requestId);
    try {
      await cancelWalletPaymentRequest({ data: { requestId } });
      toast.success("Payment request cancelled");
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Request could not be cancelled.");
    } finally {
      setRequestActionId(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background text-foreground">
      <header className="liquid-panel sticky top-0 z-10 flex items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <WalletIcon className="h-5 w-5 text-primary" />
          <h1 className="text-[2rem] font-bold">Wallet</h1>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh wallet"
          onClick={() => setRefreshKey((current) => current + 1)}
        >
          <RefreshCw />
        </Button>
      </header>

      <div className="flex-1 space-y-6 px-4 py-5">
        {loadError ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p>Wallet data could not load.</p>
            <Button variant="secondary" onClick={() => setRefreshKey((current) => current + 1)}>
              <RefreshCw /> Retry
            </Button>
          </div>
        ) : overview === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <section className="border-b border-border pb-5">
              <p className="text-sm text-muted-foreground">Available</p>
              <p className="text-4xl font-semibold">{formatUsd(overview.availableMinor)}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {formatUsd(overview.pendingMinor)} pending settlement
              </p>
            </section>

            {notice && (
              <p role="status" className="rounded-md bg-secondary px-3 py-2 text-sm">
                {notice}
              </p>
            )}

            <section className="grid gap-6 border-b border-border pb-6 sm:grid-cols-2">
              <form onSubmit={(event) => void fundWallet(event)} className="space-y-3">
                <h2 className="font-semibold">Add funds</h2>
                <p className="text-sm text-muted-foreground">
                  Stripe must confirm payment before funds become available.
                </p>
                <Input
                  aria-label="Funding amount in US dollars"
                  type="number"
                  min="1"
                  max="5000"
                  step="0.01"
                  value={fundingAmount}
                  onChange={(event) => {
                    setFundingAmount(event.target.value);
                    setFundingKey(null);
                  }}
                  placeholder="Amount in USD"
                  required
                />
                <Button type="submit" disabled={busyAction !== null}>
                  {busyAction === "fund" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ArrowDownToLine />
                  )}
                  Continue to Stripe
                </Button>
              </form>

              <form onSubmit={(event) => void sendTransfer(event)} className="space-y-3">
                <h2 className="font-semibold">Send</h2>
                <Input
                  value={transferRecipient}
                  onChange={(event) => {
                    setTransferRecipient(event.target.value);
                    setTransferKey(null);
                  }}
                  placeholder="Recipient username"
                  aria-label="Recipient username"
                  autoCapitalize="none"
                  required
                />
                <Input
                  type="number"
                  min="0.01"
                  max="1000"
                  step="0.01"
                  value={transferAmount}
                  onChange={(event) => {
                    setTransferAmount(event.target.value);
                    setTransferKey(null);
                  }}
                  placeholder="Amount in USD"
                  aria-label="Transfer amount in US dollars"
                  required
                />
                <Button type="submit" variant="secondary" disabled={busyAction !== null}>
                  {busyAction === "send" ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <ArrowUpFromLine />
                  )}
                  Send transfer
                </Button>
              </form>
            </section>

            <section className="grid gap-4 border-b border-border pb-6 sm:grid-cols-[1fr_auto]">
              <div className="space-y-3">
                <div>
                  <h2 className="font-semibold">Receive money</h2>
                  <p className="text-sm text-muted-foreground">
                    Share your username or Wallet ID. Transfers are recorded in the Wallet ledger.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">Username</p>
                    <p className="truncate font-medium">@{profile?.username ?? "Unavailable"}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Copy Wallet username"
                    disabled={!profile?.username}
                    onClick={() =>
                      profile?.username && void copyReceiveValue(profile.username, "username")
                    }
                  >
                    {copiedField === "username" ? <Check /> : <Copy />}
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">Wallet ID</p>
                    <p className="break-all font-mono text-xs">{overview.walletId}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Copy Wallet ID"
                    onClick={() => void copyReceiveValue(overview.walletId, "wallet")}
                  >
                    {copiedField === "wallet" ? <Check /> : <Copy />}
                  </Button>
                </div>
                {profile?.username && (
                  <a
                    href={`${window.location.origin}/wallet?recipient=${encodeURIComponent(profile.username)}`}
                    className="inline-flex items-center gap-2 text-sm text-primary underline"
                  >
                    <QrCode className="h-4 w-4" /> Share receive link
                  </a>
                )}
              </div>
              {receiveQr ? (
                <img
                  src={receiveQr}
                  alt="Wallet receive QR code"
                  className="h-48 w-48 rounded-md bg-white p-2"
                />
              ) : (
                <div className="grid h-48 w-48 place-items-center rounded-md bg-secondary text-muted-foreground">
                  <QrCode className="h-8 w-8" />
                </div>
              )}
            </section>

            <section className="space-y-4 border-b border-border pb-6">
              <div>
                <h2 className="font-semibold">Request payment</h2>
                <p className="text-sm text-muted-foreground">
                  The requested amount moves only after the payer approves and the ledger posts it.
                </p>
              </div>
              <form
                onSubmit={(event) => void createPaymentRequest(event)}
                className="grid gap-2 sm:grid-cols-2"
              >
                <Input
                  value={requestPayer}
                  onChange={(event) => {
                    setRequestPayer(event.target.value);
                    setRequestKey(null);
                  }}
                  placeholder="Payer username"
                  aria-label="Payer username"
                  autoCapitalize="none"
                  required
                />
                <Input
                  type="number"
                  min="0.01"
                  max="1000"
                  step="0.01"
                  value={requestAmount}
                  onChange={(event) => {
                    setRequestAmount(event.target.value);
                    setRequestKey(null);
                  }}
                  placeholder="Amount in USD"
                  aria-label="Requested amount in US dollars"
                  required
                />
                <Input
                  value={requestNote}
                  onChange={(event) => {
                    setRequestNote(event.target.value);
                    setRequestKey(null);
                  }}
                  placeholder="Note (optional)"
                  aria-label="Payment request note"
                  maxLength={280}
                  className="sm:col-span-2"
                />
                <Button type="submit" disabled={requestBusy} className="sm:col-span-2">
                  {requestBusy ? <Loader2 className="animate-spin" /> : null}
                  Create payment request
                </Button>
              </form>

              <ul className="divide-y divide-border">
                {overview.requests.map((request) => {
                  const isRequester = request.requester_id === user?.id;
                  const canPay =
                    !isRequester && request.payer_id === user?.id && request.status === "open";
                  const canCancel = isRequester && request.status === "open";
                  return (
                    <li key={request.id} className="space-y-2 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">
                            {isRequester ? "You requested" : "Payment requested"}{" "}
                            {formatUsd(request.amount_minor)}
                          </span>
                          <span className="block text-xs capitalize text-muted-foreground">
                            {request.status} · {request.note || "No note"}
                          </span>
                        </span>
                        {canPay && (
                          <Button
                            size="sm"
                            disabled={requestActionId === request.id}
                            onClick={() => void payRequest(request.id)}
                          >
                            {requestActionId === request.id ? (
                              <Loader2 className="animate-spin" />
                            ) : null}
                            Pay
                          </Button>
                        )}
                        {canCancel && (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={requestActionId === request.id}
                            onClick={() => void cancelRequest(request.id)}
                          >
                            Cancel
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
                {overview.requests.length === 0 && (
                  <li className="py-3 text-sm text-muted-foreground">No payment requests.</li>
                )}
              </ul>
            </section>

            <section>
              <h2 className="mb-3 font-semibold">Recent transactions</h2>
              {overview.transactions.length === 0 ? (
                <p className="py-5 text-sm text-muted-foreground">No wallet activity yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {overview.transactions.map((transaction) => {
                    const incoming =
                      transaction.recipient_id === user?.id ||
                      transaction.transaction_type === "funding";
                    return (
                      <li key={transaction.id}>
                        <Link
                          to="/wallet/transactions/$transactionId"
                          params={{ transactionId: transaction.id }}
                          className="flex items-center gap-3 py-3"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium capitalize">
                              {transaction.transaction_type.replaceAll("_", " ")}
                            </span>
                            <span className="block text-xs capitalize text-muted-foreground">
                              {transaction.status} ·{" "}
                              {new Date(transaction.created_at).toLocaleString()}
                            </span>
                          </span>
                          <span className="shrink-0 font-semibold">
                            {incoming ? "+" : "−"}
                            {formatUsd(transaction.amount_minor)}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
      <BottomNav />
    </main>
  );
}

function formatUsd(amountMinor: number) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(
    amountMinor / 100,
  );
}
