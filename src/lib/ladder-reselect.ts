// Right-click → "reselect the summary with a model": one node's active
// version gets a selected ladder (lib/ladder.ts) from the model picked in
// the model picker (the person asked, so their pick wins), else the model
// that wrote the answer, else the default background model. Until it
// lands, and if nothing usable comes back, the plaque keeps its local ladder.
import { useStore } from '../store';
import { toast, useUiStore } from './ui-store';
import { isAgentModel } from './agents/agent-runtime';
import { t, fmt } from '../i18n';
import { buildLadder, ladderModelFor, inFlight } from './ladder';
import { describeModel } from './use-models';

export async function reselectLadder(nodeId: string): Promise<boolean> {
  const n = useStore.getState().nodes.find((x) => x.id === nodeId);
  if (!n) return false;
  const response = n.data.responses[n.data.responseIndex] ?? n.data.response;
  if (!response) return false;
  // an explicit request: the model the person has picked right now wins (an API model), then the answering model, then the default
  const picked = useUiStore.getState().selectedModel;
  const model = picked && !isAgentModel(picked) ? picked : await ladderModelFor(n.data.generatedBy?.[n.data.responseIndex] ?? undefined);
  if (!model) { toast('info', t('ladder.noModel')); return false; }
  toast('info', fmt(t('ladder.reselecting'), { m: describeModel(model) }), 6000);
  inFlight.add(nodeId);
  try {
    const ladder = await buildLadder(n.data.question, response, model);
    if (!ladder) { toast('info', t('ladder.failed')); return false; }
    useStore.getState().setLadder(nodeId, response, ladder);
    toast('success', t('ladder.reselected'));
    return true;
  } catch (e) {
    toast('error', e instanceof Error ? e.message : String(e));
    return false;
  } finally { inFlight.delete(nodeId); }
}
