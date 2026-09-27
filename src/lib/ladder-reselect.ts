// "Update node summaries": the selected nodes' active versions get a
// written ladder (lib/ladder.ts) from the model picked in the model picker
// (the person asked, so their pick wins), else the model that wrote the
// answer, else the default background model. Files, notes, answers still
// generating and short answers are skipped, not failed. Three run at a time;
// progress shows in the bottom-right card (components/ui/LadderJobCard),
// which can stop the job: nodes not yet started are left as they are, the
// ones in flight finish. Until a node's ladder lands, its plaque keeps the
// local one.
import { useStore } from '../store';
import { toast, useUiStore, type LadderJob } from './ui-store';
import { isAgentModel } from './agents/agent-runtime';
import { t } from '../i18n';
import { buildLadder, ladderModelFor, inFlight } from './ladder';
import { ladderContextFor } from './ladder-context';
import { describeModel } from './use-models';
import { SUMMARY_MIN_CHARS } from '../store/streaming';

/** The model an explicit update runs on: the picked API model first. */
async function modelFor(nodeId: string): Promise<string | undefined> {
  const picked = useUiStore.getState().selectedModel;
  if (picked && !isAgentModel(picked)) return picked;
  const n = useStore.getState().nodes.find((x) => x.id === nodeId);
  return ladderModelFor(n?.data.generatedBy?.[n.data.responseIndex] ?? undefined);
}

/** Whether a node has an answer worth selecting from (thought nodes with a long enough active answer). */
export function reselectable(nodeId: string): boolean {
  const n = useStore.getState().nodes.find((x) => x.id === nodeId);
  if (!n || n.data.stepKind || n.data.isLoading) return false;
  const response = n.data.responses?.[n.data.responseIndex] ?? n.data.response;
  return (response?.length ?? 0) >= SUMMARY_MIN_CHARS;
}

const patch = (fn: (j: LadderJob) => Partial<LadderJob>) => useUiStore.getState().setLadderJob((j) => (j ? { ...j, ...fn(j) } : j));

async function updateOne(nodeId: string, model: string): Promise<'done' | 'failed' | 'skipped'> {
  const n = useStore.getState().nodes.find((x) => x.id === nodeId);
  if (!n || !reselectable(nodeId)) return 'skipped';
  const response = n.data.responses[n.data.responseIndex] ?? n.data.response;
  inFlight.add(nodeId);
  try {
    // one more try after a pause, whether the transport failed (rate limit, a dropped connection) or the model's
    // selection came back unusable: a second sampling usually lands
    let ladder = null; let lastError = '';
    for (let attempt = 0; attempt < 2 && !ladder; attempt++) {
      try { const st = useStore.getState(); ladder = await buildLadder(n.data.question, response, model, ladderContextFor(nodeId, st.nodes, st.edges)); }
      catch (e) { lastError = e instanceof Error ? e.message : String(e); }
      if (!ladder && attempt === 0) await new Promise((r) => setTimeout(r, 1500));
    }
    if (!ladder) { if (lastError) patch(() => ({ lastError: lastError.slice(0, 120) })); return 'failed'; }
    useStore.getState().setLadder(nodeId, response, ladder);
    return 'done';
  } finally { inFlight.delete(nodeId); }
}

/** Stop the running job: nothing new starts, what is in flight finishes. */
export function stopLadderJob(): void { patch(() => ({ cancelled: true })); }
export function dismissLadderJob(): void { useUiStore.getState().setLadderJob(null); }

/** Update the summaries of these nodes (one from the right-click menu, many from the selection toolbar). */
export async function updateSummaries(nodeIds: string[]): Promise<{ done: number; skipped: number; failed: number }> {
  if (useUiStore.getState().ladderJob?.running) { toast('info', t('ladder.jobBusy')); return { done: 0, skipped: 0, failed: 0 }; }
  const eligible = nodeIds.filter(reselectable);
  const skipped = nodeIds.length - eligible.length;
  if (!eligible.length) { toast('info', t('ladder.batchNone')); return { done: 0, skipped, failed: 0 }; }
  const model = await modelFor(eligible[0]);
  if (!model) { toast('info', t('ladder.noModel')); return { done: 0, skipped, failed: 0 }; }
  useUiStore.getState().setLadderJob({ total: eligible.length, done: 0, failed: 0, skipped, model: describeModel(model), running: true, cancelled: false });
  const queue = [...eligible];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length && !useUiStore.getState().ladderJob?.cancelled) {
      const id = queue.shift()!;
      const out = await updateOne(id, model);
      patch((j) => (out === 'done' ? { done: j.done + 1 } : out === 'failed' ? { failed: j.failed + 1 } : { skipped: j.skipped + 1 }));
    }
  }));
  patch(() => ({ running: false, finishedAt: Date.now() }));
  const j = useUiStore.getState().ladderJob;
  return { done: j?.done ?? 0, skipped: j?.skipped ?? skipped, failed: j?.failed ?? 0 };
}
