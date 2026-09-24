ALTER TABLE public.ai_call_log
  ADD COLUMN IF NOT EXISTS stage text,
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS call_kind text,
  ADD COLUMN IF NOT EXISTS invoke_reason text,
  ADD COLUMN IF NOT EXISTS parent_stage text,
  ADD COLUMN IF NOT EXISTS files_affected text[],
  ADD COLUMN IF NOT EXISTS generated_files boolean;