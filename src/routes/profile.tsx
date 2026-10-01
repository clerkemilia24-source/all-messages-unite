import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Camera, LogOut } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { ChatAvatar } from "@/components/RemoteImage";
import { uploadFile } from "@/lib/storage";
import { BottomNav } from "@/components/BottomNav";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/profile")({
  head: () => ({
    meta: [
      { title: "Your profile — Ripple" },
      { name: "description", content: "Update your name, username, photo and status so friends can find you." },
      { property: "og:title", content: "Your profile — Ripple" },
      { property: "og:description", content: "Update your name, username, photo and status." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ProfilePage,
});

const STATUSES = ["Available", "Busy", "At the gym 🏋️", "Do Not Disturb 🌙", "On my way 🚗"];

function ProfilePage() {
  const { user, profile, loading, refreshProfile, signOut } = useAuth();
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) void navigate({ to: "/auth" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (profile) {
      setDisplayName(profile.display_name);
      setUsername(profile.username);
      setStatus(profile.status_text ?? "");
    }
  }, [profile]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: displayName.trim() || "Unnamed",
        username: username.trim().toLowerCase(),
        status_text: status.trim() || null,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "That username is taken" : error.message);
      return;
    }
    await refreshProfile();
    toast.success("Profile saved");
  };

  const pickAvatar = async (file: File) => {
    if (!user) return;
    try {
      const path = await uploadFile("avatars", user.id, file);
      await supabase.from("profiles").update({ avatar_url: path }).eq("id", user.id);
      await refreshProfile();
      toast.success("Photo updated");
    } catch {
      toast.error("Could not upload that photo");
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col bg-background">
      <header className="liquid-panel sticky top-0 z-10 flex items-center justify-between px-2 pb-2 pt-[max(0.6rem,env(safe-area-inset-top))]">
        <Link to="/" className="flex items-center text-primary">
          <ChevronLeft className="h-6 w-6" />
          <span className="text-[17px]">Messages</span>
        </Link>
        <p className="text-[17px] font-semibold text-foreground">Profile</p>
        <Button variant="ghost" onClick={save} disabled={saving} className="px-3 text-[17px] font-semibold text-primary">
          {saving ? "…" : "Save"}
        </Button>
      </header>

      <div className="flex flex-col items-center px-6 py-8">
        <button onClick={() => fileRef.current?.click()} className="relative">
          <ChatAvatar name={displayName || "Me"} path={profile?.avatar_url} size={104} />
          <span className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-primary">
            <Camera className="h-4 w-4 text-primary-foreground" />
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void pickAvatar(f);
          }}
        />
        <p className="mt-3 text-sm text-muted-foreground">{user?.email}</p>
      </div>

      <div className="space-y-6 px-4 pb-10">
        <section className="overflow-hidden rounded-xl bg-card">
          <Field label="Name" value={displayName} onChange={setDisplayName} placeholder="Your name" />
          <div className="h-px bg-border" />
          <Field label="Username" value={username} onChange={setUsername} placeholder="username" />
          <div className="h-px bg-border" />
          <Field label="Status" value={status} onChange={setStatus} placeholder="What's up?" />
        </section>

        <section>
          <p className="px-2 pb-2 text-[13px] uppercase tracking-wide text-muted-foreground">
            Quick status
          </p>
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={() => setStatus(s)}
                className={`rounded-full border px-3 py-1.5 text-[14px] transition ${
                  status === s
                    ? "border-primary bg-primary/12 text-primary"
                    : "border-border bg-card text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </section>

        <button
          onClick={async () => {
            await signOut();
            await navigate({ to: "/auth" });
          }}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-card py-3 text-[17px] font-medium text-destructive"
        >
          <LogOut className="h-5 w-5" />
          Sign out
        </button>
      </div>
      <BottomNav />
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex items-center gap-3 px-4 py-3">
      <span className="w-24 shrink-0 text-[16px] text-muted-foreground">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-transparent text-[16px] text-foreground outline-none placeholder:text-muted-foreground"
      />
    </label>
  );
}
