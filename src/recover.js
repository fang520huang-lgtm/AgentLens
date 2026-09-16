import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { analyze } from './analyze.js';
import { writeHtml } from './render.js';

export function readRecordedEvents(path) {
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const events = [];
  let malformedLines = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line);
      const event = value.event ?? value;
      if (!event || typeof event.type !== 'string') { malformedLines++; continue; }
      events.push({ at: value.at ?? event.timestamp ?? new Date(0).toISOString(), event });
    } catch { malformedLines++; }
  }
  return { events, malformedLines };
}

export function recoverRun(input) {
  const output = resolve(input);
  const rawPath = join(output, 'events.jsonl');
  if (!existsSync(rawPath)) throw new Error(`Event stream not found: ${rawPath}`);
  const metaPath = join(output, 'meta.json');
  const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
  const { events, malformedLines } = readRecordedEvents(rawPath);
  if (!events.length) throw new Error('No valid Codex events were found in this recording.');
  const endedAt = events.at(-1).at;
  const session = analyze(events, [], {
    ...meta,
    id: meta.id ?? basename(output),
    startedAt: meta.startedAt ?? events[0].at,
    endedAt,
    outcome: 'recovered',
    exitCode: meta.exitCode ?? null,
    captureCoverage: { status: 'unavailable', before: meta.captureCoverage?.before ?? null, after: null },
    recovery: { malformedLines, note: 'Rebuilt from events.jsonl. Workspace patch unavailable without a completed after snapshot.' }
  });
  const jsonPath = join(output, 'session.json');
  const htmlPath = join(output, 'index.html');
  writeFileSync(jsonPath, JSON.stringify(session, null, 2) + '\n');
  writeHtml(session, htmlPath);
  return { session, jsonPath, htmlPath };
}
