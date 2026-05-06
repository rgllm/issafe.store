import { Link } from '@tanstack/react-router'

export default function Header() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="text-base tracking-tight no-underline">
          <span className="font-bold text-foreground">is</span>
          <span className="font-bold text-primary">safe</span>
          <span className="font-light text-muted-foreground">.store</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm text-muted-foreground">
          <a href="/#how-we-check" className="hidden no-underline transition-colors hover:text-foreground sm:inline">
            How it works
          </a>
          <a href="#" className="no-underline transition-colors hover:text-foreground">
            API
          </a>
          <a href="#" className="no-underline transition-colors hover:text-foreground">
            Blog
          </a>
        </nav>
      </div>
    </header>
  )
}
