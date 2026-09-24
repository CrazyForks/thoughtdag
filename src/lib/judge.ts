// The judge: a System One decision. A state and typed questions go in, a
// probability for every option comes out — the /v1/systemone contract
// TypeSafe published for Jev and the open reproductions copied. One shape,
// several backends: OpenRouter (Jev, on the key the app may already hold),
// TypeSafe directly, Cloudflare Workers AI, any self-hosted endpoint (Kev,
// Laya, Von), and the configured chat model as an uncalibrated stand-in.
// Off by default. Everything that asks the judge falls back to rules when
// no judge answers, so the app works the same without one.
import { llmCall } from './api';
import { useUiStore } from './ui-store';

export type JudgeQuestion =
  | { type: 'noul'; instructions: string; criteria?: { true: string; false: string } }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

export interface JudgeAnswer {
  type: 'noul' | 'choice' | 'score';
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  score?: number;
  legend?: Record<string, string>;
  confidence?: number;
}

export type JudgeProviderId = 'none' | 'openrouter' | 'typesafe' | 'cloudflare' | 'custom' | 'llm';

export interface JudgeSettings {
  provider: JudgeProviderId;
  openrouterKey: string;
  typesafeKey: string;
  cloudflareAccount: string;
  cloudflareToken: string;
  customUrl: string;
  customKey: string;
}

export interface JudgeResult {
  provider: JudgeProviderId;
  model: string;
  answers: Record<string, JudgeAnswer>;
  usage?: { input_tokens?: number; output_tokens?: number };
  ms: number;
  /** a trained decision model's probabilities are calibrated; a chat model's are not */
  calibrated: boolean;
}

export const DEFAULT_JUDGE: JudgeSettings = { provider: 'none', openrouterKey: '', typesafeKey: '', cloudflareAccount: '', cloudflareToken: '', customUrl: '', customKey: '' };
const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export const JUDGE_LABELS: Record<JudgeProviderId, string> = {
  none: '—', openrouter: 'OpenRouter · Jev', typesafe: 'TypeSafe · Jev', cloudflare: 'Cloudflare · Jev', custom: 'System One endpoint', llm: 'chat model',
};

// ── the decisions the app asks, in one place ──
// Each is a typed question set with its thresholds spelled out, so what the
// judge decides and where the bar sits can be read here, not hunted down.

/** Before an ask, with auto switches on: which tools this question wants. */
export async function decideSwitches(question: string): Promise<{ web: number; scholar: number; recall: number; provider: JudgeProviderId; model: string; calibrated: boolean }> {
  const r = await judge({ question }, {
    web: { type: 'noul', instructions: 'Does answering `question` need current information from the web — recent events, prices, versions, availability, live data — rather than general knowledge?' },
    scholar: { type: 'noul', instructions: 'Does `question` call for academic literature: papers, citations, studies, formal results?' },
    recall: { type: 'noul', instructions: 'Does `question` refer to something the user discussed, decided or worked on before — their own projects, past conversations, earlier choices — rather than asking about the world in general?' },
  });
  const p = (k: string) => r.answers[k]?.noul ?? 0;
  return { web: p('web'), scholar: p('scholar'), recall: p('recall'), provider: r.provider, model: r.model, calibrated: r.calibrated };
}

/** The bar a switch turns on at. */
export const SWITCH_ON = 0.5;

/** After an answer: is there something durable to remember, and what kind. */
export interface MemoryVerdictJudged { durable: number; category: 'preference' | 'identity' | 'project' | 'none'; categoryP: number; stated: number; covers: string | null; coversP: number; provider: JudgeProviderId; model: string; calibrated: boolean }
export async function decideMemory(question: string, response: string, existing: { id: string; text: string }[]): Promise<MemoryVerdictJudged> {
  const criteria: Record<string, string> = Object.fromEntries(existing.slice(0, 40).map((m) => [m.id, m.text.slice(0, 160)]));
  criteria.none = 'no existing entry covers this';
  const r = await judge(
    { exchange: { user: question.slice(0, 2000), assistant: response.slice(0, 2000) }, existing_entries: existing.slice(0, 40).map((m) => m.text.slice(0, 160)) },
    {
      durable: { type: 'noul', instructions: 'Does `exchange` reveal something DURABLE about the user — how they like things done, who they are, or what they are working on — that would still matter in a later, unrelated session? Not: content questions, one-off task details, general knowledge, facts about this workspace, verbatim text, credentials.' },
      category: { type: 'choice', instructions: 'If `exchange` reveals something durable about the user, which kind?', criteria: { preference: 'how they like things done: language, style, format, tools, models', identity: 'who they are: role, field, expertise, long-term research agenda', project: 'what they are working on right now', none: 'nothing durable about the user here' } },
      stated: { type: 'noul', instructions: 'Did the user state this about themselves in so many words in `exchange`, rather than it being inferred from their behaviour?' },
      covers: { type: 'choice', instructions: 'Which entry in `existing_entries`, if any, already covers the same topic as what `exchange` reveals (so an update fits better than a new entry)?', criteria },
    },
  );
  const cat = r.answers.category; const cov = r.answers.covers;
  const category = (cat?.choice ?? 'none') as MemoryVerdictJudged['category'];
  return {
    durable: r.answers.durable?.noul ?? 0, category, categoryP: cat?.probabilities?.[category] ?? 0,
    stated: r.answers.stated?.noul ?? 0,
    covers: cov?.choice && cov.choice !== 'none' ? cov.choice : null, coversP: cov?.choice ? cov.probabilities?.[cov.choice] ?? 0 : 0,
    provider: r.provider, model: r.model, calibrated: r.calibrated,
  };
}
/** Memory is written only above this bar; identity also needs the user to have said it. */
export const MEMORY_DURABLE_BAR = 0.6;
export const MEMORY_STATED_BAR = 0.7;

/** The move an exchange makes on the map. */
export type TakeawayKind = 'insight' | 'ruleout' | 'decision' | 'pivot' | 'open';
export async function decideTakeaway(question: string, response: string): Promise<{ kind: TakeawayKind; p: number; provider: JudgeProviderId; model: string; calibrated: boolean }> {
  const r = await judge({ exchange: { user: question.slice(0, 3000), assistant: response.slice(0, 4000) } }, {
    kind: { type: 'choice', instructions: 'What kind of move does `exchange` make in the line of thinking?', criteria: {
      ruleout: 'something is ruled out, rejected or shown not to work',
      decision: 'a choice is made between alternatives, a course is settled',
      pivot: 'the direction, framing or goal changes',
      open: 'a question is raised or left unresolved, next steps are asked for',
      insight: 'an ordinary step: an explanation, a result, information, no decisive move',
    } },
  });
  const a = r.answers.kind;
  const kind = (a?.choice ?? 'insight') as TakeawayKind;
  return { kind, p: a?.probabilities?.[kind] ?? 0, provider: r.provider, model: r.model, calibrated: r.calibrated };
}


/** The key the app already holds for OpenRouter (a runtime provider), if any. */
export function storedOpenRouterKey(): string {
  try {
    const raw = localStorage.getItem('thoughtdag.runtimeProviders');
    if (!raw) return '';
    const list = JSON.parse(raw) as { baseURL?: string; apiKey?: string }[];
    return list.find((p) => /openrouter\.ai/i.test(p.baseURL ?? '') && p.apiKey)?.apiKey ?? '';
  } catch { return ''; }
}

export function judgeSettings(): JudgeSettings { return useUiStore.getState().judge; }

/** Whether a judge is configured well enough to be asked. */
export function judgeAvailable(s: JudgeSettings = judgeSettings()): boolean {
  switch (s.provider) {
    case 'openrouter': return !!(s.openrouterKey || storedOpenRouterKey());
    case 'typesafe': return !!s.typesafeKey;
    case 'cloudflare': return !!(s.cloudflareAccount && s.cloudflareToken);
    case 'custom': return /^https?:\/\//.test(s.customUrl);
    case 'llm': return true;
    default: return false;
  }
}

// ── transport ──

interface Wire { url: string; headers: Record<string, string>; body: unknown; direct: boolean; unwrap?: (j: unknown) => unknown }

function wireFor(s: JudgeSettings, state: unknown, questions: Record<string, JudgeQuestion>): Wire {
  switch (s.provider) {
    case 'openrouter':
      return { url: 'https://openrouter.ai/api/v1/systemone', headers: { Authorization: `Bearer ${s.openrouterKey || storedOpenRouterKey()}`, 'HTTP-Referer': 'https://chenxiachan.github.io/thoughtdag/', 'X-Title': 'ThoughtDAG' }, body: { model: 'typesafe/jev-1.13', state, questions }, direct: true };
    case 'typesafe':
      return { url: 'https://api.typesafe.ai/v1/systemone', headers: { Authorization: `Bearer ${s.typesafeKey}` }, body: { model: 'jev-latest', state, questions }, direct: false };
    case 'cloudflare':
      return {
        url: `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(s.cloudflareAccount)}/ai/run`,
        headers: { Authorization: `Bearer ${s.cloudflareToken}` },
        body: { model: 'typesafe/jev', input: { state, questions } }, direct: false,
        unwrap: (j) => (j && typeof j === 'object' && 'result' in j ? (j as { result: unknown }).result : j),
      };
    case 'custom':
      return { url: s.customUrl, headers: s.customKey ? { Authorization: `Bearer ${s.customKey}` } : {}, body: { model: 'jev-latest', state, questions }, direct: true };
    default:
      throw new Error('no judge configured');
  }
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
}

async function viaProxy(w: Wire): Promise<Response> {
  return fetch(`${API_BASE}/api/judge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ url: w.url, headers: w.headers, body: w.body }) });
}

function normalize(raw: unknown): { model: string; answers: Record<string, JudgeAnswer>; usage?: JudgeResult['usage'] } {
  const j = (raw ?? {}) as { model?: string; answers?: Record<string, JudgeAnswer>; usage?: JudgeResult['usage']; error?: unknown };
  if (!j.answers || typeof j.answers !== 'object') throw new Error(typeof j.error === 'string' ? j.error : (j.error as { message?: string })?.message ?? 'the judge returned no answers');
  return { model: j.model ?? '', answers: j.answers, usage: j.usage };
}

/** Ask the configured judge. Throws when none is configured or the call fails. */
export async function judge(state: unknown, questions: Record<string, JudgeQuestion>, opts: { settings?: JudgeSettings; signal?: AbortSignal } = {}): Promise<JudgeResult> {
  const s = opts.settings ?? judgeSettings();
  if (!judgeAvailable(s)) throw new Error('no judge configured');
  const t0 = Date.now();
  if (s.provider === 'llm') {
    const r = await llmJudge(state, questions);
    return { provider: 'llm', model: useUiStore.getState().selectedModel ?? '', answers: r, ms: Date.now() - t0, calibrated: false };
  }
  const w = wireFor(s, state, questions);
  let res: Response;
  if (w.direct) {
    // a browser can reach OpenRouter and (usually) a self-hosted endpoint directly; the proxy is the fallback for CORS
    try { res = await post(w.url, w.headers, w.body); }
    catch { res = await viaProxy(w); }
  } else {
    res = await viaProxy(w);
  }
  const text = await res.text();
  let parsed: unknown = {};
  try { parsed = text ? JSON.parse(text) : {}; } catch { throw new Error(`the judge answered ${res.status} with non-JSON`); }
  if (!res.ok) {
    const err = (parsed as { error?: unknown; errors?: { message?: string }[] });
    const msg = typeof err.error === 'string' ? err.error : (err.error as { message?: string })?.message ?? err.errors?.[0]?.message ?? `HTTP ${res.status}`;
    throw new Error(msg);
  }
  const n = normalize(w.unwrap ? w.unwrap(parsed) : parsed);
  return { provider: s.provider, model: n.model, answers: n.answers, usage: n.usage, ms: Date.now() - t0, calibrated: true };
}

// ── the chat model as a stand-in ──
// The same questions, answered by the configured model as JSON. Slower,
// costs output tokens, and its numbers are opinions, not calibrated
// probabilities — the result says so (calibrated: false).

async function llmJudge(state: unknown, questions: Record<string, JudgeQuestion>): Promise<Record<string, JudgeAnswer>> {
  const spec = Object.entries(questions).map(([k, q]) => {
    if (q.type === 'noul') return `- "${k}" (noul): ${q.instructions} → {"noul": p(yes) in [0,1]}`;
    if (q.type === 'choice') return `- "${k}" (choice): ${q.instructions}\n  options: ${Object.entries(q.criteria).map(([o, d]) => `${o} = ${d}`).join('; ')} → {"choice": option, "probabilities": {option: p, ...} summing to 1}`;
    return `- "${k}" (score): ${q.instructions}\n  levels (index 0..${q.criteria.length - 1}): ${q.criteria.map((d, i) => `${i} = ${d}`).join('; ')} → {"probabilities": {"0": p, ...} summing to 1}`;
  }).join('\n');
  const prompt = `You are a decision function. Read the STATE, then answer every QUESTION with probabilities only. Output ONE JSON object whose keys are the question ids and whose values follow the shapes given. No prose, no markdown fences.\n\nSTATE:\n${typeof state === 'string' ? state : JSON.stringify(state)}\n\nQUESTIONS:\n${spec}`;
  const text = await llmCall([{ role: 'user', content: prompt }]);
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('the model returned no JSON');
  const j = JSON.parse(m[0]) as Record<string, Record<string, unknown>>;
  const out: Record<string, JudgeAnswer> = {};
  for (const [k, q] of Object.entries(questions)) {
    const a = j[k] ?? {};
    if (q.type === 'noul') { const p = Number(a.noul ?? a.p ?? a.probability); out[k] = { type: 'noul', noul: Number.isFinite(p) ? Math.min(1, Math.max(0, p)) : 0.5 }; continue; }
    const probs = (a.probabilities && typeof a.probabilities === 'object') ? a.probabilities as Record<string, number> : {};
    const keys = q.type === 'choice' ? Object.keys(q.criteria) : q.criteria.map((_, i) => String(i));
    let sum = 0; const norm: Record<string, number> = {};
    for (const key of keys) { const v = Math.max(0, Number(probs[key] ?? 0) || 0); norm[key] = v; sum += v; }
    if (sum > 0) for (const key of keys) norm[key] /= sum; else for (const key of keys) norm[key] = 1 / keys.length;
    const top = keys.reduce((b, key) => (norm[key] > norm[b] ? key : b), keys[0]);
    const confidence = keys.length > 1 ? 1 - (-keys.reduce((h, key) => h + (norm[key] > 0 ? norm[key] * Math.log(norm[key]) : 0), 0) / Math.log(keys.length)) : 1;
    if (q.type === 'choice') out[k] = { type: 'choice', choice: typeof a.choice === 'string' && keys.includes(a.choice) ? a.choice : top, probabilities: norm, confidence };
    else out[k] = { type: 'score', score: keys.reduce((e, key) => e + Number(key) * norm[key], 0), probabilities: norm, legend: Object.fromEntries(q.criteria.map((d, i) => [String(i), d])), confidence };
  }
  return out;
}

/** A tiny decision, for the settings page's Test button. */
export async function judgeSelfTest(settings: JudgeSettings): Promise<JudgeResult> {
  return judge(
    { message: 'Help! My payouts have been failing for 3 days and nobody answers.' },
    {
      urgent: { type: 'noul', instructions: 'Does `message` communicate time pressure?' },
      department: { type: 'choice', instructions: 'Which team should handle `message`?', criteria: { billing: 'payments, invoices, refunds', technical: 'bugs, outages, integrations', other: 'everything else' } },
    },
    { settings },
  );
}
