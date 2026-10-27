import { createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { spawn } from 'node:child_process'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { createInterface } from 'node:readline'
import { customTitle, firstPrompt, parseSession, sessionSettings } from './parse.ts'

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
            }
          }),
        )
        return {
          name: d.name,
          label: basename(sessions.find((s) => s.cwd)?.cwd ?? d.name),
          mtime: files[0]?.mtime ?? 0,
          sessions: sessions.map(({ id, title }) => ({ id, title })),
        }
      }),
  )
  return projects.filter((p) => p.sessions.length > 0).sort((a, b) => b.mtime - a.mtime)
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

// This endpoint runs Claude on this machine. Only accept requests from this
// app's own pages on a loopback host (blocks other sites and DNS rebinding).
function assertLocalSameOrigin() {
  const host = getRequestHeader('host') ?? ''
  const site = getRequestHeader('sec-fetch-site')
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || (site && site !== 'same-origin')) {
    throw new Error('Forbidden')
  }
}

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
    const args = [
      isNew ? '--session-id' : '--resume',
      data.session,
      '--print',
      '--output-format',
      'stream-json',
      '--verbose',
    ]
    if (permissionMode) args.push('--permission-mode', permissionMode)
    if (addDirs.length > 0) args.push('--add-dir', ...addDirs)
    const child = spawn('claude', args, { cwd })
    child.stdin.end(data.text)
    let stderr = ''
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const exit = new Promise<number | Error | null>((resolve) => {
      child.on('error', resolve)
      child.on('close', resolve)
    })
    try {
      for await (const line of createInterface({ input: child.stdout })) {
        yield* parseSession(line)
      }
    } finally {
      // If the page goes away, let Claude finish the turn instead of blocking on a full pipe.
      child.stdout.resume()
    }
    const code = await exit
    if (code !== 0) {
      throw new Error(code instanceof Error ? code.message : stderr.trim() || `claude exited with ${code}`)
    }
    // The desktop app does not pick up CLI sessions on its own.
    if (isNew) await addToDesktop(cwd, data.session)
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
