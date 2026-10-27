import { Link, createFileRoute } from '@tanstack/react-router'
import { formatTime } from '../parse.ts'
import { listProjects } from '../sessions.ts'

export const Route = createFileRoute('/')({
  loader: () => listProjects(),
  component: Projects,
})

function Projects() {
  const projects = Route.useLoaderData()
  return (
    <>
      <h1>Projects</h1>
      <table>
        <tbody>
          {projects.map((p) => (
            <tr key={p.name}>
              <td>
                <Link to="/$project" params={{ project: p.name }}>
                  {p.name}
                </Link>
              </td>
              <td className="num">{p.sessions} sessions</td>
              <td className="num">{formatTime(p.mtime)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
