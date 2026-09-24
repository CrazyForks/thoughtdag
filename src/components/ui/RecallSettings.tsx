import { Scale } from 'lucide-react';
import { useUiStore } from '../../lib/ui-store';
import { JUDGE_LABELS, judgeAvailable } from '../../lib/judge';
import { useT, fmt } from '../../i18n';

// The recall's dials on the memory page. The judge itself is configured
// with the other keys (the model-access dialog); this only says which one
// is set and opens that dialog.

export default function RecallSettings() {
  const t = useT();
  const recallLimit = useUiStore((s) => s.recallLimit);
  const setRecallLimit = useUiStore((s) => s.setRecallLimit);
  const recallBudget = useUiStore((s) => s.recallBudget);
  const setRecallBudget = useUiStore((s) => s.setRecallBudget);
  const judgeCfg = useUiStore((s) => s.judge);
  const hasJudge = judgeAvailable(judgeCfg);
  return (
    <section className="mt-8 border-t border-line pt-5 grid grid-cols-2 gap-8 items-start" data-recall-settings>
      <div>
        <div className="text-sm font-semibold text-ink">{t('recall.settingsTitle')}</div>
        <div className="text-2xs text-ink-faint mt-0.5 mb-3">{t(hasJudge ? 'recall.settingsHintJudged' : 'recall.settingsHint')}</div>
        <div className="flex items-center gap-4 text-xs text-ink">
          <label className="flex items-center gap-2">
            <span className="text-ink-muted">{t('recall.limit')}</span>
            <select value={recallLimit} onChange={(e) => setRecallLimit(Number(e.target.value))} className="bg-wash border border-line rounded-md px-2 py-1 text-xs" data-recall-limit>
              {[3, 6, 12].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-ink-muted">{t('recall.budget')}</span>
            <select value={recallBudget} onChange={(e) => setRecallBudget(Number(e.target.value))} className="bg-wash border border-line rounded-md px-2 py-1 text-xs" data-recall-budget>
              {[2000, 4000, 8000].map((n) => <option key={n} value={n}>{n / 1000}k tok</option>)}
            </select>
          </label>
        </div>
      </div>
      <div>
        <div className="flex items-center gap-1.5">
          <Scale size={14} strokeWidth={1.75} className="text-accent" />
          <span className="text-sm font-semibold text-ink">{t('judge.title')}</span>
        </div>
        <p className="text-2xs text-ink-faint mt-0.5 mb-2 leading-relaxed">{hasJudge ? fmt(t('judge.current'), { j: JUDGE_LABELS[judgeCfg.provider] }) : t('judge.none')}</p>
        <button onClick={() => useUiStore.getState().setApiKeyModalOpen(true)} className="text-xs px-3 py-1 rounded-lg bg-accent/10 text-accent hover:bg-accent/20" data-judge-configure>{t('judge.configure')}</button>
      </div>
    </section>
  );
}
