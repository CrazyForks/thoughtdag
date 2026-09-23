// A live session log, read incrementally: what the canvas already holds and
// what to ask the host for next. Pure functions, so the arithmetic that
// once lost an event has a test.

/** The seq of the last event in a JSONL log, or null when no line carries
 *  one (a header alone, or a torn last line). Scans from the end: the log
 *  can be long and only its tail matters here. */
export function lastSeqOf(log: string): number | null {
  let end = log.length;
  while (end > 0 && log.charCodeAt(end - 1) === 10) end--;
  if (end === 0) return null;
  const start = log.lastIndexOf('\n', end - 1) + 1;
  try {
    const seq = (JSON.parse(log.slice(start, end)) as { seq?: unknown }).seq;
    return typeof seq === 'number' ? seq : null;
  } catch { return null; }
}

export type LiveTailPlan =
  | { kind: 'reuse' }                 // the held log already has everything
  | { kind: 'tail'; since: number }   // ask for the events strictly after `since`
  | { kind: 'full' };                 // nothing usable held: fetch the whole log

/** What to fetch for a live session whose list entry now reports `listSeq`.
 *
 *  The tail is defined by the last event we actually HOLD, never by the seq
 *  the list reported when we fetched: that seq is the number of the NEXT
 *  event (and the log may have grown between the list and our fetch), while
 *  the host answers `?since=` with the events strictly after it. Asking with
 *  the list's seq dropped exactly one event, the first after our snapshot;
 *  when a step is a single assistant/message rather than a run of chunks,
 *  that event was the answer, and the node mirrored from this projection
 *  lost it. */
export function liveTailPlan(held: string | null | undefined, listSeq: number | null | undefined): LiveTailPlan {
  if (!held || typeof listSeq !== 'number') return { kind: 'full' };
  const last = lastSeqOf(held);
  if (last === null) return { kind: 'full' };
  return listSeq <= last + 1 ? { kind: 'reuse' } : { kind: 'tail', since: last };
}
