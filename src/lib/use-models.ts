import { useEffect, useState } from 'react';
import { API_BASE } from './constants';
import { storedProviders, pushProviders } from './runtime-providers';
import { agentModels, AGENT_PROVIDER } from './agents/agent-runtime';

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  vision: boolean;
}

export interface Capabilities {
  webSearch: boolean;
  searchEngine: string;
  /** AnySearch engine reachable (always true locally; hosted = key present). */
  anysearch?: boolean;
  scholarSearch: boolean;
  vision: boolean;
}

export type ModelData = { models: ModelInfo[]; default: string | null; capabilities?: Capabilities; /** the agent runtimes are still being asked */ agentsPending?: boolean };

// Model list is fetched once per session and shared by every picker
let cache: ModelData | null = null;
let inflight: Promise<ModelData | null> | null = null;
const listeners = new Set<(d: ModelData) => void>();

/** Imperative access to the same per-session model cache (e.g. picking an extraction model). */
export function getModelsOnce(): Promise<ModelData | null> {
  if (cache) return Promise.resolve(cache);
  inflight ??= (async () => {
    // browser-stored providers re-register themselves before the first list
    // fetch (the proxy holds them in memory only, so restarts forget them)
    const stored = storedProviders();
    let base: ModelData | null = null;
    if (stored.length > 0) {
      try { base = await pushProviders(stored); } catch { /* proxy down or bad config: fall through to the plain list */ }
    }
    if (!base) {
      base = await fetch(`${API_BASE}/api/models`)
        .then((r) => r.json())
        .then((d) => ({ models: d.models ?? [], default: d.default ?? null, capabilities: d.capabilities }) as ModelData)
        .catch(() => null);
    }
    if (!base) return null;
    // the API models show at once; the agent runtimes answer in their own
    // time (a CLI to start, a catalog to read) — last launch's agent list
    // fills the gap, then the fresh one replaces it
    cache = withRemembered(base);
    void refreshAgents(cache);
    return cache;
  })();
  return inflight;
}

/** Family-level id for cross-provider comparison: the gateway slug
    'deepseek/deepseek-v4-pro' and the direct id 'deepseek-v4-pro' are the
    same model reached through different doors. */
function modelBasename(id: string): string {
  return (id.split('/').pop() ?? id).toLowerCase();
}

/** Reconcile a pinned model id against the locally available list: exact id
    → itself; same family under a different provider → the local id;
    otherwise null (not reachable here). */
export function reconcileModelId(pinned: string, models: ModelInfo[]): string | null {
  if (models.some((m) => m.id === pinned)) return pinned;
  const base = modelBasename(pinned);
  const match = models.find((m) => modelBasename(m.id) === base);
  return match ? match.id : null;
}

const AGENT_CACHE_KEY = 'thoughtdag.agentModels';
const hasAgentsBridge = () => typeof window !== 'undefined' && !!window.desktopAgents;

/** Last launch's agent models, so the picker is whole while the runtimes answer. */
function withRemembered(d: ModelData): ModelData {
  if (!hasAgentsBridge()) return d;
  let remembered: ModelInfo[] = [];
  try { remembered = JSON.parse(localStorage.getItem(AGENT_CACHE_KEY) ?? '[]'); } catch { remembered = []; }
  const own = d.models.filter((m) => m.provider !== AGENT_PROVIDER);
  return { ...d, models: [...own, ...remembered.filter((m) => m && m.provider === AGENT_PROVIDER)], agentsPending: true };
}

/** Ask the runtimes and replace the agent group when they answer. */
async function refreshAgents(base: ModelData): Promise<void> {
  if (!hasAgentsBridge()) return;
  const extra = await agentModels().catch(() => [] as ModelInfo[]);
  try { localStorage.setItem(AGENT_CACHE_KEY, JSON.stringify(extra)); } catch { /* ignore */ }
  const own = (cache ?? base).models.filter((m) => m.provider !== AGENT_PROVIDER);
  setModelsCache({ ...(cache ?? base), models: [...own, ...extra], agentsPending: false });
}

/** Replace the shared cache (after a runtime-key change) and notify every subscribed picker. */
export function setModelsCache(d: ModelData): void {
  cache = d;
  inflight = Promise.resolve(d);
  for (const fn of listeners) fn(d);
  // a list rebuilt from a runtime-key change carries no agent group yet
  if (d.agentsPending === undefined && hasAgentsBridge() && !d.models.some((m) => m.provider === AGENT_PROVIDER)) {
    cache = withRemembered(d);
    for (const fn of listeners) fn(cache);
    void refreshAgents(cache);
  }
}

export function useModels(): ModelData | null {
  const [data, setData] = useState<ModelData | null>(cache);
  useEffect(() => {
    const fn = (d: ModelData) => setData(d);
    listeners.add(fn);
    if (!cache) {
      void getModelsOnce().then((d) => { if (listeners.has(fn) && d) setData(d); });
    }
    return () => { listeners.delete(fn); };
  }, []);
  return data;
}
