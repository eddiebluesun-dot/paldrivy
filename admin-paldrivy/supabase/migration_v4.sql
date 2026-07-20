-- Add multi-currency prices to plans
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS prices JSONB NOT NULL DEFAULT '{}';

-- Migrate existing price_cents → prices.BRL
UPDATE plans
SET prices = jsonb_build_object('BRL', price_cents)
WHERE price_cents > 0 AND (prices = '{}' OR prices IS NULL);
