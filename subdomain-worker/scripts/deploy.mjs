// Deploy the subdomain-router Worker via the Cloudflare REST API and bind it
// to *.buildwithpetal.com/*. Run with: `node scripts/deploy.mjs`
//
// Required env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_SAAS_ZONE_ID
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const { CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_SAAS_ZONE_ID } =
  process.env;
if (!CLOUDFLARE_API_TOKEN || !CLOUDFLARE_ACCOUNT_ID || !CLOUDFLARE_SAAS_ZONE_ID) {
  console.error("Missing one of CLOUDFLARE_API_TOKEN / _ACCOUNT_ID / _SAAS_ZONE_ID");
  process.exit(1);
}

const SCRIPT = "petal-subdomain-router";
const PATTERN = "*.buildwithpetal.com/*";

const cf = (p, init = {}) =>
  fetch(`https://api.cloudflare.com/client/v4${p}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CLOUDFLARE_API_TOKEN}`,
      ...(init.headers ?? {}),
    },
  });

// ---- 1) Upload the Worker module ---------------------------------------
const code = await readFile(path.join(root, "src/index.js"), "utf8");

const metadata = {
  main_module: "index.mjs",
  compatibility_date: "2025-01-01",
};

const form = new FormData();
form.append(
  "metadata",
  new Blob([JSON.stringify(metadata)], { type: "application/json" }),
);
form.append(
  "index.mjs",
  new Blob([code], { type: "application/javascript+module" }),
  "index.mjs",
);

const upload = await cf(
  `/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${SCRIPT}`,
  { method: "PUT", body: form },
);
const uploadJson = await upload.json();
if (!uploadJson.success) {
  console.error("Upload failed:", JSON.stringify(uploadJson, null, 2));
  process.exit(1);
}
console.log("✓ Worker uploaded");

// ---- 2) Bind to *.buildwithpetal.com/* ---------------------------------
const routes = await cf(`/zones/${CLOUDFLARE_SAAS_ZONE_ID}/workers/routes`).then(
  (r) => r.json(),
);
const existing = routes.result?.find((r) => r.pattern === PATTERN);
if (existing) {
  if (existing.script === SCRIPT) {
    console.log(`✓ Route ${PATTERN} already bound to ${SCRIPT}`);
  } else {
    const upd = await cf(
      `/zones/${CLOUDFLARE_SAAS_ZONE_ID}/workers/routes/${existing.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pattern: PATTERN, script: SCRIPT }),
      },
    ).then((r) => r.json());
    if (!upd.success) {
      console.error("Route update failed:", JSON.stringify(upd, null, 2));
      process.exit(1);
    }
    console.log(`✓ Route ${PATTERN} re-bound to ${SCRIPT}`);
  }
} else {
  const add = await cf(`/zones/${CLOUDFLARE_SAAS_ZONE_ID}/workers/routes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pattern: PATTERN, script: SCRIPT }),
  }).then((r) => r.json());
  if (!add.success) {
    console.error("Route add failed:", JSON.stringify(add, null, 2));
    process.exit(1);
  }
  console.log(`✓ Route ${PATTERN} bound to ${SCRIPT}`);
}

console.log("\nAll set. Test with:  curl -I https://<slug>.buildwithpetal.com");
