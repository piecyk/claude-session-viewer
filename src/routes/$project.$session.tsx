import { createFileRoute, useLoaderData, useRouter } from '@tanstack/react-router'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { formatTime } from '../parse.ts'
import type { Block, Entry } from '../parse.ts'
import { getSession, sendMessage } from '../sessions.ts'

export const Route = createFileRoute('/$project/$session')({
  loader: ({ params }) => getSession({ data: params }),
  component: Transcript,
})

// ponytail: fixed guess of the sticky form height; measure it if the form changes.
const FORM_HEIGHT = 190

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
  const [live, setLive] = useState<Array<Entry>>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const all = [...entries, ...live]

  const listRef = useRef<HTMLDivElement>(null)
  const [listTop, setListTop] = useState(0)
  useLayoutEffect(() => setListTop(listRef.current?.offsetTop ?? 0), [])

  const virtualizer = useWindowVirtualizer({
    count: all.length,
    estimateSize: () => 80,
    overscan: 5,
    scrollMargin: listTop,
    scrollPaddingEnd: FORM_HEIGHT,
    getItemKey: (i) => all[i].uuid || i,
  })

  // ponytail: always follows new entries, even if you scrolled up to read.
  useEffect(() => {
    if (all.length > 0) virtualizer.scrollToIndex(all.length - 1, { align: 'end' })
  }, [all.length, virtualizer])

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
      for await (const entry of await sendMessage({ data: { project, session, text } })) {
        setLive((l) => [...l, entry])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      await router.invalidate()
      setLive([])
      setPending(false)
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
                  <BlockView key={i} block={b} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
      <SendForm pending={pending} error={error} onSend={send} />
    </>
  )
}

function SendForm({
  pending,
  error,
  onSend,
}: {
  pending: boolean
  error: string
  onSend: (text: string) => Promise<void>
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
      <label htmlFor="text">Message</label>
      <textarea id="text" name="text" rows={3} disabled={pending} />
      <button type="submit" disabled={pending}>
        {pending ? 'Claude is working…' : 'Send'}
      </button>
      {error && <pre className="error">{error}</pre>}
    </form>
  )
}

function BlockView({ block }: { block: Block }) {
  switch (block.type) {
    case 'text':
      return <pre>{block.text}</pre>
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
