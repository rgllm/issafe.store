import { Agent } from 'agents'
import { getCacheTtlSeconds, runStoreResearch } from '../lib/research'
import { saveReport } from '../lib/reports-db'
import type {
  StoreSafetyReport,
  StoreSafetyRequest,
  StoreSafetyState,
} from '../types/report'

export class StoreSafetyAgent extends Agent<Env, StoreSafetyState> {
  initialState: StoreSafetyState = {
    report: null,
    updatedAt: null,
  }

  async startCheck(request: StoreSafetyRequest): Promise<StoreSafetyReport> {
    const existing = this.state.report

    if (
      existing?.id === request.id &&
      existing.status !== 'failed' &&
      new Date(existing.expiresAt).getTime() > Date.now()
    ) {
      return existing
    }

    const now = new Date().toISOString()
    const queuedReport = createBaseReport(
      request,
      'queued',
      'Store safety check queued.',
      this.env,
    )

    this.setState({
      report: queuedReport,
      updatedAt: now,
    })

    await this.queue('processCheck', request)

    return queuedReport
  }

  async getCurrentReport(): Promise<StoreSafetyReport | null> {
    return this.state.report
  }

  async processCheck(request: StoreSafetyRequest): Promise<void> {
    this.setState({
      report: createBaseReport(
        request,
        'researching',
        'Checking the store site, domain data, and external reputation signals.',
        this.env,
      ),
      updatedAt: new Date().toISOString(),
    })

    try {
      const report = await runStoreResearch(request, this.env, (status, summary) => {
        const current =
          this.state.report ?? createBaseReport(request, status, summary, this.env)

        this.setState({
          report: {
            ...current,
            status,
            summary,
            evidence: current.evidence,
          },
          updatedAt: new Date().toISOString(),
        })
      })

      this.setState({
        report,
        updatedAt: new Date().toISOString(),
      })

      await saveReport(this.env.DB, report)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'The check failed while collecting public signals.'

      this.setState({
        report: {
          ...createBaseReport(request, 'failed', message, this.env),
          confidence: 10,
          recommendation: 'unknown',
        },
        updatedAt: new Date().toISOString(),
      })
    }
  }
}

function createBaseReport(
  request: StoreSafetyRequest,
  status: StoreSafetyReport['status'],
  summary: string,
  env: Env,
): StoreSafetyReport {
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(
    Date.now() + getCacheTtlSeconds(env) * 1000,
  ).toISOString()

  return {
    ...request,
    status,
    score: 0,
    confidence: 0,
    recommendation: 'unknown',
    summary,
    evidence: [],
    createdAt,
    expiresAt,
  }
}
