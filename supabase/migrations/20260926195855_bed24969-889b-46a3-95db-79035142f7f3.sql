CREATE OR REPLACE FUNCTION public.retire_checkpoint_on_cancel()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN ('cancelled','aborted') AND OLD.status IS DISTINCT FROM NEW.status THEN
    UPDATE public.build_checkpoints
       SET status = 'discarded', terminal_outcome = NEW.status, closed_at = now(), updated_at = now()
     WHERE turn_id = NEW.id AND status IN ('active','resuming');
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.retire_checkpoint_on_cancel() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS turns_retire_checkpoint_on_cancel ON public.turns;
CREATE TRIGGER turns_retire_checkpoint_on_cancel AFTER UPDATE OF status ON public.turns
FOR EACH ROW EXECUTE FUNCTION public.retire_checkpoint_on_cancel();
UPDATE public.build_checkpoints c SET status='discarded', terminal_outcome='verification_failed', closed_at=now(), updated_at=now()
 FROM public.turns t WHERE t.id=c.turn_id AND c.status IN ('active','resuming') AND t.status <> 'running';