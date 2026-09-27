DROP INDEX IF EXISTS public.cost_events_source_ref_uq;
CREATE UNIQUE INDEX cost_events_source_ref_uq ON public.cost_events (source_ref);
UPDATE public.economics_config SET value = 0.30 WHERE key = 'min_charge_credits';