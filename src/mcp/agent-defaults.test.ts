import { describe, expect, test } from 'bun:test';
import { AGENT_MCP_DEFAULTS, getAgentMcps } from './agent-defaults';

describe('AGENT_MCP_DEFAULTS', () => {
  test('thread has grep_app', () => {
    expect(AGENT_MCP_DEFAULTS.thread).toEqual(['grep_app']);
  });

  test('spindle has context7 and grep_app', () => {
    expect(AGENT_MCP_DEFAULTS.spindle).toEqual(['context7', 'grep_app']);
  });

  test('weft has websearch', () => {
    expect(AGENT_MCP_DEFAULTS.weft).toEqual(['websearch']);
  });

  test('warp has websearch and grep_app', () => {
    expect(AGENT_MCP_DEFAULTS.warp).toEqual(['websearch', 'grep_app']);
  });

  test('loom has all MCPs', () => {
    expect(AGENT_MCP_DEFAULTS.loom).toContain('websearch');
    expect(AGENT_MCP_DEFAULTS.loom).toContain('context7');
    expect(AGENT_MCP_DEFAULTS.loom).toContain('grep_app');
  });

  test('tapestry has all MCPs', () => {
    expect(AGENT_MCP_DEFAULTS.tapestry).toContain('websearch');
    expect(AGENT_MCP_DEFAULTS.tapestry).toContain('context7');
    expect(AGENT_MCP_DEFAULTS.tapestry).toContain('grep_app');
  });

  test('shuttle has grep_app', () => {
    expect(AGENT_MCP_DEFAULTS.shuttle).toEqual(['grep_app']);
  });

  test('default is websearch', () => {
    expect(AGENT_MCP_DEFAULTS.default).toEqual(['websearch']);
  });
});

describe('getAgentMcps', () => {
  test('returns user config when provided', () => {
    const userConfig = ['context7'];
    expect(getAgentMcps('thread', userConfig)).toEqual(['context7']);
  });

  test('returns user config even if empty array', () => {
    const userConfig: string[] = [];
    expect(getAgentMcps('thread', userConfig)).toEqual([]);
  });

  test('returns defaults when no user config', () => {
    expect(getAgentMcps('thread', undefined)).toEqual(['grep_app']);
    expect(getAgentMcps('spindle', undefined)).toEqual([
      'context7',
      'grep_app',
    ]);
  });

  test('falls back to default for unknown agents', () => {
    expect(getAgentMcps('unknown_agent', undefined)).toEqual(['websearch']);
  });

  test('user config overrides defaults', () => {
    const userConfig = ['websearch', 'context7'];
    expect(getAgentMcps('thread', userConfig)).toEqual([
      'websearch',
      'context7',
    ]);
  });
});
