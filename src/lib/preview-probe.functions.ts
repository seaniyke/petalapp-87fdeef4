/**
 * Server-side reachability probe for the "instant preview" iframe.
 *
 * A browser-side `fetch(..., { mode: "no-cors" })` returns an opaque response
 * for dead hosts, 404 pages and hosts that refuse framing alike — so the
 * builder happily embedded URLs that then rendered
 * "…pages.dev refused to connect." inside the iframe.
 *
 * Running the probe on the server lets us read the real status code AND the
 * framing headers (X-Frame-Options / CSP frame-ancestors), so we only hand
 * back a URL the iframe can actually display.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({ url: z.string().url() });

export type PreviewProbeResult = {
  embeddable: boolean;
  status: number | null;
  reason?: string;
};

export const probePreviewUrl = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data }): Promise<PreviewProbeResult> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const res = await fetch(data.url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "user-agent": "PetalPreviewProbe/1.0" },
      });
      if (res.status >= 400) {
        return { embeddable: false, status: res.status, reason: `http_${res.status}` };
      }
      const xfo = (res.headers.get("x-frame-options") ?? "").toLowerCase();
      if (xfo.includes("deny") || xfo.includes("sameorigin")) {
        return { embeddable: false, status: res.status, reason: "x_frame_options" };
      }
      const csp = (res.headers.get("content-security-policy") ?? "").toLowerCase();
      const fa = /frame-ancestors([^;]*)/.exec(csp)?.[1] ?? "";
      if (fa && !fa.includes("*") && !fa.includes("https:")) {
        return { embeddable: false, status: res.status, reason: "frame_ancestors" };
      }
      return { embeddable: true, status: res.status };
    } catch (e) {
      return {
        embeddable: false,
        status: null,
        reason: e instanceof Error ? e.message.slice(0, 120) : "unreachable",
      };
    } finally {
      clearTimeout(timer);
    }
  });
