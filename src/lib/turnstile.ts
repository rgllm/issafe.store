type TurnstileResponse = {
  success: boolean
  'error-codes'?: string[]
}

export async function verifyTurnstileToken(token: string | undefined, env: Env) {
  if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY) {
    return { success: true, skipped: true }
  }

  if (!token) {
    return { success: false, skipped: false }
  }

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      secret: env.TURNSTILE_SECRET_KEY,
      response: token,
    }),
  })
  const result = (await response.json()) as TurnstileResponse

  return {
    success: result.success,
    skipped: false,
  }
}
