/**
 * MobilePublishSheet — "Ship your app" surface for the mobile target.
 *
 * Honest model:
 *   - Petal runs EAS Build on its own Expo org → user gets .apk / .ipa
 *     with zero account setup. (Same model as Bolt/Rork's free path.)
 *   - Direct install on Android: free, just sideload the .apk.
 *   - Play Store: $25 one-time Google Play Console fee.
 *   - App Store / TestFlight: $99/yr Apple Developer Program — there
 *     is NO way around this; Apple legally requires the app owner's
 *     own developer account for store submission.
 */
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Apple,
  Download,
  Smartphone,
  AlertTriangle,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMobileBuildReady } from "@/lib/expo.functions";
import { startMobileBuild } from "@/lib/mobile-builds.functions";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string | null;
};

export function MobilePublishSheet({ open, onOpenChange, projectId }: Props) {
  const fetchStatus = useServerFn(getMobileBuildReady);
  const triggerBuild = useServerFn(startMobileBuild);
  const { data: status } = useQuery({
    queryKey: ["mobile-build-ready"],
    queryFn: () => fetchStatus(),
    enabled: open,
    staleTime: 60_000,
  });
  const ready = Boolean(status?.ready);
  const [building, setBuilding] = useState<"android" | "ios" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startBuild = async (platform: "android" | "ios") => {
    if (!projectId) return;
    setBuilding(platform);
    setError(null);
    try {
      // Unsigned preview build — user can sideload the .apk directly.
      // Signed/store builds go through the Advanced sheet which collects
      // a signing profile first.
      const result = await triggerBuild({
        data: { projectId, platform, kind: "unsigned" },
      });
      if (!result.ok) {
        const msg =
          result.reason === "plan_required"
            ? "Mobile builds require a paid plan. Upgrade in Settings → Plan."
            : result.reason === "signing_required"
              ? "Add a signing certificate in the Advanced sheet first."
              : (result.message ?? "Build couldn't start. Try again shortly.");
        setError(msg);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error — try again.");
    } finally {
      setBuilding(null);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" /> Ship your mobile app
          </SheetTitle>
          <SheetDescription>
            Petal builds your app on its own infrastructure — no Expo
            account, no SDK install. You'll get a download link as soon
            as the build finishes (5–10 min).
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5 text-sm">
          {/* Android — easiest path */}
          <section className="rounded-2xl border border-border bg-card/60 p-4">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
              <Download className="h-4 w-4" /> Android (.apk)
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              Install directly on any Android phone — no store account
              required. For Play Store submission later: $25 one-time
              Google Play Console fee (your account, not Petal's).
            </p>
            <button
              type="button"
              onClick={() => startBuild("android")}
              disabled={!ready || building !== null || !projectId}
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-full bg-foreground px-4 text-[12.5px] font-medium text-background transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {building === "android" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting build…
                </>
              ) : (
                <>Build Android .apk</>
              )}
            </button>
          </section>

          {/* iOS — has hard prerequisites for store submission */}
          <section className="rounded-2xl border border-border bg-card/60 p-4">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
              <Apple className="h-4 w-4" /> iOS (App Store / TestFlight)
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11.5px] text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <div className="font-medium">
                  Apple Developer Program required for store submission
                </div>
                <div className="mt-0.5 opacity-90">
                  $99/yr from Apple. There's no way around this — Apple
                  requires the app owner's own developer account for
                  every app on the store. Petal can't legally do this on
                  your behalf.
                </div>
                <a
                  href="https://developer.apple.com/programs/enroll/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 underline hover:no-underline"
                >
                  Enroll with Apple <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
            <button
              type="button"
              onClick={() => startBuild("ios")}
              disabled={!ready || building !== null || !projectId}
              className="mt-3 inline-flex h-9 items-center gap-2 rounded-full border border-border bg-muted/30 px-4 text-[12.5px] font-medium text-foreground transition hover:bg-foreground/[0.05] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {building === "ios" ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting build…
                </>
              ) : (
                <>Build iOS .ipa</>
              )}
            </button>
          </section>

          {!ready && (
            <p className="text-[11.5px] text-muted-foreground">
              Petal's mobile build pipeline is being finalized. The Build
              buttons unlock once it's live — no action needed on your end.
            </p>
          )}

          {error && (
            <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-[11.5px] text-destructive">
              {error}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
