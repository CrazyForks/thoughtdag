// Pi as an agent runtime for the desktop shell. One `pi --mode rpc` child
// per working directory, spoken to in JSONL: commands go down stdin with an
// id and come back as `response` lines; everything else on stdout is a
// session event (agent_start, message_update, tool_execution_*, agent_end…)
// which the shell forwards to the renderer untouched, tagged with the run
// it belongs to. Pi keeps its own session files (~/.pi/agent/sessions), its
// own keys and model catalog: the shell only asks, never copies.
//
// A run is one prompt on one session: fresh (`new_session`), continued
// (`switch_session` to a file), or branched (`fork` at an entry of the
// current session). Runs on one process are serialized; a process idle for
// a while is closed; a process that dies is replaced on the next run.

'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { randomUUID } = require('node:crypto');

const fsp = fs.promises;
const IDLE_MS = 10 * 60 * 1000;
const RESPONSE_MS = 30 * 1000;
const CANDIDATE_DIRS = [
  '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin',
  path.join(os.homedir(), '.bun', 'bin'), path.join(os.homedir(), '.npm-global', 'bin'),
  path.join(os.homedir(), '.local', 'bin'), path.join(os.homedir(), '.pi', 'bin'),
];

async function executable(p) {
  try { await fsp.access(p, fs.constants.X_OK); return true; } catch { return false; }
}

/** The pi binary: PATH first (a terminal launch), then the usual homes
 *  (a Finder launch carries almost no PATH). */
async function findPi() {
  const names = process.platform === 'win32' ? ['pi.cmd', 'pi.exe', 'pi'] : ['pi'];
  const dirs = [...(process.env.PATH || '').split(path.delimiter), ...CANDIDATE_DIRS].filter(Boolean);
  for (const d of dirs) for (const n of names) { const p = path.join(d, n); if (await executable(p)) return p; }
  return null;
}

/** PATH for the child: the shell's plus the usual homes, so Pi's own bash
 *  tool finds git, node and friends even under a Finder launch. */
function childEnv() {
  const seen = new Set((process.env.PATH || '').split(path.delimiter).filter(Boolean));
  const extra = CANDIDATE_DIRS.filter((d) => !seen.has(d));
  return { ...process.env, PATH: [...seen, ...extra].join(path.delimiter) };
}

class PiProcess {
  constructor(bin, cwd, opts) {
    this.cwd = cwd;
    this.log = opts.log || (() => {});
    this.onExit = opts.onExit || (() => {});
    this.pending = new Map();
    this.nextId = 1;
    this.buf = '';
    this.dead = false;
    this.busy = Promise.resolve();
    this.listener = null;       // the run currently receiving events
    this.idleTimer = null;
    const args = ['--mode', 'rpc', ...(opts.noSession ? ['--no-session'] : [])];
    this.proc = spawn(bin, args, { cwd, env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', (d) => this.feed(d.toString()));
    this.proc.stderr.on('data', (d) => this.log('[pi stderr] ' + d.toString().trim().slice(0, 400)));
    this.proc.on('error', (e) => { this.log('[pi] spawn error: ' + e.message); this.die('spawn error: ' + e.message); });
    this.proc.on('exit', (code, signal) => this.die(`pi exited (${signal || code})`));
    this.touch();
  }

  touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => { if (!this.listener) this.close(); }, IDLE_MS);
  }

  feed(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i); this.buf = this.buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { this.log('[pi] non-JSON line: ' + line.slice(0, 120)); continue; }
      this.dispatch(msg);
    }
  }

  dispatch(msg) {
    if (msg.type === 'response') {
      const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
      if (p) { this.pending.delete(msg.id); p(msg); }
      return;
    }
    if (msg.type === 'extension_ui_request') {
      // an extension asked the person something; nobody is at that
      // terminal, so the question is withdrawn and the run hears about it
      this.write({ type: 'extension_ui_response', id: msg.id, cancelled: true });
      this.listener?.({ type: 'extension_ui_cancelled', method: msg.method, title: msg.title ?? null });
      return;
    }
    this.listener?.(msg);
  }

  write(obj) {
    try { this.proc.stdin.write(JSON.stringify(obj) + '\n'); return true; } catch { return false; }
  }

  send(cmd, timeoutMs = RESPONSE_MS) {
    if (this.dead) return Promise.reject(new Error('pi process is gone'));
    const id = String(this.nextId++);
    this.touch();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`pi did not answer ${cmd.type} in ${timeoutMs / 1000}s`)); }, timeoutMs);
      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.success === false) reject(new Error(msg.error || `pi refused ${cmd.type}`));
        else resolve(msg.data);
      });
      if (!this.write({ id, ...cmd })) { clearTimeout(timer); this.pending.delete(id); reject(new Error('pi stdin closed')); }
    });
  }

  /** Runs `fn` when no other run holds this process. */
  exclusive(fn) {
    const turn = this.busy.then(fn, fn);
    this.busy = turn.catch(() => {});
    return turn;
  }

  die(reason) {
    if (this.dead) return;
    this.dead = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    for (const p of this.pending.values()) p({ type: 'response', success: false, error: reason });
    this.pending.clear();
    this.listener?.({ type: 'process_exit', reason });
    this.listener = null;
    this.onExit(this);
  }

  close() {
    if (this.dead) return;
    try { this.proc.kill(); } catch { /* already gone */ }
  }
}

const textOf = (message) => (Array.isArray(message?.content) ? message.content : [])
  .filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');

function createPiRuntime({ log } = {}) {
  const say = log || (() => {});
  const procs = new Map();     // cwd → PiProcess
  const runs = new Map();      // runId → { proc, abort() }
  let binPromise = null;

  const bin = () => { if (!binPromise) binPromise = findPi(); return binPromise; };

  async function processFor(cwd) {
    const live = procs.get(cwd);
    if (live && !live.dead) return live;
    const b = await bin();
    if (!b) throw new Error('pi is not installed (no `pi` on PATH or in the usual places)');
    const p = new PiProcess(b, cwd, { log: say, onExit: (dead) => { if (procs.get(cwd) === dead) procs.delete(cwd); } });
    procs.set(cwd, p);
    return p;
  }

  const modelEntry = (m) => ({
    provider: m.provider, id: m.id, name: m.name || m.id,
    reasoning: !!m.reasoning, vision: Array.isArray(m.input) && m.input.includes('image'),
  });

  return {
    /** Where pi is, or null. */
    available: () => bin(),

    /** Pi's configured models and its current default, asked of a
     *  sessionless process in the home directory. */
    async models() {
      const b = await bin();
      if (!b) return { installed: false, models: [], default: null };
      const key = '\0catalog';
      let p = procs.get(key);
      if (!p || p.dead) { p = new PiProcess(b, os.homedir(), { log: say, noSession: true, onExit: (d) => { if (procs.get(key) === d) procs.delete(key); } }); procs.set(key, p); }
      return p.exclusive(async () => {
        const [cat, state] = await Promise.all([p.send({ type: 'get_available_models' }), p.send({ type: 'get_state' })]);
        const models = (cat?.models ?? []).map(modelEntry);
        const cur = state?.model ? `${state.model.provider}/${state.model.id}` : null;
        return { installed: true, models, default: cur && models.some((m) => `${m.provider}/${m.id}` === cur) ? cur : (models[0] ? `${models[0].provider}/${models[0].id}` : null), thinkingLevel: state?.thinkingLevel ?? null };
      });
    },

    /**
     * One prompt on one session. `onEvent` receives Pi's session events as
     * they come, plus the shell's own: `session` (which session this run
     * writes to, before the prompt), `run_end` (with the final text), and
     * `run_error`. Resolves with the runId as soon as the run is accepted.
     */
    async run(req, onEvent) {
      const cwd = String(req.cwd || '');
      if (!cwd || !path.isAbsolute(cwd)) throw new Error('run needs an absolute cwd');
      await fsp.mkdir(cwd, { recursive: true });
      const runId = randomUUID();
      const proc = await processFor(cwd);
      const emit = (event) => { try { onEvent({ runId, event }); } catch { /* renderer gone */ } };
      const aborter = { aborted: false };
      runs.set(runId, { proc, abort: () => { aborter.aborted = true; proc.send({ type: 'abort' }).catch(() => {}); } });

      void proc.exclusive(async () => {
        let text = '';
        let ended;
        const finished = new Promise((resolve) => { ended = resolve; });
        proc.listener = (event) => {
          if (event.type === 'message_end' && event.message?.role === 'assistant') text = textOf(event.message) || text;
          if (event.type === 'process_exit') { emit({ type: 'run_error', message: event.reason }); ended('exit'); return; }
          emit(event);
          if (event.type === 'agent_end') ended('end');
        };
        try {
          if (req.sessionPath) await proc.send({ type: 'switch_session', sessionPath: String(req.sessionPath) });
          if (req.forkEntryId) await proc.send({ type: 'fork', entryId: String(req.forkEntryId) });
          else if (!req.sessionPath) await proc.send({ type: 'new_session' });
          if (req.model && typeof req.model === 'object' && req.model.provider && req.model.id) await proc.send({ type: 'set_model', provider: req.model.provider, modelId: req.model.id });
          if (req.thinkingLevel) await proc.send({ type: 'set_thinking_level', level: req.thinkingLevel });
          const state = await proc.send({ type: 'get_state' });
          emit({ type: 'session', sessionId: state?.sessionId ?? null, sessionFile: state?.sessionFile ?? null, model: state?.model ? { provider: state.model.provider, id: state.model.id, name: state.model.name } : null, cwd });
          if (aborter.aborted) { ended('aborted'); }
          else {
            // the prompt's response may follow the whole turn; the end is read from events
            proc.send({ type: 'prompt', message: String(req.prompt ?? ''), ...(Array.isArray(req.images) && req.images.length ? { images: req.images } : {}) }, 24 * 60 * 60 * 1000).catch((e) => { emit({ type: 'run_error', message: e.message }); ended('error'); });
          }
          const how = await finished;
          emit({ type: 'run_end', text, how });
        } catch (e) {
          emit({ type: 'run_error', message: e instanceof Error ? e.message : String(e) });
          emit({ type: 'run_end', text, how: 'error' });
        } finally {
          proc.listener = null;
          proc.touch();
          runs.delete(runId);
        }
      });
      return runId;
    },

    abort(runId) {
      const r = runs.get(runId);
      if (!r) return false;
      r.abort();
      return true;
    },

    shutdown() {
      for (const p of procs.values()) p.close();
      procs.clear();
    },
  };
}

module.exports = { createPiRuntime, findPi };
