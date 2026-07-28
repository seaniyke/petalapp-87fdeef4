-- 1. Referral columns on waitlist_signups
ALTER TABLE public.waitlist_signups
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS status_token text,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.waitlist_signups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS first_signin_at timestamptz;

CREATE OR REPLACE FUNCTION public.waitlist_gen_code()
RETURNS text
LANGUAGE sql
VOLATILE
SET search_path = public
AS $$
  SELECT lower(substr(md5(gen_random_uuid()::text), 1, 7));
$$;

-- Backfill existing rows
UPDATE public.waitlist_signups
SET referral_code = COALESCE(referral_code, public.waitlist_gen_code() || substr(md5(id::text), 1, 3)),
    status_token  = COALESCE(status_token, md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text))
WHERE referral_code IS NULL OR status_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS waitlist_signups_referral_code_key
  ON public.waitlist_signups (referral_code);
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_signups_status_token_key
  ON public.waitlist_signups (status_token);
CREATE INDEX IF NOT EXISTS waitlist_signups_referred_by_idx
  ON public.waitlist_signups (referred_by);

CREATE OR REPLACE FUNCTION public.waitlist_set_codes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := public.waitlist_gen_code() || substr(md5(gen_random_uuid()::text), 1, 3);
  END IF;
  IF NEW.status_token IS NULL THEN
    NEW.status_token := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS waitlist_signups_set_codes ON public.waitlist_signups;
CREATE TRIGGER waitlist_signups_set_codes
  BEFORE INSERT ON public.waitlist_signups
  FOR EACH ROW EXECUTE FUNCTION public.waitlist_set_codes();

-- 2. Referral edges + reward payout tracking
CREATE TABLE IF NOT EXISTS public.waitlist_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.waitlist_signups(id) ON DELETE CASCADE,
  referred_id uuid NOT NULL REFERENCES public.waitlist_signups(id) ON DELETE CASCADE,
  referred_email citext NOT NULL,
  status text NOT NULL DEFAULT 'joined',
  counted_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  referrer_credited_at timestamptz,
  referred_credited_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referred_id),
  UNIQUE (referred_email)
);

GRANT ALL ON public.waitlist_referrals TO service_role;
ALTER TABLE public.waitlist_referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read waitlist referrals"
  ON public.waitlist_referrals FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS waitlist_referrals_referrer_idx
  ON public.waitlist_referrals (referrer_id);

DROP TRIGGER IF EXISTS waitlist_referrals_touch ON public.waitlist_referrals;
CREATE TRIGGER waitlist_referrals_touch
  BEFORE UPDATE ON public.waitlist_referrals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. Live queue status from a status token (no account required)
CREATE OR REPLACE FUNCTION public.waitlist_status(_token text)
RETURNS TABLE(
  name text,
  email text,
  referral_code text,
  referral_count integer,
  queue_position integer,
  total integer,
  approved boolean,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT * FROM public.waitlist_signups WHERE status_token = _token
  ),
  base AS (
    SELECT (SELECT count(*) FROM public.waitlist_signups s
            WHERE s.created_at <= (SELECT created_at FROM me))::int AS rank,
           (SELECT count(*) FROM public.waitlist_signups)::int AS total
  )
  SELECT m.name,
         m.email::text,
         m.referral_code,
         m.referral_count,
         GREATEST(b.rank - (m.referral_count * 15), 1)::int AS queue_position,
         b.total,
         m.approved_at IS NOT NULL AS approved,
         m.created_at
  FROM me m CROSS JOIN base b;
$$;

GRANT EXECUTE ON FUNCTION public.waitlist_status(text) TO anon, authenticated, service_role;