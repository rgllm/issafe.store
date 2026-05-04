import handler from '@tanstack/react-start/server-entry'
import { routeAgentRequest } from 'agents'
import { StoreSafetyAgent } from './agents/store-safety-agent'

export { StoreSafetyAgent }

export default {
  async fetch(request: Request, env: Env) {
    const agentResponse = await routeAgentRequest(request, env)

    if (agentResponse) {
      return agentResponse
    }

    return handler.fetch(request)
  },
}
