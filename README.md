# Claude Session Viewer

A local web app to read and continue your Claude Code sessions. Built with
[TanStack Start](https://tanstack.com/start) and
[TanStack Virtual](https://tanstack.com/virtual).

- Lists your projects and sessions from `~/.claude/projects`.
- Shows a session transcript: text, thinking, tool calls, and tool results.
- Sends a message to a session and streams each step while Claude works.
- Starts a new session in a project and adds it to Claude Desktop.

## Requirements

- macOS (the Claude Desktop step uses the BSD `script` command)
- Node.js 24
- pnpm
- The [`claude` CLI](https://code.claude.com/docs), signed in

## Run it

```bash
pnpm install
pnpm dev
```

Open http://127.0.0.1:3333.

## How it works

- **Read.** Each session is a `.jsonl` file in `~/.claude/projects/<project>/`.
  The server reads these files and keeps the `user` and `assistant` records.
- **Send.** The server runs `claude --resume <id> --print --output-format stream-json`
  in the session's folder, and streams each output line to the page.
- **Permissions.** The server reads the session's last permission mode and its
  added folders from the session file, and passes them to `claude`. It never
  uses `bypassPermissions`. It skips `default`, because a headless run cannot
  ask you for approval.
- **New session.** "New session" opens an empty page with a new UUID. The first
  message runs `claude --session-id <uuid>`, with the folder and permissions of
  the newest session in that project. When the first turn ends, the server runs
  `claude --desktop --resume <uuid>`, so the session shows in Claude Desktop.

## Security

This app runs Claude on your machine with your session permissions, for example
`auto` mode. Transcripts can contain secrets from tool output.

- Run it on `127.0.0.1` only. Do not deploy it or expose the port.
- The server accepts send requests only from its own pages on `127.0.0.1` or
  `localhost`. This blocks other websites and DNS rebinding.

## Limits

- The session file format has no public documentation, and it can change
  between Claude Code versions.
- The transcript uses the line order of the file. Branches from edited messages
  show one after the other.
- Output streams one step at a time, not one token at a time.
- The page always scrolls to new entries, even if you scrolled up.
- Do not send to a session that is running in another window at the same time.

## Scripts

```bash
pnpm test        # parser tests (node:test)
pnpm typecheck   # tsc --noEmit
pnpm build       # production build
```
