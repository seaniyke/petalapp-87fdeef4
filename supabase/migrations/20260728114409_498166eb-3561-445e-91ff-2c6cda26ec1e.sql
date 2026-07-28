ALTER TABLE public.waitlist_signups ADD COLUMN IF NOT EXISTS approved_at timestamptz;
CREATE INDEX IF NOT EXISTS waitlist_signups_approved_at_idx ON public.waitlist_signups (approved_at);