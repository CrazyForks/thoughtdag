// Pi sessions in the why layer: a format-v3 tree under its own root. The
// question's parent is an entry, not a turn — a branch resolves through a
// bookkeeping entry (model_change) to the turn that owns it. Own fixture
// store so the counts in why.test.mjs stay what they are.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'thoughtdag.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'td-pi-'));
const proj = join(tmp, 'proj'); mkdirSync(join(proj, 'src'), { recursive: true }); mkdirSync(join(proj, '.git'));
const home = join(tmp, 'home'); const piRoot = join(tmp, 'pi');
const dir = join(piRoot, '--proj--'); mkdirSync(dir, { recursive: true });
const file = join(dir, '2026-09-06T10-00-00-000Z_pi-1.jsonl');
const L = (o) => JSON.stringify(o);
const T = '2026-09-06T10:00:00.000Z';
const api = join(proj, 'src', 'api.ts');
writeFileSync(file, [
  L({ type: 'session', version: 3, id: 'pi-1', timestamp: T, cwd: proj }),
  L({ type: 'thinking_level_change', id: 'tl', parentId: null, timestamp: T, thinkingLevel: 'off' }),
  L({ type: 'model_change', id: 'mc1', parentId: 'tl', timestamp: T, provider: 'deepseek', modelId: 'deepseek-v4-pro' }),
  // turn 1: read api.ts (lines 10-29), then edit it
  L({ type: 'message', id: 'u1', parentId: 'mc1', timestamp: T, message: { role: 'user', content: [{ type: 'text', text: '把 api.ts 的重试改成退避' }], timestamp: 1 } }),
  L({ type: 'message', id: 'a1', parentId: 'u1', timestamp: T, message: { role: 'assistant', content: [{ type: 'thinking', text: 'The user wants backoff.' }, { type: 'toolCall', id: 'c1', name: 'read', arguments: { path: api, offset: 10, limit: 20 } }], provider: 'deepseek', model: 'deepseek-v4-pro' } }),
  L({ type: 'message', id: 'r1', parentId: 'a1', timestamp: T, message: { role: 'toolResult', toolCallId: 'c1', toolName: 'read', content: [{ type: 'text', text: 'export const x = retry(1);' }] } }),
  L({ type: 'message', id: 'a2', parentId: 'r1', timestamp: T, message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c2', name: 'edit', arguments: { path: api, edits: [{ oldText: 'x = retry(1)', newText: 'x = backoff(1)' }] } }] } }),
  L({ type: 'message', id: 'r2', parentId: 'a2', timestamp: T, message: { role: 'toolResult', toolCallId: 'c2', toolName: 'edit', content: [{ type: 'text', text: 'edited' }] } }),
  L({ type: 'message', id: 'a3', parentId: 'r2', timestamp: T, message: { role: 'assistant', content: [{ type: 'text', text: '改好了。\n\n重试改成指数退避，接口不变。' }] } }),
  // a model switch mid-session: its entry sits on the parent chain of turn 2
  L({ type: 'model_change', id: 'mc2', parentId: 'a3', timestamp: T, provider: 'anthropic', modelId: 'claude-sonnet-4.5' }),
  // turn 2 continues from the model switch
  L({ type: 'message', id: 'u2', parentId: 'mc2', timestamp: T, message: { role: 'user', content: [{ type: 'text', text: '再看看 README' }] } }),
  L({ type: 'message', id: 'a4', parentId: 'u2', timestamp: T, message: { role: 'assistant', content: [{ type: 'text', text: 'README 没问题。' }] } }),
  // turn 3 is a FORK: it answers a1 (inside turn 1), not turn 2
  L({ type: 'message', id: 'u3', parentId: 'a1', timestamp: T, message: { role: 'user', content: [{ type: 'text', text: '换个思路：不要退避，加熔断' }] } }),
  L({ type: 'message', id: 'a5', parentId: 'u3', timestamp: T, message: { role: 'assistant', content: [{ type: 'text', text: '熔断方案如下。' }] } }),
].join('\n') + '\n');
const env = { ...process.env, THOUGHTDAG_HOME: home, THOUGHTDAG_SESSION_ROOTS: piRoot };
const run = (...a) => execFileSync(process.execPath, [CLI, ...a], { env, cwd: proj, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('index reads a Pi v3 session as one session of three turns', () => {
  assert.match(run('index'), /indexed 1 session \(0 unchanged, 0 not sessions, 0 gone\)/);
  assert.match(run('status'), /1 sessions? in 1 files? · 3 turns/);
});

test('the edit is the footprint, rendered as a diff; thinking is not the answer', () => {
  // the read and the edit happen in ONE turn: the turn's op is the edit, and
  // the read's line window rides along as a locator
  const why = run('why', 'src/api.ts');
  assert.match(why.split('\n')[0], /1 turn in 1 session$/);
  assert.match(why, /pi  「把 api\.ts 的重试改成退避」/);
  assert.match(why, /✏️ edit .*L10-29/);
  assert.match(why, /Δ x = retry\(1\) → x = backoff\(1\)/);
  assert.ok(!why.includes('The user wants backoff'), 'thinking is not the answer');
});

test('events: the fork hangs off turn 1, the continuation off turn 2 through the model switch', () => {
  const ev = run('events', file).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const turns = ev.filter((e) => e.kind === 'turn.started');
  assert.equal(turns.length, 3);
  const [t1, t2, t3] = turns;
  assert.equal(t1.parentTurnId, undefined, 'the root has no parent');
  assert.equal(t2.parentTurnId, t1.id.replace(/\/turn$/, ''), 'turn 2 continues turn 1 (its parent is the model_change entry turn 1 owns)');
  assert.equal(t3.parentTurnId, t1.id.replace(/\/turn$/, ''), 'the fork answers a1 inside turn 1');
  assert.match(ev.find((e) => e.kind === 'session.started').runner, /^pi$/);
});

test('find and recall reach the words and the diff', () => {
  assert.match(run('find', '指数退避', '--in', 'a'), /1 turn in 1 session/);
  const rec = run('recall', 'pi-1', '0');
  assert.ok(rec.includes('把 api.ts 的重试改成退避') && rec.includes('+++ new\n') && rec.includes('x = backoff(1)'));
});

test('purge, then the fixture goes', () => { run('purge'); rmSync(tmp, { recursive: true, force: true }); });
