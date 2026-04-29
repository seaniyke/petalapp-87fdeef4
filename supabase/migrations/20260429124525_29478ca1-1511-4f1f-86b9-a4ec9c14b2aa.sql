
CREATE TABLE public.ai_call_outcomes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  ai_call_id UUID NOT NULL REFERENCES public.ai_call_log(id) ON DELETE CASCADE,
  project_id UUID,
  message_id UUID,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  local_verifier_pass BOOLEAN,
  local_verifier_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  autofix_count INTEGER NOT NULL DEFAULT 0,
  build_status TEXT,
  build_id UUID,
  user_followup_was_fix BOOLEAN,
  files_written INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_call_outcomes_ai_call ON public.ai_call_outcomes(ai_call_id);
CREATE INDEX idx_ai_call_outcomes_project ON public.ai_call_outcomes(project_id);
CREATE INDEX idx_ai_call_outcomes_model_created ON public.ai_call_outcomes(model, created_at DESC);
CREATE INDEX idx_ai_call_outcomes_feature_created ON public.ai_call_outcomes(feature, created_at DESC);

ALTER TABLE public.ai_call_outcomes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read ai_call_outcomes"
ON public.ai_call_outcomes
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role can insert ai_call_outcomes"
ON public.ai_call_outcomes
FOR INSERT
TO public
WITH CHECK (auth.role() = 'service_role'::text);

CREATE POLICY "Service role can update ai_call_outcomes"
ON public.ai_call_outcomes
FOR UPDATE
TO public
USING (auth.role() = 'service_role'::text)
WITH CHECK (auth.role() = 'service_role'::text);

CREATE TRIGGER trg_ai_call_outcomes_updated_at
BEFORE UPDATE ON public.ai_call_outcomes
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Aggregate view for the smart router (admin-only via underlying table RLS)
CREATE OR REPLACE VIEW public.ai_model_quality AS
SELECT
  feature,
  provider,
  model,
  COUNT(*) AS samples,
  AVG(CASE WHEN local_verifier_pass THEN 1 ELSE 0 END)::numeric(5,4) AS verifier_pass_rate,
  AVG(autofix_count)::numeric(6,3) AS avg_autofixes,
  AVG(CASE WHEN build_status = 'ready' THEN 1 ELSE 0 END)::numeric(5,4) AS build_success_rate,
  AVG(CASE WHEN user_followup_was_fix THEN 1 ELSE 0 END)::numeric(5,4) AS followup_fix_rate,
  MAX(created_at) AS last_seen_at
FROM public.ai_call_outcomes
WHERE created_at > now() - interval '7 days'
GROUP BY feature, provider, model;
