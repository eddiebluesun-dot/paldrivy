import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { getLegalDocuments, createDocumentVersion, publishDocument, getConsentStats } from '../services/admin';
import type { LegalDocument, ConsentStats } from '../types';

const TYPE_LABEL: Record<string, string> = {
  privacy_policy: 'Política de Privacidade',
  terms_of_use: 'Termos de Uso',
};

function fmtDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface NewVersionModalProps {
  type: 'privacy_policy' | 'terms_of_use';
  onSave: (data: { type: 'privacy_policy' | 'terms_of_use'; version: string; title: string; content: string }) => Promise<void>;
  onCancel: () => void;
}

function NewVersionModal({ type, onSave, onCancel }: NewVersionModalProps) {
  const [version, setVersion] = useState('');
  const [title, setTitle] = useState(TYPE_LABEL[type]);
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await onSave({ type, version, title, content });
    setSaving(false);
  }

  const inputCls = "w-full bg-[#0B1221] border border-white/15 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/40";

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
      <div className="bg-[#111827] border border-white/10 rounded-2xl shadow-xl w-full max-w-2xl p-6 flex flex-col max-h-[90vh]">
        <h2 className="text-base font-semibold text-white mb-4">Nova versão — {TYPE_LABEL[type]}</h2>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 gap-4 min-h-0">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1">Versão (ex: 1.1)</label>
              <input required value={version} onChange={e => setVersion(e.target.value)} placeholder="1.1"
                className={inputCls} />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-400 mb-1">Título</label>
              <input required value={title} onChange={e => setTitle(e.target.value)}
                className={inputCls} />
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <label className="block text-xs font-medium text-gray-400 mb-1">Conteúdo (HTML)</label>
            <textarea required value={content} onChange={e => setContent(e.target.value)}
              className={`${inputCls} h-full min-h-[200px] font-mono resize-none`} />
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={onCancel}
              className="flex-1 border border-white/15 text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-white/5">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 bg-[#F59E0B] text-[#0B1221] py-2 rounded-lg text-sm font-bold hover:bg-[#D97706] disabled:opacity-60">
              {saving ? 'Salvando...' : 'Salvar (rascunho)'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DocSectionProps {
  type: 'privacy_policy' | 'terms_of_use';
  docs: LegalDocument[];
  stats: ConsentStats[];
  onPublish: (id: string) => Promise<void>;
  onNewVersion: () => void;
}

function DocSection({ type, docs, stats, onPublish, onNewVersion }: DocSectionProps) {
  const typeDocs = docs.filter(d => d.type === type).sort((a, b) =>
    new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );
  const active = typeDocs.find(d => d.is_active);
  const [preview, setPreview] = useState<LegalDocument | null>(active ?? null);
  const [publishing, setPublishing] = useState('');

  const statMap = new Map(stats.map(s => [s.document_id, s]));

  async function handlePublish(id: string) {
    setPublishing(id);
    await onPublish(id);
    setPublishing('');
  }

  return (
    <div className="bg-[#111827] rounded-xl border border-white/8 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/8">
        <h2 className="font-semibold text-white">{TYPE_LABEL[type]}</h2>
        <button onClick={onNewVersion}
          className="bg-[#F59E0B] text-[#0B1221] px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-[#D97706]">
          + Nova versão
        </button>
      </div>

      <div className="flex divide-x divide-white/8" style={{ minHeight: 320 }}>
        <div className="w-64 flex-shrink-0 overflow-y-auto">
          {typeDocs.length === 0 ? (
            <p className="text-xs text-gray-500 p-4">Nenhuma versão</p>
          ) : typeDocs.map(doc => {
            const s = statMap.get(doc.id);
            return (
              <button key={doc.id} onClick={() => setPreview(doc)}
                className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/5 transition-colors ${preview?.id === doc.id ? 'bg-[#F59E0B]/8' : ''}`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-white">v{doc.version}</span>
                  {doc.is_active && (
                    <span className="text-xs bg-emerald-500/15 text-emerald-400 px-1.5 py-0.5 rounded-full font-medium">Ativa</span>
                  )}
                </div>
                <p className="text-xs text-gray-600 mt-0.5">{fmtDate(doc.published_at ?? doc.created_at)}</p>
                {s && <p className="text-xs text-[#F59E0B]/70 mt-0.5">{s.total_consents} aceite(s)</p>}
                {!doc.is_active && (
                  <button onClick={e => { e.stopPropagation(); handlePublish(doc.id); }}
                    disabled={publishing === doc.id}
                    className="mt-1.5 text-xs text-[#F59E0B] hover:underline disabled:opacity-50">
                    {publishing === doc.id ? 'Publicando...' : 'Publicar'}
                  </button>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {preview ? (
            <div
              className="prose prose-sm prose-invert max-w-none text-gray-300"
              dangerouslySetInnerHTML={{ __html: preview.content }}
            />
          ) : (
            <p className="text-gray-500 text-sm">Selecione uma versão</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LegalDocs() {
  const [docs, setDocs] = useState<LegalDocument[]>([]);
  const [stats, setStats] = useState<ConsentStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [newVersionType, setNewVersionType] = useState<'privacy_policy' | 'terms_of_use' | null>(null);

  async function load() {
    setLoading(true);
    const [d, s] = await Promise.all([getLegalDocuments(), getConsentStats()]);
    setDocs(d);
    setStats(s);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handlePublish(id: string) {
    await publishDocument(id);
    load();
  }

  async function handleNewVersion(data: Parameters<typeof createDocumentVersion>[0]) {
    await createDocumentVersion(data);
    setNewVersionType(null);
    load();
  }

  const totalConsents = stats.reduce((s, c) => s + c.total_consents, 0);

  return (
    <Layout title="Legal / LGPD">
      {loading ? (
        <div className="text-gray-500 py-8 text-center">Carregando...</div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-[#111827] rounded-xl border border-white/8 p-4">
              <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Total de aceites</p>
              <p className="text-2xl font-bold text-[#F59E0B] mt-1 tabular-nums">{totalConsents}</p>
            </div>
            {(['privacy_policy', 'terms_of_use'] as const).map(t => {
              const s = stats.find(x => x.type === t);
              const active = docs.find(d => d.type === t && d.is_active);
              return (
                <div key={t} className="bg-[#111827] rounded-xl border border-white/8 p-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">{TYPE_LABEL[t]}</p>
                  <p className="text-sm font-semibold text-white mt-1">
                    {active ? `v${active.version} ativa` : 'Sem versão ativa'}
                  </p>
                  <p className="text-xs text-gray-600">{s?.total_consents ?? 0} aceite(s)</p>
                </div>
              );
            })}
          </div>

          {(['privacy_policy', 'terms_of_use'] as const).map(type => (
            <DocSection
              key={type}
              type={type}
              docs={docs}
              stats={stats}
              onPublish={handlePublish}
              onNewVersion={() => setNewVersionType(type)}
            />
          ))}
        </div>
      )}

      {newVersionType && (
        <NewVersionModal
          type={newVersionType}
          onSave={handleNewVersion}
          onCancel={() => setNewVersionType(null)}
        />
      )}
    </Layout>
  );
}
