CREATE TABLE IF NOT EXISTS public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  turn_id text not null,
  project_id uuid,
  user_id uuid,
  profile text not null,
  complexity integer not null default 0,
  agent text not null,
  status text not null,
  attempts integer not null default 1,
  ms integer not null default 0,
  cost_micro_usd integer not null default 0,
  decisions integer not null default 0,
  objections integer not null default 0,
  optional boolean not null default true,
  error text,
  created_at timestamptz not null default now()
);

CREATE INDEX IF NOT EXISTS agent_runs_created_at_idx ON public.agent_runs (created_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_turn_idx ON public.agent_runs (turn_id);

GRANT ALL ON public.agent_runs TO service_role;

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_runs service only" ON public.agent_runs;
CREATE POLICY "agent_runs service only" ON public.agent_runs FOR ALL TO service_role USING (true) WITH CHECK (true);