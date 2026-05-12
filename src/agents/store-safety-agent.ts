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
      0,
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
        1,
      ),
      updatedAt: new Date().toISOString(),
    })

    try {
      const report = await runStoreResearch(request, this.env, (status, summary, progressStep) => {
        const current =
          this.state.report ?? createBaseReport(request, status, summary, this.env, progressStep)

        this.setState({
          report: {
            ...current,
            status,
            summary,
            progressStep,
            evidence: current.evidence,
            coupons: current.coupons,
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
  progressStep?: number,
): StoreSafetyReport {
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(
    Date.now() + getCacheTtlSeconds(env) * 1000,
  ).toISOString()

  return {
    ...request,
    status,
    ...(progressStep !== undefined ? { progressStep } : {}),
    score: 0,
    confidence: 0,
    recommendation: 'unknown',
    summary,
    evidence: [],
    coupons: [],
    createdAt,
    expiresAt,
  }
}
