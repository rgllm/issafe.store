import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createMcpHandler } from 'agents/mcp'
import { z } from 'zod'
import { getStoreCheck, startStoreCheck } from '../lib/checks'
import {
  formatCompactMcpReport,
  isReportInProgress,
  mcpTextResult,
} from '../lib/mcp-report'
import { UsageLimitError } from '../lib/usage-limits'
import { UrlValidationError } from '../lib/url'

const CHECK_POLL_ATTEMPTS = 10
const CHECK_POLL_INTERVAL_MS = 2_000
const IN_PROGRESS_NEXT_ACTION =
  'Call get_report with this id in a few seconds until status is complete or failed.'

export function createIsSafeMcpFetchHandler() {
  return async (request: Request, env: Env, ctx: ExecutionContext) => {
    const server = createIsSafeMcpServer(env)
    return createMcpHandler(server, { route: '/mcp' })(request, env, ctx)
  }
}

export function createIsSafeMcpServer(env: Env) {
  const server = new McpServer({
    name: 'issafe-store',
    version: '1.0.0',
  })

  server.registerTool(
    'check_store',
    {
      description:
        'Start or reuse a public-signal store safety check for a store URL or hostname. Returns a compact risk report. If the check is still running after a short wait, call get_report with the returned id.',
      inputSchema: {
        url: z
          .string()
          .min(1)
          .describe('Store URL or hostname to check, e.g. https://example-store.com'),
      },
    },
    async ({ url }) => {
      try {
        const started = await startStoreCheck({ url }, env)
        const report = await waitForReport(started.report.id, env, started.report)

        if (isReportInProgress(report.status)) {
          return mcpTextResult(
            formatCompactMcpReport(report, {
              cached: started.cached,
              nextAction: IN_PROGRESS_NEXT_ACTION,
            }),
          )
        }

        return mcpTextResult(
          formatCompactMcpReport(report, {
            cached: started.cached,
          }),
        )
      } catch (error) {
        return mcpTextResult(describeError(error), true)
      }
    },
  )

  server.registerTool(
    'get_report',
    {
      description:
        'Fetch an existing IsSafe.store check by report id. Use after check_store when the report is still in progress.',
      inputSchema: {
        id: z.string().min(1).describe('Report id returned by check_store'),
      },
    },
    async ({ id }) => {
      try {
        const result = await getStoreCheck(id, env)

        if (!result) {
          return mcpTextResult(`Check not found for id: ${id}`, true)
        }

        if (isReportInProgress(result.report.status)) {
          return mcpTextResult(
            formatCompactMcpReport(result.report, {
              cached: result.cached,
              nextAction: IN_PROGRESS_NEXT_ACTION,
            }),
          )
        }

        return mcpTextResult(
          formatCompactMcpReport(result.report, {
            cached: result.cached,
          }),
        )
      } catch (error) {
        return mcpTextResult(describeError(error), true)
      }
    },
  )

  return server
}

async function waitForReport(
  id: string,
  env: Env,
  initial: Awaited<ReturnType<typeof startStoreCheck>>['report'],
) {
  let report = initial

  if (!isReportInProgress(report.status)) {
    return report
  }

  for (let attempt = 0; attempt < CHECK_POLL_ATTEMPTS; attempt += 1) {
    await sleep(CHECK_POLL_INTERVAL_MS)
    const latest = await getStoreCheck(id, env)

    if (!latest) {
      return report
    }

    report = latest.report

    if (!isReportInProgress(report.status)) {
      return report
    }
  }

  return report
}

function describeError(error: unknown) {
  if (error instanceof UrlValidationError || error instanceof UsageLimitError) {
    return error.message
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'Store safety check failed.'
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
