GRANT SELECT ON public.pipeline_failures TO authenticated;
GRANT ALL ON public.pipeline_failures TO service_role;

GRANT SELECT ON public.pipeline_tier_events TO authenticated;
GRANT ALL ON public.pipeline_tier_events TO service_role;