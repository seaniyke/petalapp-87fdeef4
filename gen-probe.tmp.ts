/** One controlled edit against an existing test app, to prove which AI steps run. */
import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PROJECT = process.argv[2];
const PROMPT = process.argv[3];
const EMAIL = "benchmark@bench.buildwithpetal.com";

const list = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
const user = list.data.users.find((u) => u.email === EMAIL)!;
await supabaseAdmin.from("user_wallets").update({ topup_credits_remaining: 5000, credit_debt: 0 } as never).eq("user_id", user.id);
const link = await supabaseAdmin.auth.admin.generateLink({ type: "magiclink", email: EMAIL });
const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, { auth: { persistSession: false } });
const { data } = await anon.auth.verifyOtp({ token_hash: link.data.properties!.hashed_token, type: "email" });
const { data: files } = await supabaseAdmin.from("project_files").select("path,content").eq("project_id", PROJECT);

const t0 = Date.now();
const res = await fetch("http://localhost:8080/api/generate", {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${data.session!.access_token}`, "x-petal-target": "web" },
  body: JSON.stringify({ projectId: PROJECT, currentFiles: files, messages: [{ role: "user", content: PROMPT }] }),
});
console.log("status", res.status, "start", new Date(t0).toISOString());
const text = await res.text();
const types = new Map<string, number>();
for (const l of text.split("\n")) {
  if (!l.startsWith("data:")) continue;
  try { const e = JSON.parse(l.slice(5)); types.set(e.type, (types.get(e.type) ?? 0) + 1); if (e.type === "error") console.log("ERR", e.message); } catch {}
}
console.log("seconds", ((Date.now() - t0) / 1000).toFixed(1), JSON.stringify([...types]));
