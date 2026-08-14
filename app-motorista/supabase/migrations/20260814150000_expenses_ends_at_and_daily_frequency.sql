-- Add ends_at: when set, this recurring expense stops being allocated
-- for any day >= ends_at. Days before ends_at are unaffected (forward-only).
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS ends_at DATE;

-- Allow 'daily' as a recurring_frequency value (a daily rate contributes
-- its full amount every working day, no period division).
ALTER TABLE expenses
  DROP CONSTRAINT IF EXISTS expenses_recurring_frequency_check;

ALTER TABLE expenses
  ADD CONSTRAINT expenses_recurring_frequency_check
  CHECK (recurring_frequency IN ('daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual'));
