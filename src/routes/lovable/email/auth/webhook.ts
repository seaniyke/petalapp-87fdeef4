import { parseEmailWebhookPayload } from '@lovable.dev/email-js'
import { WebhookError, verifyWebhookRequest } from '@lovable.dev/webhooks-js'
import { createClient } from '@supabase/supabase-js'
import { createFileRoute } from '@tanstack/react-router'

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: 'Confirm your email',
  invite: "You've been invited",
  magiclink: 'Your login link',
  recovery: 'Reset your password',
  email_change: 'Confirm your new email',
  reauthentication: 'Your verification code',
}

// Configuration
const SITE_NAME = "Petal"
const SENDER_DOMAIN = "notify.buildwithpetal.com"
const ROOT_DOMAIN = "buildwithpetal.com"
const FROM_DOMAIN = "buildwithpetal.com"

function redactEmail(email: string | null | undefined): string {
  if (!email) return '***'
  const [localPart, domain] = email.split('@')
  if (!localPart || !domain) return '***'
  return `${localPart[0]}***@${domain}`
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function renderAuthEmail(type: string, props: Record<string, string | undefined>) {
  const title = EMAIL_SUBJECTS[type] || 'Notification'
  const url = props.confirmationUrl || props.siteUrl || `https://${ROOT_DOMAIN}`
  // Only show the token for flows where the code itself is the verification mechanism
  const showToken = type === 'reauthentication'
  const token = showToken && props.token ? `<div style="font-size:28px;font-weight:600;letter-spacing:0.2em;background:#ffffff;border:1px solid #f1e6db;border-radius:12px;padding:18px 24px;text-align:center;margin:0 0 28px;">${escapeHtml(props.token)}</div>` : ''
  const introByType: Record<string, string> = {
    signup: `Welcome to ${SITE_NAME}. Please confirm ${props.recipient || 'your email'} to activate your account.`,
    invite: `You've been invited to join ${SITE_NAME}. Accept the invitation to create your account.`,
    magiclink: `Click the button below to sign in to ${SITE_NAME}. This link will expire shortly.`,
    recovery: `We received a request to reset the password for your ${SITE_NAME} account.`,
    email_change: `Confirm the requested email change for your ${SITE_NAME} account.`,
    reauthentication: `Use this verification code to continue with ${SITE_NAME}.`,
  }
  const ctaByType: Record<string, string> = {
    signup: 'Verify email',
    invite: 'Accept invitation',
    magiclink: 'Sign in',
    recovery: 'Reset password',
    email_change: 'Confirm email change',
    reauthentication: 'Open Petal',
  }
  const intro = introByType[type] || `You have a new notification from ${SITE_NAME}.`

  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#3a2a20;"><main style="max-width:480px;margin:40px auto;padding:40px 32px;background:#fffaf6;border:1px solid #f1e6db;border-radius:16px;"><p style="margin:0 0 28px;font-family:Georgia,serif;font-size:20px;font-weight:600;color:#2a1c14;">🌸 ${SITE_NAME}</p><h1 style="margin:0 0 16px;font-family:Georgia,serif;font-size:26px;line-height:1.2;color:#2a1c14;">${escapeHtml(title)}</h1><p style="margin:0 0 20px;font-size:15px;line-height:1.6;">${escapeHtml(intro)}</p>${token}<a href="${escapeHtml(url)}" style="display:inline-block;margin:8px 0 24px;padding:13px 24px;border-radius:12px;background:#e2674d;color:#fff;text-decoration:none;font-size:15px;font-weight:500;">${escapeHtml(ctaByType[type] || 'Open Petal')}</a><p style="margin:24px 0 0;padding-top:20px;border-top:1px solid #f1e6db;color:#a8978a;font-size:13px;line-height:1.5;">If you did not request this email, you can safely ignore it.</p></main></body></html>`
  const text = `${title}\n\n${intro}${props.token ? `\n\nCode: ${props.token}` : ''}\n\n${url}\n\nIf you did not request this email, you can safely ignore it.`

  return { html, text }
}

export const Route = createFileRoute("/lovable/email/auth/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = process.env.LOVABLE_API_KEY

        if (!apiKey) {
          console.error('LOVABLE_API_KEY not configured')
          return Response.json(
            { error: 'Server configuration error' },
            { status: 500 }
          )
        }

        // Verify signature + timestamp, then parse payload.
        let payload: any
        let run_id = ''
        try {
          const verified = await verifyWebhookRequest({
            req: request,
            secret: apiKey,
            parser: parseEmailWebhookPayload,
          })
          payload = verified.payload
          run_id = payload.run_id
        } catch (error) {
          if (error instanceof WebhookError) {
            switch (error.code) {
              case 'invalid_signature':
              case 'missing_timestamp':
              case 'invalid_timestamp':
              case 'stale_timestamp':
                console.error('Invalid webhook signature', { error: error.message })
                return Response.json(
                  { error: 'Invalid signature' },
                  { status: 401 }
                )
              case 'invalid_payload':
              case 'invalid_json':
                console.error('Invalid webhook payload', { error: error.message })
                return Response.json(
                  { error: 'Invalid webhook payload' },
                  { status: 400 }
                )
            }
          }

          console.error('Webhook verification failed', { error })
          return Response.json(
            { error: 'Invalid webhook payload' },
            { status: 400 }
          )
        }

        if (!run_id) {
          console.error('Webhook payload missing run_id')
          return Response.json(
            { error: 'Invalid webhook payload' },
            { status: 400 }
          )
        }

        if (payload.version !== '1') {
          console.error('Unsupported payload version', { version: payload.version, run_id })
          return Response.json(
            { error: `Unsupported payload version: ${payload.version}` },
            { status: 400 }
          )
        }

        // The email action type is in payload.data.action_type (e.g., "signup", "recovery")
        // payload.type is the hook event type ("auth")
        const emailType = payload.data.action_type
        console.log('Received auth event', {
          emailType,
          email_redacted: redactEmail(payload.data.email),
          run_id,
        })

        const emailSubject = EMAIL_SUBJECTS[emailType]
        if (!emailSubject) {
          console.error('Unknown email type', { emailType, run_id })
          return Response.json(
            { error: `Unknown email type: ${emailType}` },
            { status: 400 }
          )
        }

        // Build template props from payload.data (HookData structure)
        const templateProps = {
          siteName: SITE_NAME,
          siteUrl: `https://${ROOT_DOMAIN}`,
          recipient: payload.data.email,
          confirmationUrl: payload.data.url,
          token: payload.data.token,
          email: payload.data.email,
          newEmail: payload.data.new_email,
        }

        const { html, text } = renderAuthEmail(emailType, templateProps)

        // Enqueue email for async processing by the dispatcher (process-email-queue).
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !supabaseServiceKey) {
          console.error('Missing Supabase environment variables')
          return Response.json(
            { error: 'Server configuration error' },
            { status: 500 }
          )
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey)
        const messageId = crypto.randomUUID()

        // Log pending BEFORE enqueue so we have a record even if enqueue crashes
        await supabase.from('email_send_log').insert({
          message_id: messageId,
          template_name: emailType,
          recipient_email: payload.data.email,
          status: 'pending',
        })

        const { error: enqueueError } = await supabase.rpc('enqueue_email', {
          queue_name: 'auth_emails',
          payload: {
            run_id,
            message_id: messageId,
            to: payload.data.email,
            from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
            sender_domain: SENDER_DOMAIN,
            subject: emailSubject,
            html,
            text,
            purpose: 'transactional',
            label: emailType,
            queued_at: new Date().toISOString(),
          },
        })

        if (enqueueError) {
          console.error('Failed to enqueue auth email', { error: enqueueError, run_id, emailType })
          await supabase.from('email_send_log').insert({
            message_id: messageId,
            template_name: emailType,
            recipient_email: payload.data.email,
            status: 'failed',
            error_message: 'Failed to enqueue email',
          })
          return Response.json(
            { error: 'Failed to enqueue email' },
            { status: 500 }
          )
        }

        console.log('Auth email enqueued', {
          emailType,
          email_redacted: redactEmail(payload.data.email),
          run_id,
        })

        return Response.json({ success: true, queued: true })
      },
    },
  },
})
