import { createClient } from '@supabase/supabase-js';
import { applyScaffoldKit, STYLES_CSS } from '/dev-server/src/server/scaffold-kit.ts';
import { syncViteAliasesWithTsconfig } from '/dev-server/src/server/sync-vite-aliases.server.ts';
import { validateStylesCss } from '/dev-server/src/server/validate-styles.server.ts';
import { autofixFiles } from '/dev-server/src/server/stream-autofixer.ts';
import { postBuildToRailway } from '/dev-server/src/server/builder.server.ts';

const PROJECT_ID = 'a2d24a98-d012-465b-8810-636235df2aea';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Missing backend credentials');
const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: rawFiles, error: filesErr } = await sb.from('project_files').select('path, content').eq('project_id', PROJECT_ID);
if (filesErr) throw filesErr;
const files = (rawFiles ?? []).map((r: any) => ({ path: r.path, content: r.content }));
const { files: fixedFiles, report } = autofixFiles(files);
console.log(`deterministic fixes: ${report.fixedCount}`);
for (const note of report.notes) console.log(note);

for (const f of fixedFiles) {
  const original = files.find((x) => x.path === f.path)?.content;
  if (original !== f.content) {
    const { error } = await sb.from('project_files').update({ content: f.content }).eq('project_id', PROJECT_ID).eq('path', f.path);
    if (error) throw error;
  }
}

const { data: backendRow } = await sb.from('project_backends').select('supabase_url, anon_key').eq('project_id', PROJECT_ID).maybeSingle();
const backend = backendRow ? { url: backendRow.supabase_url, anonKey: backendRow.anon_key } : undefined;
const scaffolded = applyScaffoldKit(fixedFiles, { backend });
const aliasFixed = syncViteAliasesWithTsconfig(scaffolded);
const styleSafe = aliasFixed.map((f) => {
  if (f.path !== 'src/styles.css') return f;
  const result = validateStylesCss(f.content);
  return result.ok ? f : { ...f, content: STYLES_CSS };
});
const { files: buildFiles, report: buildReport } = autofixFiles(styleSafe);
console.log(`build payload fixes: ${buildReport.fixedCount}`);

const { data: project } = await sb.from('projects').select('owner_id, hide_petal_badge').eq('id', PROJECT_ID).single();
let hideBadge = false;
if (project) {
  const { data: wallet } = await sb.from('user_wallets').select('plan_code').eq('user_id', project.owner_id).maybeSingle();
  const isPaidPlan = !!wallet?.plan_code && wallet.plan_code !== 'free';
  hideBadge = isPaidPlan && project.hide_petal_badge === true;
}

const { data: build, error: insertErr } = await sb.from('project_builds').insert({ project_id: PROJECT_ID, status: 'pending' }).select('id').single();
if (insertErr || !build) throw insertErr ?? new Error('No build row');
await sb.from('projects').update({ latest_build_id: build.id }).eq('id', PROJECT_ID);
await postBuildToRailway({ projectId: PROJECT_ID, buildId: build.id, files: buildFiles, hideBadge });
console.log(`queued build: ${build.id}`);
