// Pi as a model the canvas can pick: the desktop shell runs `pi --mode rpc`
// (window.desktopAgents), the canvas compiles what it wired in and hands
// over one prompt, Pi answers with its own tools in a working directory,
// and its events come back as the same callbacks a streamed model call
// uses. Pi keeps the session file, the keys and the catalog; the canvas
// keeps the context. Same shape as the harness lane inside DeepSeek
// Harness, one runtime further.

import type { ContextMessage, ImageAttachment, StreamCallbacks } from '../api';
import type { ModelInfo } from '../use-models';

/** Picker ids of agent-run models: `pi/<provider>/<model>`. */
export const PI_MODEL_PREFIX = 'pi/';
/** The provider key the picker groups every agent-run model under. */
export const AGENT_PROVIDER = '__agent__';

export const isAgentModel = (id: string | undefined | null): boolean => !!id && id.startsWith(PI_MODEL_PREFIX);

/** `pi/<provider>/<model>` → Pi's own coordinates, or null. */
export function piTarget(id: string): { provider: string; id: string } | null {
  if (!isAgentModel(id)) return null;
  const rest = id.slice(PI_MODEL_PREFIX.length);
  const i = rest.indexOf('/');
  if (i <= 0 || i === rest.length - 1) return null;
  return { provider: rest.slice(0, i), id: rest.slice(i + 1) };
}

/** Pi's configured models as picker entries, or none when Pi is not around. */
export async function agentModels(): Promise<ModelInfo[]> {
  const bridge = window.desktopAgents;
  if (!bridge) return [];
  try {
    const r = await bridge.models();
    if (!r?.installed) return [];
    return r.models.map((m) => ({
      id: `${PI_MODEL_PREFIX}${m.provider}/${m.id}`,
      name: `Pi · ${m.name}`,
      provider: AGENT_PROVIDER,
      vision: m.vision,
    }));
  } catch {
    return [];
  }
}

export type AgentRoute = { cwd: string; sessionPath?: string; forkEntryId?: string; continue?: boolean };

export type CwdChoice = { cwd: string; kind: 'chosen' | 'mirrored' | 'workspace' };

/** The working directory the active canvas's agent turns run in: the one
 *  the person chose for this canvas, else the project its mirrored nodes
 *  came from, else the canvas's own workspace. */
export async function resolveAgentCwd(): Promise<CwdChoice | null> {
  if (!window.desktopAgents) return null;
  try {
    const { useStore } = await import('../../store');
    const { useProjects } = await import('../../store/projects');
    const { projects, activeId } = useProjects.getState();
    const meta = projects.find((p) => p.id === activeId);
    if (meta?.agentCwd) return { cwd: meta.agentCwd, kind: 'chosen' };
    const counts = new Map<string, number>();
    for (const n of useStore.getState().nodes) {
      const c = n.data.importSource?.cwd;
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let best: string | null = null; let bestN = 0;
    for (const [c, n] of counts) if (n > bestN) { best = c; bestN = n; }
    const workspace = await window.desktopAgents.workspace(activeId ?? 'default');
    if (best && best !== workspace) return { cwd: best, kind: 'mirrored' };
    return { cwd: workspace, kind: 'workspace' };
  } catch {
    return null;
  }
}

/** The mirrored project directory of the active canvas, if any. */
export async function mirroredCwd(): Promise<string | null> {
  try {
    const { useStore } = await import('../../store');
    const { useProjects } = await import('../../store/projects');
    const workspace = window.desktopAgents ? await window.desktopAgents.workspace(useProjects.getState().activeId ?? 'default') : null;
    const counts = new Map<string, number>();
    for (const n of useStore.getState().nodes) {
      const c = n.data.importSource?.cwd;
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let best: string | null = null; let bestN = 0;
    for (const [c, n] of counts) if (n > bestN) { best = c; bestN = n; }
    return best && best !== workspace ? best : null;
  } catch { return null; }
}

/** The Pi session file for a session id: the tail node's own record, else
 *  the file under the Pi root whose name carries the id. */
async function piSessionFile(sessionId: string, tail: { data: { agentSession?: { sessionId: string | null; sessionFile: string | null } } } | undefined): Promise<string | null> {
  const own = tail?.data.agentSession;
  if (own?.sessionId === sessionId && own.sessionFile) return own.sessionFile;
  const bridge = window.desktopSessions;
  if (!bridge) return null;
  try {
    const roots = await bridge.roots();
    const root = roots.find((x) => x.key === 'pi-sessions');
    if (!root) return null;
    const files = await bridge.list('pi-sessions');
    const hit = files.find((f) => f.rel.includes(sessionId));
    return hit ? `${root.path.replace(/\/$/, '')}/${hit.rel}` : null;
  } catch { return null; }
}

/**
 * The route for the node about to generate. A question asked DIRECTLY off
 * the tail of a Pi session this canvas subscribes to, with nothing else
 * wired in, continues that session in its own directory: the session
 * already holds the conversation, so only the question travels. Any other
 * wiring, or a different working directory, opens a fresh session carrying
 * the compiled context.
 */
export async function agentOutbound(model: string | undefined, nodeId?: string): Promise<AgentRoute | undefined> {
  if (!window.desktopAgents || !isAgentModel(model)) return undefined;
  const choice = await resolveAgentCwd();
  if (!choice) return undefined;
  if (!nodeId) return { cwd: choice.cwd };
  try {
    const { useStore } = await import('../../store');
    const { useProjects } = await import('../../store/projects');
    const { projects, activeId } = useProjects.getState();
    const ss = projects.find((p) => p.id === activeId)?.sourceSession;
    if (!ss) return { cwd: choice.cwd };
    const { nodes, edges } = useStore.getState();
    const incoming = edges.filter((e) => e.target === nodeId);
    if (incoming.length !== 1) return { cwd: choice.cwd };
    const parentId = incoming[0].source;
    const entries = [ss, ...(ss.chapters ?? []), ...(ss.branches ?? [])].filter((e) => e.runner === 'pi' && e.sessionId);
    const entry = entries.find((e) => e.tailNodeId === parentId);
    if (!entry) return { cwd: choice.cwd };
    const tail = nodes.find((n) => n.id === parentId);
    const sessionCwd = tail?.data.agentSession?.cwd ?? tail?.data.importSource?.cwd ?? null;
    if (sessionCwd && sessionCwd !== choice.cwd) return { cwd: choice.cwd };
    const sessionPath = await piSessionFile(entry.sessionId, tail);
    if (!sessionPath) return { cwd: choice.cwd };
    return { cwd: sessionCwd ?? choice.cwd, sessionPath, continue: true };
  } catch {
    return { cwd: choice.cwd };
  }
}

/**
 * The moment a continued turn names its session: the node becomes that
 * turn's mirror now — provenance stamped, ledger advanced — so the live
 * sweep, which polls the file every few seconds, does not append the
 * in-progress turn a second time. The completion stamp fills in the rest.
 */
export async function claimPiTurn(nodeId: string, sessionId: string, cwd: string): Promise<void> {
  try {
    const { useStore } = await import('../../store');
    const { useProjects, patchLedgerEntry, subscribedSessionIds } = await import('../../store/projects');
    const { projects, activeId } = useProjects.getState();
    const meta = activeId ? projects.find((p) => p.id === activeId) : undefined;
    if (!meta || !activeId || !subscribedSessionIds(meta).includes(sessionId)) return;
    const ss = meta.sourceSession!;
    const entry = [ss, ...(ss.chapters ?? []), ...(ss.branches ?? [])].find((e) => e.sessionId === sessionId);
    if (!entry) return;
    useStore.setState((st) => ({
      nodes: st.nodes.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, importSource: { runner: 'pi', sessionId, itemIds: [], cwd } } } : n),
    }));
    await patchLedgerEntry(activeId, sessionId, { importedCount: entry.importedCount + 1, tailNodeId: nodeId });
  } catch { /* the completion stamp still lands */ }
}

/** The materials wired into a node's context — its own and its ancestors'
 *  document attachments — written where the agent can read them. Returns
 *  the note to append to the prompt, or '' when nothing was written. */
async function materialsToDisk(nodeId: string | undefined, cwd: string): Promise<string> {
  if (!nodeId || !window.desktopAgents) return '';
  try {
    const { useStore } = await import('../../store');
    const { loadAttachmentContent } = await import('../attachment-vault');
    const { nodes, edges } = useStore.getState();
    const seen = new Set<string>();
    const queue = [nodeId];
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const e of edges) if (e.target === id && !seen.has(e.source)) queue.push(e.source);
    }
    const files: { name: string; content: string; encoding?: 'utf8' | 'base64' }[] = [];
    const names = new Set<string>();
    for (const n of nodes) {
      if (!seen.has(n.id)) continue;
      for (const att of n.data.attachments ?? []) {
        if (att.op || /^(tool|🔧|⌨️)/.test(att.name)) continue; // tool footprints are not materials
        if (names.has(att.name) || files.length >= 40) continue;
        const isPdf = /^application\/pdf/.test(att.type);
        const isImage = att.type.startsWith('image/');
        if (isImage) continue;
        let content = '';
        try { content = await loadAttachmentContent(att); } catch { content = att.content; }
        if (!content) continue;
        names.add(att.name);
        if (isPdf) files.push({ name: att.name, content, encoding: 'base64' });
        else files.push({ name: att.name, content });
      }
    }
    if (files.length === 0) return '';
    const r = await window.desktopAgents.writeMaterials(cwd, files);
    if (!r.dir || r.written.length === 0) return '';
    return `The canvas's materials are also on disk, readable with your tools, under ${r.dir}:\n` + r.written.map((f) => '- ' + f).join('\n');
  } catch {
    return '';
  }
}

/** The canvas's compiled messages, split for an agent that keeps its own
 *  history: the last user message is the question; everything before it is
 *  the context the canvas wired in, sent ahead of the question as one block. */
export function compileForAgent(messages: ContextMessage[]): { question: string; context: string } {
  const msgs = messages.filter((m) => m && typeof m.content === 'string' && m.content.trim());
  const last = msgs[msgs.length - 1];
  if (!last || last.role !== 'user') throw new Error('the last message must be the question');
  const system = msgs.slice(0, -1).filter((m) => m.role === 'system').map((m) => m.content.trim());
  const history = msgs.slice(0, -1).filter((m) => m.role !== 'system');
  const parts: string[] = [];
  if (system.length) parts.push('Instructions from the canvas:\n\n' + system.join('\n\n'));
  if (history.length) parts.push('The conversation the canvas wired into this question, oldest first:\n\n' + history.map((m) => `[${m.role === 'assistant' ? 'assistant' : 'user'}]\n${m.content.trim()}`).join('\n\n'));
  const context = parts.length
    ? '[ThoughtDAG canvas context] The question that follows was asked from a ThoughtDAG canvas. Treat the material below as the conversation so far; answer the question at the end.\n\n' + parts.join('\n\n---\n\n')
    : '';
  return { question: last.content.trim(), context };
}

type AgentEvent = { runId: string; event: Record<string, unknown> & { type: string } };
const handlers = new Map<string, (event: AgentEvent['event']) => void>();
let subscribed = false;
function subscribe() {
  if (subscribed || !window.desktopAgents) return;
  subscribed = true;
  window.desktopAgents.onEvent(({ runId, event }) => { handlers.get(runId)?.(event); });
}

/** One line naming what a tool call does, for the node's progress row. */
function toolQuery(name: string, args: unknown): string {
  const a = args && typeof args === 'object' ? (args as Record<string, unknown>) : null;
  if (!a) return '';
  for (const k of ['command', 'path', 'file_path', 'pattern', 'url', 'query', 'description']) {
    const v = a[k];
    if (typeof v === 'string' && v) return v.slice(0, 120);
  }
  const first = Object.values(a).find((v) => typeof v === 'string' && v);
  return typeof first === 'string' ? first.slice(0, 120) : name;
}

/**
 * One turn on the Pi runtime with the streamed-call contract: text deltas
 * through onChunk, thinking through onReasoning, tool starts through
 * onToolCall, the session through onAgentSession; resolves with the final
 * text; an aborted signal stops Pi and rejects with AbortError.
 */
export async function agentCallStream(
  messages: ContextMessage[],
  onChunk: (chunk: string, fullSoFar: string) => void,
  signal: AbortSignal | undefined,
  images: ImageAttachment[] | undefined,
  callbacks: StreamCallbacks | undefined,
  modelId: string,
  route: AgentRoute | undefined,
  nodeId?: string,
): Promise<string> {
  const bridge = window.desktopAgents;
  if (!bridge) throw new Error('agent runtimes need the desktop app');
  const target = piTarget(modelId);
  if (!target) throw new Error('not an agent model: ' + modelId);
  const cwd = route?.cwd ?? (await agentOutbound(modelId))?.cwd;
  if (!cwd) throw new Error('no working directory for this canvas');
  const { question, context } = compileForAgent(messages);
  await writeGuard(cwd);
  const continuing = !!route?.continue && !!route?.sessionPath;
  const materials = continuing ? '' : await materialsToDisk(nodeId, cwd);
  const ahead = continuing ? '' : [context, materials].filter(Boolean).join('\n\n');
  const prompt = ahead ? `${ahead}\n\n---\n\n${question}` : question;
  subscribe();

  let full = '';
  let reasoning = '';
  let finalText = '';
  const done = new Promise<{ how: string; error?: string }>((resolve) => {
    void bridge.run({
      cwd, prompt,
      ...(route?.sessionPath ? { sessionPath: route.sessionPath } : {}),
      ...(route?.forkEntryId ? { forkEntryId: route.forkEntryId } : {}),
      images: (images ?? []).map((img) => ({ type: 'image' as const, data: img.data, mimeType: img.mimeType })),
      model: target,
    }).then((runId) => {
      const stop = () => { void bridge.abort(runId); };
      if (signal?.aborted) { stop(); }
      signal?.addEventListener('abort', stop, { once: true });
      handlers.set(runId, (event) => {
        switch (event.type) {
          case 'session':
            callbacks?.onAgentSession?.({
              runtime: 'pi',
              sessionId: (event.sessionId as string | null) ?? null,
              sessionFile: (event.sessionFile as string | null) ?? null,
              cwd: (event.cwd as string) ?? cwd,
            });
            break;
          case 'message_update': {
            const ev = event.assistantMessageEvent as { type?: string; delta?: string } | undefined;
            if (ev?.type === 'text_delta' && ev.delta) { full += ev.delta; onChunk(ev.delta, full); }
            else if (ev?.type === 'thinking_delta' && ev.delta) { reasoning += ev.delta; callbacks?.onReasoning?.(ev.delta, reasoning); }
            break;
          }
          case 'tool_execution_start': {
            const name = String(event.toolName ?? 'tool');
            // the trace, not the one-line placeholder: the node shows every call
            const query = toolQuery(name, event.args);
            callbacks?.onAgentTool?.({ id: String(event.toolCallId ?? ''), name, query, phase: 'start' });
            break;
          }
          case 'tool_execution_end':
            callbacks?.onAgentTool?.({ id: String(event.toolCallId ?? ''), name: String(event.toolName ?? 'tool'), query: '', phase: 'end', isError: !!event.isError });
            break;
          case 'extension_ui_cancelled': {
            // an extension's own question, withdrawn: the run goes on with the
            // dialog's default; the trace says so, the terminal is where to answer
            const id = `dialog-${Date.now()}`;
            const title = String(event.title ?? event.method ?? 'dialog');
            callbacks?.onAgentTool?.({ id, name: 'dialog', query: title, phase: 'start' });
            callbacks?.onAgentTool?.({ id, name: 'dialog', query: '', phase: 'end', isError: true });
            break;
          }
          case 'question_answered':
            callbacks?.onApprovalDecided?.({ id: String(event.id), outcome: (event.outcome as import('../../types').ApprovalOutcome) ?? 'cancelled', value: typeof event.value === 'string' ? event.value : null });
            break;
          case 'question':
            callbacks?.onApproval?.({
              id: String(event.id), kind: (event.kind as 'confirm' | 'select' | 'input' | 'editor') ?? 'confirm',
              toolName: 'pi', callId: null, reason: null,
              name: String(event.title ?? ''), query: String(event.message ?? ''), arguments: null,
              options: Array.isArray(event.options) ? (event.options as string[]) : [],
              placeholder: typeof event.placeholder === 'string' ? event.placeholder : null,
              prefill: typeof event.prefill === 'string' ? event.prefill : null,
              channel: { runId },
              paths: Array.isArray(event.paths) ? (event.paths as string[]) : [],
              suggest: typeof event.suggest === 'string' ? event.suggest : null,
            });
            break;
          case 'fs_changes':
            callbacks?.onAgentChanges?.({ changed: (event.changed as string[]) ?? [], added: (event.added as string[]) ?? [], removed: (event.removed as string[]) ?? [], truncated: !!event.truncated });
            break;
          case 'run_end':
            finalText = typeof event.text === 'string' && event.text ? event.text : full;
            handlers.delete(runId);
            signal?.removeEventListener('abort', stop);
            resolve({ how: String(event.how ?? 'end') });
            break;
          case 'run_error':
            handlers.delete(runId);
            signal?.removeEventListener('abort', stop);
            resolve({ how: 'error', error: String(event.message ?? 'agent run failed') });
            break;
          default:
            break;
        }
      });
    }).catch((e: unknown) => resolve({ how: 'error', error: e instanceof Error ? e.message : String(e) }));
  });
  const r = await done;
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  if (r.how === 'error') throw new Error(r.error ?? 'agent run failed');
  return finalText || full;
}

/** After a Pi run: the node becomes the mirror of the turn Pi just wrote —
 *  the turn's tool calls as attachments (footprints), provenance
 *  (runner, session, item ids, cwd), the source snapshot — and the canvas
 *  subscribes to the session so turns added later, from the terminal,
 *  append here. The live sweep never appends this turn a second time: the
 *  ledger records it as imported with this node as the tail. */
export async function adoptPiTurn(nodeId: string, session: { sessionFile: string | null; sessionId: string | null; cwd: string }, question: string): Promise<boolean> {
  const bridge = window.desktopSessions;
  if (!bridge || !session.sessionFile) return false;
  const marker = '/agent/sessions/';
  const at = session.sessionFile.indexOf(marker);
  if (at < 0) return false;
  const rel = session.sessionFile.slice(at + marker.length);
  try {
    const { piSessionConversation } = await import('../adapters/pi-session');
    const { useStore } = await import('../../store');
    const { useProjects, registerLedgerEntry, updateSourceSession, subscribedSessionIds } = await import('../../store/projects');
    const text = await bridge.read('pi-sessions', rel);
    if (!text) return false;
    const conv = piSessionConversation(text);
    if (!conv?.sessionId) return false;
    const built = conv.build();
    const qa = built.nodes.filter((n) => n.data.importSource);
    const q = question.trim();
    let idx = -1;
    for (let i = qa.length - 1; i >= 0; i--) {
      const qq = qa[i].data.question.trim();
      if (qq === q || qq.endsWith(q) || q.endsWith(qq)) { idx = i; break; }
    }
    if (idx < 0) idx = qa.length - 1;
    if (idx < 0) return false;
    const turn = qa[idx];
    const toolAtts = turn.data.attachments ?? [];
    // what the file system saw change, beyond what the tools declared:
    // a shell redirect, a script's output — one footprint attachment
    const fsAtt = fsFootprint(session, toolAtts);
    const agentAtts = fsAtt ? [...toolAtts, fsAtt] : toolAtts;
    useStore.setState((st) => ({
      nodes: st.nodes.map((n) => n.id === nodeId
        ? { ...n, data: {
            ...n.data,
            attachments: [...(n.data.attachments ?? []).filter((a) => !a.op), ...agentAtts],
            // footprints are pointers, not contents: an agent turn's tool
            // outputs stay out of downstream context unless brought back by hand
            excludedAttachmentIds: [...new Set([...(n.data.excludedAttachmentIds ?? []), ...agentAtts.map((a) => a.id)])],
            importSource: turn.data.importSource,
            // the snapshot is what Pi recorded — the compiled context ahead of
            // the question — so the node reads as edited (the question as
            // asked) and the live sweep never rewrites it from the file
            source: turn.data.source ?? { question: turn.data.question, response: turn.data.response },
            agentTrace: undefined,
          } }
        : n),
    }));
    const { projects, activeId } = useProjects.getState();
    const meta = activeId ? projects.find((p) => p.id === activeId) : undefined;
    if (!meta) return true;
    const entry = { sessionId: conv.sessionId, runner: 'pi', importedCount: idx + 1, tailNodeId: nodeId };
    if (subscribedSessionIds(meta).includes(conv.sessionId)) {
      const { patchLedgerEntry } = await import('../../store/projects');
      await patchLedgerEntry(activeId!, conv.sessionId, { importedCount: idx + 1, tailNodeId: nodeId });
    } else if (!meta.sourceSession) {
      await updateSourceSession(activeId!, entry);
      if (!useProjects.getState().projects.find((p) => p.id === activeId)?.sourceSession) {
        // updateSourceSession only patches an existing ledger: create it
        useProjects.setState((st) => ({ projects: st.projects.map((p) => (p.id === activeId ? { ...p, sourceSession: entry } : p)) }));
        await registerLedgerEntry(activeId!, 'chapter', entry).catch(() => {});
        useProjects.setState((st) => ({ projects: st.projects.map((p) => (p.id === activeId && p.sourceSession ? { ...p, sourceSession: { ...p.sourceSession, chapters: (p.sourceSession.chapters ?? []).filter((c) => c.sessionId !== entry.sessionId) } } : p)) }));
      }
    } else {
      await registerLedgerEntry(activeId!, 'chapter', entry);
    }
    return true;
  } catch {
    return false;
  }
}

/** The active canvas's guard tuning, as the guard file expects it. */
export async function guardConfig(): Promise<{ mode: 'ask' | 'allow'; allow: string[] }> {
  try {
    const { useProjects } = await import('../../store/projects');
    const { projects, activeId } = useProjects.getState();
    const g = projects.find((p) => p.id === activeId)?.agentGuard;
    return { mode: g?.mode === 'allow' ? 'allow' : 'ask', allow: g?.allow ?? [] };
  } catch { return { mode: 'ask', allow: [] }; }
}

/** Write the guard file for a working directory (the run's, or the
 *  canvas's current one when omitted). */
export async function writeGuard(cwd?: string): Promise<void> {
  if (!window.desktopAgents) return;
  const dir = cwd ?? (await resolveAgentCwd())?.cwd;
  if (!dir) return;
  try { await window.desktopAgents.guardWrite(dir, await guardConfig()); } catch { /* the guard falls back to asking */ }
}

/** Switch the active canvas's guard mode, effective for the run in progress. */
export async function setGuardMode(mode: 'ask' | 'allow'): Promise<void> {
  const { useProjects, setProjectAgentGuard } = await import('../../store/projects');
  const { projects, activeId } = useProjects.getState();
  if (!activeId) return;
  const g = projects.find((p) => p.id === activeId)?.agentGuard;
  await setProjectAgentGuard(activeId, { mode, allow: g?.allow ?? [] });
  await writeGuard();
}

/** Let a directory through from now on for the active canvas (and the
 *  run in progress); `remove` takes it back. */
export async function allowLocation(dir: string, remove = false): Promise<void> {
  const { useProjects, setProjectAgentGuard } = await import('../../store/projects');
  const { projects, activeId } = useProjects.getState();
  if (!activeId) return;
  const g = projects.find((p) => p.id === activeId)?.agentGuard;
  const allow = remove ? (g?.allow ?? []).filter((a) => a !== dir) : [...new Set([...(g?.allow ?? []), dir])];
  await setProjectAgentGuard(activeId, { mode: g?.mode ?? 'ask', allow });
  await writeGuard();
}

/** One attachment naming the files the file system saw change during the
 *  turn that the tools did not already declare — absolute paths, op
 *  "write", the why layer's join key like any footprint. */
function fsFootprint(
  session: { cwd: string; changes?: { changed: string[]; added: string[]; removed: string[]; truncated?: boolean } },
  toolAtts: import('../../types').Attachment[],
): import('../../types').Attachment | null {
  const ch = session.changes;
  if (!ch) return null;
  const declared = new Set<string>();
  for (const a of toolAtts) for (const p of a.paths ?? []) declared.add(p.startsWith('/') ? p : `${session.cwd.replace(/\/$/, '')}/${p}`);
  const changed = [...ch.changed, ...ch.added].filter((p) => !declared.has(p));
  const removed = ch.removed.filter((p) => !declared.has(p));
  if (changed.length === 0 && removed.length === 0 && !ch.truncated) return null;
  const rel = (p: string) => (p.startsWith(session.cwd) ? p.slice(session.cwd.length).replace(/^\//, '') : p);
  const lines: string[] = [];
  if (changed.length) lines.push('Changed on disk during this turn (seen by the file system, not declared by a tool):', ...changed.map((p) => '- ' + rel(p)));
  if (removed.length) lines.push('Removed:', ...removed.map((p) => '- ' + rel(p)));
  if (ch.truncated) lines.push('(the directory was too large to scan completely)');
  return {
    id: `fs-${Date.now().toString(36)}`, name: 'tool: fs-changes', type: 'text/plain', size: 0,
    content: lines.join('\n'), op: 'write', paths: [...changed, ...removed],
  } as import('../../types').Attachment;
}
