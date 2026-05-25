import type { ProjectFile } from "@/server/generate.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { DesignDirection } from "@/server/design-director.server";
import type { WebSubtype } from "@/lib/web-subtype";

export interface BuildBlueprint {
  projectType: WebSubtype | "mobile" | "extension" | "web-mobile" | "backend";
  sections: string[];
  navigation: string[];
  designLanguage: string;
  backend: string;
  files: string[];
}

function routeFromPath(path: string): string | null {
  const m = path.match(/^src\/pages\/([A-Za-z0-9_$.-]+)\.tsx$/);
  if (!m) return null;
  if (/^home$/i.test(m[1])) return "/";
  return `/${m[1].replace(/\$/g, ":").replace(/\./g, "/").toLowerCase()}`;
}

export function makeBuildBlueprint(args: {
  projectType: BuildBlueprint["projectType"];
  prompt: string;
  files: ProjectFile[];
  designDirection?: DesignDirection | null;
  hasBackend: boolean;
}): BuildBlueprint {
  const text = args.files.map((f) => f.content).join("\n").slice(0, 120_000);
  const routes = args.files.map((f) => routeFromPath(f.path)).filter((r): r is string => !!r);
  const navLabels = Array.from(text.matchAll(/(?:Link|NavLink)[\s\S]{0,120}?to=["']([^"']+)["']/g))
    .map((m) => m[1])
    .filter((v) => v.startsWith("/"));
  const sectionNames = Array.from(text.matchAll(/function\s+([A-Z][A-Za-z0-9_]*(?:Section|Hero|Footer|Header|Features|Pricing|Testimonials|FAQ))/g))
    .map((m) => m[1].replace(/Section$/, ""));

  return {
    projectType: args.projectType,
    sections: Array.from(new Set(sectionNames)).slice(0, 12),
    navigation: Array.from(new Set([...routes, ...navLabels])).slice(0, 12),
    designLanguage: args.designDirection
      ? `${args.designDirection.vibe}; ${args.designDirection.display_font} + ${args.designDirection.body_font}; ${args.designDirection.palette_mood}`
      : "Use the committed design direction and semantic theme tokens.",
    backend: args.hasBackend ? "connected" : "none",
    files: args.files.map((f) => f.path).filter((p) => !p.startsWith("src/components/ui/")).slice(0, 40),
  };
}

export function renderBuildBlueprintBlock(blueprint: BuildBlueprint | null): string {
  if (!blueprint) return "";
  return `\n\n### Build Blueprint (echo before files, then follow exactly)\n${JSON.stringify(blueprint, null, 2)}\nKeep this blueprint consistent on subsequent turns; do not switch app type, navigation model, fonts, or palette unless the user explicitly asks.`;
}

export async function loadProjectBlueprint(projectId?: string | null): Promise<BuildBlueprint | null> {
  if (!projectId) return null;
  try {
    const { data } = await (supabaseAdmin as any)
      .from("project_blueprints")
      .select("blueprint")
      .eq("project_id", projectId)
      .maybeSingle();
    return data?.blueprint ?? null;
  } catch (e) {
    console.warn("[blueprint] load skipped:", e instanceof Error ? e.message : String(e));
    return null;
  }
}

export async function saveProjectBlueprint(projectId: string | undefined, blueprint: BuildBlueprint): Promise<void> {
  if (!projectId) return;
  try {
    await (supabaseAdmin as any).from("project_blueprints").upsert(
      {
        project_id: projectId,
        project_type: blueprint.projectType,
        sections: blueprint.sections,
        navigation: blueprint.navigation,
        design_language: blueprint.designLanguage,
        backend: blueprint.backend,
        files: blueprint.files,
        blueprint,
      },
      { onConflict: "project_id" },
    );
  } catch (e) {
    console.warn("[blueprint] save skipped:", e instanceof Error ? e.message : String(e));
  }
}