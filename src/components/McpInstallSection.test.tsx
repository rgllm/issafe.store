/* @vitest-environment jsdom */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { McpInstallSection } from './McpInstallSection'

describe('McpInstallSection', () => {
  it('renders the MCP install endpoint and client configs', () => {
    const { getByRole, getByText, container } = render(<McpInstallSection />)

    expect(
      getByRole('heading', { name: 'Use IsSafe.store from your AI client' }),
    ).toBeTruthy()
    expect(getByText('https://issafe.store/mcp')).toBeTruthy()
    expect(getByRole('link', { name: 'Add to Cursor' })).toHaveProperty(
      'href',
      'cursor://anysphere.cursor-deeplink/mcp/install?name=issafe-store&config=eyJ1cmwiOiJodHRwczovL2lzc2FmZS5zdG9yZS9tY3AifQ==',
    )
    expect(container.textContent).toContain('"issafe-store"')
    expect(container.textContent).toContain('mcp-remote')
    expect(container.textContent).toContain(
      'claude mcp add --transport http issafe-store https://issafe.store/mcp',
    )
    expect(container.querySelector('#mcp')).toBeTruthy()
  })
})
