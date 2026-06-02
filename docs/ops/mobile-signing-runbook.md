# Mobile Signing Key Runbook

How Petal handles iOS/Android signing materials end-to-end, plus the on-call
playbook for the three things that go wrong in production: lost user keys,
compromised Petal master key, and Codemagic build failures traced to signing.

## TL;DR for on-call

| Symptom | Likely cause | First action |
|---------|--------------|--------------|
| User says "my Android build won't install over my old version" | Lost their original `android_keystore` — there is NO recovery. | Confirm via runbook §4. Direct them to publish as a new package id. |
| Codemagic build fails with `code signing` / `provisioning profile` error | Apple cert or provisioning profile expired (1yr cert, 1yr profile). | Walk through §3. User must regenerate in Apple Developer portal. |
| Multiple unrelated projects start failing iOS builds at once | Petal's Apple Distribution cert expired, OR `MOBILE_SIGNING_KEY` rotated incorrectly. | Check §5 (master key) before anything else. |
| `MOBILE_SIGNING_KEY` suspected leaked | Rotate immediately — every user's secrets are AES-encrypted with it. | Execute §5. |

## 1. Architecture

```
User uploads cert/keystore via Petal UI
        │
        ▼
src/server/mobile-signing.server.ts
   encrypt(plaintext, MOBILE_SIGNING_KEY)   ── AES-256-GCM
        │
        ▼
public.mobile_signing_profiles  (RLS: owner_id only)
        │
        ▼  on build start, decrypt server-side
src/server/mobile-service.server.ts
   inject into Codemagic `variables` payload as `signingEnv`
        │
        ▼
Codemagic build worker (ephemeral) ── signs ipa/apk ── uploads back via webhook
```

Key properties:
- **Plaintext never persists.** Plaintext lives only in the build worker's
  RAM for the duration of one build.
- **One signing profile per project**, enforced by the
  `mobile_signing_profiles_project_id_key` unique index.
- **RLS:** only the project owner can read/write their row. Service role
  (used by the build trigger) bypasses RLS.

## 2. Required secrets

| Secret | Where | Purpose | Rotation cadence |
|--------|-------|---------|------------------|
| `MOBILE_SIGNING_KEY` | Petal runtime env | AES-256 master key wrapping every row in `mobile_signing_profiles` | Only on suspected compromise — see §5 |
| `CODEMAGIC_API_TOKEN` | Petal runtime env | Trigger builds | Annually |
| `CODEMAGIC_APP_ID` | Petal runtime env | App template ID | Never (constant) |
| `MOBILE_CODEMAGIC_WEBHOOK_SECRET` | Petal runtime + Codemagic webhook config | HMAC build-finished callbacks | On suspected compromise |
| `EXPO_ACCESS_TOKEN` | Petal runtime env | Server-side EAS access (Petal org) | Annually |

Verify the full set with `GET /api/internal/health` — see `docs/ops/prod-env.md`.

## 3. Apple signing certificate / provisioning profile expiry

**Frequency**: Apple Distribution certs are valid **1 year**. App Store
provisioning profiles are valid **1 year**. We do NOT proactively warn — yet.

**Detection**: Codemagic build log shows one of:
- `No signing certificate "iOS Distribution" found`
- `Provisioning profile "..." has expired`
- `Code signing is required for product type 'Application'`

**Resolution (user-driven — Apple legally requires the app owner to do this):**
1. User opens [developer.apple.com](https://developer.apple.com) → Certificates, Identifiers & Profiles.
2. Revoke the expired Distribution cert; generate a new one.
3. Regenerate the App Store provisioning profile against the new cert.
4. Export the new `.p12` (with password) and `.mobileprovision`.
5. In Petal: **Project Settings → Mobile → Signing → Replace iOS credentials**.
6. Re-trigger the build from the Publish sheet.

**On-call action**: paste the doc link, no shell access needed. We cannot
regenerate Apple credentials on the user's behalf — Apple requires their
Apple ID + 2FA.

## 4. Lost Android keystore

**This is unrecoverable.** Google Play binds an APK/AAB to the SHA-1 of the
upload keystore. Without the original keystore, the user cannot ship an
update to the existing listing — they must publish under a new package id
and ask users to reinstall.

**Mitigation we DO offer** (built-in to Codemagic config):
- Google Play App Signing is enabled by default for new uploads. Google
  holds the actual app-signing key; the user only loses the upload key,
  which Google can reset with proof of ownership (typically 1–2 week SLA).

**Playbook**:
1. Ask user: "Did you enable Play App Signing on your first upload?" (default yes).
2. If yes → direct them to [Play Console → Setup → App integrity → Request upload key reset](https://support.google.com/googleplay/android-developer/answer/9842756).
3. Once Google resets it, user generates a new keystore and uploads via
   **Project Settings → Mobile → Signing → Replace Android credentials**.
4. If no Play App Signing → confirm there is no recovery; new package id
   is the only path.

## 5. `MOBILE_SIGNING_KEY` compromise / rotation

This is the master key wrapping every user's signing material. Treat as
P0 — comparable to a DB password leak.

**Immediate (within 1 hour):**
1. Generate a new 32-byte key:
   `openssl rand -base64 32`
2. In Petal runtime env, set `MOBILE_SIGNING_KEY_NEXT` to the new value.
   Do **not** replace `MOBILE_SIGNING_KEY` yet.
3. Deploy. The mobile-signing helper reads both — decrypt with current,
   re-encrypt with NEXT on every read.
4. Run the re-wrap migration job (see §5.1) to walk every row in
   `mobile_signing_profiles`.

**Cut-over (after job completes — usually <10 min for current row count):**
5. Promote: `MOBILE_SIGNING_KEY = <new>`, delete `MOBILE_SIGNING_KEY_NEXT`.
6. Redeploy.
7. File incident report; rotate `CODEMAGIC_API_TOKEN` and
   `MOBILE_CODEMAGIC_WEBHOOK_SECRET` as defence in depth.

**If the leaked key escaped before any user uploads:** truncate the table
and notify affected users to re-upload — faster and provably clean.

### 5.1 Re-wrap migration job

Not yet automated as a one-click. Manual recipe:

```ts
// Run as a one-off server function (delete after).
const rows = await supabaseAdmin.from("mobile_signing_profiles").select("*");
for (const row of rows.data ?? []) {
  const fields = [
    "apple_p12_ciphertext",
    "apple_p12_password_ciphertext",
    "apple_provisioning_profile_ciphertext",
    "apple_app_store_connect_key_ciphertext",
    "android_keystore_ciphertext",
    "android_keystore_password_ciphertext",
    "android_key_password_ciphertext",
    "android_play_service_account_ciphertext",
  ] as const;
  const update: Record<string, string> = {};
  for (const f of fields) {
    if (!row[f]) continue;
    const plain = decryptWith(row[f], OLD_KEY);
    update[f] = encryptWith(plain, NEW_KEY);
  }
  await supabaseAdmin.from("mobile_signing_profiles")
    .update(update).eq("id", row.id);
}
```

TODO (post-launch): wrap the above in `/api/internal/admin/rewrap-signing`
gated by `BUILDER_SHARED_SECRET`, and add a Petal Cloud UI button.

## 6. Pre-launch checklist (signing-specific)

- [ ] `MOBILE_SIGNING_KEY` set, 32+ bytes, NOT the same value as any other env.
- [ ] `CODEMAGIC_API_TOKEN` and `CODEMAGIC_APP_ID` set; `GET /api/internal/health` returns `{ ok: true }`.
- [ ] Codemagic webhook secret matches `MOBILE_CODEMAGIC_WEBHOOK_SECRET`.
- [ ] Test build from a throwaway project: upload dummy Android keystore → trigger build → confirm signed AAB returned.
- [ ] Test re-wrap dry-run on a single row before any future key rotation.
- [ ] Backup procedure for `MOBILE_SIGNING_KEY` documented (1Password vault, 2 admins).
