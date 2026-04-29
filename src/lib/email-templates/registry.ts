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

export const TEMPLATES: Record<string, TemplateEntry> = {
  'backend-renewal-reminder': backendRenewalReminder,
  'payment-success': paymentSuccess,
  'payment-failed': paymentFailed,
}
