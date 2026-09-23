import { runNightlyBenchmark } from "@/server/benchmark.server";
const ids = ["micro-edit","multi-file-edit","mobile-fix","visual-redesign","backed-form","broken-recovery"];
runNightlyBenchmark({ trigger: "manual", only: ids })
  .then((r) => console.log("RESULT", JSON.stringify(r, null, 2)))
  .catch((e) => console.error("FAILED", e));
