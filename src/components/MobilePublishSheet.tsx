/**
 * MobilePublishSheet — staging surface for Milestone 4.
 *
 * Real EAS Build / App Store / Play publishing requires:
 *   1. The user's Expo account (OAuth — needs an Expo OAuth app + secrets).
 *   2. For iOS: an active Apple Developer Program membership ($99/yr).
 *   3. For Android: a Google Play Console account ($25 one-time) OR
 *      raw APK download via `eas build --profile preview --platform android`.
 *
 * Until those credentials are connected, we surface the prerequisites
 * clearly and gate the real publish call behind a "Connect Expo account"
 * step. This is the same shape Bolt/Rork land on — they collect Expo
 * credentials first, then trigger EAS Build server-side.
 *
 * When the user confirms they're ready, we'll wire `secrets--add_secret`
 * to capture `EXPO_OAUTH_CLIENT_ID` / `EXPO_OAUTH_CLIENT_SECRET` and
 * implement `POST /api/mobile/eas-build` to call EAS Build's REST API.
 * That's a separate PR — kept out of this one so we don't ship a
 * half-working publish flow.
 */
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Apple, Download, Smartphone, AlertTriangle, ExternalLink } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getExpoConnectStatus } from "@/lib/expo.functions";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};


export function MobilePublishSheet({ open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Smartphone className="h-4 w-4" /> Ship to App Store & Play
          </SheetTitle>
          <SheetDescription>
            Petal can build your app with EAS and submit it to the stores.
            A few one-time setup steps first.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5 text-sm">
          {/* Android — easiest path */}
          <section className="rounded-2xl border border-border bg-card/60 p-4">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
              <Download className="h-4 w-4" /> Android (.apk)
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              No store account needed for a direct install. Petal will
              run <code className="rounded bg-muted px-1 py-0.5 text-[11px]">eas build --profile preview --platform android</code> on
              your behalf and email you the .apk link when it's ready
              (typically 5–10 min).
            </p>
            <p className="mt-2 text-[11.5px] text-muted-foreground">
              For Play Store submission: $25 one-time Google Play Console fee.
            </p>
          </section>

          {/* iOS — has hard prerequisites */}
          <section className="rounded-2xl border border-border bg-card/60 p-4">
            <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
              <Apple className="h-4 w-4" /> iOS (App Store)
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 text-[11.5px] text-amber-700 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div>
                <div className="font-medium">Requires an Apple Developer account</div>
                <div className="mt-0.5 opacity-90">
                  $99/yr from Apple. There's no way around this — Apple
                  requires it for every iOS app on the store.
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
          </section>

          {/* Expo account — needed for both */}
          <section className="rounded-2xl border border-border bg-card/60 p-4">
            <div className="mb-1 text-[13px] font-semibold">
              Connect your Expo account
            </div>
            <p className="text-[12.5px] text-muted-foreground">
              Petal builds via{" "}
              <a
                href="https://docs.expo.dev/build/introduction/"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:no-underline"
              >
                EAS Build
              </a>
              . Free tier gives you 30 builds/month. Sign in with Expo
              below — Petal never stores your password, just an OAuth
              refresh token scoped to builds.
            </p>
            <button
              type="button"
              disabled
              title="Connect-Expo OAuth is wired in the next release"
              className="mt-3 inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-full border border-border bg-muted/40 px-4 text-[12.5px] font-medium text-muted-foreground"
            >
              Connect Expo account
              <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[10px]">
                Coming soon
              </span>
            </button>
            <p className="mt-2 text-[11px] text-muted-foreground">
              In the meantime, you can export the project from the menu
              and run <code className="rounded bg-muted px-1 py-0.5 text-[11px]">eas build</code> locally
              with the same files.
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
