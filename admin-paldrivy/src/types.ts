export interface Profile {
  id: string;
  name: string | null;
  email?: string;
  phone?: string | null;
  has_profile?: boolean;
  role: 'admin' | 'driver';
  currency_code: string | null;
  locale: string | null;
  country: string | null;
  city: string | null;
  state: string | null;
  worker_type: 'driver' | 'motoboy' | null;
  created_at?: string;
}

export interface Plan {
  id: string;
  name: string;
  description: string | null;
  price_cents: number;
  prices: Record<string, number>; // { BRL: 1990, USD: 499, GBP: 399 }
  interval: 'monthly' | 'yearly';
  features: string[];
  is_active: boolean;
  sort_order: number;
  created_at: string;
  subscriber_count?: number;
}

export type SubscriptionStatus = 'active' | 'trial' | 'complimentary' | 'cancelled' | 'expired';

export interface Subscription {
  id: string;
  user_id: string;
  plan_id: string;
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string | null; // null = lifetime
  cancelled_at: string | null;
  notes: string | null;
  created_at: string;
  profile?: Profile;
  plan?: Plan;
}

export interface DashboardStats {
  total_users: number;
  new_users_month: number;
  active_subscriptions: number;
  free_users: number;
  shifts_month: number;
  gross_month_cents: number;
}

export interface UserWithSubscription extends Profile {
  subscription: Subscription | null;
}

export interface LegalDocument {
  id: string;
  type: 'privacy_policy' | 'terms_of_use';
  version: string;
  title: string;
  content: string;
  is_active: boolean;
  published_at: string | null;
  created_at: string;
  created_by: string | null;
}

export interface UserConsent {
  id: string;
  user_id: string;
  document_id: string;
  accepted_at: string;
  ip_address: string | null;
  user_agent: string | null;
  profile?: Profile;
  document?: LegalDocument;
}

export interface ConsentStats {
  document_id: string;
  type: string;
  version: string;
  total_consents: number;
  latest_consent: string | null;
}

export interface CountryStat {
  country: string;
  total_users: number;
  new_users_month: number;
  active_subs: number;
  trial_subs: number;
  complimentary_subs: number;
  free_users: number;
  drivers: number;
  motoboys: number;
  currency_code: string | null;
}

export interface PushFilters {
  planId?: string;
  status?: SubscriptionStatus | '';
  country?: string;
}

export interface PushBroadcast {
  id: string;
  title: string;
  body: string;
  filters: PushFilters;
  recipient_count: number;
  sent_by: string | null;
  created_at: string;
}
