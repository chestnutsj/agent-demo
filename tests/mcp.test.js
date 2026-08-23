// The MCP transport, end to end: spawn the server, speak the protocol.
//
// Asserts the model-facing surface — the tool list is what a session actually
// gets — rather than re-testing the core through a second door.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const SERVER = new URL('../lib/mcp/server.js', import.meta.url).pathname

let client

before(async () => {
  client = new Client({ name: 'dba-agent-tests', version: '0' })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [SERVER],
    // A closed port, so the call takes the relay path deterministically.
    env: { ...process.env, MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '1' },
  }))
})

after(async () => { await client?.close() })

test('exposes exactly one tool', async () => {
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map(t => t.name), ['sql_evidence'])
  assert.deepEqual(tools[0].inputSchema.required, ['sql'])
})

test('renders OFFLINE as a successful relay block', async () => {
  const result = await client.callTool({ name: 'sql_evidence', arguments: { sql: 'SELECT * FROM orders' } })

  // Not an error: the caller is being handed work to do. Rendering it as an
  // error teaches the model to retry or to guess, and both are worse.
  assert.notEqual(result.isError, true)
  assert.match(result.content[0].text, /^DBA_OFFLINE: /)
})

test('refuses to time a DML statement', async () => {
  const result = await client.callTool({
    name: 'sql_evidence',
    arguments: { sql: 'DELETE FROM orders', analyze: true },
  })

  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /只对 SELECT 开放/)
})
