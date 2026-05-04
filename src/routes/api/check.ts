import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { errorResponse, jsonResponse } from '../../lib/http'
import { startStoreCheck } from '../../lib/checks'
import { UrlValidationError } from '../../lib/url'
import { verifyTurnstileToken } from '../../lib/turnstile'

type CheckBody = {
  url?: string
  turnstileToken?: string
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

        const turnstile = await verifyTurnstileToken(body.turnstileToken, env)

        if (!turnstile.success) {
          return errorResponse('Human verification failed. Refresh and try again.', 403)
        }

        try {
          const result = await startStoreCheck({ url: body.url }, env)

          return jsonResponse({
            ...result,
            turnstileSkipped: turnstile.skipped,
          })
        } catch (error) {
          if (error instanceof UrlValidationError) {
            return errorResponse(error.message)
          }

          throw error
        }
      },
    },
  },
})
