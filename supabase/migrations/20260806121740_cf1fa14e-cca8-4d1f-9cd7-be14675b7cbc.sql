CREATE TABLE public.petal_repair_ledger (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID,
  build_id UUID,
  user_id UUID,
  phase TEXT NOT NULL,
  pass_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  outcome TEXT NOT NULL,
  detail TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT ALL ON public.petal_repair_ledger TO service_role;

ALTER TABLE public.petal_repair_ledger ENABLE ROW LEVEL SECURITY;

CREATE INDEX petal_repair_ledger_pass_created_idx
  ON public.petal_repair_ledger (pass_id, created_at DESC);
CREATE INDEX petal_repair_ledger_project_idx
  ON public.petal_repair_ledger (project_id, created_at DESC);