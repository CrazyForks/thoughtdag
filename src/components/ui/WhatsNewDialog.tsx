import { useEffect, useRef, useState } from 'react';
import { useI18n, useT, fmt } from '../../i18n';
import { whatsNewFor, type WhatsNewEntry } from '../../whats-new';

// Once per release that asks for it, on the first launch after the update:
// what changed, in three or four items, each with a door to read more. The
// desktop shell hands its version over in the URL (?dv=); the web build has
// no version of its own and never shows this. A fresh install is not an
// update: the current version is recorded silently and nothing pops.
// `?wn=1` forces the dialog for the running version (development, demos).

const SEEN_KEY = 'thoughtdag.whatsNewSeen';
const params = new URLSearchParams(window.location.search);
const appVersion = params.get('dv');

function decide(): WhatsNewEntry | null {
  const forced = params.get('wn') === '1';
  const entry = whatsNewFor(appVersion);
  if (forced) return entry;
  if (!appVersion) return null;
  let seen: string | null = null;
  try { seen = localStorage.getItem(SEEN_KEY); } catch { /* storage unavailable: never nag */ }
  if (seen === null) { try { localStorage.setItem(SEEN_KEY, appVersion); } catch { /* ignore */ } return null; }
  if (seen === appVersion) return null;
  return entry;
}

export default function WhatsNewDialog() {
  const [entry, setEntry] = useState<WhatsNewEntry | null>(() => decide());
  const lang = useI18n((s) => s.lang);
  const t = useT();
  const okRef = useRef<HTMLButtonElement>(null);

  const close = () => {
    if (appVersion) { try { localStorage.setItem(SEEN_KEY, appVersion); } catch { /* ignore */ } }
    setEntry(null);
  };

  useEffect(() => {
    if (!entry) return;
    // Enter closes, so the button holds focus — taken without scrolling, or
    // the panel would open scrolled to its foot and hide the title
    okRef.current?.focus({ preventScroll: true });
    const onKeyDown = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape' || e.key === 'Enter') close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [entry]);

  if (!entry) return null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/25 flex items-center justify-center animate-fade-in p-6" onClick={close}>
      <div
        className="bg-card border border-line rounded-2xl shadow-xl w-[520px] max-w-full max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="whats-new-title"
        data-whats-new
      >
        <div className="px-6 pt-5 pb-4 border-b border-line">
          <div className="text-2xs uppercase tracking-wide text-ink-faint">ThoughtDAG</div>
          <h2 id="whats-new-title" className="text-base font-semibold text-ink mt-0.5">{fmt(t('whatsNew.title'), { v: entry.version })}</h2>
          <p className="text-sm text-ink-muted leading-relaxed mt-2">{entry.lead[lang]}</p>
        </div>
        <ol className="px-6 py-2 divide-y divide-line">
          {entry.items.map((it, i) => (
            <li key={i} className="py-3 flex gap-3.5">
              <span className="shrink-0 w-6 h-6 rounded-full bg-accent/10 text-accent text-xs font-semibold flex items-center justify-center mt-0.5">{i + 1}</span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink">{it.title[lang]}</div>
                <p className="text-sm text-ink-muted leading-relaxed mt-1 [overflow-wrap:anywhere]">{it.body[lang]}</p>
                {it.link && (
                  <a
                    href={it.link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-block mt-1.5 text-xs font-medium text-accent hover:underline"
                  >
                    {it.link.label[lang]} →
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
        <div className="px-6 py-4 border-t border-line flex justify-end">
          <button
            ref={okRef}
            onClick={close}
            className="text-xs text-white px-4 py-2 rounded-lg bg-accent hover:bg-accent-strong transition-colors"
          >
            {t('whatsNew.ok')}
          </button>
        </div>
      </div>
    </div>
  );
}
