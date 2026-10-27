export type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; name: string; input: string }
  | { type: 'tool_result'; text: string; isError: boolean }
  | { type: 'next_step'; recap: string; ask: string; actions: Array<NextStepAction> }
  | { type: 'task'; title: string; tldr: string; prompt: string }

// A button from Claude Desktop's next-step box. Clicking it sends `message`.
export type NextStepAction = { label: string; message: string }

// A tool call waiting for Allow or Deny in the viewer.
export type PermissionRequest = {
  kind: 'permission'
  requestId: string
  tool: string
  description: string
  input: string
}

export type Entry = {
  uuid: string
  role: 'user' | 'assistant'
  timestamp: string
  blocks: Array<Block>
}

type RawBlock = {
  type?: string
  text?: string
  thinking?: string
  name?: string
  input?: unknown
  content?: unknown
  is_error?: boolean
}

type RawRecord = {
  type?: string
  uuid?: string
  timestamp?: string
  isMeta?: boolean
  message?: { content?: string | Array<RawBlock> }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((c: RawBlock) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`))
    .join('\n')
}

function toBlock(b: RawBlock): Block {
  switch (b.type) {
    case 'text':
      return { type: 'text', text: b.text ?? '' }
    case 'thinking':
      return { type: 'thinking', text: b.thinking ?? '' }
    case 'tool_use':
      if (b.name === 'mcp__ccd_turn__wrap_up') return nextStep(b.input)
      if (b.name === 'mcp__ccd_session__spawn_task' || b.name === 'mcp__ccd_session__start_session') {
        const task = taskCard(b.input)
        if (task) return task
      }
      return {
        type: 'tool_use',
        name: b.name ?? '?',
        input: JSON.stringify(b.input, null, 2),
      }
    case 'tool_result':
      return {
        type: 'tool_result',
        text: resultText(b.content),
        isError: b.is_error === true,
      }
    default:
      return { type: 'text', text: `[${b.type}]` }
  }
}

// ponytail: file order, not the parentUuid tree. Edited/branched sessions show
// every branch inline; walk parentUuid from the last record if that matters.
export function parseSession(jsonl: string): Array<Entry> {
  const entries: Array<Entry> = []
  for (const line of jsonl.split('\n')) {
    if (!line) continue
    let r: RawRecord
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if ((r.type !== 'user' && r.type !== 'assistant') || r.isMeta) continue
    const content = r.message?.content
    const blocks =
      typeof content === 'string'
        ? [{ type: 'text' as const, text: content }]
        : (content ?? [])
            .map(toBlock)
            // Some thinking is stored with empty text (only a signature); there is nothing to show.
            .filter((b) => b.type !== 'thinking' || b.text.trim() !== '')
    if (blocks.length === 0) continue
    entries.push({
      uuid: r.uuid ?? '',
      role: r.type,
      timestamp: r.timestamp ?? '',
      blocks,
    })
  }
  return entries
}

export type SessionSettings = {
  cwd?: string
  permissionMode?: string
  addDirs: Array<string>
}

type SettingsRecord = {
  cwd?: unknown
  permissionMode?: unknown
  attachment?: { snapshot?: { additionalWorkingDirectories?: unknown } }
}

// Modes the CLI accepts. The app records 'default', which the CLI calls 'manual'.
// 'bypassPermissions' is skipped: a web form must not turn it on.
const CLI_MODES: Record<string, string> = {
  acceptEdits: 'acceptEdits',
  auto: 'auto',
  plan: 'plan',
  dontAsk: 'dontAsk',
  manual: 'manual',
  default: 'manual',
}

// The access the app gave this session, so a resumed headless run gets the same.
export function sessionSettings(jsonl: string): SessionSettings {
  const settings: SessionSettings = { addDirs: [] }
  for (const line of jsonl.split('\n')) {
    let r: SettingsRecord
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    if (!settings.cwd && typeof r.cwd === 'string') settings.cwd = r.cwd
    if (typeof r.permissionMode === 'string' && Object.hasOwn(CLI_MODES, r.permissionMode)) {
      settings.permissionMode = CLI_MODES[r.permissionMode]
    }
    const dirs = r.attachment?.snapshot?.additionalWorkingDirectories
    if (Array.isArray(dirs)) settings.addDirs = dirs.filter((d) => typeof d === 'string')
  }
  return settings
}

// Claude Desktop draws its next-step box from this tool call's input:
// { recap, ask?, actions?: [{ label, message? } | { action }] }.
function nextStep(input: unknown): Block {
  const i = (input ?? {}) as { recap?: unknown; ask?: unknown; actions?: unknown }
  const actions: Array<NextStepAction> = []
  for (const a of Array.isArray(i.actions) ? i.actions : []) {
    const { label, message } = (a ?? {}) as { label?: unknown; message?: unknown }
    // App actions ({ action: 'commit' }, …) have no text to send; the viewer skips them.
    if (typeof label !== 'string') continue
    actions.push({ label, message: typeof message === 'string' ? message : label })
  }
  return {
    type: 'next_step',
    recap: typeof i.recap === 'string' ? i.recap : '',
    ask: typeof i.ask === 'string' ? i.ask : '',
    actions,
  }
}

// Claude Desktop shows these calls as "suggested task" cards: { title, tldr?, prompt }.
// Whether a card was started or dismissed lives in the app, not in the file.
function taskCard(input: unknown): Block | undefined {
  const i = (input ?? {}) as { title?: unknown; tldr?: unknown; prompt?: unknown }
  if (typeof i.title !== 'string' || typeof i.prompt !== 'string') return undefined
  return { type: 'task', title: i.title, tldr: typeof i.tldr === 'string' ? i.tldr : '', prompt: i.prompt }
}

// Index of the last prompt you typed (a user entry with text), or -1. Cards and
// questions after it belong to the latest turn.
export function lastPromptIndex(entries: Array<Entry>): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].role === 'user' && entries[i].blocks.some((b) => b.type === 'text')) return i
  }
  return -1
}

// The open question of the latest turn: a next step after the last prompt you typed.
export function openNextStep(entries: Array<Entry>) {
  for (let i = entries.length - 1; i >= 0; i--) {
    const blocks = entries[i].blocks
    if (entries[i].role === 'user' && blocks.some((b) => b.type === 'text')) return undefined
    const step = blocks.find((b) => b.type === 'next_step')
    if (step?.type === 'next_step') return step.ask && step.actions.length > 0 ? step : undefined
  }
  return undefined
}

// The desktop app writes its session titles as `custom-title` records, again
// during the session, so the newest one is near the end of the file.
export function customTitle(jsonl: string): string {
  let title = ''
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"custom-title"')) continue
    try {
      const r: { type?: unknown; customTitle?: unknown } = JSON.parse(line)
      if (r.type === 'custom-title' && typeof r.customTitle === 'string') title = r.customTitle
    } catch {}
  }
  return title
}

export function firstPrompt(jsonl: string): string {
  for (const e of parseSession(jsonl)) {
    if (e.role !== 'user') continue
    const text = e.blocks.find((b) => b.type === 'text')
    if (text?.type === 'text') return promptTitle(text.text).slice(0, 120)
  }
  return ''
}

// A slash command is stored as <command-name>/retro</command-name><command-args>…</command-args>.
function promptTitle(text: string): string {
  const name = /<command-name>([^<]*)<\/command-name>/.exec(text)?.[1]
  if (!name) return text
  const args = /<command-args>([^<]*)<\/command-args>/.exec(text)?.[1] ?? ''
  return `${name} ${args}`.trim()
}

// Time of the last message, which is what Claude Desktop sorts by. File mtime is
// not: other tools rewrite old session files.
export function lastActivity(jsonl: string): string {
  let last = ''
  for (const line of jsonl.split('\n')) {
    if (!line.includes('"timestamp"')) continue
    try {
      const r: { type?: unknown; timestamp?: unknown } = JSON.parse(line)
      if ((r.type === 'user' || r.type === 'assistant') && typeof r.timestamp === 'string') {
        last = r.timestamp
      }
    } catch {}
  }
  return last
}

// Fixed locale so server and browser render the same text (no hydration mismatch).
export const formatTime = (time: string | number) => new Date(time).toLocaleString('sv-SE')
