import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import type { Evidence, StoreSafetyReport } from '../types/report'

const PROGRESS_STATUSES = new Set<StoreSafetyReport['status']>([
  'queued',
  'researching',
  'scoring',
])

export function isReportInProgress(status: StoreSafetyReport['status']) {
  return PROGRESS_STATUSES.has(status)
}

export function ReportView({
  report,
  cached,
}: {
  report: StoreSafetyReport
  cached: boolean
}) {
  const verdict = getVerdict(report)
  const progressWidth = `${Math.max(2, Math.min(100, report.score))}%`
  const isWorking = isReportInProgress(report.status)

  return (
    <main className="page-wrap px-4 py-8 sm:py-10">
      <div className="mb-5 flex items-center justify-between gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-sm font-medium text-[var(--sea-ink-soft)] no-underline hover:text-[var(--sea-ink)]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Check another store
        </Link>
        <span className="text-xs font-medium text-[var(--sea-ink-soft)]">
          {cached ? 'Cached result (up to 24 hours)' : formatStatus(report.status)}
        </span>
      </div>

      <section className="island-shell rounded-lg">
        <div className="border-b border-[var(--line)] px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-sm font-medium text-[var(--sea-ink-soft)]">
                Store safety report
              </p>
              <h1 className="m-0 mt-1 truncate text-2xl font-semibold tracking-[-0.01em] text-[var(--sea-ink)] sm:text-3xl">
                {report.hostname}
              </h1>
            </div>
            <span
              className="inline-flex w-fit items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm font-medium"
              style={{
                color: verdict.color,
                background: verdict.background,
                borderColor: verdict.border,
              }}
            >
              <verdict.Icon className="h-4 w-4" aria-hidden="true" />
              {verdict.label}
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric label="Score" value={`${report.score}/100`} />
            <Metric label="Confidence" value={`${report.confidence}/100`} />
            <Metric label="Recommendation" value={verdict.label} />
          </div>

          <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--meter-bg)]">
            <div
              className="h-full rounded-full"
              style={{ width: progressWidth, background: verdict.color }}
            />
          </div>
        </div>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,0.68fr)_minmax(320px,0.32fr)]">
          <section className="border-b border-[var(--line)] p-5 sm:p-6 lg:border-b-0 lg:border-r">
            <h2 className="m-0 text-sm font-semibold text-[var(--sea-ink)]">Summary</h2>
            <p className="m-0 mt-3 text-sm leading-6 text-[var(--sea-ink-soft)]">
              {report.summary}
            </p>

            {isWorking ? (
              <div className="mt-5 flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] px-3 py-2 text-sm font-medium text-[var(--sea-ink)]">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Collecting fresh evidence...
              </div>
            ) : null}

            <EvidenceList evidence={report.evidence} />
          </section>

          <aside className="p-5 sm:p-6">
            <h2 className="m-0 text-sm font-semibold text-[var(--sea-ink)]">
              Before you buy
            </h2>
            <ul className="m-0 mt-4 space-y-3 p-0 text-sm leading-6 text-[var(--sea-ink-soft)]">
              {[
                'Verify reviews on independent sites, not only the store itself.',
                'Read refund, shipping, and support policies before checkout.',
                'Pay with a method that includes buyer protection.',
              ].map((item) => (
                <li key={item} className="flex gap-2">
                  <CheckCircle2
                    className="mt-1 h-4 w-4 flex-none text-[var(--signal-safe)]"
                    aria-hidden="true"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="m-0 mt-6 border-t border-[var(--line)] pt-4 text-xs leading-5 text-[var(--sea-ink-soft)]">
              This report is a public-signal risk assessment and cannot guarantee purchase,
              merchant, or delivery safety.
            </p>
          </aside>
        </div>
      </section>
    </main>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3">
      <p className="m-0 text-xs font-medium text-[var(--sea-ink-soft)]">{label}</p>
      <p className="m-0 mt-1 text-lg font-semibold text-[var(--sea-ink)]">{value}</p>
    </div>
  )
}

function EvidenceList({ evidence }: { evidence: Evidence[] }) {
  if (evidence.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface-muted)] p-4 text-sm text-[var(--sea-ink-soft)]">
        Evidence will appear here as the analysis finishes.
      </div>
    )
  }

  return (
    <div className="mt-7">
      <h2 className="m-0 text-sm font-semibold text-[var(--sea-ink)]">Evidence</h2>
      <div className="mt-3 divide-y divide-[var(--line)] rounded-lg border border-[var(--line)]">
        {evidence.map((item, index) => (
          <EvidenceRow key={`${item.title}-${index}`} evidence={item} />
        ))}
      </div>
    </div>
  )
}

function EvidenceRow({ evidence }: { evidence: Evidence }) {
  const tone = getEvidenceTone(evidence.sentiment)

  return (
    <article className="bg-[var(--surface)] p-4 first:rounded-t-lg last:rounded-b-lg">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 text-xs font-medium text-[var(--sea-ink-soft)]">
            {evidence.sourceType.replace('-', ' ')}
          </p>
          <h3 className="m-0 mt-1 text-sm font-semibold text-[var(--sea-ink)]">
            {evidence.title}
          </h3>
        </div>
        <span
          className="rounded-md px-2 py-1 text-xs font-medium"
          style={{ color: tone.color, background: tone.background }}
        >
          {evidence.sentiment}
        </span>
      </div>
      <p className="m-0 mt-2 text-sm leading-6 text-[var(--sea-ink-soft)]">
        {evidence.snippet}
      </p>
      {evidence.url ? (
        <a
          href={evidence.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium no-underline"
        >
          Source
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </article>
  )
}

function getVerdict(report: StoreSafetyReport): {
  label: string
  color: string
  background: string
  border: string
  Icon: LucideIcon
} {
  if (report.status === 'failed') {
    return createTone('Check failed', 'var(--signal-risk)', AlertTriangle)
  }

  if (isReportInProgress(report.status)) {
    return createTone('In progress', 'var(--signal-unknown)', Clock3)
  }

  if (report.recommendation === 'likely-safe') {
    return createTone('Likely safe', 'var(--signal-safe)', ShieldCheck)
  }

  if (report.recommendation === 'avoid') {
    return createTone('Avoid', 'var(--signal-risk)', ShieldAlert)
  }

  if (report.recommendation === 'unknown') {
    return createTone('Unknown', 'var(--signal-unknown)', AlertTriangle)
  }

  return createTone('Use caution', 'var(--signal-caution)', AlertTriangle)
}

function createTone(label: string, color: string, Icon: LucideIcon) {
  return {
    label,
    color,
    background: `color-mix(in oklab, ${color} 9%, transparent)`,
    border: `color-mix(in oklab, ${color} 24%, var(--line))`,
    Icon,
  }
}

function getEvidenceTone(sentiment: Evidence['sentiment']) {
  if (sentiment === 'positive') {
    return {
      color: 'var(--signal-safe)',
      background: 'color-mix(in oklab, var(--signal-safe) 9%, transparent)',
    }
  }

  if (sentiment === 'negative') {
    return {
      color: 'var(--signal-risk)',
      background: 'color-mix(in oklab, var(--signal-risk) 9%, transparent)',
    }
  }

  return {
    color: 'var(--signal-unknown)',
    background: 'color-mix(in oklab, var(--signal-unknown) 9%, transparent)',
  }
}

function formatStatus(status: StoreSafetyReport['status']) {
  return status.charAt(0).toUpperCase() + status.slice(1)
}
