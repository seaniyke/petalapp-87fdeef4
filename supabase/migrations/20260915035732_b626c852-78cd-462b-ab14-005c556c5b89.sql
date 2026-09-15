CREATE TABLE public.credit_paused_turns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  turn_id uuid NOT NULL UNIQUE REFERENCES public.turns(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_credits'
    CHECK (status IN ('awaiting_credits','parked','applying','completed','superseded','failed')),
  required_credits numeric(10,2) NOT NULL CHECK (required_credits > 0),
  baseline_hash text NOT NULL,
  candidate_files jsonb NOT NULL,
  result_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  original_request text NOT NULL DEFAULT '',
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.credit_paused_turns TO authenticated;
GRANT ALL ON public.credit_paused_turns TO service_role;

ALTER TABLE public.credit_paused_turns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners view paused credit turns"
  ON public.credit_paused_turns FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Owners park paused credit turns"
  ON public.credit_paused_turns FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND status IN ('awaiting_credits','parked'));

CREATE INDEX idx_credit_paused_turns_user_status
  ON public.credit_paused_turns(user_id, status, created_at DESC);
CREATE INDEX idx_credit_paused_turns_project_status
  ON public.credit_paused_turns(project_id, status, created_at DESC);

CREATE TRIGGER update_credit_paused_turns_updated_at
BEFORE UPDATE ON public.credit_paused_turns
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.turns DROP CONSTRAINT IF EXISTS turns_status_check;
ALTER TABLE public.turns ADD CONSTRAINT turns_status_check
  CHECK (status IN ('running','awaiting_credits','succeeded','failed','aborted'));

CREATE OR REPLACE FUNCTION public.claim_credit_paused_turn(_checkpoint_id uuid)
RETURNS TABLE(checkpoint_id uuid, project_id uuid, turn_id uuid, candidate_files jsonb, result_payload jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cp public.credit_paused_turns%ROWTYPE;
  ledger uuid;
BEGIN
  SELECT * INTO cp
  FROM public.credit_paused_turns
  WHERE id = _checkpoint_id
  FOR UPDATE;

  IF NOT FOUND OR cp.status NOT IN ('awaiting_credits','parked') THEN RETURN; END IF;

  ledger := public.spend_credit(
    cp.user_id,
    cp.required_credits,
    'ai_build_charge',
    cp.project_id,
    jsonb_build_object('turn_id', cp.turn_id, 'resumed_from_credit_pause', true)
  );
  IF ledger IS NULL THEN RETURN; END IF;

  UPDATE public.credit_ledger SET turn_id = cp.turn_id WHERE id = ledger;
  UPDATE public.credit_paused_turns
  SET status = 'applying', claimed_at = now(), updated_at = now(), last_error = NULL
  WHERE id = cp.id;

  RETURN QUERY SELECT cp.id, cp.project_id, cp.turn_id, cp.candidate_files, cp.result_payload;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_credit_paused_turn(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_credit_paused_turn(uuid) TO service_role;