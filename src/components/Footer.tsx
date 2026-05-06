export default function Footer() {
  return (
    <footer className="mt-auto border-t border-border bg-background px-6 py-6">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 text-xs text-muted-foreground sm:flex-row">
        <span className="font-medium text-foreground">
          is<span className="text-primary">safe</span>.store
        </span>
        <span className="text-center text-pretty">
          Public-signal risk assessment only. Does not guarantee merchant, purchase, or delivery safety.
        </span>
        <span>
          Made by{' '}
          <a
            href="https://rgllm.com"
            target="_blank"
            rel="noreferrer"
            className="font-medium text-foreground no-underline hover:text-primary"
          >
            Rogério
          </a>
        </span>
      </div>
    </footer>
  )
}
