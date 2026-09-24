import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ExternalLink, Loader2, Quote } from 'lucide-react';
import { whyBridge } from '../../lib/why-bridge';
import { citeHit, openHit } from '../../lib/recall';
import { useStore } from '../../store';
import { useT, fmt } from '../../i18n';

// The answer to "what did we say about X": the why layer's find, shown as
// two groups — memory entries and conversation turns — each hit with the
// words that matched. Two actions: Open follows a turn into its mirror
// (a memory entry unfolds in place instead), Cite quotes the hit onto the
// canvas as a note wired into the selected node. Exact words only, as the
// index is: the snippet shows why a hit is here.

const LIMIT = 40;
const when = (at: string | null): string => (at ? at.slice(0, 10) : '');
const keyOf = (h: WhyFindHit) => `${h.session}#${h.turn}`;

/** A list of hits with their two actions; shared by the search, the topic
 *  browser and the side panel's related conversations. */
export function HitCards({ hits, onOpened, extra }: { hits: WhyFindHit[]; onOpened?: () => void; extra?: (h: WhyFindHit) => ReactNode }) {
  const t = useT();
  const selectedNodeId = useStore((s) => s.selectedNodeId);
  const [unfolded, setUnfolded] = useState<Record<string, WhyRecalledTurn | 'loading'>>({});
  const [citing, setCiting] = useState<string | null>(null);
  const unfold = async (h: WhyFindHit) => {
    const k = keyOf(h);
    if (unfolded[k]) { setUnfolded((u) => { const n = { ...u }; delete n[k]; return n; }); return; }
    setUnfolded((u) => ({ ...u, [k]: 'loading' }));
    try { const r = await whyBridge()!.recall(h.session, h.turn); setUnfolded((u) => ({ ...u, [k]: r })); }
    catch { setUnfolded((u) => { const n = { ...u }; delete n[k]; return n; }); }
  };
  const open = async (h: WhyFindHit) => {
    if (h.kind === 'memory') { await unfold(h); return; }
    if (await openHit(h)) onOpened?.();
  };
  const cite = async (h: WhyFindHit) => {
    setCiting(keyOf(h));
    try { await citeHit(h, selectedNodeId); } finally { setCiting(null); }
  };
  return (
    <div className="space-y-1">
      {hits.map((h) => {
        const k = keyOf(h);
        const u = unfolded[k];
        return (
          <div key={k} className="border border-line rounded-xl px-3 py-2 bg-card hover:bg-wash/60 transition-colors" data-recall-hit={h.kind}>
            <div className="flex items-start gap-2">
              <button onClick={() => void open(h)} className="flex-1 min-w-0 text-left" title={h.kind === 'memory' ? h.file : h.open} data-recall-open>
                <div className="text-2xs text-ink-faint font-mono flex items-center gap-1.5 flex-wrap">
                  <span className="border border-line rounded px-1 py-px">{h.runner}</span>
                  <span className="truncate max-w-[260px]">{h.title}</span>
                  <span>#{h.turn}</span>
                  {h.at && <span>{when(h.at)}</span>}
                  {extra?.(h)}
                  {h.kind === 'memory' ? (u ? <ChevronDown size={11} /> : <ChevronRight size={11} />) : <ExternalLink size={11} />}
                </div>
                <div className="text-xs text-ink mt-0.5 leading-relaxed break-words">
                  <span className="text-ink-faint">{h.where}: </span>{h.snippet}
                </div>
              </button>
              <button
                onClick={() => void cite(h)}
                disabled={citing === k}
                className="shrink-0 flex items-center gap-1 text-2xs text-accent hover:bg-accent/10 px-2 py-1 rounded-lg transition-colors disabled:opacity-50"
                title={t('recall.cite')}
                data-recall-cite
              >
                {citing === k ? <Loader2 size={11} className="animate-spin" /> : <Quote size={11} strokeWidth={1.75} />} {t('recall.cite')}
              </button>
            </div>
            {u && (
              <div className="mt-2 border-t border-line/60 pt-2 text-xs text-ink-muted leading-relaxed whitespace-pre-wrap break-words max-h-[240px] overflow-y-auto" data-recall-unfolded>
                {u === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <><div className="font-medium text-ink mb-1">{u.question}</div>{u.response}</>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function RecallResults({ phrase, onOpened }: { phrase: string; onOpened?: () => void }) {
  const t = useT();
  const [result, setResult] = useState<WhyFindResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const bridge = whyBridge();
    if (!bridge) return;
    const q = phrase.trim();
    if (timer.current) window.clearTimeout(timer.current);
    if (q.length < 2) return; // nothing renders below two characters; the last result waits
    let alive = true;
    timer.current = window.setTimeout(() => {
      setBusy(true); setError(null);
      bridge.find(q, { limit: LIMIT })
        .then((r) => { if (alive) setResult(r); })
        .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
        .finally(() => { if (alive) setBusy(false); });
    }, 350);
    return () => { alive = false; if (timer.current) window.clearTimeout(timer.current); };
  }, [phrase]);

  if (!whyBridge()) return <p className="text-xs text-ink-faint italic px-1 py-2" data-recall-unavailable>{t('recall.unavailable')}</p>;
  if (phrase.trim().length < 2) return null;

  const groups: { key: 'memory' | 'turn'; label: string; hits: WhyFindHit[] }[] = result
    ? [
      { key: 'memory' as const, label: t('recall.memories'), hits: result.hits.filter((h) => h.kind === 'memory') },
      { key: 'turn' as const, label: t('recall.turns'), hits: result.hits.filter((h) => h.kind === 'turn') },
    ].filter((g) => g.hits.length > 0)
    : [];

  return (
    <section className="mb-4" data-recall-results>
      <div className="flex items-center gap-2 text-2xs text-ink-faint uppercase tracking-wide px-1 pb-1.5">
        {busy ? <span className="flex items-center gap-1.5"><Loader2 size={11} className="animate-spin" /> {t('recall.searching')}</span>
          : result ? <span data-recall-summary>{fmt(t('recall.summary'), { n: result.turns, m: result.sessions })}</span> : null}
        {error && <span className="text-red-500 normal-case tracking-normal">{error}</span>}
      </div>
      {result && result.hits.length === 0 && !busy && (
        <p className="text-xs text-ink-faint italic px-1 py-2" data-recall-none>{t('recall.none')}</p>
      )}
      {groups.map((g) => (
        <div key={g.key} className="mb-3" data-recall-group={g.key}>
          <div className="text-2xs font-medium text-ink-muted px-1 pb-1">{g.label} · {g.hits.length}</div>
          <HitCards hits={g.hits} onOpened={onOpened} />
        </div>
      ))}
      {result && result.turns > result.hits.length && (
        <p className="text-2xs text-ink-faint px-1">{fmt(t('recall.more'), { n: result.hits.length })}</p>
      )}
    </section>
  );
}
