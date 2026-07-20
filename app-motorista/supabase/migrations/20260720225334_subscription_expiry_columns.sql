alter table subscriptions
  add column expiry_warning_sent_at timestamptz,
  add column expiry_followup_sent_at timestamptz;
