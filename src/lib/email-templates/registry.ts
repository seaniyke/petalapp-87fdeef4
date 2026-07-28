import type { ComponentType } from 'react'

export interface TemplateEntry {
  component: ComponentType<any>
  subject: string | ((data: Record<string, any>) => string)
  displayName?: string
  previewData?: Record<string, any>
  /** Fixed recipient — overrides caller-provided recipientEmail when set. */
  to?: string
}

/**
 * Template registry — maps template names to their React Email components.
 * Import and register new templates here after creating them in this directory.
 */
import { template as backendRenewalReminder } from './backend-renewal-reminder'
import { template as paymentSuccess } from './payment-success'
import { template as paymentFailed } from './payment-failed'
import { template as subscriptionRenewalReminder } from './subscription-renewal-reminder'
import { template as subscriptionPaymentFailedFollowup } from './subscription-payment-failed-followup'
import { template as subscriptionExpired } from './subscription-expired'
import { template as waitlistConfirmation } from './waitlist-confirmation'
import { template as waitlistAnnouncement } from './waitlist-announcement'
import { template as waitlistInvite } from './waitlist-invite'

export const TEMPLATES: Record<string, TemplateEntry> = {
  'backend-renewal-reminder': backendRenewalReminder,
  'payment-success': paymentSuccess,
  'payment-failed': paymentFailed,
  'subscription-renewal-reminder': subscriptionRenewalReminder,
  'subscription-payment-failed-followup': subscriptionPaymentFailedFollowup,
  'subscription-expired': subscriptionExpired,
  'waitlist-confirmation': waitlistConfirmation,
  'waitlist-announcement': waitlistAnnouncement,
  'waitlist-invite': waitlistInvite,
}
