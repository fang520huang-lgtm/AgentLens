import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareRuns } from './compare.js';
import { redactSession } from './redact.js';

const here = dirname(fileURLToPath(import.meta.url));
const view = join(here, 'compare-view');

export function renderComparisonHtml(a, b, { mode = 'redacted' } = {}) {
  if (!['redacted', 'raw'].includes(mode)) throw new Error(`Unsupported comparison mode: ${mode}`);
  const left = mode === 'redacted' ? redactSession(a) : { ...a, redaction: { mode: 'raw' } };
  const right = mode === 'redacted' ? redactSession(b) : { ...b, redaction: { mode: 'raw' } };
  const payload = { a: left, b: right, report: compareRuns(left, right) };
  const data = JSON.stringify(payload).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  const shareHtml = mode === 'raw' ? Buffer.from(renderComparisonHtml(a, b), 'utf8').toString('base64') : '';
  return readFileSync(join(view, 'index.html'), 'utf8')
    .replace('/*__STYLE__*/', readFileSync(join(view, 'style.css'), 'utf8'))
    .replace('/*__APP__*/', readFileSync(join(view, 'app.js'), 'utf8'))
    .replace('/*__DATA__*/', data)
    .replace('/*__SHARE_HTML__*/', shareHtml);
}

export function writeComparisonHtml(a, b, path, options = {}) {
  writeFileSync(path, renderComparisonHtml(a, b, options), 'utf8');
}
