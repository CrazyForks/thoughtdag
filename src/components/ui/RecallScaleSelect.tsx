import { useUiStore } from '../../lib/ui-store';
import { RECALL_SCALES, type RecallScale } from '../../lib/recall';
import { useT } from '../../i18n';

// The one recall preference a person can hold: how much may come in, as
// three words. Input tokens, a share of the answering model's window, with
// a cap; the exact numbers sit in the tooltip, not on the page.

export default function RecallScaleSelect() {
  const t = useT();
  const value = useUiStore((s) => s.recallScale);
  const set = useUiStore((s) => s.setRecallScale);
  const k = (v: RecallScale) => `${Math.round(RECALL_SCALES[v].share * 100)}% · ≤${RECALL_SCALES[v].max / 1000}k`;
  return (
    <label className="inline-flex items-center gap-1 text-2xs text-ink-faint" title={t('recall.scaleHint')} data-recall-scale>
      <span>{t('recall.scale')}</span>
      <select value={value} onChange={(e) => set(e.target.value as RecallScale)} className="bg-transparent border-b border-line text-2xs text-ink-muted focus:outline-none">
        <option value="lean">{t('recall.scaleLean')} · {k('lean')}</option>
        <option value="standard">{t('recall.scaleStandard')} · {k('standard')}</option>
        <option value="generous">{t('recall.scaleGenerous')} · {k('generous')}</option>
      </select>
    </label>
  );
}
