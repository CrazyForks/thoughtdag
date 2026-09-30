import { Globe, GraduationCap } from 'lucide-react';
import { hasWhy } from '../../lib/why-bridge';
import { useUiStore } from '../../lib/ui-store';
import { useModels } from '../../lib/use-models';
import { directWithoutSearch } from '../../lib/direct-llm';
import { useT } from '../../i18n';

// Per-ask search permissions, shown next to every input that asks. The two
// toggles edit the shared default (ui-store, persisted); each new node
// snapshots them at creation, so reruns keep behaving the same way.
export default function SearchToggles({ size = 16 }: { size?: number }) {
  const web = useUiStore((s) => s.webSearchEnabled);
  const setWeb = useUiStore((s) => s.setWebSearchEnabled);
  const scholar = useUiStore((s) => s.scholarSearchEnabled);
  const setScholar = useUiStore((s) => s.setScholarSearchEnabled);
  // recall: the why layer's exact words from past conversations and memories,
  // brought into the ask as listed items; only where a local index answers
  const recall = useUiStore((s) => s.recallEnabled);
  const setRecall = useUiStore((s) => s.setRecallEnabled);
  const recallAvailable = hasWhy();
  const t = useT();
  // no key, no button: search that cannot run must not be offerable
  // (the capabilities panel is the one place that says why)
  const webAvailable = useModels()?.capabilities?.webSearch ?? true;
  // Models on a searchless direct lane (hosted app, e.g. DeepSeek browser-
  // direct) show DISABLED toggles with the reason — a control that vanishes
  // reads as a missing feature, a disabled one explains itself. Offering a
  // live toggle would route the request through the proxy, where thinking
  // streams die of the Workers CPU allowance.
  const selectedModel = useUiStore((s) => s.selectedModel);
  const noSearchLane = directWithoutSearch(selectedModel ?? undefined);

  const cls = (on: boolean) =>
    noSearchLane
      ? 'transition-colors shrink-0 rounded-full w-8 h-8 flex items-center justify-center text-ink-faint opacity-30 cursor-not-allowed'
      : `transition-colors shrink-0 rounded-full w-8 h-8 flex items-center justify-center ${
          on
            ? 'text-accent bg-accent/15 ring-1 ring-accent/40 hover:bg-accent/25'
            : 'text-ink-muted opacity-50 hover:opacity-90 hover:bg-line'
        }`;

  return (
    <>
      {webAvailable && (
        <button
          type="button"
          onClick={() => { if (!noSearchLane) setWeb(!web); }}
          disabled={noSearchLane}
          title={noSearchLane ? t('toolbar.searchUnavailableLane') : web ? t('toolbar.webSearch') : t('toolbar.webSearchOff')}
          className={cls(web)}
          data-web-toggle
        >
          <Globe size={size} strokeWidth={1.75} />
        </button>
      )}
      <button
        type="button"
        onClick={() => { if (!noSearchLane) setScholar(!scholar); }}
        disabled={noSearchLane}
        title={noSearchLane ? t('toolbar.searchUnavailableLane') : scholar ? t('toolbar.scholarSearch') : t('toolbar.scholarSearchOff')}
        className={cls(scholar)}
        data-scholar-toggle
      >
        <GraduationCap size={size} strokeWidth={1.75} />
      </button>
      {recallAvailable && (
        // recall is a switch, not a third search icon: a track and a knob, its
        // name beside it, set apart from the two searches by a hairline
        <>
          <span className="w-px h-4 bg-line mx-0.5 shrink-0" aria-hidden />
          <button
            type="button"
            role="switch"
            aria-checked={recall}
            onClick={() => setRecall(!recall)}
            title={recall ? t('toolbar.recall') : t('toolbar.recallOff')}
            className="shrink-0 h-8 pl-0.5 pr-2 rounded-full flex items-center gap-1.5 hover:bg-wash transition-colors"
            data-recall-toggle
          >
            <span className={`relative w-9 h-5 rounded-full transition-colors ${recall ? 'bg-accent' : 'bg-line-strong'}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${recall ? 'translate-x-4' : ''}`} />
            </span>
            <span className={`text-2xs font-medium ${recall ? 'text-accent' : 'text-ink-muted'}`}>{t('toolbar.recallLabel')}</span>
          </button>
        </>
      )}
    </>
  );
}
