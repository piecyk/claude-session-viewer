import { createServerFn } from '@tanstack/react-start'
import { getRequest, getRequestHeader } from '@tanstack/react-start/server'
import { spawn } from 'node:child_process'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import { customTitle, firstPrompt, lastActivity, parseSession, sessionSettings, turnRunning } from './parse.ts'
import type { Entry, PermissionRequest } from './parse.ts'

const ROOT = join(homedir(), '.claude', 'projects')

// Route params become path segments. Reject anything that could leave ROOT.
function segment(value: unknown): string {
  if (typeof value !== 'string' || !/^[\w-][\w.-]*$/.test(value)) {
    throw new Error('Invalid path segment')
  }
  return value
}

async function jsonlFiles(dir: string) {
  const names = (await readdir(dir)).filter((n) => n.endsWith('.jsonl'))
  const files = await Promise.all(
    names.map(async (name) => {
      const s = await stat(join(dir, name))
      return { id: name.slice(0, -'.jsonl'.length), mtime: s.mtimeMs, size: s.size }
    }),
  )
  return files.sort((a, b) => b.mtime - a.mtime)
}

const CHUNK = 65536

// Complete lines from the first or the last 64 KB of a file.
// ponytail: cwd and first prompt from the head, title from the tail; read more if they go missing.
async function readLines(path: string, from: 'head' | 'tail', size: number) {
  const start = from === 'head' ? 0 : Math.max(0, size - CHUNK)
  const fh = await open(path)
  try {
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(CHUNK), 0, CHUNK, start)
    let text = buffer.toString('utf8', 0, bytesRead)
    if (start > 0) text = text.slice(text.indexOf('\n') + 1)
    return text.slice(0, text.lastIndexOf('\n') + 1)
  } finally {
    await fh.close()
  }
}

export const listSidebar = createServerFn({ method: 'GET' }).handler(async () => {
  const dirs = await readdir(ROOT, { withFileTypes: true })
  const projects = await Promise.all(
    dirs
      .filter((d) => d.isDirectory())
      .map(async (d) => {
        const dir = join(ROOT, d.name)
        const files = await jsonlFiles(dir)
        const sessions = await Promise.all(
          files.map(async (f) => {
            const path = join(dir, `${f.id}.jsonl`)
            const head = await readLines(path, 'head', f.size)
            const tail = await readLines(path, 'tail', f.size)
            return {
              id: f.id,
              title: customTitle(tail) || firstPrompt(head),
              cwd: sessionSettings(head).cwd,
              // Same order as Claude Desktop: the last message, not the file mtime.
              activity: Date.parse(lastActivity(tail)) || f.mtime,
            }
          }),
        )
        sessions.sort((a, b) => b.activity - a.activity)
        return {
          name: d.name,
          label: basename(sessions.find((s) => s.cwd)?.cwd ?? d.name),
          mtime: sessions[0]?.activity ?? 0,
          sessions: sessions.map(({ id, title }) => ({ id, title })),
        }
      }),
  )
  return projects.filter((p) => p.sessions.length > 0).sort((a, b) => b.mtime - a.mtime)
})

// Sessions with a turn this server started that has not exited yet.
const runningHere = new Set<string>()
// A turn that ended without a final record (a crash) stops counting after this.
const RECENT_MS = 10 * 60_000

// Sessions with a turn in progress: the ones this server runs, plus any recently
// written file whose last turn has not ended (Claude Desktop, a terminal).
export const runningSessions = createServerFn({ method: 'GET' }).handler(async () => {
  const ids = new Set(runningHere)
  const since = Date.now() - RECENT_MS
  const dirs = await readdir(ROOT, { withFileTypes: true })
  await Promise.all(
    dirs
      .filter((d) => d.isDirectory())
      .map(async (d) => {
        const dir = join(ROOT, d.name)
        for (const f of await jsonlFiles(dir)) {
          if (f.mtime < since) break // newest first
          if (turnRunning(await readLines(join(dir, `${f.id}.jsonl`), 'tail', f.size))) ids.add(f.id)
        }
      }),
  )
  return [...ids]
})

export const getSession = createServerFn({ method: 'GET' })
  .validator((input: { project: string; session: string }) => ({
    project: segment(input.project),
    session: segment(input.session),
  }))
  .handler(async ({ data }) => {
    // ponytail: whole file in memory and one render; stream + virtualize for huge sessions.
    const text = await readSessionFile(data.project, data.session)
    // A new session has no file until its first message.
    return text === undefined ? [] : parseSession(text)
  })

async function readSessionFile(project: string, session: string) {
  try {
    return await readFile(join(ROOT, project, `${session}.jsonl`), 'utf8')
  } catch (e) {
    if (e instanceof Error && 'code' in e && e.code === 'ENOENT') return undefined
    throw e
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Claude Desktop keeps one file per session, at <account>/<org>/local_<id>.json.
const DESKTOP = join(homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions')

// A `#local_<id>` link in a Claude Desktop transcript names the app's session id.
// The app's file for it holds the CLI session id, which names the .jsonl file.
export const findDesktopSession = createServerFn({ method: 'GET' })
  .validator((id: string) => {
    if (typeof id !== 'string' || !/^local_[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid session id')
    return id
  })
  .handler(async ({ data: id }) => {
    const files = await readdir(DESKTOP, { recursive: true }).catch(() => [])
    const file = files.find((f) => basename(f) === `${id}.json`)
    if (!file) return undefined
    const { cliSessionId } = JSON.parse(await readFile(join(DESKTOP, file), 'utf8')) as { cliSessionId?: unknown }
    if (typeof cliSessionId !== 'string' || !UUID.test(cliSessionId)) return undefined
    for (const project of await readdir(ROOT)) {
      const found = await stat(join(ROOT, project, `${cliSessionId}.jsonl`)).catch(() => undefined)
      if (found) return { project, session: cliSessionId }
    }
    return undefined
  })

// This endpoint runs Claude on this machine. Only accept requests from this
// app's own pages on a loopback host (blocks other sites and DNS rebinding).
function assertLocalSameOrigin() {
  const host = getRequestHeader('host') ?? ''
  const site = getRequestHeader('sec-fetch-site')
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || (site && site !== 'same-origin')) {
    throw new Error('Forbidden')
  }
}

// Open approval requests across all running turns, by request id.
const pending = new Map<string, (allow: boolean) => void>()

type ControlLine = {
  type?: string
  request_id?: string
  request?: {
    subtype?: string
    tool_name?: string
    display_name?: string
    description?: string
    input?: unknown
  }
}

export const answerPermission = createServerFn({ method: 'POST' })
  .validator((input: { requestId: string; allow: boolean }) => {
    if (typeof input.requestId !== 'string' || typeof input.allow !== 'boolean') {
      throw new Error('Invalid answer')
    }
    return { requestId: input.requestId, allow: input.allow }
  })
  .handler(async ({ data }) => {
    assertLocalSameOrigin()
    const resolve = pending.get(data.requestId)
    if (!resolve) throw new Error('This request is no longer open')
    resolve(data.allow)
  })

export const sendMessage = createServerFn({ method: 'POST' })
  .validator((input: { project: string; session: string; text: string }) => {
    if (typeof input.text !== 'string' || !input.text.trim()) {
      throw new Error('Empty message')
    }
    return {
      project: segment(input.project),
      session: segment(input.session),
      text: input.text,
    }
  })
  .handler(async function* ({ data }) {
    assertLocalSameOrigin()
    let jsonl = await readSessionFile(data.project, data.session)
    const isNew = jsonl === undefined
    if (isNew) {
      if (!UUID.test(data.session)) throw new Error('Invalid session id')
      // A new session gets its folder and access from the newest session in the project.
      const [newest] = await jsonlFiles(join(ROOT, data.project))
      if (!newest) throw new Error('Project has no sessions')
      jsonl = await readSessionFile(data.project, newest.id)
    }
    const { cwd, permissionMode, addDirs } = sessionSettings(jsonl ?? '')
    if (!cwd) throw new Error('Session has no cwd')
    // stream-json lines have the same shape as session file records.
    // ponytail: one entry per step, not per token; add --include-partial-messages for token streaming.
    // `--permission-prompt-tool stdio` sends approval requests to us as
    // control_request lines instead of denying them.
    const args = [
      isNew ? '--session-id' : '--resume',
      data.session,
      '--print',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-prompt-tool',
      'stdio',
    ]
    if (permissionMode) args.push('--permission-mode', permissionMode)
    if (addDirs.length > 0) args.push('--add-dir', ...addDirs)
    const child = spawn('claude', args, { cwd })
    // A write after claude has exited fails with EPIPE; without a listener that
    // error would crash the whole server. The exit code below reports the failure.
    child.stdin.on('error', () => {})
    runningHere.add(data.session)
    const send = (message: unknown) => {
      if (!child.stdin.writableEnded) child.stdin.write(`${JSON.stringify(message)}\n`)
    }
    send({ type: 'user', message: { role: 'user', content: data.text } })
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const exit = new Promise<number | Error | null>((resolve) => {
      child.on('error', resolve)
      child.on('close', resolve)
    })
    void exit.then(() => runningHere.delete(data.session))
    // The desktop app does not pick up CLI sessions on its own. This waits for
    // the process, not the response, so it also runs when the page goes away
    // mid-turn (a locked phone, a dropped tunnel).
    if (isNew) {
      void exit
        .then((code) => (code === 0 ? addToDesktop(cwd, data.session) : undefined))
        .catch((e) => console.error(`Adding session ${data.session} to Claude Desktop failed:`, e))
    }
    // The process is read here, not in the loop below, so approvals are still
    // answered and stdin still closes when the page goes away mid-turn.
    const queue: Array<Entry | PermissionRequest> = []
    let wake: (() => void) | null = null
    let ended = false
    let listening = true
    const open = new Set<string>()
    const push = (item: Entry | PermissionRequest) => {
      queue.push(item)
      wake?.()
    }
    const answer = (requestId: string, input: unknown, allow: boolean) => {
      open.delete(requestId)
      pending.delete(requestId)
      send({
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: allow
            ? { behavior: 'allow', updatedInput: input }
            : { behavior: 'deny', message: 'Denied in the session viewer.' },
        },
      })
    }
    const lines = createInterface({ input: child.stdout })
    lines.on('line', (line) => {
      let message: ControlLine
      try {
        message = JSON.parse(line)
      } catch {
        return
      }
      if (message.type === 'control_request' && message.request_id) {
        const request = message.request ?? {}
        if (request.subtype !== 'can_use_tool') {
          send({
            type: 'control_response',
            response: { subtype: 'error', request_id: message.request_id, error: 'Not supported' },
          })
        } else if (!listening) {
          answer(message.request_id, request.input, false)
        } else {
          const requestId = message.request_id
          open.add(requestId)
          pending.set(requestId, (allow) => answer(requestId, request.input, allow))
          push({
            kind: 'permission',
            requestId,
            tool: request.display_name ?? request.tool_name ?? 'tool',
            description: request.description ?? '',
            input: JSON.stringify(request.input, null, 2),
          })
        }
        return
      }
      // With stream-json input, the CLI waits for more messages until stdin closes.
      if (message.type === 'result') child.stdin.end()
      for (const entry of parseSession(line)) push(entry)
    })
    lines.on('close', () => {
      ended = true
      wake?.()
    })
    // Nobody can answer once the page is gone: deny what is open and what comes
    // later. The abort signal fires even while the loop below waits for an item.
    const signal = getRequest().signal
    const gone = () => {
      listening = false
      for (const requestId of open) pending.get(requestId)?.(false)
      wake?.()
    }
    signal.addEventListener('abort', gone, { once: true })
    try {
      while (true) {
        while (queue.length > 0) yield queue.shift()!
        if (ended || signal.aborted) break
        await new Promise<void>((resolve) => (wake = resolve))
        wake = null
      }
    } finally {
      signal.removeEventListener('abort', gone)
      gone()
    }
    const code = await exit
    if (code !== 0) {
      throw new Error(code instanceof Error ? code.message : stderr.trim() || `claude exited with ${code}`)
    }
  })

async function addToDesktop(cwd: string, session: string) {
  // `--desktop` refuses to run without a terminal; `script` gives it a pseudo-terminal.
  const child = spawn('script', ['-q', '/dev/null', 'claude', '--desktop', '--resume', session], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  })
  let output = ''
  child.stdout.on('data', (chunk) => (output += chunk))
  child.stderr.on('data', (chunk) => (output += chunk))
  const code = await new Promise<number | Error | null>((resolve) => {
    child.on('error', resolve)
    child.on('close', resolve)
  })
  if (code !== 0) {
    throw new Error(code instanceof Error ? code.message : output.trim() || `claude exited with ${code}`)
  }
}
