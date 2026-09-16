import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function renderHtml(session) {
  const html = readFileSync(join(here, 'view', 'index.html'), 'utf8');
  const css = readFileSync(join(here, 'view', 'style.css'), 'utf8');
  const js = readFileSync(join(here, 'view', 'app.js'), 'utf8');
  const data = JSON.stringify(session).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
  return html.replace('/*__STYLE__*/', css).replace('/*__APP__*/', js).replace('/*__DATA__*/', data);
}

export function writeHtml(session, path) {
  writeFileSync(path, renderHtml(session), 'utf8');
}
