# Petal Mobile Pipeline — Architecture (secluded, behind `MOBILE_APPS_ENABLED=false`)

## Decision
No Despia. We own the bridge, the shell recipe and the build orchestration.
`despia-native` is ~220 lines that set `window.despia = "scheme://..."`; the paid
part is their closed native shell, Mac runners and store upload. We replace each
with open or owned parts, so neither Petal nor its customers pay a per-app licence.

## Pipeline
1. **Target** — `src/lib/target-inference.ts` decides `mobile` (gated by `site-flags.ts`).
2. **Generate** — same web engine; mobile kit (`src/components/mobile/*`) + mobile guidance
   (`integrations/mobile-guidance.server.ts`) force phone layout.
3. **Bridge** — every mobile app gets `src/lib/native.ts` (from `scaffold-kit-mobile-shell.ts`).
   App code calls `native.*` only; zero native npm packages in the app.
   - In preview/browser: real web APIs or safe fallbacks.
   - In the store app: the shell's global plugin registry (`window.Capacitor.Plugins`).
4. **Shell (build time only)** — the Mac runner adds the MIT-licensed Capacitor shell and the
   exact plugin set the bridge uses (`mobile-codemagic-template.server.ts`). A test fails if the
   bridge uses a plugin the recipe doesn't install.
5. **Build** — Mac runner compiles `.apk/.aab` and `.ipa`, posts a signed result to
   `/api/public/mobile/callback`.
6. **Deliver** — download links + install QR; optional store upload with the owner's keys.

## External systems to connect
| System | Why | What we need | Rough cost |
|---|---|---|---|
| Codemagic (Mac M2 runners) | iOS needs macOS/Xcode; also builds Android | `CODEMAGIC_API_TOKEN`, team account | ~$0.04–0.10/min, ~$0.20–0.50/build |
| Build source handoff | Runner must fetch the project | Today: GitHub org + App (`PETAL_GITHUB_MIRROR_ORG`, app id/key). Planned: signed tarball URL from Petal storage instead of one repo per project | GitHub free tier |
| Webhook secret | Verify build results | `MOBILE_CODEMAGIC_WEBHOOK_SECRET` | — |
| Apple Developer (customer's) | Legal publisher of iOS apps | App Store Connect API key (issuer id, key id, .p8) — replaces .p12 upload | $99/yr, paid by app owner |
| Google Play Console (customer's) | Legal publisher of Android apps | Service-account JSON | $25 once, paid by app owner |
| Later at scale | Fixed-cost runner | Dedicated Mac mini (MacStadium/Hetzner) | ~$60–90/mo flat |

## Keep / replace / remove
- **Keep:** target inference, mobile kit, mobile guidance, `mobile_apps`/`mobile_builds` tables, callback route, Codemagic provider.
- **Replaced (done):** five `@capacitor/*` app dependencies → owned `native` bridge.
- **Replace next:** per-project GitHub mirror → signed source tarball; manual `.p12`/provisioning upload → App Store Connect API key with automatic signing.
- **Remove next:** Expo/EAS readiness check (`src/lib/expo.functions.ts`) — Expo path is dead.

## Not done / blocked
- No Codemagic account or token yet → no real binary built.
- Route-shape check in `api/generate.ts` mobile guard still looks for `src/pages/` (pre-TanStack); fix before enabling.
- Flag stays off; nothing reaches customers.
