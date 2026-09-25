// The person's own memory as two documents, not a list of fragments: what
// they prefer (how they like things done) and who they are (role, field,
// long-term agenda). A new fact is merged into the document by rewriting
// the line it refines or contradicts (newest wins), never appended blindly;
// every rewrite leaves one line in the document's changelog. Project
// facts do not live here — they are filed into the topic's dossier (or the
// inbox when no topic fits). The legacy fragment list migrates on first use.
import { llmCall } from './api';
import { getModelsOnce } from './use-models';
import { useUiStore } from './ui-store';
import { generateId } from '../utils';
import type { MemoryEntry } from './memory';

export interface MemoryDoc { text: string; updatedAt: string | null; changelog: { at: string; note: string }[] }
export interface Profile { preferences: MemoryDoc; identity: MemoryDoc }
export type ProfileKind = keyof Profile;
export interface InboxItem { id: string; text: string; at: string; from?: string }

export const emptyDoc = (): MemoryDoc => ({ text: '', updatedAt: null, changelog: [] });
export const emptyProfile = (): Profile => ({ preferences: emptyDoc(), identity: emptyDoc() });
const CHANGELOG_CAP = 40;

/** The document's facts, one per line, without bullets. */
export const docLines = (d: MemoryDoc | undefined): string[] => (d?.text ?? '').split('\n').map((l) => l.replace(/^[-•*\s]+/, '').trim()).filter((l) => l.length > 0);
export const profileLines = (p: Profile): string[] => [...docLines(p.identity), ...docLines(p.preferences)];
const asDoc = (lines: string[]): string => lines.map((l) => `- ${l}`).join('\n');

/** The fragment list of earlier versions folds into the documents once:
 *  preferences and identity by category, everything else into the inbox. */
export function migrateLegacyMemories(): void {
  const st = useUiStore.getState();
  const legacy: MemoryEntry[] = st.memories;
  if (!legacy.length) return;
  const now = new Date().toISOString();
  const pref = legacy.filter((m) => m.category === 'preference').map((m) => m.text.trim()).filter(Boolean);
  const idn = legacy.filter((m) => m.category === 'identity').map((m) => m.text.trim()).filter(Boolean);
  const rest = legacy.filter((m) => m.category !== 'preference' && m.category !== 'identity');
  const p = st.profile;
  const merged: Profile = {
    preferences: pref.length ? { text: asDoc([...docLines(p.preferences), ...pref.filter((x) => !docLines(p.preferences).includes(x))]), updatedAt: now, changelog: [...p.preferences.changelog, { at: now, note: `folded ${pref.length} earlier entries` }].slice(-CHANGELOG_CAP) } : p.preferences,
    identity: idn.length ? { text: asDoc([...docLines(p.identity), ...idn.filter((x) => !docLines(p.identity).includes(x))]), updatedAt: now, changelog: [...p.identity.changelog, { at: now, note: `folded ${idn.length} earlier entries` }].slice(-CHANGELOG_CAP) } : p.identity,
  };
  st.setProfile(merged);
  if (rest.length) st.setMemoryInbox([...st.memoryInbox, ...rest.map((m) => ({ id: m.id, text: m.text, at: m.at, ...(m.project ? { from: m.project } : {}) }))]);
  try { localStorage.setItem('thoughtdag.memory.legacy', JSON.stringify(legacy)); } catch { /* the fold is the record */ }
  st.setMemories([]);
}

/** Merge one observed fact into a document: the model rewrites the lines
 *  (refine or replace the line it touches, else add one) and names the
 *  change. Returns what it was and what it is, so a toast can undo. */
export async function mergeIntoDoc(kind: ProfileKind, fact: string): Promise<{ before: MemoryDoc; after: MemoryDoc }> {
  const before = useUiStore.getState().profile[kind];
  const lines = docLines(before);
  const now = new Date().toISOString();
  let after: MemoryDoc;
  if (!lines.length) {
    after = { text: asDoc([fact]), updatedAt: now, changelog: [{ at: now, note: fact.slice(0, 80) }] };
  } else {
    const what = kind === 'preferences' ? 'how the user likes things done (language, style, format, tools, models)' : 'who the user is (role, field, expertise, long-term agenda)';
    const prompt = `A document of durable notes about one user — ${what} — one fact per line:\n\n${asDoc(lines)}\n\nA new fact was observed: "${fact}"\n\nRewrite the document so it includes the new fact: when it refines or contradicts an existing line, rewrite that line (the newest observation wins); otherwise add one line. Keep every line short and in the language the lines are written in; no duplicates, no headings, no commentary. Output the document lines only, each starting with "- ", then one last line "CHANGE: <one short sentence saying what changed>".`;
    const bg = (await getModelsOnce())?.default ?? undefined;
    const raw = await llmCall([{ role: 'user', content: prompt }], undefined, bg);
    const out = raw.split('\n').map((l) => l.trim());
    const newLines = out.filter((l) => /^[-•*]\s+/.test(l)).map((l) => l.replace(/^[-•*]\s+/, '').trim()).filter(Boolean);
    const change = out.find((l) => /^CHANGE:/i.test(l))?.replace(/^CHANGE:\s*/i, '').trim() || fact.slice(0, 80);
    if (newLines.length < Math.max(1, Math.floor(lines.length / 2))) throw new Error('the rewrite dropped most of the document');
    after = { text: asDoc(newLines), updatedAt: now, changelog: [...before.changelog, { at: now, note: change }].slice(-CHANGELOG_CAP) };
  }
  const st = useUiStore.getState();
  st.setProfile({ ...st.profile, [kind]: after });
  return { before, after };
}

/** A hand edit: the text as typed, one changelog line. */
export function setDocText(kind: ProfileKind, text: string, note: string): void {
  const st = useUiStore.getState();
  const now = new Date().toISOString();
  const cur = st.profile[kind];
  st.setProfile({ ...st.profile, [kind]: { text: asDoc(text.split('\n').map((l) => l.replace(/^[-•*\s]+/, '').trim()).filter(Boolean)), updatedAt: now, changelog: [...cur.changelog, { at: now, note }].slice(-CHANGELOG_CAP) } });
}

export function restoreDoc(kind: ProfileKind, doc: MemoryDoc): void {
  const st = useUiStore.getState();
  st.setProfile({ ...st.profile, [kind]: doc });
}

// ── the inbox: project facts no topic claimed ──
export function addInbox(text: string, from?: string): InboxItem {
  const item: InboxItem = { id: generateId(), text: text.trim(), at: new Date().toISOString(), ...(from ? { from } : {}) };
  const st = useUiStore.getState();
  st.setMemoryInbox([...st.memoryInbox, item]);
  return item;
}
export function removeInbox(id: string): void {
  const st = useUiStore.getState();
  st.setMemoryInbox(st.memoryInbox.filter((i) => i.id !== id));
}
