import { Github } from 'lucide-react'
import { BrandLogo } from './BrandLogo'

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-background px-6 py-6">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 text-xs text-muted-foreground sm:flex-row">
        <BrandLogo />
        <span className="text-center text-pretty">
          Public-signal risk assessment only. Does not guarantee merchant, purchase, or delivery safety.
        </span>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
          <a
            href="https://github.com/rgllm/issafe.store"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-foreground no-underline hover:text-primary"
          >
            <Github className="size-3.5 shrink-0" aria-hidden />
            GitHub
          </a>
          <span>
            Made by{' '}
            <a
              href="https://rgllm.com"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-foreground no-underline hover:text-primary"
            >
              rgllm
            </a>
          </span>
        </div>
      </div>
    </footer>
  )
}
