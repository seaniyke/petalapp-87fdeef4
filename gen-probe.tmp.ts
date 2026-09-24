import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
const PROJECT = process.argv[2], PROMPT = process.argv[3], EMAIL = "benchmark@bench.buildwithpetal.com";
const list = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
const user = list.data.users.find((u) => u.email === EMAIL)!;
await supabaseAdmin.from("user_wallets").update({ topup_credits_remaining: 5000, credit_debt: 0 } as never).eq("user_id", user.id);
const link = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
const { data } = await anon.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: "email" });
const { data: files } = await supabaseAdmin.from("project_files").select("path,content").eq("project_id", PROJECT);
const before = new Map(files!.map((f) => [f.path, f.content]));
const t0 = Date.now();
const res = await fetch("http://localhost:8080/api/generate", { method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${data.session!.access_token}`, "x-petal-target": "web" },
  body: JSON.stringify({ projectId: PROJECT, currentFiles: files, messages: [{ role: "user", content: PROMPT }] }) });
const text = await res.text();
const types = new Map<string, number>(); let result: any = null;
for (const l of text.split("\n")) { if (!l.startsWith("data:")) continue; try { const e = JSON.parse(l.slice(5)); types.set(e.type, (types.get(e.type) ?? 0) + 1); if (e.type === "error") console.log("ERR", e.message); if (e.type === "result" || e.files) result = e; } catch {} }
console.log("status", res.status, "start", new Date(t0).toISOString(), "seconds", ((Date.now() - t0) / 1000).toFixed(1));
console.log(JSON.stringify([...types]));
const after: any[] = result?.files ?? [];
const changed = after.filter((f) => before.get(f.path) !== f.content).map((f) => f.path);
console.log("changed", changed.length, changed.join(", "));
if (result?.summary) console.log("summary:", String(result.summary).slice(0, 300));
