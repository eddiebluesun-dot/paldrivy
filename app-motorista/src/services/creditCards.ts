import { supabase } from '../lib/supabase';

export interface CreditCard {
  id: string;
  user_id: string;
  name: string;
  last_four?: string | null;
  limit_cents: number;
  closing_day: number;
  due_day: number;
  created_at: string;
}

export interface CreditCardInput {
  name: string;
  last_four?: string | null;
  limit_cents: number;
  closing_day: number;
  due_day: number;
}

export function nextOccurrence(day: number): Date {
  const now = new Date();
  const candidate = new Date(now.getFullYear(), now.getMonth(), day);
  if (candidate <= now) candidate.setMonth(candidate.getMonth() + 1);
  return candidate;
}

export async function getCreditCards(userId: string): Promise<CreditCard[]> {
  const { data, error } = await supabase
    .from('credit_cards')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as CreditCard[];
}

export async function createCreditCard(userId: string, input: CreditCardInput): Promise<CreditCard> {
  const { data, error } = await supabase
    .from('credit_cards')
    .insert({ user_id: userId, ...input })
    .select('*')
    .single();
  if (error) throw error;
  return data as CreditCard;
}

export async function updateCreditCard(id: string, input: CreditCardInput): Promise<void> {
  const { error } = await supabase.from('credit_cards').update(input).eq('id', id);
  if (error) throw error;
}

export async function deleteCreditCard(id: string): Promise<void> {
  const { error } = await supabase.from('credit_cards').delete().eq('id', id);
  if (error) throw error;
}
