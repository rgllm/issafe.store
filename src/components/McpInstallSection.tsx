import { Check, Copy, Terminal } from 'lucide-react'
import { useState } from 'react'

const MCP_ENDPOINT = 'https://issafe.store/mcp'
const CURSOR_CONFIG = `{
  "mcpServers": {
    "issafe-store": {
      "url": "${MCP_ENDPOINT}"
    }
  }
}`
const CLAUDE_DESKTOP_CONFIG = `{
  "mcpServers": {
    "issafe-store": {
      "command": "npx",
      "args": ["mcp-remote", "${MCP_ENDPOINT}"]
    }
  }
}`
const CLAUDE_CODE_COMMAND =
  'claude mcp add --transport http issafe-store https://issafe.store/mcp'
const CURSOR_INSTALL_LINK =
  'cursor://anysphere.cursor-deeplink/mcp/install?name=issafe-store&config=eyJ1cmwiOiJodHRwczovL2lzc2FmZS5zdG9yZS9tY3AifQ=='

export function McpInstallSection() {
  return (
    <section id="mcp" className="px-6 py-16">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <div className="text-center">
          <h2 className="m-0 text-balance text-2xl font-semibold text-foreground">
            Use IsSafe.store from your AI client
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-pretty text-base leading-7 text-muted-foreground">
            Connect the public MCP endpoint so Cursor, Claude, or other agents
            can check a store URL and read the compact risk report.
          </p>
        </div>

        <div className="flex flex-col gap-4">
          <CopyBlock
            label="MCP endpoint"
            value={MCP_ENDPOINT}
            language="text"
          />

          <div className="flex flex-wrap items-center gap-3">
            <a
              href={CURSOR_INSTALL_LINK}
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-semibold text-primary-foreground no-underline transition-colors hover:bg-primary/90"
            >
              Add to Cursor
            </a>
            <p className="m-0 text-sm text-muted-foreground">
              Or paste one of the configs below.
            </p>
          </div>

          <CopyBlock label="Cursor" value={CURSOR_CONFIG} language="json" />
          <CopyBlock
            label="Claude Desktop"
            value={CLAUDE_DESKTOP_CONFIG}
            language="json"
          />
          <CopyBlock
            label="Claude Code"
            value={CLAUDE_CODE_COMMAND}
            language="bash"
          />
        </div>

        <div className="rounded-md border border-border bg-muted/50 px-5 py-3.5 text-pretty text-sm leading-6 text-muted-foreground">
          <span className="font-semibold text-foreground">Note:</span> The MCP
          tools share the same public-signal checks and daily limits as the
          website. Results are a risk assessment, not a purchase guarantee.
        </div>
      </div>
    </section>
  )
}

function CopyBlock({
  label,
  value,
  language,
}: {
  label: string
  value: string
  language: string
}) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else {
        copyWithTextarea(value)
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      try {
        copyWithTextarea(value)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      } catch {
        setCopied(false)
      }
    }
  }

  return (
    <div className="overflow-hidden rounded-md border border-border bg-white dark:bg-card">
      <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Terminal className="size-3.5 text-primary" aria-hidden="true" />
          {label}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? (
            <Check className="size-3.5 text-primary" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="m-0 overflow-x-auto bg-muted/30 p-4 text-left text-xs leading-6 text-foreground">
        <code className={`language-${language}`}>{value}</code>
      </pre>
    </div>
  )
}

function copyWithTextarea(value: string) {
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}
