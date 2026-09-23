#!/usr/bin/env node
// The live-log tail arithmetic. A live session's list entry reports `seq`,
// the number of the NEXT event; the host answers `?since=N` with the events
// strictly after N. The canvas once asked with the list's seq and lost the
// first event after its snapshot — on a runtime where a step is one
// assistant/message, that event was the answer (0.4.19).
//
// Run: node scripts/test-live-log.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tmp = mkdtempSync(join(tmpdir(), 'tdag-live-log-'));
const bundle = join(tmp, 'live-log.mjs');
execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
  join(ROOT, 'src/lib/atlas/live-log.ts'), '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`,
], { stdio: ['ignore', 'ignore', 'pipe'] });
const { lastSeqOf, liveTailPlan } = await import(pathToFileURL(bundle).href);

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const eq = (a, b, msg) => assert(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const header = JSON.stringify({ type: 'session', version: 0, id: 's1' });
const ev = (seq, type = 'step/start') => JSON.stringify({ type, seq, time: 1, data: {} });
const log = (...seqs) => [header, ...seqs.map((n) => ev(n))].join('\n');

test('lastSeqOf reads the last event, trailing newlines or not', () => {
  eq(lastSeqOf(log(0, 1, 2)), 2, 'plain');
  eq(lastSeqOf(log(0, 1, 2) + '\n\n'), 2, 'trailing newlines');
  eq(lastSeqOf(header), null, 'header alone');
  eq(lastSeqOf(''), null, 'empty');
  eq(lastSeqOf(log(0, 1) + '\n{"type":"torn'), null, 'torn last line');
});

test('the bug: list seq 22, held through 21 → nothing to fetch (the list counts the NEXT event)', () => {
  // 0.4.18 asked ?since=22 here and, when the list later said 25, the
  // tail 23..24 skipped event 22: the assistant/message with the answer
  eq(liveTailPlan(log(...Array.from({ length: 22 }, (_, i) => i)), 22), { kind: 'reuse' }, 'reuse');
});

test('the log moved on: ask strictly after the last HELD event', () => {
  const held = log(...Array.from({ length: 22 }, (_, i) => i)); // 0..21
  eq(liveTailPlan(held, 25), { kind: 'tail', since: 21 }, 'since = last held, so 22 is included');
});

test('the fetch raced ahead of the list: the held log is newer than the list says → reuse', () => {
  const held = log(0, 1, 2, 3, 4, 5); // list said 4 when we fetched, the log already had 0..5
  eq(liveTailPlan(held, 4), { kind: 'reuse' }, 'no tail asked, no duplicate lines');
  eq(liveTailPlan(held, 6), { kind: 'reuse' }, 'exactly caught up');
  eq(liveTailPlan(held, 7), { kind: 'tail', since: 5 }, 'one new event');
});

test('nothing usable held → the whole log', () => {
  eq(liveTailPlan(null, 10), { kind: 'full' }, 'no cache');
  eq(liveTailPlan('', 10), { kind: 'full' }, 'empty cache');
  eq(liveTailPlan(header, 10), { kind: 'full' }, 'header alone');
  eq(liveTailPlan(log(0, 1), null), { kind: 'full' }, 'list reports no seq');
});

rmSync(tmp, { recursive: true, force: true });
if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log('\nall live-log checks passed');
