import { useEffect, useRef, useState } from 'react';
import { FolderOpen, Check, ChevronDown, ShieldCheck, ShieldOff, X } from 'lucide-react';
import { useT } from '../../i18n';
import { useUiStore } from '../../lib/ui-store';
import { useProjects, setProjectAgentCwd } from '../../store/projects';
import { useStore } from '../../store';
import { isAgentModel, resolveAgentCwd, mirroredCwd, setGuardMode, allowLocation, type CwdChoice } from '../../lib/agents/agent-runtime';

// Where the agent works, on the toolbar, whenever an agent model is the
// pick: the chosen folder, the mirrored project, or the canvas's own
// workspace. One click shows the choices; the folder dialog adds a new one.
// Nothing is mandatory — the default stays the workspace.

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
    if (!open) return;
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
  const pick = async () => {
    const dir = await window.desktopAgents!.pickCwd();
    if (dir) await choose(dir);
  };

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
        <div className="absolute right-0 top-full mt-1.5 w-[320px] bg-card border border-line rounded-xl shadow-lg py-1.5 z-50 animate-fade-in" onClick={(e) => e.stopPropagation()}>
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
          <button onClick={() => void pick()} className="w-full text-left px-3 py-2 text-xs text-ink hover:bg-wash flex items-center gap-2" data-agent-cwd-pick>
            <FolderOpen size={14} strokeWidth={1.75} className="text-ink-faint shrink-0" /> {t('agent.cwdPick')}
          </button>
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
        </div>
      )}
    </div>
  );
}
