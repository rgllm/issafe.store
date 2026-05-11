import { Link } from '@tanstack/react-router'
import { BrandLogo } from './BrandLogo'

export default function Header() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="no-underline" aria-label="IsSafe.store home">
          <BrandLogo />
        </Link>
        <nav className="flex items-center gap-6 text-sm text-muted-foreground">
          <a href="/#how-we-check" className="hidden no-underline transition-colors hover:text-foreground sm:inline">
            How it works
          </a>
        </nav>
      </div>
    </header>
  )
}
