/**
 * Referral landing: /r/<code>
 *
 * Stores the referral code locally, then drops the visitor on the waitlist
 * form. Attribution survives a refresh or a detour through the landing page.
 */
import { useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { rememberReferral } from "@/lib/referral";

export const Route = createFileRoute("/r/$code")({
  head: () => ({
    meta: [
      { title: "You've been invited to Petal" },
      {
        name: "description",
        content:
          "Your friend saved you a spot in line for Petal — describe an app in a sentence and watch it get built.",
      },
      { property: "og:title", content: "You've been invited to Petal" },
      {
        property: "og:description",
        content: "Skip ahead in line and start building apps from a sentence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ReferralLanding,
});

function ReferralLanding() {
  const { code } = Route.useParams();
  const navigate = useNavigate();

  useEffect(() => {
    if (code) rememberReferral(code);
    void navigate({
      to: "/auth",
      search: { mode: "signup", redirect: undefined },
      replace: true,
    });
  }, [code, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
      <Loader2 className="h-5 w-5 animate-spin" />
    </div>
  );
}
