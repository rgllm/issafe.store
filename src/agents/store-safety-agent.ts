import { Agent, type FiberRecoveryContext, type RetryOptions } from 'agents'
import {
  getCacheTtlSeconds,
  runStoreResearch,
  type StoreResearchCheckpoint,
} from '../lib/research'
import { saveReport } from '../lib/reports-db'
import {
  getCheckpointProgress,
  isRetryableStoreCheckError,
} from '../lib/store-check-resilience'
import type {
  StoreSafetyReport,
  StoreSafetyRequest,
  StoreSafetyState,
} from '../types/report'

type StoreSafetyAgentState = StoreSafetyState & {
  checkpoint: StoreResearchCheckpoint | null
}

const PROCESS_CHECK_RETRY: RetryOptions = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 5_000,
}

const SAVE_REPORT_RETRY: RetryOptions = {
  maxAttempts: 3,
  baseDelayMs: 250,
  maxDelayMs: 2_500,
}

const FIBER_PREFIX = 'store-check:'

export class StoreSafetyAgent extends Agent<Env, StoreSafetyAgentState> {
  initialState: StoreSafetyAgentState = {
    report: null,
    updatedAt: null,
    checkpoint: null,
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
      checkpoint: null,
    })

    await this.queue('processCheck', request)

    return queuedReport
  }

  async getCurrentReport(): Promise<StoreSafetyReport | null> {
    return this.state.report
  }

  async processCheck(request: StoreSafetyRequest): Promise<void> {
    const checkpoint = this.state.checkpoint?.request.id === request.id ? this.state.checkpoint : null
    const progress = checkpoint ? getCheckpointProgress(checkpoint) : null

    this.setState({
      report: createProgressReport(
        this.state.report,
        request,
        progress?.status ?? 'researching',
        progress?.summary ?? 'Checking the store site and public signals.',
        this.env,
        progress?.progressStep ?? 1,
      ),
      updatedAt: new Date().toISOString(),
      checkpoint,
    })

    try {
      const report = await this.retry(
        () =>
          this.runCheckFiber(
            request,
            this.state.checkpoint?.request.id === request.id ? this.state.checkpoint : checkpoint,
          ),
        {
          ...PROCESS_CHECK_RETRY,
          shouldRetry: (error) => {
            const shouldRetry = isRetryableStoreCheckError(error)

            if (shouldRetry) {
              const nextCheckpoint =
                this.state.checkpoint?.request.id === request.id ? this.state.checkpoint : checkpoint
              this.setState({
                report: createRetryReport(this.state.report, request, this.env, nextCheckpoint),
                updatedAt: new Date().toISOString(),
                checkpoint: nextCheckpoint,
              })
            }

            return shouldRetry
          },
        },
      )

      this.setState({
        report,
        updatedAt: new Date().toISOString(),
        checkpoint: null,
      })
    } catch (error) {
      this.setState({
        report: createFailedReport(
          this.state.report,
          request,
          getFailureMessage(error),
          this.env,
        ),
        updatedAt: new Date().toISOString(),
        checkpoint: null,
      })
    }
  }

  override async onFiberRecovered(ctx: FiberRecoveryContext): Promise<void> {
    if (!ctx.name.startsWith(FIBER_PREFIX)) {
      return
    }

    const checkpoint = toCheckpoint(ctx.snapshot)

    if (!checkpoint) {
      return
    }

    const progress = getCheckpointProgress(checkpoint)
    this.setState({
      report: createProgressReport(
        this.state.report,
        checkpoint.request,
        progress.status,
        progress.summary,
        this.env,
        progress.progressStep,
      ),
      updatedAt: new Date().toISOString(),
      checkpoint,
    })
    await this.queue('processCheck', checkpoint.request)
  }

  private async runCheckFiber(
    request: StoreSafetyRequest,
    checkpoint: StoreResearchCheckpoint | null,
  ) {
    return this.runFiber(getFiberName(request.id), async (ctx) => {
      const report = await runStoreResearch(
        request,
        this.env,
        (status, summary, progressStep) => {
          this.setState({
            report: createProgressReport(
              this.state.report,
              request,
              status,
              summary,
              this.env,
              progressStep,
            ),
            updatedAt: new Date().toISOString(),
            checkpoint: this.state.checkpoint,
          })
        },
        {
          checkpoint,
          onCheckpoint: (nextCheckpoint) => {
            ctx.stash(nextCheckpoint)
            this.setState({
              report: this.state.report,
              updatedAt: new Date().toISOString(),
              checkpoint: nextCheckpoint,
            })
          },
        },
      )

      await this.retry(
        () => saveReport(this.env.DB, report),
        {
          ...SAVE_REPORT_RETRY,
          shouldRetry: (error) => isRetryableStoreCheckError(error),
        },
      )

      return report
    })
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

function createProgressReport(
  current: StoreSafetyReport | null,
  request: StoreSafetyRequest,
  status: StoreSafetyReport['status'],
  summary: string,
  env: Env,
  progressStep: number,
): StoreSafetyReport {
  const base =
    current?.id === request.id
      ? current
      : createBaseReport(request, status, summary, env, progressStep)

  return {
    ...base,
    status,
    summary,
    progressStep,
  }
}

function createRetryReport(
  current: StoreSafetyReport | null,
  request: StoreSafetyRequest,
  env: Env,
  checkpoint: StoreResearchCheckpoint | null,
): StoreSafetyReport {
  const progress = checkpoint ? getCheckpointProgress(checkpoint) : null
  const base =
    current?.id === request.id
      ? current
      : createBaseReport(
          request,
          'queued',
          'Temporary connectivity issue while checking public signals. Retrying shortly.',
          env,
          progress?.progressStep ?? 0,
        )

  return {
    ...base,
    status: 'queued',
    summary: 'Temporary connectivity issue while checking public signals. Retrying shortly.',
    progressStep: progress?.progressStep ?? base.progressStep ?? 0,
  }
}

function createFailedReport(
  current: StoreSafetyReport | null,
  request: StoreSafetyRequest,
  message: string,
  env: Env,
): StoreSafetyReport {
  const base = current?.id === request.id ? current : createBaseReport(request, 'failed', message, env)

  return {
    ...base,
    status: 'failed',
    summary: message,
    score: 0,
    confidence: 10,
    recommendation: 'unknown',
  }
}

function getFiberName(id: string) {
  return `${FIBER_PREFIX}${id}`
}

function toCheckpoint(value: unknown): StoreResearchCheckpoint | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const checkpoint = value as Partial<StoreResearchCheckpoint>
  const request = checkpoint.request

  if (
    !request ||
    typeof request !== 'object' ||
    typeof request.id !== 'string' ||
    typeof request.inputUrl !== 'string' ||
    typeof request.normalizedUrl !== 'string' ||
    typeof request.hostname !== 'string' ||
    typeof checkpoint.createdAt !== 'string' ||
    typeof checkpoint.expiresAt !== 'string'
  ) {
    return null
  }

  return checkpoint as StoreResearchCheckpoint
}

function getFailureMessage(error: unknown) {
  if (isRetryableStoreCheckError(error)) {
    return 'Temporary connectivity issues persisted after multiple retries. The check could not finish.'
  }

  return error instanceof Error
    ? error.message
    : 'The check failed while collecting public signals.'
}
