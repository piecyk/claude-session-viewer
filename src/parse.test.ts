import { test } from 'node:test'
import assert from 'node:assert/strict'
import { customTitle, firstPrompt, lastActivity, parseSession, sessionSettings } from './parse.ts'

const jsonl = [
  JSON.stringify({ type: 'queue-operation' }),
  JSON.stringify({ type: 'user', isMeta: true, message: { content: 'meta' } }),
  JSON.stringify({ type: 'user', uuid: 'u1', cwd: '/w', message: { content: 'hello' } }),
  JSON.stringify({
    type: 'assistant',
    uuid: 'a1',
    message: {
      content: [
        { type: 'thinking', thinking: 'hmm' },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
      ],
    },
  }),
  JSON.stringify({
    type: 'user',
    uuid: 'u2',
    message: {
      content: [
        {
          type: 'tool_result',
          is_error: true,
          content: [{ type: 'text', text: 'boom' }],
        },
      ],
    },
  }),
  '{broken',
].join('\n')

test('parseSession keeps user/assistant records and normalizes blocks', () => {
  const entries = parseSession(jsonl)
  assert.deepEqual(
    entries.map((e) => e.uuid),
    ['u1', 'a1', 'u2'],
  )
  assert.deepEqual(entries[1].blocks[0], { type: 'thinking', text: 'hmm' })
  assert.equal(entries[1].blocks[1].type, 'tool_use')
  assert.deepEqual(entries[2].blocks[0], {
    type: 'tool_result',
    text: 'boom',
    isError: true,
  })
})

test('firstPrompt skips meta records', () => {
  assert.equal(firstPrompt(jsonl), 'hello')
})

test('customTitle returns the last custom-title, else empty', () => {
  const titled = [
    jsonl,
    JSON.stringify({ type: 'custom-title', customTitle: 'Old' }),
    JSON.stringify({ type: 'custom-title', customTitle: 'New' }),
  ].join('\n')
  assert.equal(customTitle(titled), 'New')
  assert.equal(customTitle(jsonl), '')
})

test('sessionSettings keeps first cwd, last CLI mode, and last added folders', () => {
  const lines = [
    '{broken',
    jsonl,
    JSON.stringify({ type: 'user', cwd: '/other', permissionMode: 'auto' }),
    JSON.stringify({
      type: 'attachment',
      attachment: { snapshot: { additionalWorkingDirectories: ['/a', '/b'] } },
    }),
    JSON.stringify({ type: 'user', permissionMode: 'default' }),
    JSON.stringify({ type: 'user', permissionMode: 'bypassPermissions' }),
  ].join('\n')
  assert.deepEqual(sessionSettings(lines), {
    cwd: '/w',
    permissionMode: 'manual',
    addDirs: ['/a', '/b'],
  })
})

test('firstPrompt shows a slash command as its name and arguments', () => {
  const command = JSON.stringify({
    type: 'user',
    message: {
      content:
        '<command-message>retro</command-message>\n<command-name>/retro</command-name>\n<command-args>last 10 sessions</command-args>',
    },
  })
  assert.equal(firstPrompt(command), '/retro last 10 sessions')
})

test('lastActivity returns the last user or assistant timestamp', () => {
  const lines = [
    JSON.stringify({ type: 'user', timestamp: '2026-10-01T10:00:00Z' }),
    JSON.stringify({ type: 'assistant', timestamp: '2026-10-01T10:05:00Z' }),
    JSON.stringify({ type: 'system', timestamp: '2026-10-27T18:26:00Z' }),
    '{broken',
  ].join('\n')
  assert.equal(lastActivity(lines), '2026-10-01T10:05:00Z')
  assert.equal(lastActivity(''), '')
})
