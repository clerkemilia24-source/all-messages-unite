ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS read_receipts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_seen_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS photo_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS status_visible boolean NOT NULL DEFAULT true;