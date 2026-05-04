import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { jsonResponse } from '../../lib/http'

export const Route = createFileRoute('/api/config')({
  server: {
    handlers: {
      GET: async () =>
        jsonResponse({
          turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
        }),
    },
  },
})
