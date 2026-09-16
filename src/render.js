import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactSession } from './redact.js';

const here = dirname(fileURLToPath(import.meta.url));

export function renderHtml(session, { mode = 'raw' } = {}) {
  const html = readFileSync(join(here, 'view', 'index.html'), 'utf8');
  const css = readFileSync(join(here, 'view', 'style.css'), 'utf8');
  const js = readFileSync(join(here, 'view', 'app.js'), 'utf8');
  const payload = mode === 'redacted' ? redactSession(session) : { ...session, redaction: { mode: 'raw' } };
  const data = JSON.stringify(payload).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  const shareHtml = mode === 'raw' ? Buffer.from(renderHtml(session, { mode: 'redacted' }), 'utf8').toString('base64') : '';
  return html.replace('/*__STYLE__*/', css).replace('/*__APP__*/', js).replace('/*__DATA__*/', data).replace('/*__SHARE_HTML__*/', shareHtml);
}

export function writeHtml(session, path, options = {}) {
  writeFileSync(path, renderHtml(session, options), 'utf8');
}
