REVOKE ALL ON FUNCTION public.set_turn_base_revision() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_revision_on_file_insert() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_revision_on_file_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_revision_on_file_update() FROM PUBLIC, anon, authenticated;