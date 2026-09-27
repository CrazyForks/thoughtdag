// Local ladders for older nodes, built once, off the main thread.
// Folding the canvas used to compute one for every node in the same frame
// (a dictionary word-break of a long Chinese answer is slow; hundreds of
// nodes made zooming out stall for seconds in 0.5.2). Now a plaque or the
// timeline asks here: the answer comes from a cache, or a Web Worker builds
// it and the asker re-renders when it lands. Without workers (an old
// runtime) the same work runs on the main thread in idle time.
import { useEffect, useState } from 'react';
import type { Ladder } from '../types';
import { buildLocalLadder, LOCAL_LADDER_MIN_CHARS } from './ladder-core';

type Key = string;
const cache = new Map<Key, Ladder | null>();
const pending = new Map<Key, { question: string; response: string; takeaway?: string | null; topic?: string | null }>();
const waiters = new Map<Key, Set<() => void>>();
const versionListeners = new Set<() => void>();
let version = 0;

const settle = (key: Key, ladder: Ladder | null) => {
  cache.set(key, ladder); pending.delete(key); version++;
  for (const fn of waiters.get(key) ?? []) fn();
  waiters.delete(key);
  for (const fn of versionListeners) fn();
};

// ── the worker, or idle time as the fallback ──
let worker: Worker | null | undefined;
function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try { worker = new Worker(new URL('./local-ladder.worker.ts', import.meta.url), { type: 'module' }); }
  catch { worker = null; return null; }
  worker.onmessage = (e: MessageEvent<{ id: string; ladder: Ladder | null }>) => settle(e.data.id, e.data.ladder);
  worker.onerror = () => { worker = null; /* fall back for what is still pending */ if (pending.size) scheduleIdle(); };
  return worker;
}
let idleScheduled = false;
function scheduleIdle(): void {
  if (idleScheduled) return; idleScheduled = true;
  const w = window as unknown as { requestIdleCallback?: (cb: (d: { timeRemaining(): number }) => void, o?: { timeout: number }) => number };
  const run = (deadline: { timeRemaining(): number }) => {
    idleScheduled = false; let n = 0;
    for (const [key, req] of pending) {
      if (n++ > 0 && deadline.timeRemaining() < 3) break;
      let ladder: Ladder | null = null; try { ladder = buildLocalLadder(req.question, req.response, req.takeaway, req.topic); } catch { ladder = null; }
      settle(key, ladder);
    }
    if (pending.size) scheduleIdle();
  };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 500 }); else setTimeout(() => run({ timeRemaining: () => 8 }), 16);
}

const keyOf = (nodeId: string, response: string, takeaway?: string | null, topic?: string | null) => `${nodeId}|${response.length}|${response.slice(0, 40)}|${response.slice(-40)}|${takeaway ?? ''}|${topic ?? ''}`;

/** The cached ladder, or null now with a build under way (a worker message, else idle time). */
export function requestLocalLadder(nodeId: string, question: string, response: string | undefined, takeaway?: string | null, topic?: string | null): Ladder | null {
  if (!response || response.length < LOCAL_LADDER_MIN_CHARS) return null;
  const key = keyOf(nodeId, response, takeaway, topic);
  if (cache.has(key)) return cache.get(key) ?? null;
  if (!pending.has(key)) {
    pending.set(key, { question, response, takeaway, topic });
    const w = getWorker();
    if (w) w.postMessage({ id: key, question, response, takeaway, topic }); else scheduleIdle();
  }
  return null;
}

/** A counter that moves whenever a ladder lands: lists that read many nodes re-render on it. */
export function useLadderCacheVersion(): number {
  const [v, setV] = useState(version);
  useEffect(() => { const fn = () => setV(version); versionListeners.add(fn); return () => { versionListeners.delete(fn); }; }, []);
  return v;
}

/** The node's local ladder: at once when cached, else null now and a re-render when it has been built. */
export function useLocalLadder(enabled: boolean, nodeId: string, question: string, response: string | undefined, takeaway?: string | null, topic?: string | null): Ladder | null {
  const key = enabled && response ? keyOf(nodeId, response, takeaway, topic) : '';
  const [, bump] = useState(0);
  const ready = key && cache.has(key) ? cache.get(key) ?? null : null;
  useEffect(() => {
    if (!key || cache.has(key)) return;
    requestLocalLadder(nodeId, question, response, takeaway, topic);
    const fn = () => bump((x) => x + 1);
    if (!waiters.has(key)) waiters.set(key, new Set());
    waiters.get(key)!.add(fn);
    return () => { waiters.get(key)?.delete(fn); };
  }, [key, nodeId, question, response, takeaway, topic]);
  return ready;
}
