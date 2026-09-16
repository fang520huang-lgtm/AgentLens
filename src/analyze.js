import { readFileSync } from 'node:fs';

const AGENTLENS_VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const READ_COMMAND = /\b(?:cat|head|tail|sed|rg|grep|findstr|type|Get-Content|Select-String|less|more|git\s+show|ReadAllText|readFileSync|readFile)\b/i;
const FILE_NAME = /(?:\.[a-z\d]{1,12}|^(?:README|LICENSE|Dockerfile|Makefile|AGENTS\.md)$)/i;

export function inferViewedFiles(command = '') {
  const read = READ_COMMAND.exec(command);
  if (!read) return [];
  const tail = command.slice(read.index + read[0].length);
  const quoted = [...tail.matchAll(/['"]([^'"\r\n]+\.[A-Za-z0-9]{1,12})['"]/g)].map(match => match[1]);
  const unquoted = tail.match(/[\p{L}\p{N}_.\/\\-]+\.[A-Za-z0-9]{1,12}\b/gu) ?? [];
  const matches = [...quoted, ...unquoted.filter(token => !quoted.some(path => path.includes(token)))];
  return [...new Set(matches.map(token => token.replace(/^[.][\\/]/, '')).filter(token =>
    token.length < 220 && FILE_NAME.test(token) && !/\.(?:exe|dll|ps1|cmd|bat)$/i.test(token)
  ))];
}

function titleFor(item) {
  switch (item.type) {
    case 'command_execution': return 'Command executed';
    case 'file_change': return 'Code changed';
    case 'agent_message': return 'Agent response';
    case 'mcp_tool_call': return 'MCP tool call';
    case 'web_search': return 'Web search';
    case 'plan_update': return 'Plan updated';
    default: return item.type?.replaceAll('_', ' ') || 'Agent event';
  }
}

function kindFor(item) {
  if (item.type === 'command_execution') return 'command';
  if (item.type === 'file_change') return 'change';
  if (item.type === 'agent_message') return 'message';
  if (item.type === 'mcp_tool_call' || item.type === 'web_search') return 'tool';
  return 'other';
}

export function analyze(rawEvents, changes, meta = {}) {
  const items = new Map();
  const timeline = [];
  const viewed = new Set();
  let usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 };
  let threadId = null;
  for (const entry of rawEvents) {
    const { at, event } = entry;
    if (event.type === 'thread.started') threadId = event.thread_id ?? threadId;
    if (event.type === 'turn.completed' && event.usage) {
      for (const key of Object.keys(usage)) usage[key] += Number(event.usage[key] ?? 0);
    }
    if (event.type === 'error' || event.type === 'turn.failed') {
      timeline.push({ id: `error-${timeline.length}`, at, kind: 'error', title: 'Run error', detail: event.message ?? event.error?.message ?? 'Codex reported a failure.' });
    }
    if (!event.type?.startsWith('item.') || !event.item) continue;
    const item = event.item;
    const id = item.id ?? `${event.type}-${timeline.length}`;
    if (event.type === 'item.started' || event.type === 'item.updated') {
      const prior = items.get(id) ?? { at, item: {} };
      items.set(id, { at: prior.at, item: { ...prior.item, ...item } });
      continue;
    }
    if (event.type !== 'item.completed') continue;
    if (item.type === 'reasoning') continue;
    const prior = items.get(id);
    const merged = { ...prior?.item, ...item };
    const command = merged.command ?? '';
    const files = merged.type === 'command_execution' ? inferViewedFiles(command) :
      merged.type === 'file_change' ? (merged.changes ?? []).map(change => change.path).filter(Boolean) : [];
    if (merged.type === 'command_execution') files.forEach(file => viewed.add(file));
    timeline.push({
      id, at: prior?.at ?? at, kind: kindFor(merged), title: titleFor(merged),
      detail: merged.text ?? merged.query ?? merged.tool ?? merged.server ?? '',
      command, output: merged.aggregated_output ?? merged.output ?? '',
      exitCode: merged.exit_code, files,
      changes: merged.type === 'file_change' ? merged.changes ?? [] : [],
      status: merged.status ?? 'completed'
    });
    items.delete(id);
  }
  for (const [id, { at, item }] of items) {
    if (item.type === 'reasoning') continue;
    timeline.push({ id, at, kind: kindFor(item), title: titleFor(item), detail: 'Interrupted before completion', command: item.command ?? '', files: [], status: 'interrupted' });
  }
  timeline.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const durationMs = Math.max(0, Date.parse(meta.endedAt ?? '') - Date.parse(meta.startedAt ?? '')) || 0;
  return {
    schemaVersion: 1, agentlensVersion: AGENTLENS_VERSION, outcome: 'completed',
    model: null, codexVersion: null, gitCommit: null, dirtyBefore: null, dirtyAfter: null,
    sandbox: null, platform: { os: 'unknown', arch: 'unknown' },
    captureCoverage: { status: 'unavailable', before: null, after: null },
    ...meta, threadId, durationMs, usage,
    stats: {
      commands: timeline.filter(item => item.kind === 'command').length,
      filesViewed: viewed.size, filesChanged: changes.length,
      additions: changes.reduce((sum, item) => sum + item.additions, 0),
      deletions: changes.reduce((sum, item) => sum + item.deletions, 0)
    },
    viewedFiles: [...viewed].sort(), changes, timeline
  };
}
