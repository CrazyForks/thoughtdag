import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Folder, Check, ChevronDown, ChevronRight, ArrowLeft, Home, ShieldCheck, ShieldOff, X } from 'lucide-react';
import { useT } from '../../i18n';
import { useUiStore } from '../../lib/ui-store';
import { useProjects, setProjectAgentCwd } from '../../store/projects';
import { useStore } from '../../store';
import { isAgentModel, resolveAgentCwd, mirroredCwd, setGuardMode, allowLocation, type CwdChoice } from '../../lib/agents/agent-runtime';

// Where the agent works, on the toolbar, whenever an agent model is the
// pick: the chosen folder, the mirrored project, or the canvas's own
// workspace. One click shows the choices; the folder dialog adds a new one,
// and where the host has no dialog (a browser tab inside the harness) a
// small browser walks the host's folders instead, one level at a time, the
// path typed or pasted as a shortcut. Nothing is mandatory — the default
// stays the workspace.

const tail = (p: string) => p.split('/').filter(Boolean).slice(-1)[0] ?? p;

export default function AgentCwdChip() {
  const t = useT();
  const selectedModel = useUiStore((s) => s.selectedModel);
  const activeId = useProjects((s) => s.activeId);
  const projects = useProjects((s) => s.projects);
  const nodeCount = useStore((s) => s.nodes.length);
  const [choice, setChoice] = useState<CwdChoice | null>(null);
  const [mirrored, setMirrored] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  // the folder browser, when the host lists folders instead of showing a dialog
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [browseError, setBrowseError] = useState(false);
  const [browseBusy, setBrowseBusy] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [pathDraft, setPathDraft] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const visible = !!window.desktopAgents && isAgentModel(selectedModel);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void resolveAgentCwd().then((c) => { if (alive) setChoice(c); });
    void mirroredCwd().then((m) => { if (alive) setMirrored(m); });
    return () => { alive = false; };
  }, [visible, activeId, projects, nodeCount]);

  useEffect(() => {
    if (!open) { setBrowsing(false); setBrowseError(false); return; }
    const onDown = (e: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!visible || !choice) return null;
  const meta = projects.find((p) => p.id === activeId);
  const recent = [...new Set(projects.map((p) => p.agentCwd).filter((c): c is string => !!c))].filter((c) => c !== meta?.agentCwd).slice(0, 5);

  const choose = async (cwd: string | undefined) => {
    if (!activeId) return;
    await setProjectAgentCwd(activeId, cwd);
    setOpen(false);
  };
  const nativePicker = window.desktopAgents?.capabilities?.nativePicker !== false;
  const pick = async () => {
    const dir = await window.desktopAgents!.pickCwd();
    if (dir) await choose(dir);
  };
  const submitTyped = async () => {
    const v = typed.trim();
    if (v.startsWith('/')) await choose(v);
  };
  const canBrowse = !nativePicker && typeof window.desktopAgents?.listDirectory === 'function';
  const browse = async (dir?: string) => {
    setBrowseBusy(true);
    setBrowseError(false);
    try {
      const l = await window.desktopAgents!.listDirectory!(dir);
      setListing(l);
      setPathDraft(l.path);
      setBrowsing(true);
    } catch {
      setBrowseError(true);
      if (!listing) setBrowsing(true);
    } finally {
      setBrowseBusy(false);
    }
  };
  const visibleEntries = (listing?.entries ?? []).filter((e) => showHidden || !e.hidden);
  // crumbs after the home icon: the path below home when we are under it, the whole ancestry otherwise
  const crumbs = listing
    ? (listing.path === listing.home || listing.path.startsWith(listing.home + '/')
      ? listing.crumbs.filter((c) => c.path.startsWith(listing.home + '/'))
      : listing.crumbs)
    : [];

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="bg-card/90 backdrop-blur border border-line rounded-lg h-8 px-2.5 flex items-center gap-1.5 shadow-sm hover:bg-wash transition-colors text-xs text-ink max-w-[220px]"
        title={`${t('agent.cwd')} · ${choice.cwd}`}
        data-agent-cwd={choice.kind}
      >
        <FolderOpen size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" />
        <span className="truncate">{choice.kind === 'workspace' ? t('agent.cwdWorkspace') : tail(choice.cwd)}</span>
        <ChevronDown size={12} strokeWidth={1.75} className="text-ink-faint shrink-0" />
      </button>
      {open && (
        <div className={`absolute right-0 top-full mt-1.5 ${browsing ? 'w-[380px]' : 'w-[320px]'} bg-card border border-line rounded-xl shadow-lg py-1.5 z-50 animate-fade-in`} onClick={(e) => e.stopPropagation()} data-agent-cwd-menu>
          {browsing ? (
            <div data-agent-cwd-browser>
              <div className="flex items-center gap-1.5 px-2 pt-1 pb-1.5">
                <button onClick={() => setBrowsing(false)} className="p-1 rounded-md text-ink-faint hover:text-ink hover:bg-wash" title={t('agent.cwdBack')} data-agent-cwd-back>
                  <ArrowLeft size={14} strokeWidth={1.75} />
                </button>
                <p className="text-2xs text-ink-faint uppercase tracking-wider font-medium flex-1">{t('agent.cwdBrowse')}</p>
                <button onClick={() => setShowHidden((v) => !v)} className={`text-2xs px-1.5 py-0.5 rounded-md hover:bg-wash ${showHidden ? 'text-ink' : 'text-ink-faint'}`} data-agent-cwd-hidden={showHidden ? 'on' : 'off'}>
                  {t('agent.cwdShowHidden')}
                </button>
              </div>
              <div className="px-3 pb-1.5">
                <input
                  value={pathDraft}
                  onChange={(e) => setPathDraft(e.target.value)}
                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void browse(pathDraft.trim()); }}
                  placeholder={t('agent.cwdType')}
                  className={`w-full min-w-0 text-xs font-mono bg-wash border rounded-md px-2 py-1 focus:outline-none focus:border-accent/60 ${browseError ? 'border-red-400/70' : 'border-line'}`}
                  spellCheck={false}
                  data-agent-cwd-input
                />
                {browseError && <p className="text-2xs text-red-500 mt-1">{t('agent.cwdBrowseError')}</p>}
              </div>
              {listing && (
                <div className="flex items-center gap-0.5 px-3 pb-1 overflow-x-auto whitespace-nowrap text-2xs text-ink-faint" data-agent-cwd-crumbs>
                  <button onClick={() => void browse(listing.home)} className="p-0.5 rounded hover:text-ink hover:bg-wash shrink-0" title={listing.home}>
                    <Home size={12} strokeWidth={1.75} />
                  </button>
                  {crumbs.map((c, i, arr) => (
                    <span key={c.path} className="flex items-center gap-0.5 shrink-0">
                      <ChevronRight size={10} strokeWidth={1.75} className="text-ink-faint/70" />
                      <button onClick={() => void browse(c.path)} className={`px-1 py-0.5 rounded hover:bg-wash hover:text-ink max-w-[140px] truncate ${i === arr.length - 1 ? 'text-ink font-medium' : ''}`} title={c.path}>{c.name}</button>
                    </span>
                  ))}
                </div>
              )}
              <div className="max-h-56 overflow-y-auto border-t border-line/60" data-agent-cwd-entries>
                {listing && visibleEntries.length === 0 && !browseBusy && (
                  <p className="text-2xs text-ink-faint px-3 py-3">{t('agent.cwdEmpty')}</p>
                )}
                {visibleEntries.map((e) => (
                  <button key={e.path} onClick={() => void browse(e.path)} className={`w-full text-left px-3 py-1.5 text-xs hover:bg-wash flex items-center gap-2 ${e.hidden ? 'text-ink-faint' : 'text-ink'}`} title={e.path} data-agent-cwd-entry={e.name}>
                    <Folder size={13} strokeWidth={1.75} className="text-ink-faint shrink-0" />
                    <span className="flex-1 min-w-0 truncate">{e.name}</span>
                    <ChevronRight size={12} strokeWidth={1.75} className="text-ink-faint/70 shrink-0" />
                  </button>
                ))}
                {listing?.truncated && <p className="text-2xs text-ink-faint px-3 py-2">{t('agent.cwdTruncated')}</p>}
              </div>
              <div className="flex items-center gap-2 px-3 pt-2 pb-1 border-t border-line/60">
                <span className="flex-1 min-w-0 text-2xs text-ink-faint font-mono truncate" title={listing?.path ?? ''}>{listing?.path ?? ''}</span>
                <button
                  onClick={() => { if (listing) void choose(listing.path); }}
                  disabled={!listing || browseBusy}
                  className="text-xs px-2.5 py-1 rounded-md bg-ink text-card hover:bg-ink/90 disabled:opacity-40 shrink-0"
                  data-agent-cwd-use
                >
                  {t('agent.cwdUseThis')}
                </button>
              </div>
            </div>
          ) : (<>
          <p className="text-2xs text-ink-faint uppercase tracking-wider font-medium px-3 pt-1 pb-1">{t('agent.cwd')}</p>
          <button onClick={() => void choose(undefined)} className="w-full text-left px-3 py-2 text-xs hover:bg-wash flex items-center gap-2">
            <span className="flex-1 min-w-0">
              <span className="block text-ink">{mirrored ? t('agent.cwdMirrored') : t('agent.cwdWorkspace')}</span>
              <span className="block text-2xs text-ink-faint truncate">{mirrored ?? t('agent.cwdWorkspaceHint')}</span>
            </span>
            {!meta?.agentCwd && <Check size={13} strokeWidth={2} className="shrink-0 text-accent" />}
          </button>
          {meta?.agentCwd && (
            <button onClick={() => void choose(meta.agentCwd)} className="w-full text-left px-3 py-2 text-xs hover:bg-wash flex items-center gap-2">
              <span className="flex-1 min-w-0"><span className="block text-ink">{tail(meta.agentCwd)}</span><span className="block text-2xs text-ink-faint truncate">{meta.agentCwd}</span></span>
              <Check size={13} strokeWidth={2} className="shrink-0 text-accent" />
            </button>
          )}
          {recent.length > 0 && <p className="text-2xs text-ink-faint uppercase tracking-wider font-medium px-3 pt-2 pb-1">{t('agent.cwdRecent')}</p>}
          {recent.map((c) => (
            <button key={c} onClick={() => void choose(c)} className="w-full text-left px-3 py-1.5 text-xs hover:bg-wash flex items-center gap-2">
              <span className="flex-1 min-w-0"><span className="block text-ink">{tail(c)}</span><span className="block text-2xs text-ink-faint truncate">{c}</span></span>
            </button>
          ))}
          <div className="border-t border-line/60 my-1" />
          {nativePicker ? (
            <button onClick={() => void pick()} className="w-full text-left px-3 py-2 text-xs text-ink hover:bg-wash flex items-center gap-2" data-agent-cwd-pick>
              <FolderOpen size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {t('agent.cwdPick')}
            </button>
          ) : canBrowse ? (
            <button onClick={() => void browse(meta?.agentCwd ?? undefined)} className="w-full text-left px-3 py-2 text-xs text-ink hover:bg-wash flex items-center gap-2" data-agent-cwd-pick>
              <FolderOpen size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {t('agent.cwdBrowse')}
            </button>
          ) : (
            <div className="px-3 py-2 flex items-center gap-2">
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void submitTyped(); }}
                placeholder={t('agent.cwdType')}
                className="flex-1 min-w-0 text-xs font-mono bg-wash border border-line rounded-md px-2 py-1 focus:outline-none focus:border-accent/60"
                data-agent-cwd-input
              />
              <button onClick={() => void submitTyped()} className="text-xs text-accent hover:underline shrink-0">{t('agent.cwdUse')}</button>
            </div>
          )}
          <div className="border-t border-line/60 my-1" />
          <p className="text-2xs text-ink-faint uppercase tracking-wider font-medium px-3 pt-1 pb-1">{t('agent.guard')}</p>
          <button onClick={() => { void setGuardMode('ask'); setOpen(false); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-wash flex items-center gap-2" data-agent-guard="ask">
            <ShieldCheck size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" />
            <span className="flex-1 min-w-0"><span className="block text-ink">{t('agent.guardAsk')}</span><span className="block text-2xs text-ink-faint">{t('agent.guardAskHint')}</span></span>
            {(meta?.agentGuard?.mode ?? 'ask') === 'ask' && <Check size={13} strokeWidth={2} className="shrink-0 text-accent" />}
          </button>
          <button onClick={() => { void setGuardMode('allow'); setOpen(false); }} className="w-full text-left px-3 py-1.5 text-xs hover:bg-wash flex items-center gap-2" data-agent-guard="allow">
            <ShieldOff size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" />
            <span className="flex-1 min-w-0"><span className="block text-ink">{t('agent.guardAllow')}</span><span className="block text-2xs text-ink-faint">{t('agent.guardAllowHint')}</span></span>
            {meta?.agentGuard?.mode === 'allow' && <Check size={13} strokeWidth={2} className="shrink-0 text-accent" />}
          </button>
          {(meta?.agentGuard?.allow?.length ?? 0) > 0 && (
            <>
              <p className="text-2xs text-ink-faint px-3 pt-2 pb-1">{t('agent.guardAllowed')}</p>
              {meta!.agentGuard!.allow.map((a) => (
                <div key={a} className="px-3 py-1 text-xs flex items-center gap-2 min-w-0" data-agent-guard-allowed={a}>
                  <span className="flex-1 min-w-0 truncate text-ink-muted font-mono" title={a}>{a}</span>
                  <button onClick={() => void allowLocation(a, true)} className="text-ink-faint hover:text-red-500 shrink-0" title={t('agent.guardRemove')}>
                    <X size={12} strokeWidth={2} />
                  </button>
                </div>
              ))}
            </>
          )}
          </>)}
        </div>
      )}
    </div>
  );
}
