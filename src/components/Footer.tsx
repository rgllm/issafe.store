export default function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer className="site-footer px-4 pb-10 pt-8 text-[var(--sea-ink-soft)]">
      <div className="page-wrap grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2">
          <p className="m-0 text-sm font-medium text-[var(--sea-ink)]">IsSafe.store</p>
          <p className="m-0 mt-2 max-w-md text-sm leading-6">
            Quick store risk checks based on public signals. Always verify key details before payment.
          </p>
          <p className="m-0 mt-3 text-xs">&copy; {year} IsSafe.store</p>
        </div>
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em]">Product</p>
          <ul className="m-0 mt-3 list-none space-y-2 p-0 text-sm">
            <li>
              <a href="#top" className="no-underline hover:underline">
                Start a check
              </a>
            </li>
            <li>
              <a href="#how-agent-works" className="no-underline hover:underline">
                How scoring works
              </a>
            </li>
          </ul>
        </div>
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-[0.08em]">Safety</p>
          <ul className="m-0 mt-3 list-none space-y-2 p-0 text-sm">
            <li>Public signals only</li>
            <li>Not financial or legal advice</li>
          </ul>
        </div>
      </div>
    </footer>
  )
}
