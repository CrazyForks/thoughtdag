import { useState } from 'react';
import { Download, Plus, Trash2 } from 'lucide-react';
import { useUiStore } from '../../lib/ui-store';
import { downloadFile } from '../../lib/export';
import { generateId } from '../../utils';
import { useT, fmt } from '../../i18n';

// The curation surface of ThoughtDAG's own memory (the ChatGPT-style list):
// the ONLY standing place to edit what rides the system layer. Writes
// announce themselves via toasts elsewhere; here entries paste in as plain
// lines and export as a JSON file you own. Rendered inside the memory page.

export default function MemoryLibrary() {
  const t = useT();
  const memories = useUiStore((s) => s.memories);
  const setMemories = useUiStore((s) => s.setMemories);
  const enabled = useUiStore((s) => s.memoryEnabled);
  const setEnabled = useUiStore((s) => s.setMemoryEnabled);
  const [importing, setImporting] = useState(false);
  const [importText, setImportText] = useState('');

  const kindLabel = (k: string) => t(k === 'auto' ? 'memory.kindAuto' : k === 'imported' ? 'memory.kindImported' : 'memory.kindManual');
  const catBadge = (c?: string) =>
    c === 'preference' ? { label: t('memory.catPreference'), cls: 'bg-sky-500/10 text-sky-600' }
    : c === 'identity' ? { label: t('memory.catIdentity'), cls: 'bg-violet-500/10 text-violet-600' }
    : c === 'project' ? { label: t('memory.catProject'), cls: 'bg-amber-500/10 text-amber-600' }
    : null;

  const add = () => setMemories([...memories, { id: generateId(), text: '', kind: 'manual', at: new Date().toISOString() }]);
  const commit = (id: string, text: string) => {
    const v = text.trim();
    if (!v) { setMemories(memories.filter((m) => m.id !== id)); return; }
    setMemories(memories.map((m) => (m.id === id ? { ...m, text: v } : m)));
  };
  const doImport = () => {
    const lines = importText.split('\n').map((l) => l.replace(/^[-•\s]+/, '').trim()).filter((l) => l.length > 1);
    if (lines.length === 0) { setImporting(false); return; }
    const now = new Date().toISOString();
    setMemories([...memories, ...lines.map((text) => ({ id: generateId(), text, kind: 'imported' as const, at: now }))]);
    setImportText('');
    setImporting(false);
  };
  const doExport = () => downloadFile('thoughtdag-memory.json', JSON.stringify(memories, null, 2), 'application/json');

  return (
    <section className="flex flex-col min-h-0" data-memory-library>
      <div className="flex items-center gap-2 pb-2">
        <span className="text-sm font-semibold text-ink">{t('memory.mine')}</span>
        <span className="text-2xs text-ink-faint flex-1">{fmt(t('memory.hint'), { n: memories.length })}</span>
        <button
          onClick={() => setEnabled(!enabled)}
          title={t('caps.memoryTitle')}
          className={`text-2xs px-2.5 py-1 rounded-full transition-colors shrink-0 ${enabled ? 'bg-accent/10 text-accent' : 'bg-wash text-ink-faint'}`}
          data-memory-switch={enabled ? 'on' : 'off'}
        >
          {enabled ? t('caps.on') : t('caps.off')}
        </button>
      </div>
      <div className="space-y-2">
        {memories.length === 0 && !importing && (
          <p className="text-xs text-ink-faint italic py-2">{t('memory.empty')}</p>
        )}
        {memories.map((m) => (
          <div key={m.id} className="border border-line rounded-xl px-3 py-2 bg-surface group" data-memory-entry>
            <div className="flex items-start gap-2">
              <textarea
                defaultValue={m.text}
                onBlur={(e) => commit(m.id, e.target.value)}
                rows={1}
                className="flex-1 text-sm text-ink bg-transparent focus:outline-none resize-y leading-relaxed"
              />
              <button
                onClick={() => setMemories(memories.filter((x) => x.id !== m.id))}
                title={t('common.delete')}
                className="text-ink-faint hover:text-red-500 w-6 h-6 rounded-full flex items-center justify-center transition-colors shrink-0 opacity-0 group-hover:opacity-100"
              >
                <Trash2 size={13} strokeWidth={1.75} />
              </button>
            </div>
            <p className="text-2xs text-ink-faint mt-1 font-mono flex items-center gap-1.5 flex-wrap">
              {(() => { const b = catBadge(m.category); return b ? <span className={`px-1.5 py-px rounded-full font-sans ${b.cls}`}>{b.label}</span> : null; })()}
              <span>{kindLabel(m.kind)}{m.project ? ` · ${m.project}` : ''} · {m.at.slice(0, 10)}</span>
            </p>
          </div>
        ))}
        {importing && (
          <div className="border border-accent/40 rounded-xl px-3 py-2 bg-surface space-y-2">
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={t('memory.importPlaceholder')}
              rows={5}
              autoFocus
              className="w-full text-xs text-ink bg-transparent focus:outline-none resize-y leading-relaxed placeholder-ink-faint"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setImporting(false)} className="text-xs text-ink-muted hover:text-ink px-3 py-1 rounded-lg hover:bg-wash transition-colors">{t('common.cancel')}</button>
              <button onClick={doImport} className="text-xs bg-accent text-white px-3 py-1 rounded-lg">{t('memory.importConfirm')}</button>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 pt-2">
        <button onClick={add} className="flex items-center gap-1.5 text-xs text-accent hover:bg-accent/10 px-3 py-1.5 rounded-lg transition-colors" data-memory-add>
          <Plus size={14} strokeWidth={1.75} /> {t('memory.add')}
        </button>
        <button onClick={() => setImporting(true)} className="text-xs text-ink-muted hover:text-ink hover:bg-wash px-3 py-1.5 rounded-lg transition-colors">
          {t('memory.import')}
        </button>
        <div className="flex-1" />
        {memories.length > 0 && (
          <button onClick={doExport} className="flex items-center gap-1.5 text-2xs text-ink-faint hover:text-ink-muted transition-colors" title={t('memory.exportTitle')}>
            <Download size={12} strokeWidth={1.75} /> {t('memory.export')}
          </button>
        )}
      </div>
    </section>
  );
}
