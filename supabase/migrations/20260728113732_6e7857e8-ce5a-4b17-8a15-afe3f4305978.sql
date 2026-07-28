CREATE TABLE public.waitlist_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email citext NOT NULL UNIQUE,
  source text,
  ip inet,
  user_agent text,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.waitlist_signups TO authenticated;
GRANT ALL ON public.waitlist_signups TO service_role;
ALTER TABLE public.waitlist_signups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view waitlist" ON public.waitlist_signups
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER waitlist_signups_touch
  BEFORE UPDATE ON public.waitlist_signups
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX waitlist_signups_created_at_idx ON public.waitlist_signups (created_at DESC);
CREATE INDEX waitlist_signups_notified_at_idx ON public.waitlist_signups (notified_at);

CREATE TABLE public.waitlist_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  heading text,
  body text NOT NULL,
  cta_label text,
  cta_url text,
  recipients_total integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.waitlist_announcements TO authenticated;
GRANT ALL ON public.waitlist_announcements TO service_role;
ALTER TABLE public.waitlist_announcements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view announcements" ON public.waitlist_announcements
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER waitlist_announcements_touch
  BEFORE UPDATE ON public.waitlist_announcements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.system_settings (key, value, description)
VALUES ('access.waitlist_mode', 'true'::jsonb, 'When true, visitors see the waitlist instead of sign-up/sign-in.')
ON CONFLICT (key) DO NOTHING;