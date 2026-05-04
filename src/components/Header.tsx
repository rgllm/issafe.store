import { Link } from '@tanstack/react-router'

export default function Header() {
  return (
    <header className="px-4 pt-6 sm:pt-8">
      <div className="page-wrap flex items-center justify-center">
        <Link
          to="/"
          className="text-sm font-semibold uppercase tracking-[0.08em] text-[var(--sea-ink)] no-underline"
        >
          IsSafe.store
        </Link>
      </div>
    </header>
  )
}
