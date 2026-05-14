/* @vitest-environment jsdom */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportView } from './ReportView'
import type { StoreSafetyReport } from '../types/report'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...props }: any) => <a {...props}>{children}</a>,
}))

afterEach(() => {
  cleanup()
})

const baseReport: StoreSafetyReport = {
  id: 'report-1',
  inputUrl: 'https://example.com',
  normalizedUrl: 'https://example.com',
  hostname: 'example.com',
  status: 'complete',
  score: 82,
  confidence: 90,
  recommendation: 'safe',
  summary: 'Looks fine.',
  evidence: [],
  coupons: [],
  createdAt: '2026-05-14T18:00:00.000Z',
  expiresAt: '2026-05-21T18:00:00.000Z',
}

describe('ReportView coupon sidebar', () => {
  it('shows only coupon codes and omits coupons without a code', () => {
    render(
      <ReportView
        cached={false}
        report={{
          ...baseReport,
          coupons: [
            {
              title: 'Example.com coupon code',
              description: 'Use code SAVE20 for 20% off.',
              code: 'SAVE20',
              source: 'deals.example',
              observedAt: '2026-05-14T18:00:00.000Z',
            },
            {
              title: 'No code discount offer',
              description: 'Current discount offers are available for example.com shoppers.',
              source: 'offers.example',
              observedAt: '2026-05-14T18:00:00.000Z',
            },
          ],
        }}
      />,
    )

    expect(screen.getByText('Coupons')).toBeTruthy()
    expect(screen.getByText('SAVE20')).toBeTruthy()
    expect(screen.queryByText('Example.com coupon code')).toBeNull()
    expect(
      screen.queryByText('Current discount offers are available for example.com shoppers.'),
    ).toBeNull()
    expect(screen.queryByText('No code discount offer')).toBeNull()
  })

  it('hides the coupons section when no coupon has an extracted code', () => {
    render(
      <ReportView
        cached={false}
        report={{
          ...baseReport,
          coupons: [
            {
              title: 'No code discount offer',
              description: 'Current discount offers are available for example.com shoppers.',
              source: 'offers.example',
              observedAt: '2026-05-14T18:00:00.000Z',
            },
          ],
        }}
      />,
    )

    expect(screen.queryByText('Coupons')).toBeNull()
    expect(screen.queryByText('No code discount offer')).toBeNull()
  })
})
