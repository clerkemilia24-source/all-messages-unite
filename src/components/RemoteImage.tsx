import { useEffect, useState } from "react";
import { getSignedUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";

export function useRemoteUrl(bucket: string, path?: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    if (!path) {
      setUrl(null);
      return;
    }
    void getSignedUrl(bucket, path).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [bucket, path]);
  return url;
}

export function RemoteImage({
  bucket,
  path,
  alt,
  className,
}: {
  bucket: string;
  path?: string | null | undefined;
  alt: string;
  className?: string;
}) {
  const url = useRemoteUrl(bucket, path);
  if (!url) return <div className={cn("bg-muted animate-pulse", className)} />;
  return <img src={url} alt={alt} className={className} loading="lazy" />;
}

export function ChatAvatar({
  name,
  path,
  size = 44,
  online,
}: {
  name: string;
  path?: string | null | undefined;
  size?: number;
  online?: boolean;
}) {
  const url = useRemoteUrl("avatars", path);
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {url ? (
        <img
          src={url}
          alt={name}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded-full bg-avatar text-avatar-foreground font-medium"
          style={{ fontSize: size * 0.36 }}
        >
          {initials || "?"}
        </div>
      )}
      {online && (
        <span className="absolute bottom-0 right-0 block h-3 w-3 rounded-full border-2 border-background bg-presence" />
      )}
    </div>
  );
}
