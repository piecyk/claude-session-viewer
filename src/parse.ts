export type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; name: string; input: string }
  | { type: 'tool_result'; text: string; isError: boolean }

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
        : (content ?? []).map(toBlock)
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

// ponytail: skips 'default' (a headless run cannot ask for approval) and
// 'bypassPermissions' (a web form must not turn it on).
const HEADLESS_MODES = ['acceptEdits', 'auto', 'plan', 'dontAsk', 'manual']

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
    if (typeof r.permissionMode === 'string' && HEADLESS_MODES.includes(r.permissionMode)) {
      settings.permissionMode = r.permissionMode
    }
    const dirs = r.attachment?.snapshot?.additionalWorkingDirectories
    if (Array.isArray(dirs)) settings.addDirs = dirs.filter((d) => typeof d === 'string')
  }
  return settings
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
    if (text?.type === 'text') return text.text.slice(0, 120)
  }
  return ''
}

// Fixed locale so server and browser render the same text (no hydration mismatch).
export const formatTime = (time: string | number) => new Date(time).toLocaleString('sv-SE')
