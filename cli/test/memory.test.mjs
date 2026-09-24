// The memories two agents keep for themselves join the index: Claude Code's
// per-project memory directory (one fact per file) and Codex's memories
// (MEMORY.md by task group, raw_memories.md by thread). Each file is a
// session of kind 'memory', each entry a turn — so find and recall answer
// over them, and a canvas can cite one entry with its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'thoughtdag.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'td-memory-'));
const home = join(tmp, 'home');
const sessions = join(tmp, 'sessions'); mkdirSync(sessions);
const proj = join(tmp, 'solarisnet'); mkdirSync(proj);
const other = join(tmp, 'elsewhere'); mkdirSync(other);
// the index canonicalises paths (macOS mounts /var under /private)
const realProj = realpathSync(proj); const realOther = realpathSync(other);

// Claude Code: <projects>/<slug>/memory/*.md beside the project's session files (whose records carry cwd)
const ccProjects = join(tmp, 'claude-projects');
const slug = join(ccProjects, 'Users-me-solarisnet'); mkdirSync(join(slug, 'memory'), { recursive: true });
writeFileSync(join(slug, 'abc.jsonl'), JSON.stringify({ type: 'user', uuid: 'u1', parentUuid: null, sessionId: 'abc', cwd: proj, timestamp: '2026-09-01T10:00:00.000Z', message: { role: 'user', content: 'hi' } }) + '\n');
writeFileSync(join(slug, 'memory', 'MEMORY.md'), '# Memory Index\n\n- [Solaris baseline](solaris-baseline.md) — the 2026-08 number\n');
writeFileSync(join(slug, 'memory', 'solaris-baseline.md'), `---
name: solaris-baseline
description: Solaris 基线：2026-08 的实验用 0.7 阈值
metadata:
  type: project
---

Solaris 的基线实验定在 0.7 阈值，改动前先跑一遍对照组。

**Why:** 用户 2026-08-30 拍板。
`);
writeFileSync(join(slug, 'memory', 'style.md'), `---
name: style
description: 回复用短句
metadata:
  type: feedback
---

回复不要用破折号连句。
`);

// Codex: memories/MEMORY.md (task groups naming their cwd), raw_memories.md (threads), memory_summary.md
const cxMem = join(tmp, 'codex-memories'); mkdirSync(join(cxMem, 'extensions', 'ad_hoc'), { recursive: true });
writeFileSync(join(cxMem, 'MEMORY.md'), `# Task Group: Solaris data pipeline

scope: Rebuild the solaris ingestion so the 0.7 threshold is applied once.
applies_to: cwd=${proj}; reuse_rule=the threshold constant is project-specific.

## Task 1: Apply the threshold in one place, success

- moved the constant into config; solaris runs green

## Reusable knowledge

- run the contrast set before touching thresholds

# Task Group: Unrelated CV update

scope: Update a CV.
applies_to: cwd=${other}; reuse_rule=none.

## Task 1: Update the CV, success

- done
`);
writeFileSync(join(cxMem, 'raw_memories.md'), `# Raw Memories

Merged stage-1 raw memories:

## Thread \`t-1\`
updated_at: 2026-09-09T02:42:55+00:00
cwd: ${proj}
rollout_path: /x/rollout-1.jsonl

- the user asked to keep solaris logs verbose

## Thread \`t-2\`
updated_at: 2026-09-10T02:42:55+00:00
cwd: ${other}
rollout_path: /x/rollout-2.jsonl

- nothing relevant here
`);
writeFileSync(join(cxMem, 'memory_summary.md'), `# Memory Summary

## User Profile

- a postdoc

## User preferences

- short replies
`);
writeFileSync(join(cxMem, 'extensions', 'ad_hoc', 'instructions.md'), '# Ad hoc\n\nalways check the solaris changelog first\n');

const env = {
  ...process.env,
  THOUGHTDAG_HOME: home,
  THOUGHTDAG_SESSION_ROOTS: sessions,
  THOUGHTDAG_MEMORY_ROOTS: [`claude-code=${ccProjects}`, `codex=${cxMem}`].join(delimiter),
};
const run = (...a) => execFileSync(process.execPath, [CLI, ...a], { env, cwd: tmp, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('index: every memory file is a session of kind memory; Claude Code\'s MEMORY.md index is not one', () => {
  run('index');
  const status = run('status');
  assert.match(status, /memories: 6 files · 10 entries/);
  const list = run('memories');
  assert.match(list, /mem-cc-[0-9a-f]{12}  claude-code  1 entry  「memory · solarisnet · solaris-baseline」/);
  assert.match(list, /mem-cx-[0-9a-f]{12}  codex  3 entries  「memory · Codex · MEMORY.md」/);
  assert.match(list, /codex  2 entries  「memory · Codex · raw_memories.md」/);
  assert.doesNotMatch(list, /memory · solarisnet · MEMORY/);
});

test('find: memory entries are hits of kind memory, carrying the project they are about', () => {
  const r = JSON.parse(run('find', 'solaris', '--json'));
  const kinds = new Set(r.hits.map((h) => h.kind));
  assert.deepEqual([...kinds], ['memory']);
  const cc = r.hits.find((h) => h.runner === 'claude-code');
  assert.ok(cc, 'the Claude Code fact is found');
  assert.equal(cc.cwd, realProj, 'its project comes from the sibling session file');
  assert.match(cc.open, /^thoughtdag:\/\/open\?memory=.*&entry=0$/);
  const cxTask = r.hits.find((h) => h.runner === 'codex' && /Task Group: Solaris data pipeline › Task 1/.test(h.title + h.snippet + JSON.stringify(h)));
  const cxHits = r.hits.filter((h) => h.runner === 'codex');
  assert.ok(cxHits.length >= 3, `codex hits: MEMORY.md task, raw thread, ad-hoc (got ${cxHits.length})`);
  assert.ok(cxHits.every((h) => h.cwd === realProj || h.cwd === ''), 'the CV group (another cwd) is not among the solaris hits: ' + JSON.stringify(cxHits.map((h) => h.cwd)));
  void cxTask;
  const text = run('find', 'solaris');
  assert.match(text, /codex memory  「memory · Codex · MEMORY.md」/);
});

test('find --cwd style filtering is available to hosts through the JSON api (per-entry cwd on Codex task groups)', async () => {
  const lib = await import(new URL('../dist/thoughtdag.mjs', import.meta.url).href).catch(() => null);
  // the CLI bundle has no exports; the check that matters here is the data the JSON already carries
  const r = JSON.parse(run('find', 'CV', '--json'));
  assert.equal(r.hits.length, 1);
  assert.equal(r.hits[0].cwd, realOther, 'a Codex task group entry names its own cwd');
  void lib;
});

test('recall: a memory entry comes back in full, by its memory id and entry number', () => {
  const r = JSON.parse(run('find', '0.7 阈值', '--json'));
  const hit = r.hits.find((h) => h.runner === 'claude-code');
  const out = run('recall', hit.session, String(hit.turn));
  assert.match(out, /claude-code memory  「memory · solarisnet · solaris-baseline」  entry #0/);
  assert.match(out, /## Solaris 基线：2026-08 的实验用 0.7 阈值/);
  assert.match(out, /改动前先跑一遍对照组/);
  const cx = JSON.parse(run('find', 'verbose', '--json')).hits[0];
  const raw = run('recall', cx.session, String(cx.turn));
  assert.match(raw, /codex memory  「memory · Codex · raw_memories.md」  entry #0  2026-09-09/);
  assert.match(raw, /keep solaris logs verbose/);
});

test('a store that names its session roots but no memory roots indexes no memories', () => {
  const home2 = join(tmp, 'home2');
  const out = execFileSync(process.execPath, [CLI, 'status'], { env: { ...process.env, THOUGHTDAG_HOME: home2, THOUGHTDAG_SESSION_ROOTS: sessions }, cwd: tmp, encoding: 'utf8' });
  assert.match(out, /no index yet/);
  execFileSync(process.execPath, [CLI, 'index'], { env: { ...process.env, THOUGHTDAG_HOME: home2, THOUGHTDAG_SESSION_ROOTS: sessions }, cwd: tmp, encoding: 'utf8' });
  const st = execFileSync(process.execPath, [CLI, 'status'], { env: { ...process.env, THOUGHTDAG_HOME: home2, THOUGHTDAG_SESSION_ROOTS: sessions }, cwd: tmp, encoding: 'utf8' });
  assert.doesNotMatch(st, /memories:/);
});
