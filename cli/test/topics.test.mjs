// Topics: a small table the person names, labels a judge writes for every
// indexed turn (one yes/no per topic), and a lookup by topic. The judge is
// any /v1/systemone endpoint; here a local stub that says "yes" to a topic
// when the turn mentions its name. Labelling runs in the background and
// reports progress; its key rides in the call and is never written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'td-topics-'));
const home = join(tmp, 'home');
const sessions = join(tmp, 'sessions'); mkdirSync(sessions);
const proj = join(tmp, 'proj'); mkdirSync(proj);

// a small Codex-style session log: three turns on two subjects
const rollout = join(sessions, '2026', '09', '20'); mkdirSync(rollout, { recursive: true });
const cx = (type, payload, ts = '2026-09-20T10:00:00.000Z') => JSON.stringify({ timestamp: ts, type, payload });
const turn = (q, a, i) => [
  cx('turn_context', { turn_id: `T${i}` }, `2026-09-20T10:0${i}:00.000Z`),
  cx('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: q }] }, `2026-09-20T10:0${i}:00.000Z`),
  cx('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: a }] }, `2026-09-20T10:0${i}:30.000Z`),
];
writeFileSync(join(rollout, 'rollout-2026-09-20T10-00-00-aaaa.jsonl'), [
  cx('session_meta', { id: 'aaaa', cwd: proj, timestamp: '2026-09-20T10:00:00.000Z' }),
  ...turn('How should the solarisnet baseline threshold be chosen for the August runs?', 'Keep the solarisnet baseline at 0.7 and compare against the control group before changing anything else in the pipeline.', 1),
  ...turn('Draft the DFG funding budget table for personnel costs over three years.', 'The DFG budget table lists one postdoc position for 36 months plus student assistants; travel is a separate line.', 2),
  ...turn('Why does the solarisnet loader drop the last batch when the dataset size is not divisible?', 'The solarisnet loader uses drop_last=True; set it to False or pad the final batch so evaluation sees every sample.', 3),
].join('\n') + '\n');

process.env.THOUGHTDAG_HOME = home;
process.env.THOUGHTDAG_SESSION_ROOTS = sessions;
const why = await import(join(here, '..', '..', 'desktop', 'why.mjs'));

// the stub judge: yes when the turn's text mentions the topic's name
let calls = 0; let sawAuth = '';
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls++; sawAuth = req.headers.authorization ?? '';
    const { state, questions } = JSON.parse(body);
    const answers = {};
    for (const [qid, q] of Object.entries(questions)) {
      const m = /the turn `(t\d+)` about the topic "([^"]+)"/.exec(q.instructions);
      const text = `${state[m[1]].q} ${state[m[1]].a}`.toLowerCase();
      answers[qid] = { type: 'noul', noul: text.includes(m[2].toLowerCase()) ? 0.93 : 0.04 };
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: 'stub-judge', answers }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
server.unref();
const url = `http://127.0.0.1:${server.address().port}/v1/systemone`;

test('the topic table is named, kept, and counted', async () => {
  await why.buildIndex(true);
  const before = await why.topicsJson();
  assert.equal(before.topics.length, 0);
  assert.equal(before.turns, 3);
  const saved = await why.setTopics([{ name: 'solarisnet', description: 'the solarisnet model, its loader, baselines and experiments' }, { name: 'DFG', description: 'the DFG funding application: budget, work packages, deadlines' }]);
  assert.equal(saved.length, 2);
  assert.ok(saved.every((t) => /^[a-z0-9_-]+$/.test(t.id)));
  const after = await why.topicsJson();
  assert.deepEqual(after.topics.map((t) => t.count), [0, 0]);
  assert.ok(existsSync(join(home, 'topics.json')));
});

test('labelling runs in the background with the judge and reports progress; the key is not written', async () => {
  const st = await why.labelStart({ url, headers: { Authorization: 'Bearer secret-key-123' } }, { batch: 2 });
  assert.equal(st.running, true);
  for (let i = 0; i < 100; i++) {
    const s = (await why.topicsJson()).status;
    if (!s.running) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  const done = await why.topicsJson();
  assert.equal(done.status.running, false);
  assert.equal(done.status.labeled, 3);
  assert.equal(done.status.errors, 0);
  assert.equal(done.labeled, 3);
  assert.equal(calls, 2, 'three turns in batches of two = two judge calls');
  assert.equal(sawAuth, 'Bearer secret-key-123');
  const counts = Object.fromEntries(done.topics.map((t) => [t.name, t.count]));
  assert.deepEqual(counts, { solarisnet: 2, DFG: 1 });
  assert.ok(!readFileSync(join(home, 'topics.json'), 'utf8').includes('secret-key-123'));
});

test('turns come back by topic, strongest first, with their labels', async () => {
  const { topics } = await why.topicsJson();
  const solaris = topics.find((t) => t.name === 'solarisnet');
  const r = await why.byTopicJson([solaris.id]);
  assert.equal(r.total, 2);
  assert.ok(r.hits.every((h) => h.topics[solaris.id] >= 0.9));
  assert.ok(r.hits.every((h) => /solarisnet/i.test(h.snippet)));
  const none = await why.byTopicJson(['nope']);
  assert.equal(none.total, 0);
  // a second labelling pass finds nothing left to do
  const again = await why.labelStart({ url, headers: {} }, { batch: 2 });
  for (let i = 0; i < 100 && (await why.topicsJson()).status.running; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal((await why.topicsJson()).status.total, 0);
  assert.equal(again.running, true);
});

test('removing a topic drops its labels; the sample spreads across past questions', async () => {
  const { topics } = await why.topicsJson();
  await why.setTopics(topics.filter((t) => t.name !== 'DFG'));
  const after = await why.topicsJson();
  assert.deepEqual(after.topics.map((t) => t.name), ['solarisnet']);
  assert.equal(after.labeled, 3, 'turns keep the remaining labels');
  const sample = await why.sampleQuestions(2);
  assert.equal(sample.length, 2);
  server.close();
});
