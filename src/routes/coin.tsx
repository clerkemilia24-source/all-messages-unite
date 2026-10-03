import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Coins, Loader2, RefreshCw, Send } from "lucide-react";
import { toast } from "sonner";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { getCoinOverview, transferCoin } from "@/lib/coin.functions";

export const Route = createFileRoute("/coin")({
  head: () => ({
    meta: [
      { title: "Native Coin — Ripple" },
      { name: "description", content: "Manage your Ripple Coin ledger account." },
    ],
  }),
  component: CoinPage,
});

type CoinOverview = Awaited<ReturnType<typeof getCoinOverview>>;

function CoinPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [overview, setOverview] = useState<CoinOverview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setOverview(null);
    setLoadError(false);
    void getCoinOverview()
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

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountMinor = Number(amount);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
      toast.error("Enter a positive whole number of Coin units.");
      return;
    }
    const key = idempotencyKey ?? crypto.randomUUID();
    setIdempotencyKey(key);
    setSending(true);
    try {
      const transaction = await transferCoin({
        data: {
          recipientUsername: recipient.replace(/^@/, ""),
          amountMinor,
          idempotencyKey: key,
        },
      });
      if (transaction.status !== "posted") {
        toast.error("Coin transfer is not posted. Check activity before retrying.");
        return;
      }
      toast.success("Coin transfer posted to its ledger");
      setRecipient("");
      setAmount("");
      setIdempotencyKey(null);
      setRefreshKey((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Coin transfer failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background text-foreground">
      <header className="liquid-panel sticky top-0 z-10 flex items-center justify-between px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <div className="flex items-center gap-2">
          <Coins className="h-5 w-5 text-amber-600" />
          <h1 className="text-[2rem] font-bold">Native Coin</h1>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh Coin account"
          onClick={() => setRefreshKey((current) => current + 1)}
        >
          <RefreshCw />
        </Button>
      </header>

      <div className="flex-1 space-y-6 px-4 py-5">
        <p className="text-sm text-muted-foreground">
          Internal ledger asset. It is separate from Wallet and is not represented as a blockchain
          token.
        </p>
        {loadError ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p>Coin account data could not load.</p>
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
              <p className="text-sm text-muted-foreground">Available Coin units</p>
              <p className="text-4xl font-semibold">{overview.balanceMinor.toLocaleString()}</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Circulating: {(overview.totalMinted - overview.totalBurned).toLocaleString()} units
              </p>
            </section>

            <form onSubmit={(event) => void send(event)} className="max-w-md space-y-3">
              <h2 className="font-semibold">Transfer Coin</h2>
              <Input
                value={recipient}
                onChange={(event) => {
                  setRecipient(event.target.value);
                  setIdempotencyKey(null);
                }}
                placeholder="Recipient username"
                aria-label="Coin recipient username"
                autoCapitalize="none"
                required
              />
              <Input
                type="number"
                min="1"
                max="1000000"
                step="1"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setIdempotencyKey(null);
                }}
                placeholder="Whole Coin units"
                aria-label="Coin units to transfer"
                required
              />
              <Button type="submit" variant="secondary" disabled={sending}>
                {sending ? <Loader2 className="animate-spin" /> : <Send />}
                Transfer Coin
              </Button>
            </form>

            <section>
              <h2 className="mb-3 font-semibold">Coin activity</h2>
              {overview.transactions.length === 0 ? (
                <p className="py-5 text-sm text-muted-foreground">No Coin transactions yet.</p>
              ) : (
                <ul className="divide-y divide-border">
                  {overview.transactions.map((transaction) => (
                    <li key={transaction.id} className="flex items-center gap-3 py-3">
                      <span className="min-w-0 flex-1">
                        <span className="block capitalize">
                          {transaction.transaction_type.replaceAll("_", " ")}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {transaction.status} · {transaction.id}
                        </span>
                      </span>
                      <span className="shrink-0 text-right font-semibold">
                        {transaction.recipient_id === user?.id ? "+" : "−"}
                        {transaction.amount_minor.toLocaleString()}
                        {transaction.fee_minor > 0 && (
                          <span className="block text-xs font-normal text-muted-foreground">
                            Fee {transaction.fee_minor.toLocaleString()}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <Link to="/wallet" className="text-sm text-primary underline">
              Open fiat Wallet
            </Link>
          </>
        )}
      </div>
      <BottomNav />
    </main>
  );
}
