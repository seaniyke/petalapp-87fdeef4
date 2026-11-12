# Custard Go — instant phone preview

One companion app (iPhone + Android) that runs any Custard project natively in seconds, no per-project compile.

## How it works
1. Custard calls `POST /api/public/v1/projects/:id/phone-preview` (same bearer key as other calls).
2. Response: `previewUrl`, `custardGoUrl` (`custardgo://open?url=…`), `qrData`, `qrImageUrl`, `certificate`.
3. Custard shows `qrImageUrl` in a "Preview on your phone" panel.
4. Scanned in **Custard Go** → loads the address inside the native shell: real Face ID, haptics, share, push.
5. Scanned with the **normal camera** → opens in the browser; `petal_app=1` shows the app screens (welcome, sign-in, tabs), never the landing page.
6. Edits appear on the next ready build — pull to refresh / reopen.

Errors: `409 no_ready_build` (wait for the build), `502 preview_address_unavailable` (retry in a minute; the certificate is issued on first use).

## The Custard Go app
- Capacitor 8 shell with the store-safe set: biometrics, haptics, share, push, preferences, app, browser, camera (for scanning). No location, ads, billing or tracking.
- Loads only `https://preview--*.sites.custardai.dev` (`isAllowedPreviewUrl`), opens `custardgo://open?url=` links, remembers recent projects.
- Built by the same Codemagic pipeline; published once to TestFlight / Play (internal testing first).

## Suggested user copy (Custard)
- Title: "Try it on your phone"
- Body: "Scan with Custard Go for the full app experience — Face ID, vibration and notifications. No Custard Go? Scan with your camera for a quick look."
- Buttons: "Get Custard Go (iPhone)", "Get Custard Go (Android)".
