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

export type AgentRoute = { cwd: string; sessionPath?: string; forkEntryId?: string };

/** The working directory the active canvas's turns belong to: the project
 *  its mirrored nodes came from, else the canvas's own workspace. */
export async function agentOutbound(model: string | undefined): Promise<AgentRoute | undefined> {
  if (!window.desktopAgents || !isAgentModel(model)) return undefined;
  try {
    const { useStore } = await import('../../store');
    const { useProjects } = await import('../../store/projects');
    const counts = new Map<string, number>();
    for (const n of useStore.getState().nodes) {
      const c = n.data.importSource?.cwd;
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    let best: string | null = null; let bestN = 0;
    for (const [c, n] of counts) if (n > bestN) { best = c; bestN = n; }
    if (best) return { cwd: best };
    const activeId = useProjects.getState().activeId ?? 'default';
    return { cwd: await window.desktopAgents.workspace(activeId) };
  } catch {
    return undefined;
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
): Promise<string> {
  const bridge = window.desktopAgents;
  if (!bridge) throw new Error('agent runtimes need the desktop app');
  const target = piTarget(modelId);
  if (!target) throw new Error('not an agent model: ' + modelId);
  const cwd = route?.cwd ?? (await agentOutbound(modelId))?.cwd;
  if (!cwd) throw new Error('no working directory for this canvas');
  const { question, context } = compileForAgent(messages);
  const prompt = context ? `${context}\n\n---\n\n${question}` : question;
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
          case 'tool_execution_start':
            callbacks?.onToolCall?.(String(event.toolName ?? 'tool'), toolQuery(String(event.toolName ?? ''), event.args));
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
