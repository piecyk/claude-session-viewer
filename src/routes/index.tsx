import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: () => (
    <p className="empty">Pick a session on the left, or press + to start one.</p>
  ),
})
