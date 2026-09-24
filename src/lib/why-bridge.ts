// The why layer, reached from the canvas: the desktop shell answers over
// IPC (window.desktopWhy), the harness plugin's host over HTTP, the hosted
// web app not at all (no machine to index). One shape either way; null
// where nothing can answer, so the UI hides what it cannot offer.
import { IN_HARNESS } from './embedded';

export type WhyBridge = Pick<DesktopWhyBridge, 'find' | 'recall' | 'memories'>;

let cached: WhyBridge | null | undefined;

export function whyBridge(): WhyBridge | null {
  if (cached !== undefined) return cached;
  if (window.desktopWhy) { cached = window.desktopWhy; return cached; }
  const api = (import.meta.env.VITE_DSH_BRIDGE as string | undefined)?.replace(/\/+$/, '');
  if (IN_HARNESS && api) {
    const get = async <T,>(path: string, params: Record<string, string>): Promise<T> => {
      const q = new URLSearchParams(params).toString();
      const r = await fetch(`${api}${path}${q ? `?${q}` : ''}`, { credentials: 'same-origin' });
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `${path}: ${r.status}`);
      return r.json() as Promise<T>;
    };
    cached = {
      find: (phrase, opts = {}) => get('/why/find', { phrase, scope: opts.scope ?? 'all', limit: String(opts.limit ?? 20), ...(opts.cwd ? { cwd: opts.cwd } : {}) }),
      recall: (session, turn) => get('/why/recall', { session, turn: String(turn) }),
      memories: () => get('/why/memories', {}),
    };
    return cached;
  }
  cached = null;
  return cached;
}

/** Whether this build can answer at all (the UI shows the entry only then). */
export const hasWhy = (): boolean => whyBridge() !== null;
