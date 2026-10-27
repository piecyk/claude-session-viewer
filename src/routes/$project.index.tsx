import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { formatTime } from '../parse.ts'
import { listSessions } from '../sessions.ts'

export const Route = createFileRoute('/$project/')({
  loader: ({ params }) => listSessions({ data: params.project }),
  component: Sessions,
})

function Sessions() {
  const sessions = Route.useLoaderData()
  const { project } = Route.useParams()
  const navigate = useNavigate()
  return (
    <>
      <h1>{project}</h1>
      {/* The id is made on click, not in render, so server and client HTML match. */}
      <button
        type="button"
        onClick={() =>
          navigate({
            to: '/$project/$session',
            params: { project, session: crypto.randomUUID() },
            resetScroll: false,
          })
        }
      >
        New session
      </button>
      <table>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id}>
              <td>
                {/* The transcript scrolls itself to the last entry; the router's reset would undo it. */}
                <Link to="/$project/$session" params={{ project, session: s.id }} resetScroll={false}>
                  {s.title || s.id}
                </Link>
              </td>
              <td className="num">{(s.size / 1024).toFixed(0)} KB</td>
              <td className="num">{formatTime(s.mtime)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
