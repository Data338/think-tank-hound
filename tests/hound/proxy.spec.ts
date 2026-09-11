import { describe, it, expect, vi } from 'vitest';
import { registerHoundTools } from '../../src/hound/proxy.js';
import type { HoundClientLike } from '../../src/hound/client.js';
import { resolveHoundBin, smokeTestHound } from '../../src/hound/spawn.js';

function makeServer() {
  const tools: Record<string, any> = {};
  return {
    tools,
    server: { addTool: (t: any) => { tools[t.name] = t; } } as any,
  };
}

function okClient(onCall?: (name: string, args: any) => unknown): HoundClientLike {
  return {
    callTool: vi.fn(async (name: string, args: any) =>
      onCall ? onCall(name, args) : { content: [{ type: 'text', text: '{"ok":true}' }] }),
    close: vi.fn(async () => {}),
  };
}

describe('hound proxy', () => {
  it('registers hound_search and hound_fetch', () => {
    const { tools, server } = makeServer();
    registerHoundTools(server, okClient());
    expect(Object.keys(tools).sort()).toEqual(['hound_fetch', 'hound_search']);
  });

  it('maps search params to mcp_smart_search', async () => {
    const seen: any = {};
    const client = okClient((name, args) => {
      seen.name = name; seen.args = args;
      return { content: [{ type: 'text', text: '{"results":[]}' }] };
    });
    const { tools, server } = makeServer();
    registerHoundTools(server, client);
    const out = await tools.hound_search.execute(
      { query: 'vitest mock', focus: 'mock', site: 'example.com', freshness: 'month', max_results: 3 },
      {}
    );
    expect(seen.name).toBe('mcp_smart_search');
    expect(seen.args).toEqual({
      query: 'vitest mock',
      options: { max_results: 3, freshness: 'month', site: 'example.com' },
      focus: 'mock',
    });
    expect(JSON.parse(out)).toEqual({ results: [] });
  });

  it('maps fetch params to mcp_smart_fetch', async () => {
    const seen: any = {};
    const client = okClient((name, args) => {
      seen.name = name; seen.args = args;
      return { content: [{ type: 'text', text: 'page-body' }] };
    });
    const { tools, server } = makeServer();
    registerHoundTools(server, client);
    const out = await tools.hound_fetch.execute({ url: 'https://example.com', focus: 'pricing' }, {});
    expect(seen.name).toBe('mcp_smart_fetch');
    expect(seen.args).toEqual({ url: 'https://example.com', focus: 'pricing' });
    expect(out).toBe('page-body');
  });

  it('returns {error} envelope when the child fails', async () => {
    const client = okClient(() => { throw new Error('boom'); });
    const { tools, server } = makeServer();
    registerHoundTools(server, client);
    const out = await tools.hound_search.execute({ query: 'x' }, {});
    expect(JSON.parse(out).error).toMatch(/boom/);
  });
});

describe('hound spawn', () => {
  it('respects HOUND_BIN', () => {
    process.env.HOUND_BIN = '/tmp/fake-hound';
    expect(resolveHoundBin()).toBe('/tmp/fake-hound');
    delete process.env.HOUND_BIN;
  });

  it('smoke test passes against the isolated copy (skipped if absent)', () => {
    let bin: string;
    try {
      bin = resolveHoundBin();
    } catch {
      console.warn('hound binary absent, skipping smoke test');
      return;
    }
    // Never touch production assertions here — any working binary is fine.
    expect(smokeTestHound(bin)).toMatch(/v?\d/);
  });
});
