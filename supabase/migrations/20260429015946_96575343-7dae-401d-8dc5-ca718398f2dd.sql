-- Add the $10 backend-floor pack and retire the $1 starter.

INSERT INTO public.runtime_topup_packs
  (code, label, amount_cents, currency_code, display_amount_minor, sort_order, is_active)
VALUES
  ('runtime_backend_floor', '₦15,000', 1000, 'NGN', 1500000, 2, true)
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label,
      amount_cents = EXCLUDED.amount_cents,
      currency_code = EXCLUDED.currency_code,
      display_amount_minor = EXCLUDED.display_amount_minor,
      sort_order = EXCLUDED.sort_order,
      is_active = EXCLUDED.is_active;

-- Bump runtime_standard sort to keep ordering: starter (deactivated), backend_floor=2, standard=3, pro=4
UPDATE public.runtime_topup_packs SET sort_order = 3 WHERE code = 'runtime_standard';
UPDATE public.runtime_topup_packs SET sort_order = 4 WHERE code = 'runtime_pro';

-- Retire the $1 starter — it can't enable a backend or even cover one month of free grant.
UPDATE public.runtime_topup_packs SET is_active = false WHERE code = 'runtime_starter';