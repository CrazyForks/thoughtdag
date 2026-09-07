// A Pi extension the desktop shell loads into every run it starts
// (`pi -e <this file>`). One rule: the working directory is the boundary.
// A tool call that reaches outside it — a read, write or edit by path, a
// bash command naming a path elsewhere — asks the person first; in rpc
// mode that question travels to the canvas and comes back as an
// approval. Denied means the call is blocked with a reason the model
// sees. Paths the system owns (/usr, /bin, /dev, /tmp…) pass: a command
// that runs /usr/bin/env is not an excursion.
import { resolve, sep } from 'node:path';
import { homedir } from 'node:os';

const SYSTEM_PREFIXES = ['/dev/', '/usr/', '/bin/', '/sbin/', '/opt/', '/etc/', '/tmp/', '/private/tmp/', '/private/var/', '/var/', '/System/', '/Library/', '/Applications/', '/proc/'];

function expand(p, cwd) {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return resolve(cwd, p);
}

const inside = (abs, root) => abs === root || abs.startsWith(root + sep);
const systemOwned = (abs) => SYSTEM_PREFIXES.some((pre) => abs.startsWith(pre));

/** Paths a bash command names: absolute ones, ~ ones, and cd targets. */
function pathsInCommand(command, cwd) {
  const out = new Set();
  const text = String(command ?? '');
  for (const m of text.matchAll(/(?:^|[\s=:'"(])((?:~|\/)[^\s'"`;|&)<>]*)/g)) out.add(expand(m[1], cwd));
  for (const m of text.matchAll(/(?:^|[;&|]\s*|\s)cd\s+([^\s;|&]+)/g)) out.add(expand(m[1].replace(/^['"]|['"]$/g, ''), cwd));
  return [...out];
}

function pathsOf(event, cwd) {
  const input = event.input ?? {};
  switch (event.toolName) {
    case 'bash': return pathsInCommand(input.command, cwd);
    case 'read': case 'write': case 'edit': case 'ls': case 'grep': case 'find':
      return typeof input.path === 'string' && input.path ? [expand(input.path, cwd)] : [];
    default: return [];
  }
}

export default function (pi) {
  pi.on('tool_call', async (event, ctx) => {
    const root = resolve(ctx.cwd);
    const outside = pathsOf(event, root).filter((p) => !inside(p, root) && !systemOwned(p));
    if (outside.length === 0) return;
    const where = outside.slice(0, 3).join(', ') + (outside.length > 3 ? ` (+${outside.length - 3})` : '');
    if (!ctx.hasUI) return { block: true, reason: `outside the working directory (${where}); nobody to ask` };
    const detail = event.toolName === 'bash' ? String(event.input?.command ?? '') : where;
    const ok = await ctx.ui.confirm(`${event.toolName} outside the working directory`, detail);
    if (!ok) return { block: true, reason: `the person did not allow ${event.toolName} outside the working directory (${where})` };
  });
}
