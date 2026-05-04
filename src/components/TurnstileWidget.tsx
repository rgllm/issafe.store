import { useEffect, useRef } from 'react'

type TurnstileApi = {
  render: (
    element: HTMLElement,
    options: {
      sitekey: string
      callback: (token: string) => void
      'expired-callback': () => void
      'error-callback': () => void
    },
  ) => string
  remove: (widgetId: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export function TurnstileWidget({
  siteKey,
  onTokenChange,
}: {
  siteKey: string | null
  onTokenChange: (token: string | undefined) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const tokenChangeRef = useRef(onTokenChange)

  useEffect(() => {
    tokenChangeRef.current = onTokenChange
  }, [onTokenChange])

  useEffect(() => {
    if (!siteKey || !containerRef.current) {
      tokenChangeRef.current(undefined)
      return
    }

    let widgetId: string | undefined
    let cancelled = false
    const activeSiteKey = siteKey
    let existingScript: HTMLScriptElement | null = null

    function renderWidget() {
      if (!window.turnstile || !containerRef.current || cancelled) {
        return
      }

      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: activeSiteKey,
        callback: (token) => tokenChangeRef.current(token),
        'expired-callback': () => tokenChangeRef.current(undefined),
        'error-callback': () => tokenChangeRef.current(undefined),
      })
    }

    existingScript = document.querySelector<HTMLScriptElement>(
      'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"]',
    )

    if (window.turnstile) {
      renderWidget()
    } else if (existingScript) {
      existingScript.addEventListener('load', renderWidget, { once: true })
    } else {
      const script = document.createElement('script')
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.addEventListener('load', renderWidget, { once: true })
      document.head.appendChild(script)
    }

    return () => {
      cancelled = true
      if (widgetId && window.turnstile) {
        window.turnstile.remove(widgetId)
      }
      if (existingScript) {
        existingScript.removeEventListener('load', renderWidget)
      }
    }
  }, [siteKey])

  if (!siteKey) {
    return null
  }

  return <div ref={containerRef} className="turnstile-box mt-3 min-h-16" />
}
