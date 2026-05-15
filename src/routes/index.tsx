import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  Bot,
  Clock,
  DatabaseZap,
  Globe,
  Loader2,
  ShieldAlert,
  Star,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BrandLogo } from "../components/BrandLogo";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { trackStoreEvent } from "../lib/umami";
import type { StoreSafetyReport } from "../types/report";

const SITE_URL = "https://issafe.store";
const HOME_TITLE = "Is Safe Store | Scam store checker before you buy";
const HOME_DESCRIPTION =
  "Check whether an online store looks safe before checkout. Paste a store URL to get a risk score, confidence rating, recommendation, and cited public evidence.";

type CheckResponse = {
  report: StoreSafetyReport;
  cached: boolean;
  turnstileSkipped?: boolean;
};

type ConfigResponse = {
  turnstileSiteKey: string | null;
};

const SIGNALS = [
  {
    icon: Clock,
    title: "Domain Age & History",
    description:
      "We check when the domain was registered and whether ownership has changed hands. Newly registered domains or those with a history of transfers are a common indicator of disposable scam stores.",
  },
  {
    icon: Globe,
    title: "RDAP Registration Data",
    description:
      "Public RDAP records reveal when a domain was registered and whether the registry reports an active registration. Very new domains can be a warning sign for disposable scam stores.",
  },
  {
    icon: Star,
    title: "Review Platform Signals",
    description:
      "We aggregate public complaint and review data from Trustpilot, Better Business Bureau, ScamAdviser, Reddit, and similar platforms to surface patterns of non-delivery, fraud, or disputes.",
  },
  {
    icon: ShieldAlert,
    title: "Blocklist & Fraud Databases",
    description:
      "We cross-reference the store URL and domain against publicly maintained fraud blocklists, phishing databases, and community-reported scam registries.",
  },
  {
    icon: DatabaseZap,
    title: "SSL & Technical Signals",
    description:
      "We verify the presence, validity, and issuing authority of the store's SSL certificate. Self-signed or recently-issued certificates on new domains elevate risk.",
  },
  {
    icon: Bot,
    title: "AI-Powered Synthesis",
    description:
      "All collected signals are passed to an AI model that weighs evidence, resolves conflicts between sources, and generates a calibrated risk score, confidence rating, and plain-language recommendation.",
  },
];

const FAQS = [
  {
    question: "Can IsSafe.store guarantee a store is safe?",
    answer:
      "No. IsSafe.store is a public-signal risk assessment. It can surface warning signs and reputation evidence, but it cannot guarantee merchant behavior, delivery, refunds, or payment safety.",
  },
  {
    question: "What signals does the store checker use?",
    answer:
      "The checker reviews public signals such as domain registration data, site accessibility, SSL status, policy and contact signals, public reputation results, and known fraud or phishing indicators.",
  },
  {
    question: "Do I need an account or purchase data?",
    answer:
      "No. You only paste a store URL. IsSafe.store does not require an account and does not use private purchase, payment, or order history.",
  },
];

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: HOME_TITLE,
      },
      {
        name: "description",
        content: HOME_DESCRIPTION,
      },
      {
        name: "keywords",
        content:
          "scam store checker, store safety checker, online store legit checker, online shopping safety, ecommerce risk score, fraud check",
      },
      {
        name: "robots",
        content: "index, follow",
      },
      {
        property: "og:type",
        content: "website",
      },
      {
        property: "og:title",
        content: HOME_TITLE,
      },
      {
        property: "og:description",
        content:
          "Paste any store URL to get a public-signal risk score, confidence rating, recommendation, and cited evidence.",
      },
      {
        property: "og:url",
        content: `${SITE_URL}/`,
      },
      {
        property: "og:image",
        content: `${SITE_URL}/logo512.png`,
      },
      {
        name: "twitter:card",
        content: "summary",
      },
      {
        name: "twitter:title",
        content: HOME_TITLE,
      },
      {
        name: "twitter:description",
        content:
          "Paste any store URL to get a public-signal risk score, confidence rating, recommendation, and cited evidence.",
      },
      {
        name: "twitter:image",
        content: `${SITE_URL}/logo512.png`,
      },
      {
        "script:ld+json": {
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "IsSafe.store",
          url: `${SITE_URL}/`,
          applicationCategory: "SecurityApplication",
          operatingSystem: "Web",
          description: HOME_DESCRIPTION,
          offers: {
            "@type": "Offer",
            price: "0",
            priceCurrency: "USD",
          },
          creator: {
            "@type": "Organization",
            name: "IsSafe.store",
            url: `${SITE_URL}/`,
          },
        },
      },
      {
        "script:ld+json": {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQS.map((faq) => ({
            "@type": "Question",
            name: faq.question,
            acceptedAnswer: {
              "@type": "Answer",
              text: faq.answer,
            },
          })),
        },
      },
    ],
    links: [
      {
        rel: "canonical",
        href: `${SITE_URL}/`,
      },
    ],
  }),
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | undefined>();
  const [turnstileSiteKey, setTurnstileSiteKey] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handleTurnstileTokenChange = useCallback(
    (token: string | undefined) => {
      setTurnstileToken(token);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    fetch("/api/config")
      .then((response) => response.json() as Promise<ConfigResponse>)
      .then((config) => {
        if (!cancelled) {
          setTurnstileSiteKey(config.turnstileSiteKey);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTurnstileSiteKey(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedUrl = url.trim();
    if (!normalizedUrl) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    let checkFailureTracked = false;

    try {
      const response = await fetch("/api/check", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          url: normalizedUrl,
          turnstileToken,
        }),
      });
      const body = (await response.json()) as CheckResponse | { error: string };

      if (!response.ok) {
        trackStoreEvent("check_failed", { reason: "check_rejected" });
        checkFailureTracked = true;
        throw new Error("error" in body ? body.error : "The check failed.");
      }

      const result = body as CheckResponse;
      await navigate({
        to: "/report/$id",
        params: { id: result.report.id },
      });
      trackStoreEvent("check_completed", { cached: result.cached });
    } catch (submitError) {
      if (!checkFailureTracked) {
        trackStoreEvent("check_failed", { reason: "client_error" });
      }
      setError(
        submitError instanceof Error
          ? submitError.message
          : "The check failed.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-[calc(100vh-49px)] flex-col bg-background font-sans">
      <section className="px-6 py-20">
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-8 text-center">
          <BrandLogo size="lg" />

          <div className="flex flex-col gap-2">
            <h1 className="m-0 text-balance text-3xl font-semibold text-foreground">
              Store Safety Risk Lookup
            </h1>
            <p className="m-0 max-w-lg text-pretty text-base leading-7 text-muted-foreground">
              Paste any store URL to get a risk score, confidence rating,
              recommendation, and cited public evidence.
            </p>
          </div>

          <div className="flex w-full flex-col items-stretch gap-6">
            <form
              onSubmit={handleSubmit}
              className="flex w-full flex-col items-stretch gap-3 sm:flex-row"
            >
              <label htmlFor="store-url" className="sr-only">
                Store URL to check
              </label>
              <input
                id="store-url"
                type="text"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="Enter a store URL, e.g. example-store.com"
                aria-label="Store URL to check"
                className="min-h-12 flex-1 rounded-md border border-border bg-white px-4 py-3 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 dark:bg-input"
                autoComplete="url"
                spellCheck={false}
              />
              <button
                type="submit"
                disabled={isSubmitting || !url.trim()}
                data-umami-event="check_store_submit"
                className="flex min-h-12 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? (
                  <Loader2
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                ) : null}
                {isSubmitting ? "Checking..." : "Check Store"}
              </button>
            </form>

            <TurnstileWidget
              siteKey={turnstileSiteKey}
              onTokenChange={handleTurnstileTokenChange}
            />

            {isSubmitting ? (
              <div className="flex flex-col gap-1 text-center">
                <p className="m-0 text-sm text-muted-foreground">
                  Starting checks for{" "}
                  <span className="font-medium text-foreground">
                    {url.trim()}
                  </span>
                  …
                </p>
                <p className="m-0 text-xs text-muted-foreground">
                  Opening your live report — hang tight.
                </p>
              </div>
            ) : null}

            {error ? (
              <p className="m-0 flex items-start gap-2 rounded-md border border-[var(--risk-line)] bg-[var(--risk-bg)] px-4 py-3 text-left text-sm font-medium text-[var(--signal-risk)]">
                <AlertTriangle
                  className="mt-0.5 size-4 flex-none"
                  aria-hidden="true"
                />
                {error}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <div className="border-t border-border" />

      <section id="how-we-check" className="px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col gap-10">
            <div className="text-center">
              <h2 className="m-0 text-balance text-2xl font-semibold text-foreground">
                How We Check a Store
              </h2>
              <p className="mx-auto mt-2 max-w-2xl text-pretty text-base leading-7 text-muted-foreground">
                This application combines structured public data sources with AI
                synthesis to produce a single, actionable risk assessment. No
                account required. No purchase data is used.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {SIGNALS.map((signal) => {
                const Icon = signal.icon;

                return (
                  <article
                    key={signal.title}
                    className="flex flex-col gap-3 rounded-md border border-border bg-white p-5 dark:bg-card"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/8">
                        <Icon
                          className="size-4 text-primary"
                          aria-hidden="true"
                        />
                      </div>
                      <h3 className="m-0 text-sm font-semibold text-foreground">
                        {signal.title}
                      </h3>
                    </div>
                    <p className="m-0 text-sm leading-relaxed text-muted-foreground">
                      {signal.description}
                    </p>
                  </article>
                );
              })}
            </div>

            <div className="rounded-md border border-border bg-muted/50 px-5 py-3.5 text-pretty text-sm leading-6 text-muted-foreground">
              <span className="font-semibold text-foreground">Note:</span> This
              application relies entirely on publicly available signals. We do
              not access private merchant data, payment records, or order
              history. Results represent a best-effort public-signal assessment
              and should not be the sole basis for any financial decision.
            </div>
          </div>
        </div>
      </section>

      <div className="border-t border-border" />

      <section id="faq" className="px-6 py-16">
        <div className="mx-auto flex max-w-3xl flex-col gap-8">
          <div className="text-center">
            <h2 className="m-0 text-balance text-2xl font-semibold text-foreground">
              Common Store Safety Questions
            </h2>
            <p className="mx-auto mt-2 max-w-2xl text-pretty text-base leading-7 text-muted-foreground">
              A quick check can reduce uncertainty, but it should sit alongside
              normal payment, refund, and merchant verification habits.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            {FAQS.map((faq) => (
              <article
                key={faq.question}
                className="rounded-md border border-border bg-white p-5 dark:bg-card"
              >
                <h3 className="m-0 text-base font-semibold text-foreground">
                  {faq.question}
                </h3>
                <p className="m-0 mt-2 text-sm leading-6 text-muted-foreground">
                  {faq.answer}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
