// Dossiers: one document per topic, kept by the why layer. The canvas
// writes it (the chat model lives there); here the storage contract: the
// summary of every topic's document state, what is new since the document
// last read the topic's turns, facts filed for a later merge, replacement
// and deletion. Labels come from the same stub judge as the topics test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'td-dossiers-'));
const home = join(tmp, 'home');
const sessions = join(tmp, 'sessions'); mkdirSync(sessions);
const proj = join(tmp, 'proj'); mkdirSync(proj);
const rollout = join(sessions, '2026', '09', '21'); mkdirSync(rollout, { recursive: true });
const cx = (type, payload, ts = '2026-09-21T10:00:00.000Z') => JSON.stringify({ timestamp: ts, type, payload });
const turn = (q, a, i) => [
  cx('turn_context', { turn_id: `T${i}` }, `2026-09-21T10:0${i}:00.000Z`),
  cx('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: q }] }, `2026-09-21T10:0${i}:00.000Z`),
  cx('response_item', { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: a }] }, `2026-09-21T10:0${i}:30.000Z`),
];
writeFileSync(join(rollout, 'rollout-2026-09-21T10-00-00-bbbb.jsonl'), [
  cx('session_meta', { id: 'bbbb', cwd: proj, timestamp: '2026-09-21T10:00:00.000Z' }),
  ...turn('How should the solarisnet baseline threshold be chosen?', 'Keep the solarisnet baseline at 0.7 and compare against the control group first.', 1),
  ...turn('Why does the solarisnet loader drop the last batch?', 'The solarisnet loader uses drop_last=True; set it to False so evaluation sees every sample.', 2),
  ...turn('Draft the DFG budget table.', 'The DFG budget lists one postdoc for 36 months plus student assistants.', 3),
].join('\n') + '\n');

process.env.THOUGHTDAG_HOME = home;
process.env.THOUGHTDAG_SESSION_ROOTS = sessions;
const why = await import(join(here, '..', '..', 'desktop', 'why.mjs'));

const server = createServer((req, res) => {
  let body = ''; req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const { state, questions } = JSON.parse(body); const answers = {};
    for (const [qid, q] of Object.entries(questions)) { const m = /the turn `(t\d+)` about the topic "([^"]+)"/.exec(q.instructions); const text = `${state[m[1]].q} ${state[m[1]].a}`.toLowerCase(); answers[qid] = { type: 'noul', noul: text.includes(m[2].toLowerCase()) ? 0.9 : 0.05 }; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ model: 'stub', answers }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); server.unref();
const url = `http://127.0.0.1:${server.address().port}/v1/systemone`;

let solarisId;
test('a topic without a document reports what a build would read', async () => {
  await why.buildIndex(true);
  const [tp] = await why.setTopics([{ name: 'solarisnet', description: 'the solarisnet model' }]);
  solarisId = tp.id;
  await why.labelStart({ url, headers: {} }, { batch: 4 });
  for (let i = 0; i < 100 && (await why.topicsJson()).status.running; i++) await new Promise((r) => setTimeout(r, 50));
  const [s] = await why.dossiersJson();
  assert.equal(s.topicId, solarisId);
  assert.equal(s.built, false);
  assert.equal(s.labeled, 2);
  assert.equal(s.newTurns, 2);
  const fresh = await why.dossierNewTurns(solarisId);
  assert.equal(fresh.total, 2);
  assert.equal(fresh.excerpts.length, 2);
  assert.ok(fresh.excerpts.every((e) => /^bbbb#\d+$/.test(e.key) && e.q.length > 0 && e.a.length > 0));
  assert.equal(await why.dossierJson(solarisId), null);
});

test('the canvas writes the document; the summary and the new-turn count follow', async () => {
  const fresh = await why.dossierNewTurns(solarisId);
  const keys = fresh.excerpts.map((e) => e.key);
  const d = await why.setDossier(solarisId, {
    sections: { what: [{ text: 'A thresholded network model.', src: [keys[0]] }], decisions: [{ text: 'Baseline threshold 0.7.', src: [keys[0]] }], now: [], open: [{ text: 'Whether 0.7 holds on new data.', src: [] }] },
    sources: Object.fromEntries(fresh.hits.map((h) => [`${h.session}#${h.turn}`, { session: h.session, turn: h.turn, runner: h.runner, title: h.title, at: h.at, open: h.open, kind: h.kind }])),
    covered: keys, builtAt: new Date().toISOString(), changelog: [{ at: new Date().toISOString(), note: 'built from 2 turns' }],
  });
  assert.equal(d.topicId, solarisId);
  assert.ok(existsSync(join(home, 'dossiers.json')));
  const [s] = await why.dossiersJson();
  assert.equal(s.built, true);
  assert.equal(s.newTurns, 0);
  assert.equal(s.covered, 2);
  assert.equal(s.sentences, 3);
  assert.equal(s.lead, 'A thresholded network model.');
  const again = await why.dossierNewTurns(solarisId);
  assert.equal(again.total, 0);
});

test('facts filed for a later merge wait in the document; deletion clears it', async () => {
  const d = await why.dossierAddPending(solarisId, { text: 'Switch the loader to drop_last=False', from: 'canvas A' });
  assert.equal(d.pending.length, 1);
  assert.equal(d.pending[0].from, 'canvas A');
  const [s] = await why.dossiersJson();
  assert.equal(s.pending, 1);
  // a fact for a topic with no document yet creates the shell
  const [, dfg] = await why.setTopics([{ id: solarisId, name: 'solarisnet', description: 'the solarisnet model' }, { name: 'DFG', description: 'the funding application' }]);
  const shell = await why.dossierAddPending(dfg.id, { text: 'Budget table has one postdoc for 36 months' });
  assert.equal(shell.builtAt, null);
  assert.equal(shell.pending.length, 1);
  await why.deleteDossier(solarisId);
  assert.equal(await why.dossierJson(solarisId), null);
  assert.equal((await why.dossiersJson()).find((x) => x.topicId === solarisId).built, false);
  server.close();
});
