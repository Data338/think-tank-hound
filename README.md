# think-tank-hound

Structured reasoning + knowledge-graph memory + task plans for coding agents —
with web research built in and **zero API keys**. Fork of
[flight505/mcp-think-tank](https://github.com/flight505/mcp-think-tank) with the
Exa backend replaced by an owned [Hound](https://github.com/dondai44423/master-fetch) child process.

## Why

The upstream `exa_search` / `exa_answer` tools require a paid `EXA_API_KEY`.
This fork swaps them for `hound_search` / `hound_fetch`, backed by a Hound
process that this server spawns and owns over stdio: one process, no TCP, no
extra daemon, no orphans, no keys. Everything else (think, 11 memory tools,
5 task tools) is untouched.

## Quick start

Requirements: Node 18+, Python 3 + `hound-mcp` 13.2.0 (`pip install hound-mcp`).

```bash
npm install
npm run build
```

Register in `opencode.json` (or any MCP client):

```jsonc
{
  "mcp": {
    "think-tank-hound": {
      "type": "local",
      "command": ["node", "/path/to/think-tank-hound/dist/server.js"],
      "enabled": true,
      "environment": {
        "MCP_TRANSPORT": "stdio",
        "MEMORY_PATH": "/path/to/memory.jsonl",
        "HOUND_BIN": "/path/to/hound"
      }
    }
  }
}
```

`HOUND_BIN` may point at an isolated copy (recommended — see below); it falls
back to `hound` on `PATH`.

## Tools (20)

| Group | Tools |
|---|---|
| think (1) | `think` — structured reasoning with self-reflection |
| memory (11) | `upsert_entities`, `create_relations`, `add_observations`, `search_nodes`, `open_nodes`, `memory_query`, `read_graph`, `update_relations`, `delete_entities`, `delete_observations`, `delete_relations` |
| tasks (5) | `plan_tasks`, `list_tasks`, `next_task`, `complete_task`, `update_tasks` |
| hound (2) | `hound_search` (query, focus, site, freshness, max_results), `hound_fetch` (url/urls, focus, pages, max_content_chars) |
| utility (1) | `show_memory_path` |

## Isolated Hound copy (recommended)

Point `HOUND_BIN` at a dedicated venv so the integration never fights your
daily driver over versions:

```bash
python3 -m venv /opt/hound-integration/.venv
/opt/hound-integration/.venv/bin/pip install "hound-mcp==13.2.0"
```

Pin policy: bump only after `npx vitest run` passes against the new version.

## Dev notes

- `@modelcontextprotocol/sdk` is pinned **exact** (`1.12.3` + `overrides`): 1.30
  asserts a `completions` capability that FastMCP 1.27 never declares, which
  kills the server at startup. Do not float it without re-running the suite.
- Shutdown reaps the Hound child (SIGTERM path + stdin-close hook); no orphans.
- `npm test` — 60 tests, including proxy mapping and spawn resolution.

## License

MIT — see [LICENSE](./LICENSE). Upstream work © flight505.
