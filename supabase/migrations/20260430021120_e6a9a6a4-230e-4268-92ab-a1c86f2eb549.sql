UPDATE public.project_backends
   SET status = 'ready',
       supabase_url = 'https://shemqtujzwqgvylkunxp.supabase.co',
       anon_key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoZW1xdHVqendxZ3Z5bGt1bnhwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1MTQyNzQsImV4cCI6MjA5MzA5MDI3NH0.4SJwGDoSLU8qiiSozh2JoqF7oVb4309uadi9cBoQXJQ',
       service_role_key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNoZW1xdHVqendxZ3Z5bGt1bnhwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzUxNDI3NCwiZXhwIjoyMDkzMDkwMjc0fQ.3E1p4CjJG02uRBJ1mxv9Hxewucq_QJptEmy2b7B_xOQ',
       paused_at = NULL,
       health_checked_at = now(),
       error_message = NULL
 WHERE supabase_project_ref = 'shemqtujzwqgvylkunxp'
   AND status <> 'ready';