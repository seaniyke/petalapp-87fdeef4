CREATE TABLE IF NOT EXISTS public.pending_secret_requests (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL,
  conversation_id TEXT,
  secret_name TEXT NOT NULL,
  instructions TEXT,
  link TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','fulfilled','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  fulfilled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_psr_project ON public.pending_secret_requests(project_id, status);
CREATE INDEX IF NOT EXISTS idx_psr_conversation ON public.pending_secret_requests(conversation_id);

ALTER TABLE public.pending_secret_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read their pending secret requests"
ON public.pending_secret_requests FOR SELECT
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pending_secret_requests.project_id AND p.owner_id = auth.uid()));

CREATE POLICY "Owners insert their pending secret requests"
ON public.pending_secret_requests FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pending_secret_requests.project_id AND p.owner_id = auth.uid()));

CREATE POLICY "Owners update their pending secret requests"
ON public.pending_secret_requests FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = pending_secret_requests.project_id AND p.owner_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_psr_touch ON public.pending_secret_requests;
CREATE TRIGGER trg_psr_touch BEFORE UPDATE ON public.pending_secret_requests
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();