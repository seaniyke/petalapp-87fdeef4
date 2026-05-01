ALTER TABLE public.petal_self_learning_digests
  ADD COLUMN IF NOT EXISTS timeout_rate numeric;