import { HeadContent, Link, Scripts, createRootRoute } from '@tanstack/react-router'

const css = `
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { max-width: 960px; margin: 0 auto; padding: 16px; }
  a { color: inherit; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 6px 8px; border-bottom: 1px solid #8884; vertical-align: top; }
  td.num { text-align: right; white-space: nowrap; opacity: .7; }
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
  button { justify-self: start; padding: 6px 16px; }
`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Claude sessions' },
    ],
  }),
  shellComponent: ({ children }) => (
    <html lang="en">
      <head>
        <HeadContent />
        <style>{css}</style>
      </head>
      <body>
        <nav>
          <Link to="/">Projects</Link>
        </nav>
        {children}
        <Scripts />
      </body>
    </html>
  ),
})
