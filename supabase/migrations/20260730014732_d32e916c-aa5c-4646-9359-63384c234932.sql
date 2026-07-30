ALTER TABLE public.coffee_tips
  ADD COLUMN IF NOT EXISTS method text NOT NULL DEFAULT 'card',
  ADD COLUMN IF NOT EXISTS chain text,
  ADD COLUMN IF NOT EXISTS wallet_address text,
  ADD COLUMN IF NOT EXISTS tx_hash text;
CREATE INDEX IF NOT EXISTS coffee_tips_method_idx ON public.coffee_tips (method);