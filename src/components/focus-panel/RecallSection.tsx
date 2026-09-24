import { useState } from 'react';
import { ChevronDown, ChevronRight, History, Loader2, X, RotateCcw } from 'lucide-react';
import { useStore } from '../../store';
import { recallSourceLine, recallTokens, recallMore } from '../../lib/recall';
import { useUiStore } from '../../lib/ui-store';
import { JUDGE_LABELS, type JudgeProviderId } from '../../lib/judge';
import { useT, fmt } from '../../i18n';
import type { RecallItem, RecallMeta } from '../../types';

// What recall brought into this node: each item quoted, priced and
// removable. What you read here is what the model read — an excluded item
// stays listed (struck through) and leaves the prompt on the next run.

export default function RecallSection({ nodeId, items, meta, recallOn }: { nodeId: string; items: RecallItem[] | undefined; meta?: RecallMeta; recallOn: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(true);
  const [unfolded, setUnfolded] = useState<string | null>(null);
  const [more, setMore] = useState<'idle' | 'busy' | 'none'>('idle');
  const recallLimit = useUiStore((s) => s.recallLimit);
  if (!recallOn && !items?.length) return null;
  const loadMore = async () => {
    setMore('busy');
    try { const n = await recallMore(nodeId); setMore(n === 0 ? 'none' : 'idle'); } catch { setMore('idle'); }
  };
  const toggle = (id: string) => {
    useStore.setState((s) => ({
      nodes: s.nodes.map((n) => (n.id === nodeId
        ? { ...n, data: { ...n.data, recallItems: (n.data.recallItems ?? []).map((i) => (i.id === id ? { ...i, excluded: !i.excluded } : i)) } }
        : n)),
    }));
  };
  const total = recallTokens(items);
  return (
    <section className="px-4 py-3 border-b border-line" data-recall-section>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-left">
        {open ? <ChevronDown size={14} strokeWidth={1.75} className="text-ink-faint" /> : <ChevronRight size={14} strokeWidth={1.75} className="text-ink-faint" />}
        <History size={14} strokeWidth={1.75} className="text-accent" />
        <span className="text-xs font-medium text-ink flex-1">{t('panel.recall')}</span>
        {!!items?.length && <span className="text-2xs text-ink-faint font-mono" data-recall-total>{fmt(t('panel.recallCount'), { n: items.filter((i) => !i.excluded).length, m: items.length })} · {total} tok</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-1">
          {!items && <p className="text-2xs text-ink-faint italic">{t('panel.recallEmpty')}</p>}
          {items && items.length === 0 && <p className="text-2xs text-ink-faint italic">{t('panel.recallNone')}</p>}
          {meta && (meta.corrections.length > 0 || meta.judge || meta.judgeError) && (
            <div className="text-2xs text-ink-faint space-y-0.5 pb-1" data-recall-meta>
              {meta.corrections.map((c) => <div key={c.from}>{fmt(t('panel.recallCorrected'), { a: c.from, b: c.to })}{c.p !== undefined ? ` · ${c.p.toFixed(2)}` : ''}</div>)}
              {meta.judge && <div>{fmt(t('panel.recallJudge'), { j: `${JUDGE_LABELS[meta.judge.provider as JudgeProviderId] ?? meta.judge.provider}${meta.judge.model ? ` · ${meta.judge.model}` : ''}` })} · {t(meta.judge.calibrated ? 'judge.calibrated' : 'judge.uncalibrated')} · {fmt(t('panel.recallPool'), { n: meta.pool, m: meta.total })}{meta.dropped ? ` · ${fmt(t('panel.recallDropped'), { n: meta.dropped })}` : ''}</div>}
              {meta.judgeError && <div className="text-amber-600">{fmt(t('panel.recallJudgeFailed'), { e: meta.judgeError })}</div>}
            </div>
          )}
          {(items ?? []).map((i) => (
            <div key={i.id} className={`rounded-lg border border-line/70 px-2 py-1.5 ${i.excluded ? 'opacity-50' : ''}`} data-recall-item={i.excluded ? 'excluded' : 'included'}>
              <div className="flex items-start gap-2">
                <button onClick={() => setUnfolded(unfolded === i.id ? null : i.id)} className="flex-1 min-w-0 text-left">
                  <div className={`text-2xs font-mono text-ink-faint truncate ${i.excluded ? 'line-through' : ''}`} title={i.file}>{recallSourceLine({ kind: i.kind, runner: i.runner, session: i.session, turn: i.turn, title: i.title, file: i.file, at: i.at, open: i.open, cwd: i.cwd })}</div>
                  <div className="text-2xs text-ink-muted mt-0.5 truncate">{i.relevance !== undefined && <span className="text-accent mr-1.5" data-recall-relevance>{fmt(t('panel.recallRelevance'), { p: i.relevance.toFixed(2) })}</span>}{fmt(t('panel.recallMatched'), { w: i.matched.join(' · ') })} · {i.tokens} tok</div>
                </button>
                <button
                  onClick={() => toggle(i.id)}
                  className="shrink-0 text-ink-faint hover:text-ink w-6 h-6 rounded-full flex items-center justify-center hover:bg-wash transition-colors"
                  title={i.excluded ? t('panel.recallInclude') : t('panel.recallExclude')}
                  data-recall-item-toggle
                >
                  {i.excluded ? <RotateCcw size={12} strokeWidth={1.75} /> : <X size={12} strokeWidth={1.75} />}
                </button>
              </div>
              {unfolded === i.id && (
                <div className="mt-1.5 text-2xs text-ink-muted leading-relaxed whitespace-pre-wrap break-words max-h-[220px] overflow-y-auto border-l-2 border-line pl-2 nowheel" data-recall-item-text>{i.text}</div>
              )}
            </div>
          ))}
          {items && items.length > 0 && (
            <button onClick={() => void loadMore()} disabled={more !== 'idle'} className="text-2xs text-accent hover:bg-accent/10 px-2 py-1 rounded-md disabled:opacity-50 flex items-center gap-1" data-recall-more>
              {more === 'busy' && <Loader2 size={11} className="animate-spin" />}
              {more === 'none' ? t('panel.recallNoMore') : fmt(t('panel.recallMore'), { n: recallLimit })}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
