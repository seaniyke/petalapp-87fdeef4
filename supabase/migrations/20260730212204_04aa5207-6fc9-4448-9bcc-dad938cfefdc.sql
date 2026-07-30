UPDATE public.project_files
SET content = regexp_replace(
  content,
  '// \[petal\] removed unresolved import — package "node:[^"]*" is not in Petal''s allow-list: ',
  '',
  'g'
)
WHERE content LIKE '%package "node:%is not in Petal%';