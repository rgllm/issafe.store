import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { getStoreCheck } from '../../lib/checks'
import { errorResponse, jsonResponse } from '../../lib/http'

export const Route = createFileRoute('/api/check/$id')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const result = await getStoreCheck(params.id, env)

        if (!result) {
          return errorResponse('Check not found.', 404)
        }

        return jsonResponse(result)
      },
    },
  },
})
