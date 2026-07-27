import { supabase } from '../lib/supabase';

export interface LegalDoc {
  id: string;
  type: 'privacy_policy' | 'terms_of_use';
  version: string;
  title: string;
  content: string;
}

export async function getActiveLegalDocs(): Promise<LegalDoc[]> {
  const { data, error } = await supabase
    .from('legal_documents')
    .select('id, type, version, title, content')
    .eq('is_active', true);
  if (error) throw error;
  return (data ?? []) as LegalDoc[];
}

export async function recordConsents(docs: LegalDoc[]): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : null;

  const { error } = await supabase.from('user_consents').upsert(
    docs.map(doc => ({
      user_id: user.id,
      document_id: doc.id,
      accepted_at: new Date().toISOString(),
      user_agent: userAgent,
    })),
    { onConflict: 'user_id,document_id' }
  );
  if (error) throw error;
}

export async function hasPendingConsents(userId: string): Promise<boolean> {
  const { data: activeDocs } = await supabase
    .from('legal_documents')
    .select('id')
    .eq('is_active', true);

  if (!activeDocs?.length) return false;

  const activeIds = activeDocs.map(d => d.id);

  const { data: existing } = await supabase
    .from('user_consents')
    .select('document_id')
    .eq('user_id', userId)
    .in('document_id', activeIds);

  return (existing?.length ?? 0) < activeIds.length;
}
