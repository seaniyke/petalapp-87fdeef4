/**
 * SnackPreview — Live mobile preview via Expo Snack web-player.
 *
 * This is exactly the pattern Bolt.new / Rork / a0.dev use for their
 * mobile previews: spin up a Snack session in the browser via
 * `snack-sdk`, hand it the project's files, and render the Snack's
 * `webPreviewURL` inside an iframe sized like a phone. Hot-reload works
 * automatically — when Petal writes new files, we debounce-stream them
 * into the Snack and the iframe re-renders.
 *
 * Why Snack rather than running RN in the browser ourselves?
 * - Snack already solves the hard parts: bundling RN for web, resolving
 *   npm deps, hot-reloading, AND streaming to a real Expo Go client over
 *   the network (the "Test on phone" QR).
 * - It's free, hosted by Expo, and the SDK is browser-friendly.
 *
 * Caveats:
 * - Snack expects an Expo-style entry (`App.js` / `App.tsx`). If Petal
 *   scaffolded a web project, the preview will not be useful; we surface
 *   a "Switch to Web target" hint instead of a broken iframe.
 * - Snack needs at least one CODE file. Empty projects show a blank
 *   placeholder until Petal writes the first file.
 *
 * Milestone 3 of the build-target plan.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectFile } from "@/server/generate.server";
import { Loader2, QrCode, Smartphone } from "lucide-react";
import QRCode from "qrcode";

type Props = {
  files: ProjectFile[];
  /** Used as the Snack name + helps Expo Go users recognize the session. */
  projectName?: string;
};

// We only forward files that make sense to a Snack session. App config,
// lockfiles, and platform-only binaries would just confuse the bundler.
const SKIP_PREFIXES = [
  "node_modules/",
  ".git/",
  "android/",
  "ios/",
  "build/",
  "dist/",
];
const SKIP_FILES = new Set([
  "package-lock.json",
  "bun.lock",
  "bun.lockb",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".gitignore",
]);
// Assets must be present in the Snack session — otherwise an `import logo
// from './assets/logo.png'` hard-fails the RN bundler and the preview goes
// blank. We can't upload real binary content from the browser cheaply, so
// we register every asset path as a 1x1 transparent PNG placeholder. The
// app still renders; the developer sees a visible "missing image" outline
// instead of a crash. Real binary upload is a future milestone.
const ASSET_EXTS = /\.(png|jpe?g|gif|webp|svg|mp3|mp4|ttf|otf|woff2?)$/i;
const PLACEHOLDER_PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

type SnackFile =
  | { type: "CODE"; contents: string }
  | { type: "ASSET"; contents: string };

function toSnackFiles(files: ProjectFile[]): Record<string, SnackFile> {
  const out: Record<string, SnackFile> = {};
  for (const f of files) {
    if (!f.path) continue;
    if (SKIP_FILES.has(f.path)) continue;
    if (SKIP_PREFIXES.some((p) => f.path.startsWith(p))) continue;
    if (ASSET_EXTS.test(f.path)) {
      out[f.path] = { type: "ASSET", contents: PLACEHOLDER_PNG_DATA_URI };
      continue;
    }
    out[f.path] = { type: "CODE", contents: f.content ?? "" };
  }
  // Snack requires at least one entry file. If the project doesn't have
  // one yet, give it a placeholder so the iframe loads instead of
  // erroring with "no files".
  if (!out["App.js"] && !out["App.tsx"]) {
    out["App.js"] = {
      type: "CODE",
      contents:
        "import { Text, View } from 'react-native';\n" +
        "export default function App() {\n" +
        "  return (\n" +
        "    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>\n" +
        "      <Text>Waiting for Petal to write your first file…</Text>\n" +
        "    </View>\n" +
        "  );\n" +
        "}\n",
    };
  }
  return out;
}

export function SnackPreview({ files, projectName }: Props) {
  const [previewURL, setPreviewURL] = useState<string | null>(null);
  const [snackURL, setSnackURL] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showQR, setShowQR] = useState(false);
  const [qrDataURL, setQrDataURL] = useState<string | null>(null);
  const snackRef = useRef<unknown>(null);
  const webPreviewRef = useRef<Window | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialFiles = useMemo(() => toSnackFiles(files), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- initial only

  // Boot the Snack session once on mount.
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      try {
        // Dynamic import keeps snack-sdk out of the initial bundle for
        // users who never open a mobile preview.
        const mod = await import("snack-sdk");
        const Snack = (mod as { Snack: new (opts: unknown) => unknown }).Snack;
        const snack = new Snack({
          name: projectName ?? "Petal preview",
          description: "Generated by Petal",
          sdkVersion: "52.0.0",
          online: true,
          files: initialFiles,
          // Hand the SDK a ref so it can talk to the web-player iframe.
          // We attach it once the iframe mounts (see below).
          webPreviewRef: {
            get current() {
              return webPreviewRef.current;
            },
          },
          codeChangesDelay: 250, // debounce inside the SDK too
          verbose: false,
        }) as {
          getState(): { webPreviewURL?: string; url?: string };
          addStateListener(fn: (state: { webPreviewURL?: string; url?: string }) => void): () => void;
          updateFiles(files: Record<string, SnackFile | null>): void;
          setOnline(online: boolean): void;
        };
        snackRef.current = snack;

        const state = snack.getState();
        if (!cancelled) {
          if (state.webPreviewURL) setPreviewURL(state.webPreviewURL);
          if (state.url) setSnackURL(state.url);
        }

        const unsub = snack.addStateListener((s) => {
          if (cancelled) return;
          if (s.webPreviewURL) setPreviewURL(s.webPreviewURL);
          if (s.url) setSnackURL(s.url);
        });

        cleanup = () => {
          try {
            unsub();
          } catch {
            /* ignore */
          }
          try {
            snack.setOnline(false);
          } catch {
            /* ignore */
          }
        };
      } catch (e) {
        console.warn("[SnackPreview] init failed:", e);
        if (!cancelled) {
          setError(
            "Couldn't reach the Expo Snack service. Live mobile preview is unavailable right now.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- boot once
  }, []);

  // Stream Petal's file writes into the live Snack session.
  useEffect(() => {
    const snack = snackRef.current as
      | { updateFiles(f: Record<string, SnackFile | null>): void }
      | null;
    if (!snack) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        snack.updateFiles(toSnackFiles(files));
      } catch (e) {
        console.warn("[SnackPreview] updateFiles failed:", e);
      }
    }, 250);
  }, [files]);

  // Generate a QR code from the public Snack URL (Expo Go scans it).
  useEffect(() => {
    if (!showQR || !snackURL) return;
    QRCode.toDataURL(snackURL, { width: 220, margin: 1 })
      .then(setQrDataURL)
      .catch(() => setQrDataURL(null));
  }, [showQR, snackURL]);

  if (error) {
    return (
      <div className="grid h-full place-items-center bg-background p-4 text-center">
        <div className="max-w-xs text-xs text-muted-foreground">
          <Smartphone className="mx-auto mb-2 h-5 w-5 opacity-50" />
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      {previewURL ? (
        <iframe
          ref={(el) => {
            iframeRef.current = el;
            webPreviewRef.current = el?.contentWindow ?? null;
          }}
          src={previewURL}
          title="Mobile preview"
          allow="geolocation; microphone; camera; midi; encrypted-media; autoplay; gyroscope; accelerometer"
          className="h-full w-full border-0 bg-background"
        />
      ) : (
        <div className="grid h-full place-items-center bg-background text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Starting Expo Snack…
          </div>
        </div>
      )}

      {/* "Test on phone" QR — bottom-right floating action. */}
      {snackURL && (
        <button
          type="button"
          onClick={() => setShowQR((v) => !v)}
          className="absolute bottom-2 right-2 z-30 grid h-9 w-9 place-items-center rounded-full border border-border bg-background/95 text-foreground shadow-lg backdrop-blur transition hover:scale-105"
          aria-label="Show QR for Expo Go"
          title="Test on phone (Expo Go)"
        >
          <QrCode className="h-4 w-4" />
        </button>
      )}

      {showQR && snackURL && (
        <div
          onClick={() => setShowQR(false)}
          className="absolute inset-0 z-40 grid place-items-center bg-black/60 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[260px] rounded-2xl border border-border bg-background p-4 text-center shadow-xl"
          >
            <div className="mb-1 text-[12px] font-medium">Open on your phone</div>
            <div className="mb-3 text-[11px] text-muted-foreground">
              Install Expo Go, then scan with your camera.
            </div>
            {qrDataURL ? (
              <img
                src={qrDataURL}
                alt="Expo Go QR code"
                className="mx-auto h-[200px] w-[200px] rounded-md bg-white p-2"
              />
            ) : (
              <div className="mx-auto grid h-[200px] w-[200px] place-items-center rounded-md border border-dashed text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            )}
            <a
              href={snackURL}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-[11px] text-muted-foreground underline hover:text-foreground"
            >
              Or open in browser
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
