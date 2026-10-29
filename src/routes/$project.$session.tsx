import { Link, createFileRoute, useLoaderData, useLocation, useNavigate, useRouter } from '@tanstack/react-router'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { formatTime, lastPromptIndex, openNextStep } from '../parse.ts'
import type { Block, Entry, PermissionRequest } from '../parse.ts'
import { answerPermission, getSession, sendMessage } from '../sessions.ts'

// "Start" on a task card opens a new session page with the brief in history state.
declare module '@tanstack/react-router' {
  interface HistoryState {
    prompt?: string
  }
}

type TaskActions = { start: (prompt: string) => void; here: (title: string) => void }

export const Route = createFileRoute('/$project/$session')({
  loader: ({ params }) => getSession({ data: params }),
  component: Transcript,
})

// A new key per session resets live entries, pending state, and the virtualizer.
function Transcript() {
  const { project, session } = Route.useParams()
  return <TranscriptView key={session} project={project} session={session} />
}

function TranscriptView({ project, session }: { project: string; session: string }) {
  const entries = Route.useLoaderData()
  const sidebar = useLoaderData({ from: '__root__' })
  const group = sidebar.find((p) => p.name === project)
  const title = group?.sessions.find((s) => s.id === session)?.title
  const router = useRouter()
  const navigate = useNavigate()
  const startPrompt = useLocation({ select: (l) => l.state.prompt })
  const [live, setLive] = useState<Array<Entry>>([])
  const [asks, setAsks] = useState<Array<PermissionRequest>>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const all = [...entries, ...live]
  const nextStep = pending ? undefined : openNextStep(all)
  const openFrom = lastPromptIndex(all)
  const taskActions: TaskActions = {
    start: (prompt) =>
      navigate({
        to: '/$project/$session',
        params: { project, session: crypto.randomUUID() },
        state: { prompt },
        resetScroll: false,
      }),
    here: (title) => send(`Do this task here, in this session, not in a new one: "${title}"`),
  }

  const listRef = useRef<HTMLDivElement>(null)
  const [listTop, setListTop] = useState(0)
  useLayoutEffect(() => setListTop(listRef.current?.offsetTop ?? 0), [])

  const virtualizer = useWindowVirtualizer({
    count: all.length,
    estimateSize: () => 80,
    overscan: 5,
    scrollMargin: listTop,
    getItemKey: (i) => all[i].uuid || i,
    // Chat behavior: stay at the end while entries resize, and follow new
    // entries only when the reader is already at the end.
    anchorTo: 'end',
    followOnAppend: true,
  })

  // Open at the last entry; anchorTo and followOnAppend keep it there.
  useEffect(() => {
    virtualizer.scrollToEnd()
  }, [virtualizer])

  async function send(text: string) {
    setPending(true)
    setError('')
    setLive([
      {
        uuid: `pending-${Date.now()}`,
        role: 'user',
        timestamp: new Date().toISOString(),
        blocks: [{ type: 'text', text }],
      },
    ])
    try {
      for await (const item of await sendMessage({ data: { project, session, text } })) {
        if ('kind' in item) setAsks((a) => [...a, item])
        else setLive((l) => [...l, item])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      await router.invalidate()
      setLive([])
      setAsks([])
      setPending(false)
    }
  }

  // A new session opened from a task card sends the brief once, on its first render.
  const started = useRef(false)
  useEffect(() => {
    if (startPrompt && entries.length === 0 && !started.current) {
      started.current = true
      void send(startPrompt)
    }
  }, [])

  async function decide(ask: PermissionRequest, allow: boolean) {
    setAsks((a) => a.filter((x) => x.requestId !== ask.requestId))
    try {
      await answerPermission({ data: { requestId: ask.requestId, allow } })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <p className="meta">{group?.label ?? project}</p>
      <h1>{title || (entries.length === 0 ? 'New session' : session)}</h1>
      <div ref={listRef} style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const e = all[item.index]
          return (
            <div
              key={item.key}
              data-index={item.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                paddingBottom: 12,
                transform: `translateY(${item.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <div className={`entry ${e.role}`}>
                <div className="meta">
                  {e.role} · {formatTime(e.timestamp)}
                </div>
                {e.blocks.map((b, i) => (
                  <BlockView
                    key={i}
                    block={b}
                    role={e.role}
                    task={!pending && item.index > openFrom ? taskActions : undefined}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <SendForm pending={pending} error={error} onSend={send}>
        {nextStep && (
          <div className="next-step-ask">
            <strong>{nextStep.ask}</strong>
            <div className="actions">
              {nextStep.actions.map((action) => (
                <button key={action.label} type="button" title={action.message} onClick={() => send(action.message)}>
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {asks.map((ask) => (
          <Approval key={ask.requestId} ask={ask} onDecide={(allow) => decide(ask, allow)} />
        ))}
      </SendForm>
    </>
  )
}

function Approval({ ask, onDecide }: { ask: PermissionRequest; onDecide: (allow: boolean) => void }) {
  return (
    <div className="approval" role="alert">
      <strong>
        Allow {ask.tool}
        {ask.description && `: ${ask.description}`}?
      </strong>
      <details>
        <summary>details</summary>
        <pre>{ask.input}</pre>
      </details>
      <div className="actions">
        <button type="button" onClick={() => onDecide(true)}>
          Allow
        </button>
        <button type="button" onClick={() => onDecide(false)}>
          Deny
        </button>
      </div>
    </div>
  )
}

function SendForm({
  pending,
  error,
  onSend,
  children,
}: {
  pending: boolean
  error: string
  onSend: (text: string) => Promise<void>
  children?: React.ReactNode
}) {
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const text = new FormData(form).get('text')
    if (typeof text !== 'string' || !text.trim()) return
    form.reset()
    void onSend(text)
  }

  return (
    <form onSubmit={onSubmit}>
      {children}
      <label htmlFor="text">Message</label>
      <textarea id="text" name="text" rows={3} disabled={pending} />
      <button type="submit" disabled={pending}>
        {pending ? 'Claude is working…' : 'Send'}
      </button>
      {error && <pre className="error">{error}</pre>}
    </form>
  )
}

// Links in Claude Desktop transcripts: `#local_<id>` is a session, http(s) is a
// web page, anything else is a file path the app opens in its file pane.
const markdownComponents: Components = {
  a: ({ href = '', children }) => {
    if (href.startsWith('#local_')) {
      return (
        <Link to="/desktop/$id" params={{ id: href.slice(1) }} resetScroll={false}>
          {children}
        </Link>
      )
    }
    if (/^https?:/.test(href)) {
      return (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      )
    }
    return <code title={href}>{children}</code>
  },
}

function BlockView({ block, role, task }: { block: Block; role: Entry['role']; task?: TaskActions }) {
  switch (block.type) {
    case 'task':
      return (
        <div className="task">
          <strong>{block.title}</strong>
          {block.tldr && <p className="meta">{block.tldr}</p>}
          <details>
            <summary>prompt</summary>
            <pre>{block.prompt}</pre>
          </details>
          {task && (
            <div className="actions">
              <button type="button" onClick={() => task.start(block.prompt)}>
                Start
              </button>
              <button type="button" onClick={() => task.here(block.title)}>
                Do it here
              </button>
            </div>
          )}
        </div>
      )
    case 'text':
      // Your prompts stay as typed; Claude's replies are Markdown.
      if (role === 'user') return <pre>{block.text}</pre>
      return (
        <div className="markdown">
          <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {block.text}
          </Markdown>
        </div>
      )
    case 'thinking':
      return (
        <details>
          <summary>thinking</summary>
          <pre>{block.text}</pre>
        </details>
      )
    case 'tool_use':
      return (
        <details>
          <summary>tool: {block.name}</summary>
          <pre>{block.input}</pre>
        </details>
      )
    case 'next_step':
      return <pre className="next-step">{block.recap}</pre>
    case 'tool_result':
      return (
        <details>
          <summary className={block.isError ? 'error' : undefined}>
            {block.isError ? 'tool error' : 'tool result'}
          </summary>
          <pre>{block.text}</pre>
        </details>
      )
  }
}
