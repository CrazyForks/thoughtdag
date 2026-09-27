// Local ladders off the main thread: the core is pure, so the worker just
// runs it. One message in ({ id, question, response, takeaway, topic }),
// one out ({ id, ladder }).
import { buildLocalLadder } from './ladder-core';

self.onmessage = (e: MessageEvent<{ id: string; question: string; response: string; takeaway?: string | null; topic?: string | null }>) => {
  const { id, question, response, takeaway, topic } = e.data;
  let ladder = null;
  try { ladder = buildLocalLadder(question, response, takeaway, topic); } catch { ladder = null; }
  (self as unknown as { postMessage: (m: unknown) => void }).postMessage({ id, ladder });
};
