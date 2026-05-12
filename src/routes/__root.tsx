import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";
import Footer from "../components/Footer";
import Header from "../components/Header";
import {
  UMAMI_REPLAY_SAMPLE_RATE,
  UMAMI_WEBSITE_ID,
} from "../lib/umami";

import appCss from "../styles.css?url";

const THEME_INIT_SCRIPT = `(function(){try{var stored=window.localStorage.getItem('theme');var mode=(stored==='light'||stored==='dark'||stored==='auto')?stored:'auto';var prefersDark=window.matchMedia('(prefers-color-scheme: dark)').matches;var resolved=mode==='auto'?(prefersDark?'dark':'light'):mode;var root=document.documentElement;root.classList.remove('light','dark');root.classList.add(resolved);if(mode==='auto'){root.removeAttribute('data-theme')}else{root.setAttribute('data-theme',mode)}root.style.colorScheme=resolved;}catch(e){}})();`;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "Is Safe Store | Check store risk before you buy",
      },
      {
        name: "description",
        content:
          "Check whether an online store looks safe before checkout. Paste a store URL to get a risk score, confidence rating, recommendation, and cited public evidence.",
      },
      {
        name: "keywords",
        content:
          "store safety checker, scam store checker, online shopping safety, ecommerce risk score, fraud check",
      },
      {
        name: "author",
        content: "rgllm",
      },
      {
        name: "robots",
        content: "index, follow",
      },
      {
        name: "theme-color",
        content: "#289e62",
      },
      {
        property: "og:type",
        content: "website",
      },
      {
        property: "og:title",
        content: "Is Safe Store | Check store risk before you buy",
      },
      {
        property: "og:description",
        content:
          "Paste any store URL to get a public-signal risk score, confidence rating, recommendation, and cited evidence.",
      },
      {
        property: "og:image",
        content: "/logo512.png",
      },
      {
        property: "og:site_name",
        content: "Is Safe Store",
      },
      {
        name: "twitter:card",
        content: "summary",
      },
      {
        name: "twitter:title",
        content: "Is Safe Store | Check store risk before you buy",
      },
      {
        name: "twitter:description",
        content:
          "Paste any store URL to get a public-signal risk score, confidence rating, recommendation, and cited evidence.",
      },
      {
        name: "twitter:image",
        content: "/logo512.png",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/logo.svg",
      },
      {
        rel: "apple-touch-icon",
        href: "/logo192.png",
      },
      {
        rel: "manifest",
        href: "/manifest.json",
      },
      {
        rel: "canonical",
        href: "https://issafe.store/",
      },
    ],
    scripts: import.meta.env.PROD
      ? [
          {
            defer: true,
            src: "https://cloud.umami.is/script.js",
            "data-website-id": UMAMI_WEBSITE_ID,
            "data-performance": "true",
          },
          {
            defer: true,
            src: "https://cloud.umami.is/recorder.js",
            "data-website-id": UMAMI_WEBSITE_ID,
            "data-sample-rate": UMAMI_REPLAY_SAMPLE_RATE,
            "data-mask-level": "moderate",
            "data-max-duration": "300000",
          },
        ]
      : [],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="font-sans antialiased [overflow-wrap:anywhere] selection:bg-[rgba(94,106,210,0.22)]">
        <Header />
        {children}
        <Footer />
        {import.meta.env.DEV ? (
          <TanStackDevtools
            config={{
              position: "bottom-right",
            }}
            plugins={[
              {
                name: "Tanstack Router",
                render: <TanStackRouterDevtoolsPanel />,
              },
            ]}
          />
        ) : null}
        <Scripts />
      </body>
    </html>
  );
}
