import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  ensureUpstreamProjectRef, provisionForProject, refreshStatus,
  pauseForProject, restoreForProject, deleteForProject, activeManagedCount,
} from "@/server/managed-backend.server";

const OWNER = "7156fed0-3cc0-4fb2-83c0-d96bfa969a6f";
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11,19), ...a);

const { data: proj, error } = await supabaseAdmin.from("projects")
  .insert({ owner_id: OWNER, title: "QA dedicated cycle", backend_type: "dedicated" })
  .select("id").single();
if (error) throw error;
const id = proj.id as string;
log("project", id, "activeManagedCount before:", await activeManagedCount());

await supabaseAdmin.from("project_backends").insert({
  project_id: id, provider: "managed_petal", status: "provisioning",
  supabase_url: "", anon_key: "", provisioning_started_at: new Date().toISOString(),
  last_active_at: new Date().toISOString(),
});
const ref = await ensureUpstreamProjectRef(id);
log("upstream ref", ref);
await provisionForProject(id);
log("status after provision", JSON.stringify(await refreshStatus(id)));
log("activeManagedCount now:", await activeManagedCount());
