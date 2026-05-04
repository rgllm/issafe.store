import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Database,
  Globe2,
  Loader2,
  Search,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { TurnstileWidget } from '../components/TurnstileWidget'
import type { StoreSafetyReport } from '../types/report'

type CheckResponse = {
  report: StoreSafetyReport
  cached: boolean
  turnstileSkipped?: boolean
}

type ConfigResponse = {
  turnstileSiteKey: string | null
}

const ANALYSIS_STEPS = [
  {
    title: 'Validate the store URL',
    description:
      'We clean the URL and reject local, private, credentialed, and unsupported addresses before analysis starts.',
    Icon: Globe2,
  },
  {
    title: 'Collect public trust signals',
    description:
      'The system checks reachable store pages, policy quality, domain metadata, and independent reputation results.',
    Icon: Database,
  },
  {
    title: 'Score first, summarize second',
    description:
      'Signals are deduplicated and scored with fixed rules. AI writes the summary, but it does not decide the score.',
    Icon: Bot,
  },
]

export const Route = createFileRoute('/')({ component: HomePage })

function HomePage() {
  const navigate = useNavigate()
  const [url, setUrl] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>()
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const handleTurnstileTokenChange = useCallback((token: string | undefined) => {
    setTurnstileToken(token)
  }, [])

  useEffect(() => {
    let cancelled = false

    fetch('/api/config')
      .then((response) => response.json() as Promise<ConfigResponse>)
      .then((config) => {
        if (!cancelled) {
          setTurnstileSiteKey(config.turnstileSiteKey)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTurnstileSiteKey(null)
        }
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalizedUrl = url.trim()
    if (!normalizedUrl) {
      return
    }

    setError(null)
    setIsSubmitting(true)

    try {
      const response = await fetch('/api/check', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          url: normalizedUrl,
          turnstileToken,
        }),
      })
      const body = (await response.json()) as CheckResponse | { error: string }

      if (!response.ok) {
        throw new Error('error' in body ? body.error : 'The check failed.')
      }

      const result = body as CheckResponse
      await navigate({
        to: '/report/$id',
        params: { id: result.report.id },
      })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'The check failed.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main id="top" className="home-main">
      <section className="home-section home-hero">
        <div className="page-wrap">
          <div className="hero-grid">
            <div>
              <p className="home-kicker">Risk check before checkout</p>
              <h1 className="home-display">
                Check a store before you pay
              </h1>
              <p className="home-lede">
                Paste a store URL to get a risk score, confidence rating, and cited public evidence in seconds.
              </p>
              <form onSubmit={handleSubmit} className="island-shell hero-form">
                <label htmlFor="store-url" className="sr-only">
                  Store URL
                </label>
                <div className="hero-form-row">
                  <div className="relative min-w-0 flex-1">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sea-ink-soft)]"
                      aria-hidden="true"
                    />
                    <input
                      id="store-url"
                      value={url}
                      onChange={(event) => setUrl(event.target.value)}
                      placeholder="example-store.com"
                      autoComplete="url"
                      className="hero-input"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting || !url.trim()}
                    className="cta-pill cta-pill-dark"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ArrowRight className="h-4 w-4" aria-hidden="true" />
                    )}
                    Get risk report
                  </button>
                </div>

                <TurnstileWidget siteKey={turnstileSiteKey} onTokenChange={handleTurnstileTokenChange} />

                {error ? (
                  <p className="m-0 mt-3 flex items-start gap-2 rounded-[10px] border border-[var(--risk-line)] bg-[var(--risk-bg)] px-3 py-2 text-sm font-medium text-[var(--signal-risk)]">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
                    {error}
                  </p>
                ) : null}
              </form>
              <p className="hero-note">
                Uses public signals only. Not a guarantee of merchant or delivery safety.{' '}
                <a href="#how-agent-works">See how the score works.</a>
              </p>
            </div>
            <aside className="hero-visual-card" aria-hidden="true">
              <div className="hero-orb hero-orb-1" />
              <div className="hero-orb hero-orb-2" />
              <div className="hero-orb hero-orb-3" />
              <p className="home-kicker">Fast signal scan</p>
              <div className="hero-metric-grid">
                <article className="hero-metric">
                  <p className="hero-metric-label">Policy signals</p>
                  <p className="hero-metric-value">Clear</p>
                </article>
                <article className="hero-metric">
                  <p className="hero-metric-label">Domain history</p>
                  <p className="hero-metric-value">Established</p>
                </article>
                <article className="hero-metric">
                  <p className="hero-metric-label">Risk level</p>
                  <p className="hero-metric-value">Low</p>
                </article>
                <article className="hero-metric">
                  <p className="hero-metric-label">Evidence confidence</p>
                  <p className="hero-metric-value">High</p>
                </article>
              </div>
            </aside>
          </div>
        </div>
      </section>

      <section id="how-agent-works" className="home-section">
        <div className="page-wrap">
          <div className="home-section-head">
            <p className="home-kicker">How IsSafe works</p>
            <h2 className="home-section-title">Public evidence first. Consistent scoring second.</h2>
            <p className="home-section-copy">
              Every report follows the same transparent sequence so results stay consistent and auditable.
            </p>
          </div>
          <div className="analysis-steps">
            {ANALYSIS_STEPS.map(({ title, description, Icon }, index) => (
              <article key={title} className="analysis-step-card">
                <div className="analysis-step-top">
                  <span className="analysis-step-icon">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="analysis-step-count">0{index + 1}</span>
                </div>
                <h3>{title}</h3>
                <p>{description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
