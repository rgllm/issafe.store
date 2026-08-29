import { describe, expect, it } from 'vitest'
import {
  MCP_DISCLAIMER,
  formatCompactMcpReport,
  getReportUrl,
  isReportInProgress,
  mcpTextResult,
} from './mcp-report'
import type { StoreSafetyReport } from '../types/report'

function createReport(
  overrides: Partial<StoreSafetyReport> = {},
): StoreSafetyReport {
  return {
    id: 'report-123',
    inputUrl: 'https://shop.example',
    normalizedUrl: 'https://shop.example/',
    hostname: 'shop.example',
    status: 'complete',
    score: 72,
    confidence: 61,
    recommendation: 'likely-safe',
    summary: 'Most public signals look ordinary.',
    evidence: [
      {
        sourceType: 'review',
        title: 'Neutral mention',
        snippet: 'A short note.',
        sentiment: 'neutral',
        weight: 1,
        observedAt: '2026-05-01T00:00:00.000Z',
      },
      {
        sourceType: 'search-result',
        title: 'Delivery complaints',
        url: 'https://example.com/complaints',
        snippet: 'Several shoppers reported late or missing packages from this storefront.',
        sentiment: 'negative',
        weight: 4,
        observedAt: '2026-05-02T00:00:00.000Z',
      },
      {
        sourceType: 'rdap',
        title: 'Domain age',
        snippet: 'Registered more than five years ago.',
        sentiment: 'positive',
        weight: 3,
        observedAt: '2026-05-03T00:00:00.000Z',
      },
      {
        sourceType: 'technical',
        title: 'HTTPS enabled',
        snippet: 'Valid certificate.',
        sentiment: 'positive',
        weight: 2,
        observedAt: '2026-05-04T00:00:00.000Z',
      },
      {
        sourceType: 'store-site',
        title: 'Contact page found',
        snippet: 'Store publishes a contact form.',
        sentiment: 'positive',
        weight: 1,
        observedAt: '2026-05-05T00:00:00.000Z',
      },
      {
        sourceType: 'search-result',
        title: 'Extra evidence beyond the cap',
        snippet: 'Should be omitted from compact payload.',
        sentiment: 'neutral',
        weight: 1,
        observedAt: '2026-05-06T00:00:00.000Z',
      },
    ],
    coupons: [],
    createdAt: '2026-05-10T00:00:00.000Z',
    expiresAt: '2026-05-17T00:00:00.000Z',
    ...overrides,
  }
}

describe('mcp-report', () => {
  it('formats a compact completed report with top evidence', () => {
    const payload = formatCompactMcpReport(createReport(), { cached: true })

    expect(payload).toMatchObject({
      id: 'report-123',
      hostname: 'shop.example',
      status: 'complete',
      score: 72,
      confidence: 61,
      recommendation: 'likely-safe',
      cached: true,
      reportUrl: 'https://issafe.store/report/report-123',
      disclaimer: MCP_DISCLAIMER,
    })
    expect(payload.evidence).toHaveLength(5)
    expect(payload.evidence[0]?.title).toBe('Delivery complaints')
    expect(payload.evidence.some((item) => item.title.includes('beyond the cap'))).toBe(
      false,
    )
    expect(payload).not.toHaveProperty('progressStep')
    expect(payload).not.toHaveProperty('nextAction')
  })

  it('marks in-progress reports and includes nextAction guidance', () => {
    const payload = formatCompactMcpReport(
      createReport({
        status: 'researching',
        progressStep: 2,
        score: 0,
        confidence: 0,
        recommendation: 'unknown',
        summary: 'Checking domain registration data.',
        evidence: [],
      }),
      {
        cached: false,
        nextAction: 'Call get_report with this id in a few seconds.',
      },
    )

    expect(isReportInProgress(payload.status)).toBe(true)
    expect(payload.progressStep).toBe(2)
    expect(payload.nextAction).toBe('Call get_report with this id in a few seconds.')
    expect(payload.evidence).toEqual([])
  })

  it('omits progressStep once the report is terminal', () => {
    const failed = formatCompactMcpReport(
      createReport({
        status: 'failed',
        progressStep: 3,
        recommendation: 'unknown',
        summary: 'Check failed.',
      }),
    )

    expect(failed).not.toHaveProperty('progressStep')
    expect(getReportUrl('abc')).toBe('https://issafe.store/report/abc')
  })

  it('truncates long evidence snippets', () => {
    const longSnippet = 'x'.repeat(300)
    const payload = formatCompactMcpReport(
      createReport({
        evidence: [
          {
            sourceType: 'review',
            title: 'Long snippet',
            snippet: longSnippet,
            sentiment: 'negative',
            weight: 5,
            observedAt: '2026-05-01T00:00:00.000Z',
          },
        ],
      }),
    )

    expect(payload.evidence[0]?.snippet.length).toBeLessThanOrEqual(220)
    expect(payload.evidence[0]?.snippet.endsWith('…')).toBe(true)
  })

  it('wraps payloads as MCP text content', () => {
    expect(mcpTextResult({ ok: true })).toEqual({
      content: [{ type: 'text', text: '{\n  "ok": true\n}' }],
    })
    expect(mcpTextResult('boom', true)).toEqual({
      content: [{ type: 'text', text: 'boom' }],
      isError: true,
    })
  })
})
