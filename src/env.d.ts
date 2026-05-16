/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UMAMI_WEBSITE_ID?: string
  readonly VITE_UMAMI_REPLAY_SAMPLE_RATE?: string
}

type UmamiTracker = {
  track: (
    eventName: string,
    data?: Record<string, string | number | boolean>,
  ) => void
}

interface Window {
  umami?: UmamiTracker
}

declare namespace Cloudflare {
  interface Env {
    CLOUDFLARE_ACCOUNT_ID?: string
    CLOUDFLARE_URL_SCANNER_API_TOKEN?: string
    CLOUDFLARE_URL_SCANNER_VISIBILITY?: string
    GOOGLE_WEB_RISK_API_KEY?: string
    MAX_AI_CALLS_PER_DAY?: string
    MAX_CHECKS_PER_DAY?: string
    MAX_DOMAIN_CHECKS_PER_DAY?: string
    MAX_TAVILY_CALLS_PER_DAY?: string
    MAX_URL_SCANNER_SUBMISSIONS_PER_DAY?: string
    TAVILY_API_KEY?: string
    URLHAUS_AUTH_KEY?: string
    TURNSTILE_SECRET_KEY?: string
    TURNSTILE_REQUIRED?: string
  }
}
