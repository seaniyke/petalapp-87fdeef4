/**
 * Custard AI staff widget. Apps built for Custard AI (owned by the service
 * account) get Custard's chat/voice widget right before </body>. Idempotent.
 */
import type { ProjectFile } from "@/server/generate.server";

export const CUSTARD_WIDGET_TAG = '<script src="https://custardai.dev/widget.js" async></script>';

export function injectCustardWidget(files: ProjectFile[]): ProjectFile[] {
  return files.map((f) => {
    if (f.path !== "index.html") return f;
    if (f.content.includes("custardai.dev/widget.js")) return f;
    const closingBody = /<\/body>/i;
    if (closingBody.test(f.content)) {
      return { ...f, content: f.content.replace(closingBody, `${CUSTARD_WIDGET_TAG}\n</body>`) };
    }
    return { ...f, content: `${f.content}\n${CUSTARD_WIDGET_TAG}\n` };
  });
}

/** True when the project belongs to the Custard AI service account. */
export async function isCustardOwned(ownerId: string | null | undefined): Promise<boolean> {
  if (!ownerId) return false;
  try {
    const { serviceUserId } = await import("@/server/service-api.server");
    return ownerId === (await serviceUserId());
  } catch {
    return false;
  }
}
