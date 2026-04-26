import { supabase } from "@/integrations/supabase/client";
import type { ProjectFile } from "@/server/generate.server";

export type VersionRow = {
  id: string;
  project_id: string;
  label: string | null;
  summary: string | null;
  files: ProjectFile[];
  origin: "auto" | "manual";
  created_at: string;
};

type DbRow = {
  id: string;
  project_id: string;
  label: string | null;
  summary: string | null;
  files: unknown;
  origin: string;
  created_at: string;
};

function normalize(row: DbRow): VersionRow {
  const raw = Array.isArray(row.files) ? (row.files as unknown[]) : [];
  const files: ProjectFile[] = raw
    .filter((f): f is { path: string; content: string } => {
      return (
        typeof f === "object" &&
        f !== null &&
        typeof (f as { path?: unknown }).path === "string" &&
        typeof (f as { content?: unknown }).content === "string"
      );
    })
    .map((f) => ({ path: f.path, content: f.content }));
  return {
    id: row.id,
    project_id: row.project_id,
    label: row.label,
    summary: row.summary,
    files,
    origin: row.origin === "manual" ? "manual" : "auto",
    created_at: row.created_at,
  };
}

export async function listVersions(projectId: string): Promise<VersionRow[]> {
  const { data, error } = await supabase
    .from("project_versions")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as DbRow[]).map(normalize);
}

export async function createVersion(
  projectId: string,
  files: ProjectFile[],
  opts: { label?: string | null; summary?: string | null; origin?: "auto" | "manual" } = {}
): Promise<VersionRow> {
  if (files.length === 0) throw new Error("Nothing to snapshot yet.");
  const { data, error } = await supabase
    .from("project_versions")
    .insert([
      {
        project_id: projectId,
        files: files as unknown as DbRow["files"],
        label: opts.label ?? null,
        summary: opts.summary ?? null,
        origin: opts.origin ?? "auto",
      },
    ])
    .select("*")
    .single();
  if (error) throw error;
  return normalize(data as DbRow);
}

export async function deleteVersion(id: string) {
  const { error } = await supabase.from("project_versions").delete().eq("id", id);
  if (error) throw error;
}

export async function renameVersion(id: string, label: string) {
  const { error } = await supabase
    .from("project_versions")
    .update({ label: label.trim() || null })
    .eq("id", id);
  if (error) throw error;
}
