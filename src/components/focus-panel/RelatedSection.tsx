import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Link2, Loader2, Sparkles, Tags, X } from 'lucide-react';
import { whyBridge, hasWhy } from '../../lib/why-bridge';
import { recallTerms } from '../../lib/recall';
import { expandTerms, topicsOf, TOPIC_BAR } from '../../lib/topics';
import { judgeAvailable } from '../../lib/judge';
import { useUiStore } from '../../lib/ui-store';
import { useProjects } from '../../store/projects';
import { HitCards } from '../ui/RecallResults';
import { useT, fmt } from '../../i18n';

// On demand, for one node: the past conversations related to it. The
// node's own terms start the search; the person edits them, asks the chat
// model for more (kept only when the index knows them), or switches to
// topics — the judge says which topics the node is about, and the labelled
// turns come up. Every hit can be opened in its mirror or cited into the
// node. Nothing here enters the context by itself.

const LIMIT = 40;
const keyOf = (h: WhyFindHit) => `${h.session}#${h.turn}`;

export default function RelatedSection({ question, answer }: { question: string; answer: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [terms, setTerms] = useState<string[]>(() => recallTerms(question));
  const [input, setInput] = useState('');
  const [suggested, setSuggested] = useState<{ term: string; count: number }[] | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [table, setTable] = useState<WhyTopics['topics'] | null>(null);
  const [about, setAbout] = useState<Record<string, number> | null>(null);
  const [judging, setJudging] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [hits, setHits] = useState<(WhyFindHit & { topics?: Record<string, number> })[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeId = useProjects((s) => s.activeId);
  const judgeCfg = useUiStore((s) => s.judge);
  const hasJudge = judgeAvailable(judgeCfg);

  useEffect(() => {
    if (!open || table) return;
    const b = whyBridge(); if (!b) return;
    b.topics().then((i) => setTable(i.labeled ? i.topics : [])).catch(() => setTable([]));
  }, [open, table]);

  useEffect(() => {
    if (!open) return;
    const b = whyBridge(); if (!b) return;
    if (!terms.length && !picked.length) { setHits([]); return; }
    let alive = true;
    setBusy(true);
    const id = window.setTimeout(async () => {
      const found = new Map<string, WhyFindHit & { topics?: Record<string, number>; score: number }>();
      const add = (h: WhyFindHit & { topics?: Record<string, number> }, w: number) => {
        if (h.runner === 'thoughtdag' && h.session === activeId) return;
        const k = keyOf(h);
        const cur = found.get(k);
        if (cur) { cur.score += w; if (h.topics) cur.topics = { ...cur.topics, ...h.topics }; } else found.set(k, { ...h, score: w });
      };
      await Promise.all([
        ...terms.map((term) => b.find(term, { limit: 30 }).then((r) => r.hits.forEach((h) => add(h, 1))).catch(() => undefined)),
        picked.length ? b.byTopic(picked, { limit: 40 }).then((r) => r.hits.forEach((h) => add(h, 1))).catch(() => undefined) : Promise.resolve(),
      ]);
      if (!alive) return;
      setHits([...found.values()].sort((a, c) => c.score - a.score || (c.at ?? '').localeCompare(a.at ?? '')).slice(0, LIMIT));
      setBusy(false);
    }, 300);
    return () => { alive = false; window.clearTimeout(id); };
  }, [open, terms, picked, activeId]);

  if (!hasWhy()) return null;

  const addTerm = (term: string) => { const v = term.trim(); if (!v || terms.some((x) => x.toLowerCase() === v.toLowerCase())) return; setTerms([...terms, v]); setSuggested((s) => s?.filter((x) => x.term !== v) ?? null); };
  const expand = async () => {
    setExpanding(true); setError(null);
    try { setSuggested(await expandTerms(question, answer, terms)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setExpanding(false); }
  };
  const byTopic = async () => {
    if (!table?.length) return;
    setJudging(true); setError(null);
    try {
      const of = await topicsOf(`${question}\n\n${answer}`, table);
      setAbout(of);
      setPicked(table.filter((x) => (of[x.id] ?? 0) >= TOPIC_BAR).map((x) => x.id));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setJudging(false); }
  };
  const togglePick = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  return (
    <section className="px-4 py-3 border-b border-line" data-related-section>
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 text-left" data-related-toggle>
        {open ? <ChevronDown size={14} strokeWidth={1.75} className="text-ink-faint" /> : <ChevronRight size={14} strokeWidth={1.75} className="text-ink-faint" />}
        <Link2 size={14} strokeWidth={1.75} className="text-accent" />
        <span className="text-xs font-medium text-ink flex-1">{t('panel.related')}</span>
        {open && hits && <span className="text-2xs text-ink-faint font-mono" data-related-count>{fmt(t('panel.relatedCount'), { n: hits.length })}</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-2xs text-ink-faint leading-relaxed">{t('panel.relatedHint')}</p>
          <div className="flex flex-wrap items-center gap-1" data-related-terms>
            <span className="text-2xs text-ink-muted mr-1">{t('panel.relatedTerms')}</span>
            {terms.map((term) => (
              <span key={term} className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full border border-line bg-wash text-ink" data-related-term={term}>
                {term}
                <button onClick={() => setTerms(terms.filter((x) => x !== term))} className="text-ink-faint hover:text-ink" title={t('panel.recallExclude')}><X size={10} /></button>
              </span>
            ))}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTerm(input); setInput(''); } }}
              placeholder={t('panel.relatedAdd')}
              className="text-2xs bg-transparent border-b border-line focus:outline-none focus:border-accent px-1 py-0.5 w-[110px] text-ink placeholder:text-ink-faint"
              data-related-input
            />
            <button onClick={() => void expand()} disabled={expanding} className="text-2xs text-accent hover:bg-accent/10 px-1.5 py-0.5 rounded-md disabled:opacity-50 flex items-center gap-1" data-related-expand>
              {expanding ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} strokeWidth={1.75} />} {expanding ? t('panel.relatedExpanding') : t('panel.relatedExpand')}
            </button>
          </div>
          {suggested && (
            <div className="flex flex-wrap items-center gap-1" data-related-suggested>
              <span className="text-2xs text-ink-faint w-full">{suggested.length ? t('panel.relatedSuggested') : t('panel.relatedNoSuggest')}</span>
              {suggested.map((s) => (
                <button key={s.term} onClick={() => addTerm(s.term)} className="text-2xs px-2 py-0.5 rounded-full border border-dashed border-accent/50 text-accent hover:bg-accent/10" data-related-suggest={s.term}>+ {s.term} <span className="text-ink-faint">({s.count})</span></button>
              ))}
            </div>
          )}
          {!!table?.length && (
            <div className="flex flex-wrap items-center gap-1" data-related-topics>
              <button onClick={() => void byTopic()} disabled={judging || !hasJudge} title={hasJudge ? undefined : t('judge.none')} className="text-2xs text-accent hover:bg-accent/10 px-1.5 py-0.5 rounded-md disabled:opacity-50 flex items-center gap-1 mr-1" data-related-by-topic>
                {judging ? <Loader2 size={10} className="animate-spin" /> : <Tags size={10} strokeWidth={1.75} />} {judging ? t('panel.relatedJudging') : t('panel.relatedByTopic')}
              </button>
              {table.map((x) => {
                const p = about?.[x.id];
                const on = picked.includes(x.id);
                return (
                  <button key={x.id} onClick={() => togglePick(x.id)} title={x.description} className={`text-2xs px-2 py-0.5 rounded-full border transition-colors ${on ? 'bg-accent/10 border-accent/40 text-accent' : 'border-line text-ink-muted hover:bg-wash'}`} data-related-topic={x.id} aria-pressed={on}>
                    {x.name}{p !== undefined ? <span className="font-mono ml-1 opacity-70">{p.toFixed(2)}</span> : null}
                  </button>
                );
              })}
              {about && !picked.length && !judging && <span className="text-2xs text-ink-faint w-full">{t('panel.relatedTopicsNone')}</span>}
            </div>
          )}
          {error && <p className="text-2xs text-red-500">{error}</p>}
          <div className="nowheel">
            {busy && <div className="text-2xs text-ink-faint flex items-center gap-1 px-1"><Loader2 size={10} className="animate-spin" /> {t('recall.searching')}</div>}
            {!busy && hits && hits.length === 0 && (terms.length > 0 || picked.length > 0) && <p className="text-2xs text-ink-faint italic px-1" data-related-none>{t('panel.relatedNone')}</p>}
            {hits && hits.length > 0 && <HitCards hits={hits} extra={(h) => { const tp = (h as WhyFindHit & { topics?: Record<string, number> }).topics; return tp ? <span className="text-accent">{Object.entries(tp).map(([id, p]) => `${table?.find((x) => x.id === id)?.name ?? id} ${p.toFixed(2)}`).join(' · ')}</span> : null; }} />}
          </div>
        </div>
      )}
    </section>
  );
}
