import { test } from 'node:test'
import assert from 'node:assert/strict'
import { customTitle, firstPrompt, lastActivity, lastPromptIndex, openNextStep, parseSession, sessionSettings, turnRunning } from './parse.ts'

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

test('wrap_up becomes a next step, and only the latest unanswered one is open', () => {
  const wrapUp = JSON.stringify({
    type: 'assistant',
    uuid: 'w1',
    message: {
      content: [
        {
          type: 'tool_use',
          name: 'mcp__ccd_turn__wrap_up',
          input: {
            recap: 'Done.',
            ask: 'Push it?',
            actions: [{ label: 'Yes, push', message: 'Yes, push main.' }, { label: 'Not now' }, { action: 'commit' }],
          },
        },
      ],
    },
  })
  const step = parseSession(wrapUp)[0].blocks[0]
  assert.deepEqual(step, {
    type: 'next_step',
    recap: 'Done.',
    ask: 'Push it?',
    actions: [
      { label: 'Yes, push', message: 'Yes, push main.' },
      { label: 'Not now', message: 'Not now' },
    ],
  })
  const toolResult = JSON.stringify({
    type: 'user',
    uuid: 'r1',
    message: { content: [{ type: 'tool_result', content: 'ok' }] },
  })
  const reply = JSON.stringify({ type: 'assistant', uuid: 'a2', message: { content: [{ type: 'text', text: 'Bye' }] } })
  assert.deepEqual(openNextStep(parseSession([wrapUp, toolResult, reply].join('\n'))), step)
  const answered = JSON.stringify({ type: 'user', uuid: 'u9', message: { content: 'Yes, push main.' } })
  assert.equal(openNextStep(parseSession([wrapUp, reply, answered].join('\n'))), undefined)
})

test('spawn_task becomes a task card; lastPromptIndex skips tool results', () => {
  const lines = [
    JSON.stringify({ type: 'user', uuid: 'u1', message: { content: 'review PRs' } }),
    JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'mcp__ccd_session__spawn_task',
            input: { title: 'Review PR #1', tldr: 'Short', prompt: 'Do the review.' },
          },
        ],
      },
    }),
    JSON.stringify({ type: 'user', uuid: 'r1', message: { content: [{ type: 'tool_result', content: 'ok' }] } }),
  ].join('\n')
  const entries = parseSession(lines)
  assert.deepEqual(entries[1].blocks[0], { type: 'task', title: 'Review PR #1', tldr: 'Short', prompt: 'Do the review.' })
  assert.equal(lastPromptIndex(entries), 0)
})

test('empty thinking blocks are dropped, and an entry with only those is skipped', () => {
  const lines = [
    JSON.stringify({
      type: 'assistant',
      uuid: 'a1',
      message: { content: [{ type: 'thinking', thinking: '', signature: 'x' }] },
    }),
    JSON.stringify({
      type: 'assistant',
      uuid: 'a2',
      message: {
        content: [
          { type: 'thinking', thinking: '  ' },
          { type: 'text', text: 'Hi' },
        ],
      },
    }),
  ].join('\n')
  const entries = parseSession(lines)
  assert.deepEqual(
    entries.map((e) => [e.uuid, e.blocks]),
    [['a2', [{ type: 'text', text: 'Hi' }]]],
  )
})

test('turnRunning is true until an assistant record ends the turn', () => {
  const prompt = JSON.stringify({ type: 'user', message: { content: 'go' } })
  const toolUse = JSON.stringify({ type: 'assistant', message: { stop_reason: 'tool_use', content: [] } })
  const toolResult = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result' }] } })
  const done = JSON.stringify({ type: 'assistant', message: { stop_reason: 'end_turn', content: [] } })
  const summary = JSON.stringify({ type: 'system', subtype: 'stop_hook_summary' })
  const interrupted = JSON.stringify({ type: 'user', message: { content: '[Request interrupted by user]' } })
  assert.equal(turnRunning(prompt), true)
  assert.equal(turnRunning([prompt, toolUse, toolResult].join('\n')), true)
  assert.equal(turnRunning([prompt, toolUse, toolResult, done, summary].join('\n')), false)
  assert.equal(turnRunning([prompt, toolUse, interrupted].join('\n')), false)
  assert.equal(turnRunning(''), false)
})
