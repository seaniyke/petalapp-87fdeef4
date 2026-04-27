import { createFileRoute } from '@tanstack/react-router'

const EMAIL_TEMPLATE_TITLES: Record<string, string> = {
  signup: 'Confirm your email',
  invite: "You're invited",
  magiclink: 'Sign in to Petal',
  recovery: 'Reset your password',
  email_change: 'Confirm your new email',
  reauthentication: 'Verification code',
}

// Configuration
const SITE_NAME = "Petal"
const ROOT_DOMAIN = "buildwithpetal.com"

// Sample data for preview mode ONLY (not used in actual email sending).
// URLs are baked in at scaffold time from the project's real data.
// The sample email uses a fixed placeholder (RFC 6761 .test TLD) so the Go backend
// can always find-and-replace it with the actual recipient when sending test emails,
// even if the project's domain has changed since the template was scaffolded.
const SAMPLE_PROJECT_URL = "https://petalapp.lovable.app"
const SAMPLE_EMAIL = "user@example.test"
const SAMPLE_DATA: Record<string, object> = {
  signup: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    recipient: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  magiclink: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  recovery: {
    siteName: SITE_NAME,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  invite: {
    siteName: SITE_NAME,
    siteUrl: SAMPLE_PROJECT_URL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  email_change: {
    siteName: SITE_NAME,
    email: SAMPLE_EMAIL,
    newEmail: SAMPLE_EMAIL,
    confirmationUrl: SAMPLE_PROJECT_URL,
  },
  reauthentication: {
    token: '123456',
  },
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderPreviewHtml(type: string) {
  const title = EMAIL_TEMPLATE_TITLES[type]
  const sampleData = JSON.stringify(SAMPLE_DATA[type] || {}, null, 2)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)} · ${SITE_NAME}</title>
  </head>
  <body style="margin:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#3a2a20;">
    <main style="max-width:480px;margin:40px auto;padding:40px 32px;background:#fffaf6;border:1px solid #f1e6db;border-radius:16px;">
      <p style="margin:0 0 28px;font-family:Georgia,serif;font-size:20px;font-weight:600;color:#2a1c14;">🌸 ${SITE_NAME}</p>
      <h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:26px;line-height:1.2;color:#2a1c14;">${escapeHtml(title)}</h1>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">This is a lightweight preview placeholder for the ${escapeHtml(type)} email template.</p>
      <a href="${SAMPLE_PROJECT_URL}" style="display:inline-block;margin:8px 0 24px;padding:13px 24px;border-radius:12px;background:#e2674d;color:#fff;text-decoration:none;font-size:15px;font-weight:500;">Open ${SITE_NAME}</a>
      <pre style="white-space:pre-wrap;overflow:auto;margin:0;padding:16px;border:1px solid #f1e6db;border-radius:12px;background:#fff;color:#8a7568;font-size:12px;line-height:1.5;">${escapeHtml(sampleData)}</pre>
    </main>
  </body>
</html>`
}

export const Route = createFileRoute("/lovable/email/auth/preview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY

        if (!apiKey) {
          return Response.json(
            { error: 'Server configuration error' },
            { status: 500 }
          )
        }

        // Verify the caller is authorized with LOVABLE_API_KEY
        const authHeader = request.headers.get('Authorization')
        if (!authHeader || authHeader !== `Bearer ${apiKey}`) {
          return Response.json({ error: 'Unauthorized' }, { status: 401 })
        }

        let type: string
        try {
          const body = await request.json()
          type = body.type
        } catch {
          return Response.json(
            { error: 'Invalid JSON in request body' },
            { status: 400 }
          )
        }

        const title = EMAIL_TEMPLATE_TITLES[type]

        if (!title) {
          return Response.json(
            { error: `Unknown email type: ${type}` },
            { status: 400 }
          )
        }

        const html = renderPreviewHtml(type)

        return new Response(html, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      },
    },
  },
})
