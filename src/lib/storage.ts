import { supabase } from "@/integrations/supabase/client";

type CacheEntry = { url: string; expires: number };
const cache = new Map<string, CacheEntry>();

export async function getSignedUrl(bucket: string, path: string): Promise<string | null> {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const key = `${bucket}/${path}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.url;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  if (!data?.signedUrl) return null;
  cache.set(key, { url: data.signedUrl, expires: Date.now() + 3_000_000 });
  return data.signedUrl;
}

export async function uploadFile(bucket: string, userId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() || "bin";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  return path;
}
