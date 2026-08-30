import { createFileRoute } from '@tanstack/react-router'

const SITE_URL = 'https://issafe.store'
const ABOUT_TITLE = 'About IsSafe.store | Public store safety checks'
const ABOUT_DESCRIPTION =
  'Learn how IsSafe.store checks any online store using public reputation evidence, domain metadata, technical signals, and AI-assisted risk synthesis.'

export const Route = createFileRoute('/about')({
  head: () => ({
    meta: [
      {
        title: ABOUT_TITLE,
      },
      {
        name: 'description',
        content: ABOUT_DESCRIPTION,
      },
      {
        name: 'robots',
        content: 'index, follow',
      },
      {
        property: 'og:type',
        content: 'website',
      },
      {
        property: 'og:title',
        content: ABOUT_TITLE,
      },
      {
        property: 'og:description',
        content: ABOUT_DESCRIPTION,
      },
      {
        property: 'og:url',
        content: `${SITE_URL}/about`,
      },
      {
        property: 'og:image',
        content: `${SITE_URL}/og.png`,
      },
      {
        property: 'og:image:width',
        content: '1200',
      },
      {
        property: 'og:image:height',
        content: '630',
      },
      {
        name: 'twitter:card',
        content: 'summary_large_image',
      },
      {
        name: 'twitter:title',
        content: ABOUT_TITLE,
      },
      {
        name: 'twitter:description',
        content: ABOUT_DESCRIPTION,
      },
      {
        name: 'twitter:image',
        content: `${SITE_URL}/og.png`,
      },
      {
        'script:ld+json': {
          '@context': 'https://schema.org',
          '@type': 'AboutPage',
          name: 'About IsSafe.store',
          url: `${SITE_URL}/about`,
          description: ABOUT_DESCRIPTION,
          isPartOf: {
            '@type': 'WebSite',
            name: 'IsSafe.store',
            url: `${SITE_URL}/`,
          },
        },
      },
    ],
    links: [
      {
        rel: 'canonical',
        href: `${SITE_URL}/about`,
      },
    ],
  }),
  component: About,
})

function About() {
  return (
    <main className="page-wrap px-4 py-12">
      <section className="island-shell rounded-2xl p-6 sm:p-8">
        <p className="island-kicker mb-2">About IsSafe.store</p>
        <h1 className="display-title mb-3 text-4xl font-semibold text-[var(--sea-ink)] sm:text-5xl">
          Use public signals to shop with more confidence.
        </h1>
        <p className="m-0 max-w-3xl text-base leading-8 text-[var(--sea-ink-soft)]">
          IsSafe.store analyzes any store URL using visible site signals, public
          reputation evidence, and domain metadata. The result is a practical
          risk assessment based on public information — not a guarantee of
          purchase safety.
        </p>
      </section>

      <section className="mt-6 grid gap-4 md:grid-cols-3">
        <article className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="m-0 text-base font-semibold text-[var(--sea-ink)]">
            Public evidence first
          </h2>
          <p className="m-0 mt-2 text-sm leading-6 text-[var(--sea-ink-soft)]">
            Every report focuses on signals you can verify yourself — reachable
            pages, policy coverage, contact clues, domain registration data,
            public reviews, and fraud database indicators.
          </p>
        </article>

        <article className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="m-0 text-base font-semibold text-[var(--sea-ink)]">
            Risk, not certainty
          </h2>
          <p className="m-0 mt-2 text-sm leading-6 text-[var(--sea-ink-soft)]">
            A clean report doesn't guarantee a safe purchase — but it helps you
            spot obvious warning signs before checkout so you can decide whether
            a store deserves a closer look.
          </p>
        </article>

        <article className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-5">
          <h2 className="m-0 text-base font-semibold text-[var(--sea-ink)]">
            Built for quick checks
          </h2>
          <p className="m-0 mt-2 text-sm leading-6 text-[var(--sea-ink-soft)]">
            Paste a URL, review the score and cited evidence, then lean on
            normal buyer protections — credit card chargebacks, refund policies,
            and independent review checks.
          </p>
        </article>
      </section>
    </main>
  )
}
