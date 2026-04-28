/**
 * One-off: trigger a fresh build for the Lumen project.
 */
import { createClient } from "@supabase/supabase-js";
import { applyScaffoldKit, STYLES_CSS } from "../src/server/scaffold-kit.ts";
import { syncViteAliasesWithTsconfig } from "../src/server/sync-vite-aliases.server.ts";
import { validateStylesCss } from "../src/server/validate-styles.server.ts";
import { postBuildToRailway } from "../src/server/builder.server.ts";

const PROJECT_ID = "a2d24a98-d012-465b-8810-636235df2aea";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const sb = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: rawFiles, error: filesErr } = await sb
  .from("project_files")
  .select("path, content")
  .eq("project_id", PROJECT_ID);
if (filesErr) throw filesErr;
const files = (rawFiles ?? []).map((r) => ({ path: r.path, content: r.content }));
console.log("file count:", files.length);

const { data: backendRow } = await sb
  .from("project_backends")
  .select("supabase_url, anon_key")
  .eq("project_id", PROJECT_ID)
  .maybeSingle();
const backend = backendRow
  ? { url: backendRow.supabase_url, anonKey: backendRow.anon_key }
  : undefined;

const scaffolded = applyScaffoldKit(files, { backend });
const aliasFixed = syncViteAliasesWithTsconfig(scaffolded);
const buildFiles = aliasFixed.map((f) => {
  if (f.path !== "src/styles.css") return f;
  const result = validateStylesCss(f.content);
  return result.ok ? f : { ...f, content: STYLES_CSS };
});

const { data: build, error: insertErr } = await sb
  .from("project_builds")
  .insert({ project_id: PROJECT_ID, status: "pending" })
  .select("id")
  .single();
if (insertErr || !build) throw insertErr ?? new Error("no build id");
console.log("build id:", build.id);

await sb.from("projects").update({ latest_build_id: build.id }).eq("id", PROJECT_ID);

await postBuildToRailway({ projectId: PROJECT_ID, buildId: build.id, files: buildFiles });
console.log("posted to railway, build pending");
