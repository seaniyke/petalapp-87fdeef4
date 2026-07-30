DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);
REVOKE SELECT ON public.profiles FROM anon;

DROP POLICY IF EXISTS "Public project blueprints are viewable" ON public.project_blueprints;
REVOKE SELECT ON public.project_blueprints FROM anon;