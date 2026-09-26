-- Every terminal turn leaves durable evidence, whichever path ended it
-- (the app, the builder, or the stalled-turn reaper).
CREATE OR REPLACE FUNCTION public.close_turn_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'running' AND NEW.status IN ('failed','cancelled') THEN
    UPDATE turn_economics
       SET result = NEW.status,
           metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
             'closed_by','terminal_trigger','closed_at',now(),'terminal_error',NEW.error_message),
           updated_at = now()
     WHERE turn_id = NEW.id::text AND result = 'running';
    IF NOT EXISTS (
      SELECT 1 FROM messages m
       WHERE m.project_id = NEW.project_id AND m.role = 'assistant' AND m.created_at >= NEW.created_at
    ) THEN
      INSERT INTO messages (project_id, role, content) VALUES (
        NEW.project_id, 'assistant',
        CASE WHEN NEW.status = 'cancelled'
          THEN 'This build was stopped. Your project was left exactly as it was, and nothing was charged.'
          ELSE 'This build stopped before finishing because the Kimble build server stopped responding — not because of your request. Your project was left exactly as it was, and nothing was charged. Send your message again and Kimble will pick it back up.'
        END);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS turns_close_evidence ON public.turns;
CREATE TRIGGER turns_close_evidence AFTER UPDATE OF status ON public.turns
  FOR EACH ROW EXECUTE FUNCTION public.close_turn_evidence();

REVOKE ALL ON FUNCTION public.close_turn_evidence() FROM PUBLIC, anon, authenticated;

-- Close the evidence for turns that already ended without it.
UPDATE public.turn_economics e SET result = t.status,
       metadata = coalesce(e.metadata,'{}'::jsonb) || jsonb_build_object('closed_by','backfill','terminal_error',t.error_message)
  FROM public.turns t
 WHERE e.turn_id = t.id::text AND e.result = 'running' AND t.status IN ('failed','cancelled');