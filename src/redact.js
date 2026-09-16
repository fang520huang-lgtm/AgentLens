import { homedir, userInfo } from 'node:os';

const SECRET_NAME = '(?:[A-Za-z0-9_-]*(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|private[_-]?key|credential|authorization)[A-Za-z0-9_-]*)';
const ENV_FILE = /\.env(?:\.[A-Za-z0-9_-]+)?\b/i;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function redactSession(session, identity = {}) {
  const source = structuredClone(session);
  const home = identity.home ?? homedir();
  let username = identity.username;
  if (username === undefined) {
    try { username = userInfo().username; } catch { username = ''; }
  }
  const counts = {};
  const mark = category => { counts[category] = (counts[category] ?? 0) + 1; };

  function replace(text, pattern, replacement, category) {
    return text.replace(pattern, (...args) => {
      mark(category);
      return typeof replacement === 'function' ? replacement(...args) : replacement;
    });
  }

  function scrubText(value) {
    let text = String(value);
    text = replace(text, /-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?-----END [^-\r\n]*PRIVATE KEY-----/gi, '[REDACTED PRIVATE KEY]', 'private-key');
    if (/-----BEGIN [^-\r\n]*PRIVATE KEY-----/i.test(text)) {
      mark('private-key');
      text = '[REDACTED PRIVATE KEY CONTENT]';
    }
    text = replace(text, /\b(?:sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|glpat-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|AIza[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{16})\b/g, '[REDACTED TOKEN]', 'known-token');
    text = replace(text, /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED JWT]', 'jwt');
    text = replace(text, /\b(Bearer|Basic)\s+[A-Za-z0-9._~+\/-]{8,}=*/gi, (_full, type) => `${type} [REDACTED]`, 'authorization');
    const assignment = new RegExp(`((?:["']?${SECRET_NAME}["']?)\\s*[:=]\\s*)(?:"[^"\\r\\n]*"|'[^'\\r\\n]*'|[^\\s,;&\\r\\n]+)`, 'gi');
    text = replace(text, assignment, (_full, prefix) => `${prefix}[REDACTED]`, 'secret-assignment');
    text = replace(text, /^([+-]?[A-Z][A-Z0-9_]{1,})=(.+)$/gm, (_full, name) => `${name}=[REDACTED]`, 'env-assignment');
    text = replace(text, /\b(?:https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, match => `${match.split('://')[0]}://[REDACTED]@`, 'url-credential');
    text = replace(text, /\b[A-Za-z]:[\\/]Users[\\/][^\\/\s'"`]+/gi, '~', 'home-path');
    text = replace(text, /\/(?:home|Users)\/[^/\s'"`]+/g, '~', 'home-path');
    if (home && home.length > 3) {
      text = replace(text, new RegExp(escapeRegExp(home), process.platform === 'win32' ? 'gi' : 'g'), '~', 'home-path');
    }
    if (username && username.length >= 3) {
      text = replace(text, new RegExp(`\\b${escapeRegExp(username)}\\b`, 'gi'), '[USER]', 'username');
    }
    return text;
  }

  function scrub(value) {
    if (typeof value === 'string') return scrubText(value);
    if (Array.isArray(value)) return value.map(scrub);
    if (!value || typeof value !== 'object') return value;
    const copy = { ...value };
    const path = typeof copy.path === 'string' ? copy.path : '';
    const command = typeof copy.command === 'string' ? copy.command : '';
    if (ENV_FILE.test(path) && typeof copy.diff === 'string') {
      copy.diff = '[REDACTED .env PATCH]'; mark('env-content');
    }
    if (ENV_FILE.test(command) && typeof copy.output === 'string' && copy.output) {
      copy.output = '[REDACTED .env OUTPUT]'; mark('env-content');
    }
    if (typeof copy.diff === 'string' && /-----BEGIN [^-\r\n]*PRIVATE KEY-----/i.test(copy.diff)) {
      copy.diff = '[REDACTED PRIVATE KEY PATCH]'; mark('private-key');
    }
    for (const [key, item] of Object.entries(copy)) copy[key] = scrub(item);
    return copy;
  }

  const result = scrub(source);
  result.redaction = {
    mode: 'redacted',
    count: Object.values(counts).reduce((sum, count) => sum + count, 0),
    categories: counts,
    note: 'Pattern-based redaction. Review this export before sharing.'
  };
  return result;
}
