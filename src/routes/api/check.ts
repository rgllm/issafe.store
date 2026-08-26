import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { errorResponse, jsonResponse } from '../../lib/http'
import { startStoreCheck } from '../../lib/checks'
import { UsageLimitError } from '../../lib/usage-limits'
import { UrlValidationError } from '../../lib/url'

type CheckBody = {
  url?: string
}

export const Route = createFileRoute('/api/check')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rateLimit = await env.CHECK_RATE_LIMIT.limit({
          key: request.headers.get('cf-connecting-ip') ?? 'anonymous',
        })

        if (!rateLimit.success) {
          return errorResponse('Too many checks. Try again in a minute.', 429)
        }

        const body = (await request.json().catch(() => null)) as CheckBody | null

        if (!body?.url) {
          return errorResponse('Enter a store URL.')
        }

        try {
          const result = await startStoreCheck({ url: body.url }, env)

          return jsonResponse(result)
        } catch (error) {
          if (error instanceof UrlValidationError) {
            return errorResponse(error.message)
          }

          if (error instanceof UsageLimitError) {
            return errorResponse(error.message, 429)
          }

          throw error
        }
      },
    },
  },
})
