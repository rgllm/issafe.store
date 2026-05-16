import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { getStoreCheck } from '../../lib/checks'
import { errorResponse, jsonResponse } from '../../lib/http'

export const Route = createFileRoute('/api/check/$id')({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const rateLimit = await env.POLL_RATE_LIMIT.limit({
          key: `${request.headers.get('cf-connecting-ip') ?? 'anonymous'}:${params.id}`,
        })

        if (!rateLimit.success) {
          return errorResponse('Too many report refreshes. Try again in a minute.', 429)
        }

        const result = await getStoreCheck(params.id, env)

        if (!result) {
          return errorResponse('Check not found.', 404)
        }

        return jsonResponse(result)
      },
    },
  },
})
