import { test } from 'node:test'
import assert from 'node:assert/strict'
import { customTitle, firstPrompt, parseSession, sessionSettings } from './parse.ts'

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

test('sessionSettings keeps first cwd, last headless mode, and last added folders', () => {
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
    permissionMode: 'auto',
    addDirs: ['/a', '/b'],
  })
})
