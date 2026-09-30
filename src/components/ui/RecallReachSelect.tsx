import { useUiStore, confirmDialog } from '../../lib/ui-store';
import { RECALL_REACH, reachEstimate, type RecallReach } from '../../lib/recall';
import { whyBridge } from '../../lib/why-bridge';
import { useT, fmt } from '../../i18n';

// How far a recall reaches before the judge, as three words. Full is the one
// that costs, so it asks first, with the index's own count and the measured
// rate; the select springs back when the person declines.
export default function RecallReachSelect() {
  const t = useT();
  const value = useUiStore((s) => s.recallReach);
  const set = useUiStore((s) => s.setRecallReach);
  const choose = async (r: RecallReach) => {
    if (r !== 'full') { set(r); return; }
    // the count is a courtesy: a bridge that cannot count (an older shell) still gets the question
    const total = await Promise.resolve().then(() => whyBridge()?.turns({ limit: 0 })).then((x) => x?.total ?? 0).catch(() => 0);
    const est = reachEstimate(total);
    const ok = await confirmDialog({ title: t('recall.reachFullTitle'), message: fmt(t('recall.reachFullMsg'), { n: total.toLocaleString(), s: String(Math.round(est.seconds)), c: est.dollars.toFixed(2) }), confirmLabel: t('recall.reachFullOk') });
    if (ok) set('full');
  };
  return (
    <label className="inline-flex items-center gap-1 text-2xs text-ink-faint" title={t('recall.reachHint')} data-recall-reach>
      <span>{t('recall.reach')}</span>
      <select value={value} onChange={(e) => void choose(e.target.value as RecallReach)} className="bg-transparent border-b border-line text-2xs text-ink-muted focus:outline-none">
        <option value="light">{t('recall.reachLight')} · {RECALL_REACH.light.pool}</option>
        <option value="deep">{t('recall.reachDeep')} · {RECALL_REACH.deep.pool.toLocaleString()}</option>
        <option value="full">{t('recall.reachFull')}</option>
      </select>
    </label>
  );
}
