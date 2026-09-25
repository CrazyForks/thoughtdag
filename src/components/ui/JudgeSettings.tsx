import { useEffect, useState } from 'react';
import { Info, Loader2, Scale } from 'lucide-react';
import { useUiStore } from '../../lib/ui-store';
import { judgeSelfTest, storedOpenRouterKey, judgeConfigured, judgeTripped, type JudgeProviderId, type JudgeResult } from '../../lib/judge';
import { useT, fmt } from '../../i18n';

// The decision model (the judge), configured where the other keys are.
// One switch with what it buys; when on, the app looks for a way to reach
// one — the OpenRouter access already saved counts — and checks that it
// answers; otherwise the provider inputs unfold: TypeSafe, Cloudflare, any
// self-hosted /v1/systemone, or the chat model as an uncalibrated stand-in.
// Off, every decision falls back to its rule.

const PROVIDERS: JudgeProviderId[] = ['openrouter', 'typesafe', 'cloudflare', 'custom', 'llm'];

export default function JudgeSettings() {
  const t = useT();
  const judgeCfg = useUiStore((s) => s.judge);
  const setJudge = useUiStore((s) => s.setJudge);
  const recallLimit = useUiStore((s) => s.recallLimit);
  const setRecallLimit = useUiStore((s) => s.setRecallLimit);
  const recallBudget = useUiStore((s) => s.recallBudget);
  const setRecallBudget = useUiStore((s) => s.setRecallBudget);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: true; r: JudgeResult } | { ok: false; error: string } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const storedKey = storedOpenRouterKey();
  const on = judgeCfg.provider !== 'none';
  const configured = judgeConfigured(judgeCfg);
  const tripped = judgeTripped();

  const runTest = async (cfg = judgeCfg) => {
    setTesting(true); setTest(null);
    try { setTest({ ok: true, r: await judgeSelfTest(cfg) }); }
    catch (e) { setTest({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
    finally { setTesting(false); }
  };
  // switched on: restore the provider used before, else the saved OpenRouter access, else ask
  const toggle = () => {
    setTest(null);
    if (on) { setJudge({ provider: 'none', prevProvider: judgeCfg.provider }); setChoosing(false); return; }
    const next: JudgeProviderId = judgeCfg.prevProvider && judgeCfg.prevProvider !== 'none' ? judgeCfg.prevProvider : storedKey ? 'openrouter' : 'openrouter';
    setJudge({ provider: next });
    setChoosing(!(next === 'openrouter' && (storedKey || judgeCfg.openrouterKey)));
  };
  // a provider that is reachable in principle is checked once, so the row says whether it answers
  useEffect(() => {
    if (!on || !configured || test || testing) return;
    void runTest(judgeCfg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, configured, judgeCfg.provider]);

  const field = (label: string, value: string, onChange: (v: string) => void, extra: { placeholder?: string; secret?: boolean; hint?: string } = {}) => (
    <label className="block">
      <span className="block text-2xs text-ink-faint mb-0.5">{label}</span>
      <input
        type={extra.secret ? 'password' : 'text'}
        value={value}
        onChange={(e) => { onChange(e.target.value); setTest(null); }}
        placeholder={extra.placeholder}
        spellCheck={false}
        autoComplete="off"
        className="w-full text-xs font-mono bg-wash border border-line rounded-md px-2 py-1 focus:outline-none focus:border-accent/60"
      />
      {extra.hint && <span className="block text-2xs text-ink-faint mt-0.5">{extra.hint}</span>}
    </label>
  );
  const providerLabel = (p: JudgeProviderId) => t(`judge.provider.${p}` as 'judge.provider.none');
  const usingStored = judgeCfg.provider === 'openrouter' && !judgeCfg.openrouterKey && !!storedKey;

  return (
    <div className="border border-line rounded-xl px-3 py-2.5 bg-surface" data-judge-settings data-judge-on={on ? 'on' : 'off'}>
      <div className="flex items-center gap-2">
        <Scale size={14} strokeWidth={1.75} className="text-accent" />
        <span className="text-sm font-medium text-ink flex-1">{t('judge.enable')}</span>
        <span className="text-ink-faint cursor-help" title={t('judge.where')} data-judge-info><Info size={13} strokeWidth={1.75} /></span>
        <button role="switch" aria-checked={on} onClick={toggle} className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${on ? 'bg-accent' : 'bg-line-strong'}`} data-judge-toggle>
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
        </button>
      </div>
      <p className="text-2xs text-ink-faint mt-1 leading-relaxed">{t('judge.benefit')}</p>

      {on && (
        <div className="mt-2 space-y-2" data-judge-body>
          {/* what is in use, and whether it answers */}
          <div className="flex items-center gap-2 flex-wrap text-2xs">
            <span className="text-ink-muted">{usingStored ? t('judge.detected') : providerLabel(judgeCfg.provider)}</span>
            {!choosing && <button onClick={() => setChoosing(true)} className="text-accent hover:underline" data-judge-other>{t('judge.otherProvider')}</button>}
          </div>
          {(choosing || !configured) && (
            <label className="block">
              <span className="block text-2xs text-ink-faint mb-0.5">{t('judge.providerLabel')}</span>
              <select value={judgeCfg.provider} onChange={(e) => { setJudge({ provider: e.target.value as JudgeProviderId }); setTest(null); }} className="w-full bg-wash border border-line rounded-md px-2 py-1 text-xs" data-judge-provider>
                {PROVIDERS.map((p) => <option key={p} value={p}>{providerLabel(p)}</option>)}
              </select>
            </label>
          )}
          {(choosing || !configured) && (
            <div className="space-y-2">
              {judgeCfg.provider === 'openrouter' && field(t('judge.key'), judgeCfg.openrouterKey, (v) => setJudge({ openrouterKey: v }), { secret: true, placeholder: storedKey ? t('judge.openrouterStored') : 'sk-or-…', hint: t('judge.openrouterHint') })}
              {judgeCfg.provider === 'typesafe' && field(t('judge.key'), judgeCfg.typesafeKey, (v) => setJudge({ typesafeKey: v }), { secret: true, hint: t('judge.typesafeHint') })}
              {judgeCfg.provider === 'cloudflare' && (<>
                {field(t('judge.account'), judgeCfg.cloudflareAccount, (v) => setJudge({ cloudflareAccount: v }))}
                {field(t('judge.token'), judgeCfg.cloudflareToken, (v) => setJudge({ cloudflareToken: v }), { secret: true, hint: t('judge.cloudflareHint') })}
              </>)}
              {judgeCfg.provider === 'custom' && (<>
                {field(t('judge.url'), judgeCfg.customUrl, (v) => setJudge({ customUrl: v }), { placeholder: 'http://127.0.0.1:8000/v1/systemone', hint: t('judge.urlHint') })}
                {field(t('judge.keyOptional'), judgeCfg.customKey, (v) => setJudge({ customKey: v }), { secret: true })}
              </>)}
              {judgeCfg.provider === 'llm' && <p className="text-2xs text-ink-faint leading-relaxed">{t('judge.llmHint')}</p>}
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => void runTest()} disabled={testing || !configured} className="text-xs px-3 py-1 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50 flex items-center gap-1.5" data-judge-test>
              {testing && <Loader2 size={12} className="animate-spin" />} {t('judge.test')}
            </button>
            {testing && !test && <span className="text-2xs text-ink-faint">{t('judge.checking')}</span>}
            {test && (test.ok
              ? <span className="text-2xs text-ink-muted font-mono" data-judge-test-result>{fmt(t('judge.available'), { model: test.r.model || providerLabel(test.r.provider), ms: test.r.ms, c: t(test.r.calibrated ? 'judge.calibrated' : 'judge.uncalibrated') })}</span>
              : <span className="text-2xs text-red-500" data-judge-test-result>{fmt(t('judge.unavailable'), { e: test.error })}</span>)}
            {tripped && <span className="text-2xs text-amber-600" data-judge-tripped>{fmt(t('judge.trippedNow'), { s: Math.max(1, Math.round((tripped.until - Date.now()) / 1000)) })}</span>}
          </div>
        </div>
      )}

      <div className="mt-3 pt-2 border-t border-line/70 flex items-center gap-4 text-xs text-ink flex-wrap" data-recall-settings>
        <span className="text-2xs text-ink-faint">{t(on && configured ? 'recall.settingsHintJudged' : 'recall.settingsHint')}</span>
        <label className="flex items-center gap-1.5 shrink-0"><span className="text-ink-muted">{t('recall.limit')}</span>
          <select value={recallLimit} onChange={(e) => setRecallLimit(Number(e.target.value))} className="bg-wash border border-line rounded-md px-2 py-1 text-xs" data-recall-limit>{[3, 6, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label className="flex items-center gap-1.5 shrink-0"><span className="text-ink-muted">{t('recall.budget')}</span>
          <select value={recallBudget} onChange={(e) => setRecallBudget(Number(e.target.value))} className="bg-wash border border-line rounded-md px-2 py-1 text-xs" data-recall-budget>{[2000, 4000, 8000].map((n) => <option key={n} value={n}>{n / 1000}k tok</option>)}</select></label>
      </div>
    </div>
  );
}
