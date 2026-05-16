type TurnstileResponse = {
  success: boolean
  'error-codes'?: string[]
}

type TurnstileVerificationOptions = {
  required?: boolean
}

export async function verifyTurnstileToken(
  token: string | undefined,
  env: Env,
  options: TurnstileVerificationOptions = {},
) {
  if (!env.TURNSTILE_SITE_KEY || !env.TURNSTILE_SECRET_KEY) {
    if (options.required) {
      return { success: false, skipped: false, configurationError: true }
    }

    return { success: true, skipped: true }
  }

  if (!token) {
    return { success: false, skipped: false, configurationError: false }
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
    configurationError: false,
  }
}
