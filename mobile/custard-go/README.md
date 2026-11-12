# Custard Go companion app

One signed app that opens any Custard project preview natively (Face ID, haptics, share, push).
Only `https://preview--*.sites.custardai.dev` addresses are accepted (same rule as `src/server/custard-go.ts`).
Opens via `custardgo://open?url=...` links or a pasted link; recent projects are remembered on the phone.

Build: package these files (plus `public/icon.png`, 1024x1024) as a Petal source JSON and run the
`petal-ios-testflight` / `petal-default` workflows with `PETAL_BUNDLE_ID=dev.custardai.go`.
Blocked until the `dev.custardai.go` App ID and App Store Connect record exist.
