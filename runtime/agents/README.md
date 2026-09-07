# Agent runtimes

One file per runtime (CommonJS, `.cjs`, so it loads the same under any package type): `pi.cjs` over `pi --mode rpc`, `codex.cjs` over `codex app-server`, `claude.cjs` over `claude -p` with stream-json both ways. Each exports a factory returning the same surface:

- `available()` → where the binary is, or null
- `models()` → `{ installed, models: [{ provider, id, name, reasoning, vision }], default }`
- `run(request, onEvent)` → run id at once; events follow, tagged with it
- `abort(runId)`, `answer(runId, requestId, { confirmed } | { value } | { cancelled: true })`, `shutdown()`

A run emits exactly these event kinds (the renderer reads nothing else):

| kind | meaning |
|---|---|
| `session` | which session file this run writes to, and where (cwd) |
| `message_update` with a text or thinking delta | the answer or the reasoning growing |
| `tool_execution_start` / `tool_execution_end` | a tool call, for the live trace |
| `question` | the agent asks the person: confirm / select / input / editor |
| `question_answered` | the person's answer went back (record) |
| `fs_changes` | what the shell saw change on disk (produced here, not by the agent) |
| `run_end` / `run_error` | the turn is over |

The finished turn is adopted from the session file by the atlas's adapter for that
runtime; the stream is for showing, the file is the truth. Anything a runtime does
beyond these kinds stays inside its own file.
