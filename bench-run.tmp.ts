/**
 * Manual benchmark driver. Targets the local server on purpose: the harness
 * mints an admin session, which the public edge rejects, and long SSE streams
 * through the CDN were being cut mid-generation.
 */
process.env.PETAL_BENCH_BASE_URL = process.env.PETAL_BENCH_BASE_URL ?? "http://localhost:8080";

import { runNightlyBenchmark } from "@/server/benchmark.server";

const ids = process.argv.slice(2);
const only = ids.length
  ? ids
  : ["micro-edit", "multi-file-edit", "mobile-fix", "visual-redesign", "backed-form", "broken-recovery"];

runNightlyBenchmark({ trigger: "manual", only })
  .then((r) => console.log("RESULT", JSON.stringify(r, null, 2)))
  .catch((e) => console.error("FAILED", e));
