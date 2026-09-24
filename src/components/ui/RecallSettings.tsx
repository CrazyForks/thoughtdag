import { useState } from 'react';
import { Info, Loader2, Scale } from 'lucide-react';
import { useUiStore } from '../../lib/ui-store';
import { judgeSelfTest, storedOpenRouterKey, type JudgeProviderId, type JudgeResult } from '../../lib/judge';
import { useT, fmt } from '../../i18n';

// The recall's dials and the judge behind them, on the memory page.
// Recall: how many items one ask brings in and the tokens they may cost.
// Judge: a System One decision endpoint (Jev through OpenRouter, TypeSafe
// or Cloudflare; any self-hosted /v1/systemone; or the chat model as an
// uncalibrated stand-in). The hint says exactly where it is used and what
// leaves the machine, because that is the whole point of choosing one.

const PROVIDERS: JudgeProviderId[] = ['none', 'openrouter', 'typesafe', 'cloudflare', 'custom', 'llm'];

export default function RecallSettings() {
  const t = useT();
  const recallLimit = useUiStore((s) => s.recallLimit);
  const setRecallLimit = useUiStore((s) => s.setRecallLimit);
  const recallBudget = useUiStore((s) => s.recallBudget);
  const setRecallBudget = useUiStore((s) => s.setRecallBudget);
  const judgeCfg = useUiStore((s) => s.judge);
  const setJudge = useUiStore((s) => s.setJudge);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: true; r: JudgeResult } | { ok: false; error: string } | null>(null);
  const storedKey = storedOpenRouterKey();

  const runTest = async () => {
    setTesting(true); setTest(null);
    try { setTest({ ok: true, r: await judgeSelfTest(judgeCfg) }); }
    catch (e) { setTest({ ok: false, error: e instanceof Error ? e.message : String(e) }); }
    finally { setTesting(false); }
  };
  const field = (label: string, value: string, onChange: (v: string) => void, extra: { placeholder?: string; secret?: boolean; hint?: string } = {}) => (
    <label className="block">
      <span className="block text-2xs text-ink-faint mb-0.5">{label}</span>
      <input
        type={extra.secret ? 'password' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={extra.placeholder}
        spellCheck={false}
        autoComplete="off"
        className="w-full text-xs font-mono bg-wash border border-line rounded-md px-2 py-1 focus:outline-none focus:border-accent/60"
      />
      {extra.hint && <span className="block text-2xs text-ink-faint mt-0.5">{extra.hint}</span>}
    </label>
  );
  const providerLabel = (p: JudgeProviderId) => t(`judge.provider.${p}` as 'judge.provider.none');

  return (
    <section className="mt-8 border-t border-line pt-5 grid grid-cols-2 gap-8 items-start" data-recall-settings>
      <div>
        <div className="text-sm font-semibold text-ink">{t('recall.settingsTitle')}</div>
        <div className="text-2xs text-ink-faint mt-0.5 mb-3">{t('recall.settingsHint')}</div>
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
      <div data-judge-settings>
        <div className="flex items-center gap-1.5">
          <Scale size={14} strokeWidth={1.75} className="text-accent" />
          <span className="text-sm font-semibold text-ink">{t('judge.title')}</span>
          <span className="text-ink-faint cursor-help" title={t('judge.where')} data-judge-info><Info size={13} strokeWidth={1.75} /></span>
        </div>
        <p className="text-2xs text-ink-faint mt-0.5 mb-3 leading-relaxed">{t('judge.where')}</p>
        <label className="block mb-2">
          <span className="block text-2xs text-ink-faint mb-0.5">{t('judge.providerLabel')}</span>
          <select value={judgeCfg.provider} onChange={(e) => { setJudge({ provider: e.target.value as JudgeProviderId }); setTest(null); }} className="w-full bg-wash border border-line rounded-md px-2 py-1 text-xs" data-judge-provider>
            {PROVIDERS.map((p) => <option key={p} value={p}>{providerLabel(p)}</option>)}
          </select>
        </label>
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
        {judgeCfg.provider !== 'none' && (
          <div className="mt-3 flex items-center gap-3">
            <button onClick={() => void runTest()} disabled={testing} className="text-xs px-3 py-1 rounded-lg bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50 flex items-center gap-1.5" data-judge-test>
              {testing && <Loader2 size={12} className="animate-spin" />} {t('judge.test')}
            </button>
            {test && (test.ok
              ? <span className="text-2xs text-ink-muted font-mono" data-judge-test-result>{fmt(t('judge.testOk'), { ms: test.r.ms, model: test.r.model || '—', p: (test.r.answers.urgent?.noul ?? 0).toFixed(2), c: test.r.answers.department?.choice ?? '—' })} · {t(test.r.calibrated ? 'judge.calibrated' : 'judge.uncalibrated')}</span>
              : <span className="text-2xs text-red-500" data-judge-test-result>{test.error}</span>)}
          </div>
        )}
      </div>
    </section>
  );
}
