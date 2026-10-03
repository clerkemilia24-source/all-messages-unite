import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { getWalletTransaction } from "@/lib/wallet.functions";

export const Route = createFileRoute("/wallet/transactions/$transactionId")({
  component: WalletTransactionPage,
});

function WalletTransactionPage() {
  const { transactionId } = Route.useParams();
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [transaction, setTransaction] = useState<Awaited<
    ReturnType<typeof getWalletTransaction>
  > | null>(null);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    let active = true;
    setTransaction(null);
    setError(false);
    void getWalletTransaction({ data: { transactionId } })
      .then((result) => {
        if (active) setTransaction(result);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [transactionId, retryKey]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background text-foreground">
      <header className="liquid-panel flex items-center gap-3 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <Link to="/wallet" aria-label="Back to wallet">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="text-xl font-semibold">Transaction details</h1>
      </header>
      <section className="flex-1 space-y-4 px-4 py-6">
        {error ? (
          <div className="space-y-3">
            <p>This transaction is unavailable or could not be loaded.</p>
            <Button variant="secondary" onClick={() => setRetryKey((key) => key + 1)}>
              Retry
            </Button>
          </div>
        ) : transaction === null ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <p className="text-4xl font-semibold">
              {transaction.recipient_id === user?.id || transaction.transaction_type === "funding"
                ? "+"
                : "−"}
              {new Intl.NumberFormat(undefined, {
                style: "currency",
                currency: transaction.currency,
              }).format(transaction.amount_minor / 100)}
            </p>
            <dl className="divide-y divide-border border-y border-border">
              <Detail label="Status" value={transaction.status} />
              <Detail label="Type" value={transaction.transaction_type.replaceAll("_", " ")} />
              <Detail label="Created" value={new Date(transaction.created_at).toLocaleString()} />
              <Detail
                label="Settled"
                value={
                  transaction.settled_at
                    ? new Date(transaction.settled_at).toLocaleString()
                    : "Not settled"
                }
              />
              <Detail label="Transaction ID" value={transaction.id} />
              {transaction.reverses_transaction_id && (
                <Detail label="Reverses" value={transaction.reverses_transaction_id} />
              )}
            </dl>
            <p className="text-sm text-muted-foreground">
              {transaction.status === "posted"
                ? "This transaction is recorded in the server ledger."
                : "This transaction has not settled. No completed payment is being reported."}
            </p>
          </>
        )}
      </section>
      <BottomNav />
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="max-w-[70%] break-all text-right capitalize">{value}</dd>
    </div>
  );
}
