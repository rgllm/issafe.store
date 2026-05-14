import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  Clock3,
  DatabaseZap,
  ExternalLink,
  Globe,
  Loader2,
  ShieldAlert,
  Star,
  ShieldCheck,
  Tag,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { Coupon, Evidence, StoreSafetyReport } from '../types/report'

const PROGRESS_STATUSES = new Set<StoreSafetyReport['status']>([
  'queued',
  'researching',
  'scoring',
])

const PIPELINE_PHASES = [
  { step: 1, Icon: DatabaseZap, label: 'Store site & SSL signals' },
  { step: 2, Icon: Globe, label: 'Domain registration (RDAP)' },
  { step: 3, Icon: ShieldAlert, label: 'Threat lists & blocklists' },
  { step: 4, Icon: Star, label: 'External reputation search' },
  { step: 5, Icon: Bot, label: 'AI synthesis & summary' },
] as const

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
          <ArrowLeft className="size-4" aria-hidden="true" />
          Check another store
        </Link>
        <span className="text-xs font-medium text-[var(--sea-ink-soft)]">
          {cached ? 'Cached result (up to 7 days)' : formatStatus(report.status)}
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
              <verdict.Icon className="size-4" aria-hidden="true" />
              {verdict.label}
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <Metric
              label="Score"
              value={isWorking ? '—' : `${report.score}/100`}
              muted={isWorking}
            />
            <Metric
              label="Confidence"
              value={isWorking ? '—' : `${report.confidence}/100`}
              muted={isWorking}
            />
            <Metric
              label="Recommendation"
              value={isWorking ? 'Pending' : verdict.label}
              muted={isWorking}
            />
          </div>

          {!isWorking ? (
            <div className="mt-5 h-2 overflow-hidden rounded-full bg-[var(--meter-bg)]">
              <div
                className="h-full rounded-full transition-[width] duration-500 ease-out"
                style={{ width: progressWidth, background: verdict.color }}
              />
            </div>
          ) : null}
        </div>

        <div className="grid gap-0 lg:grid-cols-[minmax(0,0.68fr)_minmax(320px,0.32fr)]">
          <section className="border-b border-[var(--line)] p-5 sm:p-6 lg:border-b-0 lg:border-r">
            <h2 className="m-0 text-sm font-semibold text-[var(--sea-ink)]">Summary</h2>

            {isWorking ? (
              <>
                <LiveActivityStrip report={report} />
                <ProgressChecklist report={report} />
              </>
            ) : (
              <p className="m-0 mt-3 text-sm leading-6 text-[var(--sea-ink-soft)]">
                {report.summary}
              </p>
            )}

            <EvidenceList evidence={report.evidence} isWorking={isWorking} />
          </section>

          <aside className="p-5 sm:p-6">
            <CouponList coupons={report.coupons ?? []} />

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
                    className="mt-1 size-4 flex-none text-[var(--signal-safe)]"
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

function LiveActivityStrip({ report }: { report: StoreSafetyReport }) {
  const phase = formatPipelinePhase(report.status)

  return (
    <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2 gap-y-1">
        <span className="rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-[var(--sea-ink-soft)]">
          {phase}
        </span>
        <ElapsedSeconds startedAt={report.createdAt} active />
        <Loader2
          className="size-4 shrink-0 animate-spin text-[var(--primary)]"
          aria-hidden="true"
        />
      </div>
      <p
        key={report.summary}
        className="report-summary-live m-0 mt-2 text-sm font-medium leading-6 text-[var(--sea-ink)]"
      >
        {report.summary}
      </p>
    </div>
  )
}

function formatPipelinePhase(status: StoreSafetyReport['status']) {
  if (status === 'queued') {
    return 'Queued'
  }
  if (status === 'researching') {
    return 'Research'
  }
  if (status === 'scoring') {
    return 'Scoring'
  }
  return 'Progress'
}

function ElapsedSeconds({
  startedAt,
  active,
}: {
  startedAt: string
  active: boolean
}) {
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (!active) {
      return
    }
    const start = Date.parse(startedAt)
    if (Number.isNaN(start)) {
      return
    }

    const tick = () => {
      setSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)))
    }
    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [startedAt, active])

  if (!active) {
    return null
  }

  return (
    <span className="text-xs font-medium text-[var(--sea-ink-soft)]">
      Running {seconds}s
    </span>
  )
}

function ProgressChecklist({ report }: { report: StoreSafetyReport }) {
  const ps = report.progressStep ?? 0

  return (
    <div className="mt-5">
      <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--sea-ink-soft)]">
        Checks in progress
      </h3>
      <ul className="m-0 mt-3 list-none space-y-2.5 p-0">
        {PIPELINE_PHASES.map((phase, index) => {
          const isLast = index === PIPELINE_PHASES.length - 1
          const done = isLast
            ? report.status === 'complete'
            : ps > phase.step
          const active = isLast
            ? isReportInProgress(report.status) && ps >= 5
            : ps === phase.step
          const PhaseIcon = phase.Icon

          return (
            <li key={phase.label} className="flex items-start gap-2.5 text-sm">
              <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
                {done ? (
                  <CheckCircle2
                    className="size-4 text-[var(--signal-safe)]"
                    aria-hidden="true"
                  />
                ) : active ? (
                  <Loader2
                    className="size-4 animate-spin text-[var(--primary)]"
                    aria-hidden="true"
                  />
                ) : (
                  <PhaseIcon
                    className="size-4 text-[var(--sea-ink-soft)] opacity-50"
                    aria-hidden="true"
                  />
                )}
              </span>
              <span
                className={
                  active
                    ? 'font-medium text-[var(--sea-ink)]'
                    : done
                      ? 'text-[var(--sea-ink-soft)]'
                      : 'text-[var(--sea-ink-soft)]'
                }
              >
                {phase.label}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function CouponList({ coupons }: { coupons: Coupon[] }) {
  const codedCoupons = coupons.filter(
    (coupon): coupon is Coupon & { code: string } => Boolean(coupon.code),
  )

  if (codedCoupons.length === 0) {
    return null
  }

  return (
    <section className="mb-6 border-b border-[var(--line)] pb-6">
      <div className="flex items-center gap-2">
        <Tag className="size-4 text-[var(--primary)]" aria-hidden="true" />
        <h2 className="m-0 text-sm font-semibold text-[var(--sea-ink)]">Coupons</h2>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {codedCoupons.slice(0, 3).map((coupon, index) => (
          <CouponCard key={`${coupon.code}-${index}`} code={coupon.code} />
        ))}
      </div>
    </section>
  )
}

function CouponCard({ code }: { code: string }) {
  return (
    <article className="inline-flex w-fit items-center rounded-md border border-[var(--line-strong)] bg-[var(--surface)] px-3 py-1.5 shadow-sm">
      <p className="m-0 truncate font-mono text-[0.8125rem] font-semibold tracking-[0.18em] text-[var(--sea-ink)]">
        {code}
      </p>
    </article>
  )
}

function Metric({
  label,
  value,
  muted,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-muted)] p-3">
      <p className="m-0 text-xs font-medium text-[var(--sea-ink-soft)]">{label}</p>
      <p
        className={`m-0 mt-1 text-lg font-semibold ${muted ? 'text-[var(--sea-ink-soft)]' : 'text-[var(--sea-ink)]'}`}
      >
        {value}
      </p>
    </div>
  )
}

function EvidenceList({
  evidence,
  isWorking,
}: {
  evidence: Evidence[]
  isWorking: boolean
}) {
  if (isWorking && evidence.length === 0) {
    return (
      <div className="mt-7">
        <h2 className="m-0 text-sm font-semibold text-[var(--sea-ink)]">Evidence</h2>
        <div className="mt-3 space-y-3">
          <EvidenceSkeletonRow />
          <EvidenceSkeletonRow />
          <EvidenceSkeletonRow />
        </div>
      </div>
    )
  }

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

function EvidenceSkeletonRow() {
  return (
    <div
      className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
      aria-hidden="true"
    >
      <div className="skeleton-shimmer h-3 w-24 rounded" />
      <div className="skeleton-shimmer mt-3 h-4 w-[88%] max-w-md rounded" />
      <div className="skeleton-shimmer mt-2 h-4 w-[72%] max-w-sm rounded" />
      <div className="skeleton-shimmer mt-4 h-3 w-16 rounded" />
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
          <ExternalLink className="size-3.5" aria-hidden="true" />
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
    return createTone('Likely safe', 'var(--signal-likely-safe)', ShieldCheck)
  }

  if (report.recommendation === 'safe') {
    return createTone('Safe', 'var(--signal-safe)', ShieldCheck)
  }

  if (report.recommendation === 'avoid') {
    return createTone('Avoid', 'var(--signal-avoid)', ShieldAlert)
  }

  if (report.recommendation === 'unknown') {
    return createTone('Unknown', 'var(--signal-unknown)', AlertTriangle)
  }

  return createTone('Unknown', 'var(--signal-unknown)', AlertTriangle)
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
