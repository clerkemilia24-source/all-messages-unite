import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/lib/auth";
import { MessageCircle } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in — Ripple Messages" },
      { name: "description", content: "Sign in or create an account to start sending messages with tapbacks, photos and group chats." },
      { property: "og:title", content: "Sign in — Ripple Messages" },
      { property: "og:description", content: "Sign in or create an account to start messaging." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session) void navigate({ to: "/" });
  }, [session, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: name || email.split("@")[0] },
          },
        });
        if (error) throw error;
        if (!data.session) toast.success("Check your email to confirm your account.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Google sign-in failed");
      return;
    }
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-[1.35rem] bg-primary shadow-lg shadow-primary/25">
            <MessageCircle className="h-9 w-9 text-primary-foreground" strokeWidth={2.2} />
          </div>
          <h1 className="mt-5 text-2xl font-semibold tracking-tight text-foreground">Ripple Messages</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Blue bubbles, tapbacks, photos and group chats.
          </p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <input
              className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
          <input
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            type="password"
            required
            minLength={6}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            className="w-full rounded-xl border border-border bg-secondary px-4 py-3 text-base text-foreground outline-none placeholder:text-muted-foreground focus:border-primary"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-primary px-4 py-3 text-base font-semibold text-primary-foreground transition active:scale-[0.985] disabled:opacity-60"
          >
            {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
          </button>
        </form>

        <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or
          <span className="h-px flex-1 bg-border" />
        </div>

        <button
          onClick={google}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-base font-medium text-foreground transition active:scale-[0.985]"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
            <path fill="#4285F4" d="M22.5 12.2c0-.7-.06-1.4-.18-2.06H12v3.9h5.9a5 5 0 0 1-2.19 3.3v2.72h3.54c2.07-1.9 3.25-4.7 3.25-7.86Z" />
            <path fill="#34A853" d="M12 23c2.94 0 5.41-.97 7.21-2.64l-3.53-2.73c-.98.66-2.24 1.05-3.68 1.05-2.83 0-5.23-1.91-6.09-4.48H2.26v2.81A10.99 10.99 0 0 0 12 23Z" />
            <path fill="#FBBC05" d="M5.91 14.2a6.6 6.6 0 0 1 0-4.2V7.19H2.26a11 11 0 0 0 0 9.82l3.65-2.81Z" />
            <path fill="#EA4335" d="M12 5.5c1.6 0 3.04.55 4.17 1.63l3.12-3.12C17.4 2.2 14.94 1 12 1 7.7 1 3.99 3.47 2.26 7.19L5.91 10c.86-2.57 3.26-4.5 6.09-4.5Z" />
          </svg>
          Continue with Google
        </button>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {mode === "signin" ? "New here?" : "Already have an account?"}{" "}
          <button
            className="font-medium text-primary"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </div>
    </main>
  );
}
