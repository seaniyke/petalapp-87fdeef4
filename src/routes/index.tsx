import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Kimble Engine — software generation API" },
      { name: "description", content: "Kimble Engine is a private software generation service driven over API." },
      { property: "og:title", content: "Kimble Engine — software generation API" },
      { property: "og:description", content: "Private software generation service driven over API." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EngineHome,
});

function EngineHome() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="max-w-md space-y-3 text-center">
        <h1 className="text-2xl font-semibold text-foreground">Kimble Engine</h1>
        <p className="text-sm text-muted-foreground">
          Private software generation service. Access is by API key only.
        </p>
        <Link
          to="/admin"
          className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm font-medium text-foreground"
        >
          Operator console
        </Link>
      </div>
    </main>
  );
}
