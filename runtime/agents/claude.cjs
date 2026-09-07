// Claude Code as an agent runtime: one `claude -p` process per turn, spoken
// to in stream-json both ways. The turn's text and thinking arrive as
// content-block deltas, tool calls as tool_use blocks with their
// tool_result, permission prompts as control requests answered on stdin
// (`--permission-prompt-tool stdio`), the end as a result message. A session
// continues with `--resume`, branches with `--fork-session`. Claude Code
// keeps its session files under ~/.claude/projects, its login and its model
// aliases; the shell only asks. Same event kinds as the other runtimes.
'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { snapshotDir, diffSnapshots } = require('./fs-diff.cjs');

const fsp = fs.promises;
const CANDIDATE_DIRS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.claude', 'local'), path.join(os.homedir(), '.npm-global', 'bin'), path.join(os.homedir(), '.bun', 'bin')];

async function executable(p) { try { await fsp.access(p, fs.constants.X_OK); return true; } catch { return false; } }
async function findClaude() {
  const names = process.platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude'];
  const dirs = [...(process.env.PATH || '').split(path.delimiter), ...CANDIDATE_DIRS].filter(Boolean);
  for (const d of dirs) for (const n of names) { const p = path.join(d, n); if (await executable(p)) return p; }
  return null;
}
function childEnv() {
  const seen = new Set((process.env.PATH || '').split(path.delimiter).filter(Boolean));
  return { ...process.env, PATH: [...seen, ...CANDIDATE_DIRS.filter((d) => !seen.has(d))].join(path.delimiter) };
}

/** Claude Code has no model list; its aliases resolve to the newest model
 *  of each family inside the CLI, so they never go stale. `default` is the
 *  CLI's own configured model. */
const MODELS = [
  { provider: 'claude-code', id: 'default', name: 'Default model', reasoning: true, vision: true },
  { provider: 'claude-code', id: 'opus', name: 'Opus', reasoning: true, vision: true },
  { provider: 'claude-code', id: 'sonnet', name: 'Sonnet', reasoning: true, vision: true },
  { provider: 'claude-code', id: 'haiku', name: 'Haiku', reasoning: true, vision: true },
];

/** ~/.claude/projects/<slug>/<sessionId>.jsonl. The slug is the cwd with
 *  '/' and '.' turned into '-', but a long path is cut and given a short
 *  suffix by Claude Code itself — so the file is found by its id across the
 *  project directories when the computed name is not there. */
const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
async function sessionFileFor(cwd, sessionId) {
  const guess = path.join(PROJECTS_DIR, cwd.replace(/[/.]/g, '-'), `${sessionId}.jsonl`);
  if (await fsp.access(guess).then(() => true, () => false)) return guess;
  try {
    const dirs = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const candidate = path.join(PROJECTS_DIR, d.name, `${sessionId}.jsonl`);
      if (await fsp.access(candidate).then(() => true, () => false)) return candidate;
    }
  } catch { /* no projects yet */ }
  return null;
}
// the session id is the file's name; a directory on the way may carry a
// UUID of its own (a project path that names a session), so take the LAST
const sessionIdOf = (sessionPath) => { const all = String(sessionPath ?? '').match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi); return all && all.length ? all[all.length - 1] : null; };

/** The guard file the canvas writes per working directory, as a permission mode. */
async function permissionModeFor(cwd) {
  try {
    const raw = JSON.parse(await fsp.readFile(path.join(cwd, '.thoughtdag', 'guard.json'), 'utf8'));
    if (raw?.mode === 'allow') return 'bypassPermissions';
  } catch { /* default */ }
  return 'default';
}

function createClaudeRuntime({ log } = {}) {
  const say = log || (() => {});
  const runs = new Map();     // runId → state
  let binPromise = null;
  const bin = () => { if (!binPromise) binPromise = findClaude(); return binPromise; };

  return {
    available: () => bin(),

    async models() {
      const b = await bin();
      if (!b) return { installed: false, models: [], default: null };
      return { installed: true, models: MODELS, default: 'claude/claude-code/default' };
    },

    async run(req, onEvent) {
      const cwd = String(req.cwd || '');
      if (!cwd || !path.isAbsolute(cwd)) throw new Error('run needs an absolute cwd');
      await fsp.mkdir(cwd, { recursive: true });
      const b = await bin();
      if (!b) throw new Error('claude is not installed (no `claude` on PATH or in the usual places)');
      const runId = randomUUID();
      const emit = (event) => { try { onEvent({ runId, event }); } catch { /* renderer gone */ } };
      const state = { runId, proc: null, asks: new Map(), text: '', final: null, sessionId: null, waiting: false, ended: false, aborted: false };
      runs.set(runId, state);

      void (async () => {
        const IDLE = Number(process.env.TD_AGENT_IDLE_MS) || 10 * 60 * 1000;
        let lastEvent = Date.now();
        const mark = (event) => { lastEvent = Date.now(); if (event.type === 'question') state.waiting = true; if (event.type === 'question_answered') state.waiting = false; emit(event); };
        let watchdog = null;
        const before = await snapshotDir(cwd).catch(() => null);
        try {
          const mode = await permissionModeFor(cwd);
          const model = req.model && typeof req.model === 'object' && req.model.id && req.model.id !== 'default' ? req.model.id : null;
          const resumeId = req.sessionPath ? sessionIdOf(req.sessionPath) : null;
          const args = ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', mode];
          if (mode !== 'bypassPermissions') args.push('--permission-prompt-tool', 'stdio');
          if (model) args.push('--model', model);
          if (resumeId) { args.push('--resume', resumeId); if (req.forkEntryId) args.push('--fork-session'); }
          const proc = spawn(b, args, { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
          state.proc = proc;
          let buf = '';
          const finished = new Promise((resolve) => {
            const done = (how) => { if (state.ended) return; state.ended = true; resolve(how); };
            proc.stdout.on('data', (d) => {
              buf += d.toString();
              let i;
              while ((i = buf.indexOf('\n')) >= 0) {
                const line = buf.slice(0, i); buf = buf.slice(i + 1);
                if (!line.trim()) continue;
                let m; try { m = JSON.parse(line); } catch { continue; }
                handle(m, done);
              }
            });
            proc.stderr.on('data', (d) => say('[claude stderr] ' + d.toString().trim().slice(0, 400)));
            proc.on('error', (e) => { mark({ type: 'run_error', message: 'spawn error: ' + e.message }); done('error'); });
            proc.on('exit', (code, signal) => { if (!state.ended) { if (!state.aborted && code) mark({ type: 'run_error', message: `claude exited (${signal || code})` }); done(state.aborted ? 'aborted' : (code ? 'error' : 'end')); } });
          });
          watchdog = setInterval(() => {
            if (state.waiting || Date.now() - lastEvent < IDLE) return;
            mark({ type: 'run_error', message: `no activity for ${IDLE >= 60000 ? Math.round(IDLE / 60000) + ' min' : Math.round(IDLE / 1000) + ' s'}; the turn was stopped` });
            state.aborted = true; try { proc.kill(); } catch { /* gone */ }
          }, 15000);

          const handle = (m, done) => {
            switch (m.type) {
              case 'system':
                if (m.subtype === 'init') {
                  state.sessionId = m.session_id;
                  // the file appears once the first lines are written; the
                  // completion re-emits the session with its real path
                  mark({ type: 'session', sessionId: m.session_id, sessionFile: null, model: model ? { provider: 'claude-code', id: model, name: model } : null, cwd });
                } else if (m.subtype === 'permission_denied') {
                  mark({ type: 'tool_execution_end', toolCallId: m.tool_use_id ?? '', toolName: m.tool_name ?? 'tool', result: 'permission denied', isError: true });
                }
                break;
              case 'stream_event': {
                const ev = m.event ?? {};
                if (ev.type === 'content_block_delta') {
                  const d = ev.delta ?? {};
                  if (d.type === 'text_delta' && d.text) { state.text += d.text; mark({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: d.text } }); }
                  else if (d.type === 'thinking_delta' && d.thinking) mark({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: d.thinking } });
                }
                break;
              }
              case 'assistant':
                for (const b of m.message?.content ?? []) if (b.type === 'tool_use') mark({ type: 'tool_execution_start', toolCallId: b.id, toolName: b.name, args: b.input ?? {} });
                break;
              case 'user':
                for (const b of m.message?.content ?? []) if (b.type === 'tool_result') mark({ type: 'tool_execution_end', toolCallId: b.tool_use_id, toolName: '', result: typeof b.content === 'string' ? b.content : JSON.stringify(b.content ?? null).slice(0, 4000), isError: !!b.is_error });
                break;
              case 'control_request': {
                const r = m.request ?? {};
                if (r.subtype !== 'can_use_tool') { write(proc, { type: 'control_response', response: { subtype: 'error', request_id: m.request_id, error: 'unsupported request' } }); break; }
                const id = `q-${m.request_id}`;
                const input = r.input ?? {};
                const line = typeof input.command === 'string' ? input.command : (input.file_path ?? input.path ?? JSON.stringify(input).slice(0, 200));
                state.asks.set(id, (answer) => {
                  const yes = !!answer?.confirmed;
                  write(proc, { type: 'control_response', response: { subtype: 'success', request_id: m.request_id, response: yes ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'the person did not allow this step' } } });
                  mark({ type: 'question_answered', id, outcome: yes ? 'allowed-once' : 'rejected', value: null });
                });
                mark({ type: 'question', kind: 'confirm', id, title: `${r.tool_name ?? 'tool'} needs approval`, message: [line, r.description].filter(Boolean).join('\n'), options: [], placeholder: null, prefill: null, paths: [], suggest: null });
                break;
              }
              case 'result':
                state.final = typeof m.result === 'string' ? m.result : null;
                if (m.subtype && m.subtype !== 'success') mark({ type: 'run_error', message: String(m.result ?? m.subtype) });
                done(m.subtype === 'success' ? 'end' : 'error');
                break;
              default: break;
            }
          };

          // the prompt goes in as one user message; stdin stays open for answers
          const content = [{ type: 'text', text: String(req.prompt ?? '') }];
          for (const img of Array.isArray(req.images) ? req.images : []) if (img && typeof img.data === 'string') content.push({ type: 'image', source: { type: 'base64', media_type: img.mimeType, data: img.data } });
          write(proc, { type: 'user', message: { role: 'user', content } });

          const how = await finished;
          // let the CLI finish writing its transcript: it exits on its own
          // after the result; a kill is only the fallback
          await new Promise((resolve) => { if (proc.exitCode !== null || proc.signalCode) return resolve(); const t = setTimeout(() => { try { proc.kill(); } catch { /* gone */ } resolve(); }, 8000); proc.once('exit', () => { clearTimeout(t); resolve(); }); });
          if (state.sessionId) {
            const file = await sessionFileFor(cwd, state.sessionId);
            mark({ type: 'session', sessionId: state.sessionId, sessionFile: file, model: model ? { provider: 'claude-code', id: model, name: model } : null, cwd });
          }
          if (before) {
            const after = await snapshotDir(cwd).catch(() => null);
            if (after) { const d = diffSnapshots(before, after); if (d.changed.length || d.added.length || d.removed.length || d.truncated) mark({ type: 'fs_changes', ...d }); }
          }
          mark({ type: 'run_end', text: state.final ?? state.text, how });
        } catch (e) {
          mark({ type: 'run_error', message: e instanceof Error ? e.message : String(e) });
          mark({ type: 'run_end', text: state.final ?? state.text, how: 'error' });
        } finally {
          if (watchdog) clearInterval(watchdog);
          runs.delete(runId);
        }
      })();
      return runId;
    },

    abort(runId) {
      const r = runs.get(runId);
      if (!r) return false;
      r.aborted = true;
      for (const [id, respond] of r.asks) { respond({ confirmed: false }); r.asks.delete(id); }
      try { r.proc?.kill(); } catch { /* gone */ }
      return true;
    },

    answer(runId, requestId, response) {
      const r = runs.get(runId);
      const respond = r?.asks.get(String(requestId));
      if (!respond) return false;
      r.asks.delete(String(requestId));
      const a = response && typeof response === 'object' ? response : { confirmed: !!response };
      respond(a.cancelled ? { confirmed: false } : a);
      return true;
    },

    shutdown() { for (const r of runs.values()) { try { r.proc?.kill(); } catch { /* gone */ } } },
  };
}

function write(proc, obj) { try { proc.stdin.write(JSON.stringify(obj) + '\n'); return true; } catch { return false; } }

module.exports = { createClaudeRuntime, findClaude };
