import { supabase } from '../lib/supabase';

export type RecurringFrequency = 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'annual';

export interface Expense {
  id: string;
  user_id: string;
  category: string;
  amount_cents: number;
  expense_date: string;  // YYYY-MM-DD
  description: string | null;
  recurring: boolean;
  recurring_frequency: RecurringFrequency | null;
}

export async function getExpenses(
  userId: string,
  limit = 60
): Promise<Expense[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*')
    .eq('user_id', userId)
    .order('expense_date', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function addExpense(
  expense: Omit<Expense, 'id'>
): Promise<void> {
  const { error } = await supabase.from('expenses').insert(expense);
  if (error) throw error;
}

export async function updateExpense(
  id: string,
  patch: Partial<Omit<Expense, 'id' | 'user_id'>>
): Promise<void> {
  const { error } = await supabase.from('expenses').update(patch).eq('id', id);
  if (error) throw error;
}

export async function deleteExpense(id: string): Promise<void> {
  const { error } = await supabase.from('expenses').delete().eq('id', id);
  if (error) throw error;
}

// Used to guard against duplicate auto-created expenses (e.g. the
// "Adicionar como despesa" rental km-overage action): true when this user
// already has a `category` expense dated on/after `sinceDate` (YYYY-MM-DD).
export async function hasExpenseSince(
  userId: string,
  category: string,
  sinceDate: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('expenses')
    .select('id')
    .eq('user_id', userId)
    .eq('category', category)
    .gte('expense_date', sinceDate)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}
