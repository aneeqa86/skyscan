import { Link } from 'react-router-dom'

export default function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <span className="num text-6xl text-ink-600">404</span>
      <h1 className="mt-4 text-2xl font-semibold text-fg">Nothing scanned here</h1>
      <p className="mt-2 text-muted">This page does not exist.</p>
      <Link to="/" className="btn-primary mt-6">
        Back to home
      </Link>
    </div>
  )
}
