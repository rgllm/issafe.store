import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyTurnstileToken } from './turnstile'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('verifyTurnstileToken', () => {
  it('skips verification when local config is missing and Turnstile is not required', async () => {
    await expect(
      verifyTurnstileToken(undefined, {} as Env),
    ).resolves.toEqual({
      success: true,
      skipped: true,
    })
  })

  it('fails closed when Turnstile is required but config is missing', async () => {
    await expect(
      verifyTurnstileToken(undefined, {} as Env, { required: true }),
    ).resolves.toEqual({
      success: false,
      skipped: false,
      configurationError: true,
    })
  })

  it('validates configured tokens through Cloudflare Siteverify', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        headers: { 'content-type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      verifyTurnstileToken('token-1', {
        TURNSTILE_SECRET_KEY: 'secret-1',
        TURNSTILE_SITE_KEY: 'site-1',
      } as unknown as Env),
    ).resolves.toEqual({
      success: true,
      skipped: false,
      configurationError: false,
    })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://challenges.cloudflare.com/turnstile/v0/siteverify',
      expect.objectContaining({
        method: 'POST',
      }),
    )
  })
})
