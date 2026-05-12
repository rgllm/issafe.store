import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { isReportInProgress, ReportView } from '../components/ReportView'
import { trackStoreEvent } from '../lib/umami'
import type { StoreSafetyReport } from '../types/report'

type CheckResponse = {
  report: StoreSafetyReport
  cached: boolean
}

export const Route = createFileRoute('/report/$id')({
  component: ReportPage,
})

function ReportPage() {
  const { id } = Route.useParams()
  const [report, setReport] = useState<StoreSafetyReport | null>(null)
  const [cached, setCached] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const isInProgress = report ? isReportInProgress(report.status) : false
  const viewedReportIdRef = useRef<string | null>(null)

  useEffect(() => {
    viewedReportIdRef.current = null
  }, [id])

  useEffect(() => {
    if (isLoading || !report) {
      return
    }
    if (viewedReportIdRef.current === id) {
      return
    }
    viewedReportIdRef.current = id
    trackStoreEvent('report_viewed', { status: report.status, cached })
  }, [cached, id, isLoading, report])

  useEffect(() => {
    let cancelled = false

    async function loadReport() {
      setError(null)
      setIsLoading(true)

      try {
        const result = await fetchReport(id)

        if (!cancelled) {
          setReport(result.report)
          setCached(result.cached)
        }
      } catch (loadError) {
        if (!cancelled) {
          setReport(null)
          setError(loadError instanceof Error ? loadError.message : 'We could not find that report.')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void loadReport()

    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (!isInProgress) {
      return
    }

    const interval = window.setInterval(() => {
      fetchReport(id)
        .then((result) => {
          setReport(result.report)
          setCached(result.cached)
        })
        .catch(() => {
          setError('The report is still running, but live updates are temporarily unavailable.')
        })
    }, 1800)

    return () => {
      window.clearInterval(interval)
    }
  }, [id, isInProgress])

  if (error) {
    return (
      <main className="page-wrap px-4 py-10">
        <section className="island-shell rounded-lg p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 size-5 flex-none text-[var(--signal-risk)]"
              aria-hidden="true"
            />
            <div>
              <h1 className="m-0 text-base font-semibold text-[var(--sea-ink)]">
                Report unavailable
              </h1>
              <p className="m-0 mt-2 text-sm leading-6 text-[var(--sea-ink-soft)]">
                {error}
              </p>
            </div>
          </div>
        </section>
      </main>
    )
  }

  if (isLoading || !report) {
    return (
      <main className="page-wrap flex min-h-[calc(100vh-12rem)] items-center justify-center px-4 py-14">
        <div className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm font-medium text-[var(--sea-ink-soft)]">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading report...
        </div>
      </main>
    )
  }

  return <ReportView report={report} cached={cached} />
}

async function fetchReport(id: string): Promise<CheckResponse> {
  const response = await fetch(`/api/check/${id}`)
  const body = (await response.json()) as CheckResponse | { error?: string }

  if (!response.ok) {
    throw new Error('error' in body && body.error ? body.error : 'We could not find that report.')
  }

  return body as CheckResponse
}
