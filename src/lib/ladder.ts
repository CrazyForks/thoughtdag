// The summary ladder: one node, four nested texts that stay legible at every
// zoom. topic ⊂ takeaway ⊂ brief ⊂ abstract, where "⊂" means the shorter
// level is the longer one with words deleted, so a plaque can morph between
// levels word by word (the words that stay slide, the words that arrive fade
// in) and the shorter level's words stay in darker ink inside the longer one.
//
// The model never WRITES the shorter levels; it SELECTS. Asked to write four
// nested texts under a "delete only" rule, models paraphrase (0 of 8 held in
// the prototype). Asked which sentences to keep and then which words to keep,
// nesting holds by construction. Two cheap calls per node:
//   1. from the answer's numbered sentences, pick 3 or 4 → abstract (verbatim)
//   2. from the abstract's numbered words, pick the indices kept at each level,
//      plus a little glue (a comma, a particle) where a deletion left a gap
// The program intersects the levels top-down, shapes them (one sentence for
// the takeaway, one contiguous run for the topic), and enforces the budgets.
import { llmCall } from './api';
import { getModelsOnce } from './use-models';
import { isAgentModel } from './agents/agent-runtime';
import { useUiStore } from './ui-store';
import type { Ladder, LadderItem, LadderToken } from '../types';

export const LADDER_LEVELS = ['topic', 'takeaway', 'brief', 'abstract'] as const;
export type LadderLevel = 0 | 1 | 2 | 3;
/** canvas-space font size per level; on screen it is × zoom */
/** canvas-space font size per level; on screen it is × zoom. With HANDOFF_PX 12 (+1.2 hysteresis) the
 *  bands inside the map tier are roughly L1 0.34–0.54, L2 0.54–0.74, L3 0.74–0.9, then the card unfolds;
 *  text at a handoff is ~16 px on screen (was 13: the user found it small). */
export const LEVEL_FONT: Record<LadderLevel, number> = { 0: 72, 1: 48, 2: 30, 3: 22 };
/** a level takes over when ITS text reaches this many pixels on screen */
export const HANDOFF_PX = 15;
export const HANDOFF_HYST = 1.2;
/** nodes whose ladder is being built right now (a fresh answer, or a backfill); the offer skips them */
export const inFlight = new Set<string>();
/** a local ladder costs nothing, so any answer with a few sentences gets one (model ladders keep SUMMARY_MIN_CHARS) */
export const LOCAL_LADDER_MIN_CHARS = 200;

const isCJK = (s: string): boolean => /[぀-ヿ㐀-鿿]/.test(s);
const cleanMd = (s: string): string => s
  .replace(/\[([^\]]+)\]\((?:https?:)?[^)]*\)/g, '$1').replace(/\(?https?:\/\/\S+\)?/g, '')
  .replace(/\*\*|__|`|^#+\s*|^\s*[-*•]\s+|^\s*\d+[.)]\s+/gm, '')
  // single-marker emphasis (*word*, _word_) at word edges; a lone leading asterisk was showing on plaques
  .replace(/(^|[\s(（])[*_](?=\S)/g, '$1').replace(/(?<=\S)[*_](?=$|[\s,.;:!?)，。；：！？）])/g, '')
  .replace(/\s+/g, ' ').trim();
/** the answer as sentences, markdown stripped */
export function sentencesOf(response: string): string[] {
  return response.replace(/\r/g, '').split(/\n+|(?<=[。！？；])|(?<=[.!?])\s+(?=[A-Z"“])/).map(cleanMd).filter((x) => x.length >= 4);
}
export function tokenize(text: string, lang: 'zh' | 'en'): LadderToken[] {
  const seg = new Intl.Segmenter(lang === 'zh' ? 'zh' : 'en', { granularity: 'word' });
  const out: LadderToken[] = [];
  for (const { segment } of seg.segment(text)) {
    if (/^\s+$/.test(segment)) { if (out.length) out[out.length - 1].space = true; continue; }
    out.push({ t: segment });
  }
  return out;
}
const latinEnd = (t: string) => /[A-Za-z0-9]$/.test(t);
const latinStart = (t: string) => /^[A-Za-z0-9(["“]/.test(t);
const closing = (t: string) => /^[,.;:!?)\]”」。，、；：！？]/.test(t);
/** whether a space belongs between two neighbouring pieces */
const QUOTE = /^["“”'‘’]$/;
export const needsSpace = (prev: string, prevSpace: boolean | undefined, next: string): boolean => {
  // a quote opens or closes: only the source text knows which, so its own whitespace decides
  if (QUOTE.test(next) || QUOTE.test(prev)) return !!prevSpace;
  return (latinEnd(prev) && latinStart(next)) || (!!prevSpace && !closing(next) && (latinEnd(prev) || latinStart(next)));
};
/** a level's pieces in order: {text, i} where i is the abstract token index, or -1 for glue or free text */
export function pieces(ladder: Ladder, level: LadderLevel): { text: string; i: number; space?: boolean }[] {
  if (level === 3) return ladder.tokens.map((tk, i) => ({ text: tk.t, i, space: tk.space }));
  const items = ladder[LADDER_LEVELS[level] as 'topic' | 'takeaway' | 'brief'];
  return items.map((it) => typeof it === 'number' ? { text: ladder.tokens[it]?.t ?? '', i: it, space: ladder.tokens[it]?.space } : { text: it, i: -1 });
}
export interface LadderPiece { text: string; id: string; space?: boolean }
const norm = (t: string) => t.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
/** longest common subsequence of two token lists (by normalised text): pairs of indices */
function lcs(a: string[], b: string[]): [number, number][] {
  const n = a.length, m = b.length; if (!n || !m) return [];
  const dp = new Uint16Array((n + 1) * (m + 1)); const W = m + 1;
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i * W + j] = a[i] && a[i] === b[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  const out: [number, number][] = []; let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] && a[i] === b[j]) { out.push([i, j]); i++; j++; } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) i++; else j++; }
  return out;
}
/** Every level's pieces with ids that persist across levels: a word that
 *  survives from one level to the next keeps its id, so the plaque can slide
 *  it into place. Nested ladders align by token index, free-text levels (the
 *  local ladder of an older node) by longest common subsequence. */
export function ladderPieces(ladder: Ladder): LadderPiece[][] {
  const out: LadderPiece[][] = [];
  const top = pieces(ladder, 3).map((p) => ({ text: p.text, id: `a${p.i}`, space: p.space }));
  out[3] = top;
  for (const level of [2, 1, 0] as LadderLevel[]) {
    const above = out[level + 1];
    const cur = pieces(ladder, level);
    const byIndex = cur.every((p) => p.i >= 0 || p.text.length <= 12) && cur.some((p) => p.i >= 0);
    const ids: string[] = new Array(cur.length).fill('');
    if (byIndex) {
      const aboveIds = new Set(above.map((p) => p.id));
      cur.forEach((p, n) => { if (p.i >= 0 && aboveIds.has(`a${p.i}`)) ids[n] = `a${p.i}`; });
    } else {
      for (const [ci, ai] of lcs(cur.map((p) => norm(p.text)), above.map((p) => norm(p.text)))) ids[ci] = above[ai].id;
    }
    out[level] = cur.map((p, n) => ({ text: p.text, id: ids[n] || `f${level}_${n}`, space: p.space }));
  }
  return out;
}

export function levelText(ladder: Ladder, level: LadderLevel): string {
  const ps = pieces(ladder, level); let s = '';
  ps.forEach((p, n) => { if (n > 0 && needsSpace(ps[n - 1].text, ps[n - 1].space, p.text)) s += ' '; s += p.text; });
  return s.trim();
}
const budget = (lang: 'zh' | 'en') => lang === 'zh' ? { brief: 80, takeaway: 18, topic: 6, unit: 'characters' } : { brief: 40, takeaway: 10, topic: 3, unit: 'words' };
const size = (s: string, lang: 'zh' | 'en'): number => lang === 'zh' ? [...s.replace(/[\s\p{P}\p{S}]/gu, '')].length : s.split(/\s+/).filter((w) => /\w/.test(w)).length;

/** Which level is legible at this zoom: the deepest whose on-screen font is at least HANDOFF_PX, with hysteresis around the current level. */
export function pickLevel(zoom: number, current: LadderLevel | null): LadderLevel {
  let best: LadderLevel = 0;
  for (const k of [0, 1, 2, 3] as LadderLevel[]) {
    const px = LEVEL_FONT[k] * zoom;
    const need = current === null ? HANDOFF_PX : k > current ? HANDOFF_PX + HANDOFF_HYST : k === current ? HANDOFF_PX - HANDOFF_HYST : HANDOFF_PX;
    if (px >= need) best = k;
  }
  return best;
}

/** The model that writes a node's ladder: the answering model when it is an
 *  ordinary API model and the setting says so; otherwise the chosen or the
 *  default background model. Agents never write ladders. */
export async function ladderModelFor(answeringModel?: string): Promise<string | undefined> {
  const { ladderModel: pref, selectedModel } = useUiStore.getState();
  if (pref && pref !== 'answering') return pref;
  if (answeringModel && !isAgentModel(answeringModel)) return answeringModel;
  // no answering model on record (an older or seeded node): the model the person has picked right now, when it is an API model
  if (selectedModel && !isAgentModel(selectedModel)) return selectedModel;
  const md = await getModelsOnce().catch(() => null);
  const fallback = md?.default ?? md?.models.find((m) => !isAgentModel(m.id))?.id;
  return fallback ?? undefined;
}

const parseJson = <T,>(raw: string): T | null => { const m = /\{[\s\S]*\}/.exec(raw); try { return m ? JSON.parse(m[0]) as T : null; } catch { return null; } };

/** Build a node's ladder from its exchange. Null when the answer is too short or the model's picks are unusable. */
export async function buildLadder(question: string, response: string, model?: string): Promise<Ladder | null> {
  const lang: 'zh' | 'en' = isCJK(question + response.slice(0, 200)) ? 'zh' : 'en';
  const L = lang === 'zh' ? 'Chinese' : 'English';
  const sents = sentencesOf(response);
  if (sents.length < 2) return null;
  // ── step 1: which sentences ──
  const numbered = sents.map((s, i) => `${i}: ${s}`).join('\n');
  const s1 = parseJson<{ sentences?: unknown[] }>(await llmCall([{ role: 'user', content: `Below are the numbered sentences of an answer. Choose 3 or 4 sentence numbers that together state the answer's conclusion and its main reason, so that a reader who sees only those sentences understands what this exchange settled. Prefer sentences that state a result over sentences that set up or list. Output only JSON: {"sentences": [numbers in ascending order]}.\n\nQuestion:\n${question.slice(0, 1500)}\n\nSentences:\n${numbered.slice(0, 12000)}` }], undefined, model, { fast: true }));
  const chosen = [...new Set((s1?.sentences ?? []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < sents.length))].sort((a, b) => a - b).slice(0, 4);
  if (!chosen.length) return null;
  const abstract = chosen.map((i) => sents[i]).join(lang === 'zh' ? '' : ' ');
  const tokens = tokenize(abstract, lang);
  if (tokens.length < 4) return null;
  // ── step 2: which words, per level, with a little glue ──
  const b = budget(lang);
  const listed = tokens.map((tk, i) => `${i}:${tk.t}`).join(' ');
  const rules = `The abstract below is given as numbered tokens. Build three shorter versions by KEEPING a subset of the tokens: you may only delete, never reorder or change words. Where a deletion leaves a gap that reads badly you may insert ONE short glue token as a quoted string (a comma, a colon, or a particle such as ${lang === 'zh' ? '"是", "而", "的"' : '"is", "so", "the"'}), at most 3 per version. Output only JSON {"brief":[...],"takeaway":[...],"topic":[...]} where each list mixes token indices (numbers) and glue (strings), in reading order, with:\n- brief: one or two sentences, at most ${b.brief} ${b.unit}; the conclusion and its reason, hedges and examples dropped. Keep punctuation tokens where a sentence boundary is needed.\n- takeaway: the conclusion as one clause, at most ${b.takeaway} ${b.unit}, drawn from ONE sentence. Its indices must be a subset of brief's.\n- topic: the subject as a bare noun phrase, at most ${b.topic} ${b.unit}, a contiguous run of tokens. Its indices must be a subset of takeaway's.\nEach version must read as ${L} a person could say, even if telegraphic.\n\nQuestion:\n${question.slice(0, 1500)}\n\nAbstract tokens:\n${listed}`;
  const messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: rules }];
  type Pick = { brief?: unknown[]; takeaway?: unknown[]; topic?: unknown[] };
  const isBoundary = (i: number) => /^[。！？.!?；;]$/.test(tokens[i].t);
  const sentenceOf = (i: number) => { let n = 0; for (let k = 0; k < i; k++) if (isBoundary(k)) n++; return n; };
  const glueOk = (g: string) => (lang === 'zh' ? [...g].length <= 4 : g.split(/\s+/).length === 1) && g.length <= 12;
  /** normalise one level: valid indices ascending, glue kept only between kept tokens, at most 3 glue */
  const norm = (a: unknown[] | undefined, allowed: Set<number> | null): LadderItem[] => {
    const idx = [...new Set((a ?? []).filter((x) => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < tokens.length).map(Number))].filter((i) => !allowed || allowed.has(i)).sort((x, y) => x - y);
    const set = new Set(idx); const out: LadderItem[] = []; let glue = 0; let lastIdx = -1;
    for (const x of a ?? []) {
      if (typeof x === 'number') { if (set.has(x) && x > lastIdx) { out.push(x); lastIdx = x; } }
      else if (typeof x === 'string' && glueOk(x) && glue < 3 && out.length && typeof out[out.length - 1] === 'number') { out.push(x); glue++; }
    }
    // glue never trails
    while (out.length && typeof out[out.length - 1] === 'string') out.pop();
    return out;
  };
  const numbers = (items: LadderItem[]) => items.filter((x): x is number => typeof x === 'number');
  const shape = (p: Pick | null) => {
    const brief = norm(p?.brief, null);
    // a brief that straddles a dropped sentence boundary gets that boundary back
    const bn = new Set(numbers(brief));
    for (let k = 0; k < tokens.length; k++) if (isBoundary(k) && !bn.has(k) && numbers(brief).some((i) => i < k) && numbers(brief).some((i) => i > k)) bn.add(k);
    const brief2: LadderItem[] = []; const sorted = [...bn].sort((x, y) => x - y); let gi = 0;
    for (const i of sorted) { while (gi < brief.length && typeof brief[gi] === 'number' && (brief[gi] as number) < i) gi++; brief2.push(i); if (gi < brief.length && brief[gi] === i) { gi++; while (gi < brief.length && typeof brief[gi] === 'string') brief2.push(brief[gi++]); } }
    let takeaway = norm(p?.takeaway, new Set(numbers(brief2)));
    // the takeaway lives in ONE sentence: the one holding most of its tokens
    const tn = numbers(takeaway);
    if (tn.length) { const by = new Map<number, number>(); for (const i of tn) by.set(sentenceOf(i), (by.get(sentenceOf(i)) ?? 0) + 1); const best = [...by].sort((x, y) => y[1] - x[1])[0][0]; takeaway = norm(takeaway.filter((x) => typeof x === 'string' || (sentenceOf(x) === best && !isBoundary(x))), new Set(numbers(brief2))); }
    // the topic is one contiguous run inside the takeaway
    let topic = numbers(norm(p?.topic, new Set(numbers(takeaway))));
    if (topic.length) { let run: number[] = [], bestRun: number[] = []; for (const i of topic) { if (run.length && i !== run[run.length - 1] + 1) { if (run.length > bestRun.length) bestRun = run; run = []; } run.push(i); } if (run.length > bestRun.length) bestRun = run; topic = bestRun; }
    return { brief: brief2, takeaway, topic: topic as LadderItem[] };
  };
  let pick = parseJson<Pick>(await llmCall(messages, undefined, model, { fast: true }));
  let keep = shape(pick);
  const draft = (): Ladder => ({ tokens, abstract, sentences: chosen, brief: keep.brief, takeaway: keep.takeaway, topic: keep.topic, ...(model ? { model } : {}) });
  const over = (k: 'brief' | 'takeaway' | 'topic') => size(levelText(draft(), k === 'brief' ? 2 : k === 'takeaway' ? 1 : 0), lang) > b[k];
  const problems = () => (['brief', 'takeaway', 'topic'] as const).filter((k) => !keep[k].length || over(k)).map((k) => `${k} ${!keep[k].length ? 'is empty' : `is over its budget of ${b[k]} ${b.unit}`}`);
  if (problems().length) {
    messages.push({ role: 'assistant', content: JSON.stringify(pick ?? {}) }, { role: 'user', content: `Rejected: ${problems().join('; ')}. Return the corrected JSON, deleting more tokens where over budget; keep the takeaway inside one sentence and the topic contiguous.` });
    pick = parseJson<Pick>(await llmCall(messages, undefined, model, { fast: true })); keep = shape(pick);
  }
  // last resort: glue goes first, then tokens from the end that no shorter level needs
  for (const k of ['brief', 'takeaway', 'topic'] as const) {
    let guard = 0;
    while (keep[k].length > 1 && over(k) && guard++ < 400) {
      const protectedSet = new Set(numbers(k === 'brief' ? keep.takeaway : k === 'takeaway' ? keep.topic : []));
      const gi = keep[k].map((x, i) => [x, i] as const).reverse().find(([x]) => typeof x === 'string')?.[1];
      if (gi !== undefined) { keep[k] = keep[k].filter((_, i) => i !== gi); continue; }
      const ti = keep[k].map((x, i) => [x, i] as const).reverse().find(([x]) => typeof x === 'number' && !protectedSet.has(x))?.[1];
      if (ti === undefined) break;
      keep[k] = keep[k].filter((_, i) => i !== ti);
      while (keep[k].length && typeof keep[k][keep[k].length - 1] === 'string') keep[k].pop();
    }
  }
  if (!keep.takeaway.length) return null;
  if (!keep.topic.length) keep.topic = [numbers(keep.takeaway)[0]];
  return draft();
}

const CONCLUSION_MARK = /^(结论|所以|因此|总之|简言之|一句话|答案是|建议|So|Therefore|In short|The answer|Bottom line|Decision|Verdict)/i;
const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'is', 'are', 'and', 'or', 'that', 'this', 'it', 'for', 'on', 'with', 'as', 'be', '的', '了', '是', '在', '和', '与', '或', '这', '那', '就', '也', '都', '而', '及']);
const words = (text: string, lang: 'zh' | 'en') => tokenize(text, lang).map((t) => norm(t.t)).filter((w) => w && !STOP.has(w));
/** An older node's ladder without any model: the takeaway and topic it already
 *  has, and the answer's own sentences chosen by overlap with that takeaway
 *  (brief = the best one, abstract = the best three or four in order). Instant,
 *  offline, a little looser than a selected ladder; the plaque morphs by LCS. */
export function buildLocalLadder(question: string, response: string, takeaway?: string | null, topic?: string | null): Ladder | null {
  const lang: 'zh' | 'en' = isCJK(question + response.slice(0, 200)) ? 'zh' : 'en';
  const sents = sentencesOf(response);
  if (sents.length < 2) return null;
  const key = new Set(words(takeaway ?? question, lang));
  const b = budget(lang);
  const scored = sents.map((text, i) => {
    const ws = words(text, lang); const hit = ws.filter((w) => key.has(w)).length;
    const len = size(text, lang);
    let score = hit / Math.sqrt(Math.max(4, ws.length)) + (i === 0 ? 0.25 : 0) + (CONCLUSION_MARK.test(text) ? 0.5 : 0);
    if (len < 6) score -= 0.6; if (len > b.brief * 1.6) score -= 0.3;
    return { i, text, score, len };
  });
  const top = [...scored].sort((x, y) => y.score - x.score).slice(0, 4).sort((x, y) => x.i - y.i);
  const abstract = top.map((t) => t.text).join(lang === 'zh' ? '' : ' ');
  const tokens = tokenize(abstract, lang);
  // brief: the best sentence that fits, else the best
  const best = [...top].sort((x, y) => y.score - x.score);
  const briefSent = best.find((t) => t.len <= b.brief) ?? best[0];
  // its token span inside the abstract
  const before = top.filter((t) => t.i < briefSent.i).map((t) => t.text).join(lang === 'zh' ? '' : ' ');
  const start = tokenize(before, lang).length; const count = tokenize(briefSent.text, lang).length;
  const brief: LadderItem[] = Array.from({ length: count }, (_, k) => start + k).filter((k) => k < tokens.length);
  // takeaway: what the node already has, else the brief's most telling clause: list markers and
  // bare assents ("是的", "3.", "Yes") are skipped, the clause sharing most words with the question wins
  const clauseOf = (t: string): string => {
    const parts = t.split(/[，,；;：:。.!?！？]/).map((c) => c.replace(/^\s*(\d+[.)、]?|[-*•])\s*/, '').trim()).filter(Boolean);
    const usable = parts.filter((c) => size(c, lang) >= (lang === 'zh' ? 4 : 3) && !/^(是的|好的|对的?|嗯|可以|没错|yes|ok(ay)?|sure|right|indeed)$/i.test(c));
    if (!usable.length) return parts.slice(0, 2).join(lang === 'zh' ? '，' : ', ') || t;
    const qk = new Set(words(question, lang));
    const scored = usable.map((c, i) => ({ c, s: words(c, lang).filter((w) => qk.has(w)).length + (size(c, lang) <= b.takeaway ? 0.5 : 0) - i * 0.05 }));
    return scored.sort((x, y) => y.s - x.s)[0].c;
  };
  const take = (takeaway ?? '').trim() || clauseOf(briefSent.text);
  const takeItems: LadderItem[] = tokenize(take, lang).map((t) => t.t + (t.space ? ' ' : ''));
  // topic: what the node has, else the takeaway's leading words within budget
  let top0 = (topic ?? '').trim();
  if (!top0) { let acc = ''; for (const t of tokenize(take, lang)) { if (size(acc + t.t, lang) > b.topic) break; acc += t.t + (t.space && lang !== 'zh' ? ' ' : ''); } top0 = acc.trim() || take; }
  const topicItems: LadderItem[] = tokenize(top0, lang).map((t) => t.t + (t.space ? ' ' : ''));
  if (!brief.length || !takeItems.length) return null;
  return { tokens, abstract, sentences: top.map((t) => t.i), brief, takeaway: takeItems, topic: topicItems, model: 'local' };
}
