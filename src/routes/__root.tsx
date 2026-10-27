import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  useNavigate,
} from '@tanstack/react-router'
import { listSidebar } from '../sessions.ts'

const css = `
  :root {
    color-scheme: light dark;
    font-family: system-ui, sans-serif;
    --sidebar: color-mix(in srgb, CanvasText 4%, Canvas);
    --hover: color-mix(in srgb, CanvasText 8%, Canvas);
    --active: color-mix(in srgb, CanvasText 14%, Canvas);
    --border: color-mix(in srgb, CanvasText 15%, Canvas);
  }
  body { margin: 0; background: Canvas; }
  a { color: inherit; }
  .layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); }
  /* The sidebar is a popover (a drawer on narrow screens). These rules undo the
     browser's popover styles so it sits in the grid on wide screens. */
  .sidebar {
    display: block; position: sticky; inset: auto; top: 0; width: auto; height: 100vh;
    margin: 0; border: 0; border-right: 1px solid var(--border); box-sizing: border-box;
    overflow-y: auto; padding: 12px 8px; color: inherit; background: var(--sidebar);
    font-size: 14px;
  }
  .topbar { display: none; }
  .sidebar details { margin-bottom: 12px; }
  .sidebar summary {
    display: flex; align-items: center; gap: 6px; padding: 6px 8px;
    font-weight: 600; cursor: pointer; list-style: none;
  }
  .sidebar summary::after { content: '▾'; font-size: 11px; opacity: .6; order: 1; }
  .sidebar details:not([open]) > summary::after { content: '▸'; }
  .sidebar summary .label { order: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sidebar summary button {
    order: 2; margin-left: auto; border: 0; background: none; color: inherit;
    font-size: 18px; line-height: 1; padding: 2px 6px; border-radius: 6px; cursor: pointer;
  }
  .sidebar summary button:hover { background: var(--hover); }
  .sidebar .more > summary { font-weight: 400; opacity: .7; }
  .session {
    display: block; padding: 6px 8px; border-radius: 8px; text-decoration: none;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .session:hover { background: var(--hover); }
  .session.active { background: var(--active); }
  main { min-width: 0; padding: 16px 24px 0; }
  .content { max-width: 900px; margin: 0 auto; }
  .empty { margin-top: 30vh; text-align: center; opacity: .7; }
  pre { white-space: pre-wrap; word-break: break-word; margin: 4px 0; font-size: 13px; }
  .entry { border-left: 3px solid #888; padding: 4px 12px; }
  .user { border-color: #3b82f6; }
  .assistant { border-color: #f59e0b; }
  .meta { font-size: 12px; opacity: .6; }
  details { margin: 4px 0; }
  summary { cursor: pointer; font-size: 13px; opacity: .8; }
  .error { color: #ef4444; }
  form { display: grid; gap: 8px; position: sticky; bottom: 0; padding: 12px 0 16px; background: Canvas; }
  textarea { font: inherit; padding: 8px; }
  form button { justify-self: start; padding: 6px 16px; }
  @media (max-width: 700px) {
    .layout { grid-template-columns: minmax(0, 1fr); }
    .sidebar { position: fixed; inset: 0 auto 0 0; width: min(85vw, 320px); height: 100dvh; }
    .sidebar:not(:popover-open) { display: none; }
    .sidebar::backdrop { background: rgb(0 0 0 / .4); }
    .topbar {
      display: flex; position: sticky; top: 0; z-index: 1; padding: 8px 0;
      background: Canvas; border-bottom: 1px solid var(--border);
    }
    .topbar button { font: inherit; padding: 6px 12px; }
    main { padding: 0 16px; }
  }
`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Claude sessions' },
    ],
  }),
  loader: () => listSidebar(),
  // Reload only on router.invalidate() (after a send) or a full page load.
  staleTime: Infinity,
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
        <style>{css}</style>
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  ),
  // Mobile Safari asks for /favicon.ico and /apple-touch-icon.png; no route matches them.
  notFoundComponent: () => <p className="empty">Not found.</p>,
  component: () => (
    <div className="layout">
      <Sidebar />
      <main>
        <div className="topbar">
          <button type="button" popoverTarget="sidebar">
            ☰ Sessions
          </button>
        </div>
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  ),
})

// ponytail: newest 10 per project, the rest folded; add search if the list gets long.
const VISIBLE = 10

function Sidebar() {
  const projects = Route.useLoaderData()
  const navigate = useNavigate()

  return (
    <nav
      id="sidebar"
      popover="auto"
      className="sidebar"
      aria-label="Projects and sessions"
      // Close the mobile drawer after picking a session or pressing +.
      onClick={(event) => {
        const nav = event.currentTarget
        if (
          event.target instanceof Element &&
          event.target.closest('a, summary button') &&
          nav.matches(':popover-open')
        ) {
          nav.hidePopover()
        }
      }}
    >
      {projects.map((p) => {
        const links = p.sessions.map((s) => (
          <Link
            key={s.id}
            className="session"
            activeProps={{ className: 'active' }}
            to="/$project/$session"
            params={{ project: p.name, session: s.id }}
            // The transcript scrolls itself to the last entry; the router's reset would undo it.
            resetScroll={false}
            title={s.title || s.id}
          >
            {s.title || s.id}
          </Link>
        ))
        return (
          <details key={p.name} open>
            <summary title={p.name}>
              <span className="label">{p.label}</span>
              <button
                type="button"
                aria-label={`New session in ${p.label}`}
                title="New session"
                onClick={(event) => {
                  // Keep the click from toggling the <details>.
                  event.preventDefault()
                  // The id is made on click, not in render, so server and client HTML match.
                  navigate({
                    to: '/$project/$session',
                    params: { project: p.name, session: crypto.randomUUID() },
                    resetScroll: false,
                  })
                }}
              >
                +
              </button>
            </summary>
            {links.slice(0, VISIBLE)}
            {links.length > VISIBLE && (
              <details className="more">
                <summary>{links.length - VISIBLE} more</summary>
                {links.slice(VISIBLE)}
              </details>
            )}
          </details>
        )
      })}
    </nav>
  )
}
