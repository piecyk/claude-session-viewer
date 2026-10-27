# Claude Session Viewer

A local web app to read and continue your Claude Code sessions. Built with
[TanStack Start](https://tanstack.com/start) and
[TanStack Virtual](https://tanstack.com/virtual).

- Two panes, like Claude Desktop: projects and sessions from
  `~/.claude/projects` on the left, the transcript on the right.
  On narrow screens, the sidebar is a drawer behind a **Sessions** button.
- Shows text, thinking, tool calls, and tool results.
- Sends a message to a session and streams each step while Claude works.
  The transcript follows new entries while you are at the end.
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

### Remote access (phone) with a password

Use HTTP Basic auth and a
[Cloudflare Quick Tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/).
The tunnel gives you a public HTTPS URL; the password is what keeps others out.

1. Set the credentials in a `.env` file next to `package.json`. The file is
   git-ignored.

   ```bash
   printf 'VIEWER_USER=me\nVIEWER_PASSWORD=%s\n' "$(openssl rand -base64 24)" > .env
   chmod 600 .env
   ```

   - `VIEWER_PASSWORD` turns on Basic auth for every request. Without it, there
     is no password.
   - `VIEWER_USER` is optional. Without it, any user name works.
   - Variables exported in the shell win over `.env`.

2. Start the server. It reads `.env` only at startup, so restart it after you
   change the file.

   ```bash
   pnpm dev
   ```

3. Install `cloudflared` and start the tunnel in a second terminal.

   ```bash
   brew install cloudflared
   cloudflared tunnel --url http://127.0.0.1:3333 --http-host-header 127.0.0.1:3333
   ```

   `--http-host-header` is required: the server accepts only `127.0.0.1` and
   `localhost` as the host.

4. Open the URL that `cloudflared` prints (`https://<random-words>.trycloudflare.com`)
   and sign in. The URL changes every time you restart `cloudflared`; an old
   URL shows Cloudflare error 1033. To read the current URL while the tunnel
   runs:

   ```bash
   curl -s http://127.0.0.1:20241/quicktunnel
   ```

   `20241` is the default metrics port. If it is busy, `cloudflared` uses the
   next free port.

Do not use `cloudflared`'s `--allowed-mail` option: the page loads, but its
later requests fail ("Load failed"). Stop the tunnel (`Ctrl+C`) when you are
done.

## How it works

- **Read.** Each session is a `.jsonl` file in `~/.claude/projects/<project>/`.
  The server reads these files and keeps the `user` and `assistant` records.
- **Send.** The server runs `claude --resume <id> --print` with stream-json input
  and output in the session's folder, and streams each output line to the page.
- **Permissions.** The server reads the session's last permission mode and its
  added folders from the session file, and passes them to `claude` (`default`
  becomes the CLI's `manual`). It never uses `bypassPermissions`.
- **Approvals.** With `--permission-prompt-tool stdio`, a tool call that needs
  approval arrives as a `control_request`. The page shows it with **Allow** and
  **Deny**, and the server writes the answer back to `claude`. If the page goes
  away, open and later requests are denied, so the turn still ends.
- **Running.** The sidebar marks sessions with a turn in progress with a dot. It
  polls every 4 seconds: sessions this server is running, plus session files
  changed in the last 10 minutes whose last turn has not ended (no final
  `stop_reason`). That also catches turns running in Claude Desktop or a terminal.
- **Titles.** The sidebar shows the title Claude Desktop gave the session (a
  `custom-title` record near the end of the file), or else the first prompt.
- **New session.** The **+** next to a project opens an empty page with a new UUID. The first
  message runs `claude --session-id <uuid>`, with the folder and permissions of
  the newest session in that project. When the first turn ends, the server runs
  `claude --desktop --resume <uuid>`, so the session shows in Claude Desktop.

## Security

This app runs Claude on your machine with your session permissions, for example
`auto` mode. Transcripts can contain secrets from tool output.

- Run it on `127.0.0.1` only. Do not use `--host`: that opens the server to
  your whole network, and reading needs no password unless `VIEWER_PASSWORD` is set.
- The server accepts send requests only from its own pages on `127.0.0.1` or
  `localhost`. This blocks other websites and DNS rebinding.
- Behind a tunnel, the host check passes. Always set `VIEWER_PASSWORD` before you
  start a tunnel, and use a long random password.

## Limits

- The session file format has no public documentation, and it can change
  between Claude Code versions.
- The transcript uses the line order of the file. Branches from edited messages
  show one after the other.
- Output streams one step at a time, not one token at a time.
- Do not send to a session that is running in another window at the same time.

## Scripts

```bash
pnpm test        # parser tests (node:test)
pnpm typecheck   # tsc --noEmit
pnpm build       # production build
```
