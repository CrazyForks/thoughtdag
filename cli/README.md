# thoughtdag

Find the conversations that shaped a file.

```
npx thoughtdag why src/lib/api.ts
```

Indexes the agent sessions already on your machine (Claude Code, Codex, DeepSeek Harness, Pi) by the files each turn read, wrote or edited, and lists those turns: when, what changed, what was asked, what the answer said about the file. Every hit links back to the conversation.

- Facts come straight off tool calls, never from free text or a model.
- Session files are read, never written. The index lives in `~/.thoughtdag` (0700/0600) and can be deleted with `thoughtdag purge`.
- `Δ` lines are observed changes; `≈` lines are read from the answer and are candidate explanations, not verified reasons.

```
thoughtdag index [--full] [--canvas <dir>]
thoughtdag why <path> [--include-read] [--all] [--limit N] [--json]
thoughtdag why --check <path>            # one line, exit 0/1: is there history here?
thoughtdag find "<phrase>" [--in q|a|m]  # where these exact words were asked, answered or attached
thoughtdag recall <session> <n>
thoughtdag status
thoughtdag purge [--cache]
thoughtdag mcp                           # the same questions as MCP tools (stdio, read-only)
thoughtdag setup [mcp | rules [--remove]]
```

## Let the agent ask on its own

`thoughtdag setup mcp` registers the server for Claude Code in this project's `.mcp.json` and for Codex in the user-level `~/.codex/config.toml`; the agent then has `why_check`, `why_file`, `find` and `recall_turn` as tools. `thoughtdag setup rules` adds two lines to this project's `CLAUDE.md` and `AGENTS.md` — check for history before editing a file; query before explaining why code is the way it is — as a marked block, `--remove` takes it out. Rule changes are per project and explicit; nothing is written unless you ask.

## MCP clients and directories

The server's MCP Registry name is `io.github.chenxiachan/thoughtdag`. A client that supports local stdio servers can start it with:

```json
{
  "mcpServers": {
    "thoughtdag": {
      "command": "npx",
      "args": ["-y", "thoughtdag@0.2.2", "mcp"]
    }
  }
}
```

Requires Node.js 20 or newer and supported session logs on the machine running the server. Start it in the relevant project directory so file queries use the intended workspace. Clients use different configuration formats; the example above is for clients that accept `mcpServers` JSON.

The four tools search and recall history; they cannot edit a canvas, modify source sessions, or replace the client's conversation. Derived indexes and caches are written under `~/.thoughtdag`. Retrieved text is returned to the calling agent and may enter that agent's model context; review the client's provider settings before using private history.

### Container and directory checks

The [Dockerfile](https://github.com/chenxiachan/thoughtdag/blob/main/cli/Dockerfile) installs the published CLI version as a non-root stdio server. It does not copy the repository or any session data into the image. From the repository root:

```bash
docker build -f cli/Dockerfile -t thoughtdag-mcp cli
docker run --rm -i --network none thoughtdag-mcp
```

An empty container answers MCP initialization and `tools/list`; history queries have no results until you explicitly provide local data. No model key, private session, or hosted endpoint is needed for the directory check.

Glama generates its own Dockerfile from the listing's **Admin → Dockerfile** form. Use Node.js `22` and these build steps:

```json
["npm install --global --ignore-scripts --no-audit --no-fund thoughtdag@0.2.2"]
```

Use these CMD arguments (Glama adds its own `mcp-proxy` wrapper):

```json
["env", "THOUGHTDAG_HOME=/tmp/thoughtdag-index", "THOUGHTDAG_SESSION_ROOTS=/data/sessions", "THOUGHTDAG_CANVAS_ROOTS=/data/canvases", "THOUGHTDAG_MEMORY_ROOTS=", "thoughtdag", "mcp"]
```

Leave placeholder credentials empty, then build and release. The repository root builds the web frontend; it does not produce `dist/thoughtdag.mjs`. Keep the pinned CLI version in this configuration aligned with the version you intend to list. Glama's generated image is separate from the non-root image above.

For actual local use, mount only the history directories you choose, read-only, at `/data/sessions` and optionally `/data/canvases`. The derived index is stored separately at `/home/node/.thoughtdag`. Query absolute artifact paths recorded in those sessions; the container's default working directory is not your host project's path. The native `npx` configuration above is the simpler option for project-relative queries. A cloud-hosted copy cannot see the history on your computer.

## Optional Codex skill

The repository also contains a Codex skill for opening a session in the desktop app or running CLI history queries:

```bash
npx skills add chenxiachan/thoughtdag --skill thoughtdag --agent codex
```

This installs a skill in the current project. Opening a session needs the ThoughtDAG desktop app or its local bridge; CLI queries use the npm package. It is separate from MCP registration and does not provide a canvas-writing MCP tool.
