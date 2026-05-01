/**
 * Project thumbnail used by the gallery and projects drawer.
 *
 * We previously tried to mount a scaled-down iframe pointing at the deployed
 * URL, but cross-origin sandbox restrictions made the iframes render as broken
 * placeholders for most users. Instead we now render a stable, attractive
 * gradient tile with the project's initials — fast, deterministic, and works
 * for every project without an extra screenshot service.
 */
export function ProjectThumbnail({
  projectId,
  className = "h-28",
  title,
}: {
  projectId: string;
  className?: string;
  title?: string;
}) {
  // Pick one of a few gradient palettes deterministically from the projectId
  // so the same project always gets the same look but different projects feel
  // visually distinct in the grid.
  const palette = pickPalette(projectId);
  const initials = (title ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("") || "·";

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ background: palette.gradient }}
      aria-hidden
    >
      <div className="absolute inset-0 bg-grain opacity-25" />
      <div className="absolute inset-0 grid place-items-center">
        <div
          className="grid h-14 w-14 place-items-center rounded-2xl bg-white/85 text-lg font-display text-foreground shadow-md backdrop-blur"
          style={{ color: palette.ink }}
        >
          {initials}
        </div>
      </div>
    </div>
  );
}

const PALETTES = [
  { gradient: "linear-gradient(135deg,#FFD8C2 0%,#F8B4A0 50%,#E59FB7 100%)", ink: "#5B2A3A" },
  { gradient: "linear-gradient(135deg,#C7E7FF 0%,#A8C5FF 50%,#9D9BFF 100%)", ink: "#1F2960" },
  { gradient: "linear-gradient(135deg,#FFE6A8 0%,#FFC176 50%,#F58A6A 100%)", ink: "#5A2B14" },
  { gradient: "linear-gradient(135deg,#D6F1D8 0%,#9DD9C0 50%,#5FB4B5 100%)", ink: "#173E3D" },
  { gradient: "linear-gradient(135deg,#F4E5FF 0%,#D9B8FF 50%,#A487E0 100%)", ink: "#3A1F66" },
  { gradient: "linear-gradient(135deg,#FFE5EC 0%,#FFB5C5 50%,#FF7E9D 100%)", ink: "#5C1B30" },
  { gradient: "linear-gradient(135deg,#E8E0D2 0%,#D6C4A1 50%,#B89C6A 100%)", ink: "#3F3115" },
  { gradient: "linear-gradient(135deg,#D4F1F4 0%,#75CFB8 50%,#3B7A8A 100%)", ink: "#0E2F38" },
];

function pickPalette(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length];
}
