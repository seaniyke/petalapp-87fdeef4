-- Resumable turn tracking: server-owned build state so the pipeline survives
-- client disconnects and a returning user can rehydrate from the last event seq.

CREATE TABLE IF NOT EXISTS public.turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','succeeded','failed','aborted')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  last_seq integer NOT NULL DEFAULT 0,
  error_message text,
  credits_charged numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_turns_project_status
  ON public.turns (project_id, status);
CREATE INDEX IF NOT EXISTS idx_turns_user_started
  ON public.turns (user_id, started_at DESC);

ALTER TABLE public.turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view their turns"
  ON public.turns FOR SELECT
  USING (
    auth.uid() = user_id
    OR has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Service role manages turns"
  ON public.turns FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE TABLE IF NOT EXISTS public.turn_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id uuid NOT NULL REFERENCES public.turns(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  kind text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (turn_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_turn_events_turn_seq
  ON public.turn_events (turn_id, seq);

ALTER TABLE public.turn_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view their turn events"
  ON public.turn_events FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.turns t
      WHERE t.id = turn_events.turn_id
        AND (t.user_id = auth.uid() OR has_role(auth.uid(), 'admin'::app_role))
    )
  );

CREATE POLICY "Service role inserts turn events"
  ON public.turn_events FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Enable realtime so a reconnecting client gets new events live.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.turn_events;
  END IF;
END $$;