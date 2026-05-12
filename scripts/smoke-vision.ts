#!/usr/bin/env node
/**
 * Vision smoke test — confirms Petal's generate pipeline still routes
 * image attachments to a vision-capable model and the model can read them.
 *
 * Run with: bun scripts/smoke-vision.ts
 *
 * This hits the Lovable AI Gateway directly (same model + content shape that
 * src/routes/api/generate.ts uses for `hasVisionTurn`). It will fail loudly
 * if vision support regresses (model swap, gateway change, content shape
 * change). Add to CI before shipping any change to generate.ts.
 */

const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = process.env.PETAL_VISION_MODEL || "google/gemini-2.5-flash";

// 1x1 solid red PNG, base64. Trivial enough that any vision model passes.
const RED_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function main() {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    console.error("LOVABLE_API_KEY not set");
    process.exit(2);
  }
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What single color fills this image? Answer with one word." },
            { type: "image_url", image_url: { url: `data:image/png;base64,${RED_PNG_B64}` } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) {
    console.error("HTTP", res.status, await res.text());
    process.exit(1);
  }
  const json = (await res.json()) as { choices: { message: { content: string } }[] };
  const answer = (json.choices?.[0]?.message?.content || "").toLowerCase();
  console.log(`model=${MODEL} answer=${JSON.stringify(answer)}`);
  if (!/red/.test(answer)) {
    console.error(`FAIL — expected /red/ in answer, got: ${answer}`);
    process.exit(1);
  }
  console.log("PASS — vision pipeline OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
