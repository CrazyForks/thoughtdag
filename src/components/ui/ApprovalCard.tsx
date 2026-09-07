import { useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { useT } from '../../i18n';
import { useStore } from '../../store';
import { answerApproval } from '../../lib/api';
import { allowLocation } from '../../lib/agents/pi-runtime';
import type { ApprovalRequest, ApprovalRecord } from '../../types';

// The question an agent runtime asks mid-turn, answered where the turn is
// shown: on the node. One action, one decision. The click is optimistic —
// buttons lock at once; the runtime's confirmation frame moves the request
// into the node's record. `compact` is the canvas card; the focus panel
// shows the same with the full arguments available.

export function ApprovalCard({ nodeId, request, compact }: { nodeId: string; request: ApprovalRequest; compact?: boolean }) {
  const t = useT();
  const [showArgs, setShowArgs] = useState(false);
  const busy = !!request.answered;

  const decide = async (outcome: 'allowed-once' | 'rejected', allowDir?: string) => {
    if (busy) return;
    if (allowDir) await allowLocation(allowDir);
    useStore.setState((s) => ({
      nodes: s.nodes.map((n) => n.id === nodeId && n.data.pendingApproval?.id === request.id
        ? { ...n, data: { ...n.data, pendingApproval: { ...n.data.pendingApproval, answered: outcome } } }
        : n),
    }));
    const ok = await answerApproval(request, outcome);
    if (!ok) {
      // nothing was waiting: the runtime withdrew the question or the turn ended
      useStore.setState((s) => ({
        nodes: s.nodes.map((n) => n.id === nodeId && n.data.pendingApproval?.id === request.id
          ? { ...n, data: { ...n.data, pendingApproval: undefined } }
          : n),
      }));
    }
  };

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className={`rounded-xl border border-amber-400/60 bg-amber-50/80 dark:bg-amber-500/10 ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`}
      onClick={stop}
      onMouseDown={stop}
      onPointerDown={stop}
      data-approval-card={request.id}
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
        <ShieldAlert size={14} strokeWidth={1.75} className="shrink-0" />
        <span>{t('approval.title')}</span>
        <span className="ml-auto font-mono font-normal text-2xs text-ink-faint truncate max-w-[40%]">{request.name}</span>
      </div>
      <div className={`mt-1.5 font-mono text-ink bg-card/70 rounded-md px-2 py-1.5 border border-line/60 whitespace-pre-wrap break-words ${compact ? 'text-2xs max-h-[72px] overflow-hidden' : 'text-xs'}`}>
        {showArgs && request.arguments ? request.arguments : (request.query || request.toolName)}
      </div>
      {request.reason && (
        <p className={`mt-1.5 text-ink-muted leading-relaxed [overflow-wrap:anywhere] ${compact ? 'text-2xs line-clamp-2' : 'text-xs'}`}>
          <span className="text-ink-faint">{t('approval.reason')} · </span>{request.reason}
        </p>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        <button
          onClick={() => void decide('allowed-once')}
          disabled={busy}
          className="text-xs text-white px-3 py-1.5 rounded-lg bg-accent hover:bg-accent-strong transition-colors disabled:opacity-50"
          data-approval-allow
        >
          {t('approval.allowOnce')}
        </button>
        {request.suggest && request.channel && (
          <button
            onClick={() => void decide('allowed-once', request.suggest!)}
            disabled={busy}
            className="text-xs text-accent px-3 py-1.5 rounded-lg border border-accent/40 hover:bg-accent/10 transition-colors disabled:opacity-50 max-w-[45%] truncate"
            title={`${t('approval.allowLocationTitle')} ${request.suggest}`}
            data-approval-allow-location
          >
            {t('approval.allowLocation')} {request.suggest.split('/').filter(Boolean).pop()}
          </button>
        )}
        <button
          onClick={() => void decide('rejected')}
          disabled={busy}
          className="text-xs text-ink px-3 py-1.5 rounded-lg border border-line hover:bg-wash transition-colors disabled:opacity-50"
          data-approval-reject
        >
          {t('approval.reject')}
        </button>
        {!compact && request.arguments && request.arguments !== request.query && (
          <button onClick={() => setShowArgs((v) => !v)} className="text-2xs text-ink-faint hover:text-ink hover:underline ml-1">
            {t('approval.showArgs')}
          </button>
        )}
        <span className="ml-auto text-2xs text-ink-faint">{busy ? t('approval.sending') : t('approval.waiting')}</span>
      </div>
    </div>
  );
}

/** The decided approvals of a turn, one line each — the record the canvas keeps. */
export function ApprovalRecords({ records }: { records: ApprovalRecord[] }) {
  const t = useT();
  if (records.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1" data-approval-records>
      {records.map((r) => (
        <li key={r.id} className="text-2xs text-ink-faint flex items-baseline gap-1.5 min-w-0">
          <span className="shrink-0">{r.outcome === 'allowed-once' ? '✅' : '⛔'}</span>
          <span className="shrink-0">{r.outcome === 'allowed-once' ? t('approval.allowed') : r.outcome === 'rejected' ? t('approval.rejected') : r.outcome === 'cancelled' ? t('approval.cancelled') : t('approval.unavailable')}</span>
          <span className="font-mono text-ink-muted truncate">{r.name}{r.query ? ` · ${r.query}` : ''}</span>
        </li>
      ))}
    </ul>
  );
}
