import { createFileRoute, notFound, redirect } from '@tanstack/react-router'
import { findDesktopSession } from '../sessions.ts'

// Target of `#local_<id>` links in transcripts: opens that Claude Desktop session here.
export const Route = createFileRoute('/desktop/$id')({
  loader: async ({ params }) => {
    const found = await findDesktopSession({ data: params.id })
    if (!found) throw notFound()
    throw redirect({ to: '/$project/$session', params: found, resetScroll: false })
  },
})
