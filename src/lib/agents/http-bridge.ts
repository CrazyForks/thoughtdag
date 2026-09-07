// window.desktopAgents over HTTP: the same surface the desktop shell
// exposes through IPC, implemented on a host's /agents endpoints — the
// harness plugin's host, or the local server. Events arrive on one
// server-sent-events feed. Installed only when the host answers; the
// hosted deployment has no machine to run an agent on and never does.

export async function installAgentsHttpBridge(apiBase: string): Promise<boolean> {
  if (window.desktopAgents) return true;
  const api = apiBase.replace(/\/+$/, '');
  let available: Record<string, string | null>;
  try {
    const r = await fetch(api + '/agents/available', { credentials: 'same-origin' });
    if (!r.ok) return false;
    available = await r.json();
  } catch { return false; }
  const post = async <T,>(path: string, body: unknown): Promise<T> => {
    const r = await fetch(api + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify(body ?? {}) });
    if (!r.ok) throw new Error(`${path}: ${r.status}`);
    return r.json() as Promise<T>;
  };
  const listeners: ((p: { runId: string; event: Record<string, unknown> & { type: string } }) => void)[] = [];
  let feed: EventSource | null = null;
  const ensureFeed = () => {
    if (feed) return;
    feed = new EventSource(api + '/agents/events');
    feed.onmessage = (ev) => {
      try { const p = JSON.parse(ev.data); for (const cb of listeners) cb(p); } catch { /* a heartbeat */ }
    };
  };
  window.desktopAgents = {
    capabilities: { nativePicker: false },
    available: async () => available,
    models: async (runtime) => {
      const r = await fetch(api + '/agents/models' + (runtime ? `?runtime=${encodeURIComponent(runtime)}` : ''), { credentials: 'same-origin' });
      return r.json();
    },
    run: async (request) => { ensureFeed(); const r = await post<{ runId: string }>('/agents/run', request); return r.runId; },
    abort: async (runId) => (await post<{ ok: boolean }>('/agents/abort', { runId })).ok,
    answer: async (runId, requestId, response) => (await post<{ ok: boolean }>('/agents/answer', { runId, requestId, response })).ok,
    workspace: async (canvasId) => (await post<{ dir: string }>('/agents/workspace', { canvasId })).dir,
    pickCwd: async () => null,
    guardWrite: async (cwd, config) => (await post<{ ok: boolean }>('/agents/guard', { cwd, config })).ok,
    writeMaterials: async (cwd, files) => post('/agents/materials', { cwd, files }),
    onEvent: (cb) => { listeners.push(cb); ensureFeed(); },
  };
  return true;
}
