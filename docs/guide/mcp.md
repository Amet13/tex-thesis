---
title: Using Overfull over MCP
description: Run overfull mcp as a Model Context Protocol server so an AI tool without a shell can check, cite, explain, render pages and diagnose a LaTeX project, with the same results and safety rules as the command line.
order: 11
section: With an agent
---

```sh
overfull mcp
```

`overfull mcp` runs Overfull as a [Model Context Protocol](https://modelcontextprotocol.io/)
(MCP) server over standard input and output. Use it when the agent cannot run a
shell command: a desktop chat app, a cloud editor, or any client that can start an
MCP server but not a terminal. If the agent has a shell, use the commands
directly (see [Working with an agent](./with-an-agent.md)); they do the same and
need no configuration.

You do not start the server yourself. The MCP client starts it and talks to it.

## Configure a client

Most clients take a JSON file with a list of servers. The file name and its place
differ per client; the entry looks like this:

```json
{
  "mcpServers": {
    "overfull": {
      "command": "overfull",
      "args": ["mcp"]
    }
  }
}
```

The server works on the folder it was started in. Clients that start servers from
their own folder (most desktop apps) need the project folder:

```json
{
  "mcpServers": {
    "overfull": {
      "command": "overfull",
      "args": ["mcp", "--cwd", "/path/to/your/thesis"]
    }
  }
}
```

`overfull` must be on the client's `PATH` (see [Install](./install.md)); otherwise
give the full path to the executable as `command`.

## Tools

| Tool | What it does | Arguments |
| --- | --- | --- |
| `check` | The report of `overfull check --json`. | `checks` (list), `profile`, `offline`, `main` |
| `cite` | The result of `overfull cite --json`: looks the work up and appends a verified entry to the project bibliography. | `query` (required), `key`, `author`, `year`, `dryRun` |
| `explain` | What a rule id means and how to fix it; without `rule`, every rule id. | `rule` |
| `pages` | Renders PDF pages to PNG under `.overfull/pages` and returns the paths, with the images for up to five small pages. | `range` (required) |
| `doctor` | Which tools are available on this machine. | none |

Results are JSON in a text block, and also in `structuredContent` for clients
that read it. A problem with the call itself (an unknown rule, a missing PDF, a
reference that cannot be verified) comes back as a normal tool result with
`isError: true` and the message the command line would print. `check` returns
its report even when the report has failures; read the `status` of each check in it.

`check` and `doctor` may contact reference indexes; pass `offline: true` to
`check` to stay local. `check` and `explain` change nothing in the project.
`cite` appends one entry to the bibliography and `pages` writes PNG files, both
inside the project. Clients that show tool annotations will see
`readOnlyHint: false` on those two.

## What the server will not do

- It works only inside the folder it was started in. No tool accepts a working
  directory or an output path, and every file path goes through the same
  checks as the command line: paths outside the project and symlinks that lead
  out of it are refused.
- `cite` never invents an entry. Without a confident match it writes nothing and
  says so, exactly like the command.
- It writes only protocol messages to standard output. Logs go to standard error.
- A single incoming message may be at most 4 MB.

## Protocol

The server speaks MCP revision 2026-07-28 (requests carry the protocol version in
`_meta`; `server/discover` describes the server) and, for clients that have not
moved yet, the earlier `initialize` handshake (versions 2025-11-25, 2025-06-18,
2025-03-26 and 2024-11-05). It uses newline-delimited JSON-RPC over stdio, needs no
dependency, and exits when its input closes.
