/**
 * Order in which existing files earn a place in an edit prompt. Lower = first.
 *
 * Edit targets first, then the files every visual change runs through (the
 * stylesheet, the app shell, shared layout/navigation), then pinned files the
 * prompt mentions, pinned files, prompt-relevant files, and the rest. The old
 * comparator mixed "relevant = 3" with "pinned = -1", so unrelated pinned
 * widgets out-ranked the stylesheet and pushed it out of the budget.
 */
const FOUNDATION_RE = /(^|\/)(styles|index|globals|custom)\.css$|^src\/App\.tsx$|(Layout|Header|Footer|Nav(bar)?|SiteNav|Shell|Sidebar)\.(t|j)sx$/;

export function isFoundationPath(path: string): boolean {
  return FOUNDATION_RE.test(path);
}

export function promptPriority(
  path: string,
  flags: { target: boolean; pinned: boolean; relevant: boolean },
): number {
  if (flags.target) return 0;
  if (isFoundationPath(path)) return 1;
  if (flags.pinned && flags.relevant) return 2;
  if (flags.pinned) return 3;
  if (flags.relevant) return 4;
  if (path.startsWith("src/pages/") || path.startsWith("src/routes/")) return 5;
  if (path.startsWith("src/components/")) return 6;
  return 9;
}
