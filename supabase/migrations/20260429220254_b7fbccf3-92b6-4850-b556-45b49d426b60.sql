-- Pipeline failure telemetry: capture every "Petal got a bit confused" event
-- with enough context to diagnose the silent failure path that bypasses
-- ai_call_log and ai_call_outcomes today.
CREATE TABLE public.pipeline_failures (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID,
  user_id UUID,
  surface TEXT NOT NULL,                 -- 'generate' | 'discuss' | 'build' | 'unknown'
  raw_message TEXT NOT NULL,             -- the unmatched error text
  signature TEXT NOT NULL,               -- normalized first 120 chars for grouping
  tool_name TEXT,                        -- 'write_project' | 'patch_files' | null
  model TEXT,
  stream_tail TEXT,                      -- last ~500 chars of the assistant stream, if available
  user_agent TEXT,
  url TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_failures_created ON public.pipeline_failures (created_at DESC);
CREATE INDEX idx_pipeline_failures_signature ON public.pipeline_failures (signature, created_at DESC);
CREATE INDEX idx_pipeline_failures_project ON public.pipeline_failures (project_id, created_at DESC);

ALTER TABLE public.pipeline_failures ENABLE ROW LEVEL SECURITY;

-- Only admins can read; the public ingest route uses the service role.
CREATE POLICY "Admins can read pipeline_failures"
ON public.pipeline_failures
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- No client-side inserts/updates/deletes — service role only via the public route.
