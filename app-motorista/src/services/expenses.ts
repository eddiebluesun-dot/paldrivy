import { supabase } from '../lib/supabase';

export interface Expense {
  id: string;
  user_id: string;
  category: string;      // one of the expense.* values e.g. "expense.rent"
  amount_cents: number;
  expense_date: string;  // YYYY-MM-DD
  description: string | null;
  recurring: boolean;
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
