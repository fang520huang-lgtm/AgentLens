import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { analyze } from './analyze.js';
import { compareSnapshots, takeSnapshot } from './snapshot.js';
import { writeHtml } from './render.js';
import { codexVersion, coverageFor, gitState } from './metadata.js';
import { recoverRun } from './recover.js';
import { compareRuns, formatComparison } from './compare.js';

const usage = `AgentLens — record and replay AI coding agent runs

Usage:
  agentlens run codex [options] [--] "Your task"
  agentlens replay <run-directory-or-session.json>
  agentlens export <run-directory-or-session.json> [--out replay.html] [--raw]
  agentlens recover <run-directory>
  agentlens compare <run-a> <run-b> [--json]

Run options:
  --cwd <path>        Workspace to run Codex in (default: current directory)
  --sandbox <mode>    Codex sandbox: read-only, workspace-write (default), danger-full-access
  --model <name>      Pass a model name to Codex
  --output <path>     Directory for the recording
  --no-open           Do not open the replay in a browser
  --help              Show this help

Exports are redacted by default; --raw includes original content.
Codex CLI must be installed and authenticated. Recordings stay in .agentlens/runs/.
`;

function parseRun(args) {
  const options = { cwd: process.cwd(), sandbox: 'workspace-write', open: true, prompt: [] };
  let promptOnly = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') { promptOnly = true; continue; }
    if (!promptOnly && arg === '--no-open') { options.open = false; continue; }
    if (!promptOnly && ['--cwd', '--sandbox', '--model', '--output'].includes(arg)) {
      if (!args[i + 1]) throw new Error(`${arg} requires a value`);
      options[arg.slice(2)] = args[++i]; continue;
    }
    if (!promptOnly && arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    options.prompt.push(arg);
  }
  options.cwd = resolve(options.cwd);
  if (!['read-only', 'workspace-write', 'danger-full-access'].includes(options.sandbox)) throw new Error(`Unsupported sandbox: ${options.sandbox}`);
  if (!existsSync(options.cwd)) throw new Error(`Workspace does not exist: ${options.cwd}`);
  return options;
}

async function promptFromInput() {
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { return (await new Promise(resolve => rl.question('Codex task: ', resolve))).trim(); }
    finally { rl.close(); }
  }
  let value = '';
  for await (const chunk of process.stdin) value += chunk;
  return value.trim();
}

function openFile(path) {
  let child;
  if (process.platform === 'win32') child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', path], { detached: true, stdio: 'ignore' });
  else if (process.platform === 'darwin') child = spawn('open', [path], { detached: true, stdio: 'ignore' });
  else child = spawn('xdg-open', [path], { detached: true, stdio: 'ignore' });
  child.on('error', error => console.error(`Could not open browser: ${error.message}`));
  child.unref();
}

function sessionPath(input) {
  const full = resolve(input);
  const path = full.endsWith('.json') ? full : join(full, 'session.json');
  if (!existsSync(path)) throw new Error(`Recording not found: ${path}`);
  return path;
}

function presentEvent(event) {
  if (event.type === 'item.started' && event.item?.type === 'command_execution') {
    console.log(`  › ${String(event.item.command ?? '').split('\n')[0].slice(0, 120)}`);
  } else if (event.type === 'item.completed' && event.item?.type === 'file_change') {
    const paths = event.item.changes?.map(change => change.path).filter(Boolean).join(', ');
    console.log(`  ✎ ${paths || 'Code changed'}`);
  } else if (event.type === 'turn.completed') {
    console.log(`  ✓ ${event.usage?.input_tokens ?? 0} input / ${event.usage?.output_tokens ?? 0} output tokens`);
  } else if (event.type === 'turn.failed' || event.type === 'error') {
    console.error(`  ! ${event.message ?? event.error?.message ?? 'Codex reported an error'}`);
  }
}

export async function runCodex(args, { launch = spawn } = {}) {
  const options = parseRun(args);
  const prompt = options.prompt.join(' ').trim() || await promptFromInput();
  if (!prompt) throw new Error('A task prompt is required. Pass it after `run codex` or type it when prompted.');
  const start = new Date();
  const id = `${start.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')}-${Math.random().toString(36).slice(2, 7)}`;
  const output = resolve(options.output ?? join(options.cwd, '.agentlens', 'runs', id));
  mkdirSync(output, { recursive: true });
  const rawPath = join(output, 'events.jsonl');
  const rawStream = createWriteStream(rawPath, { encoding: 'utf8' });
  const before = takeSnapshot(options.cwd, { excludePaths: [output] });
  const initialGit = gitState(options.cwd, { excludePaths: [output] });
  const meta = {
    id, agent: 'codex', prompt, cwd: options.cwd,
    startedAt: start.toISOString(), sandbox: options.sandbox,
    model: options.model ?? null, codexVersion: codexVersion(),
    platform: { os: process.platform, arch: process.arch },
    gitCommit: initialGit.commit, dirtyBefore: initialGit.dirty,
    captureCoverage: coverageFor(before, null)
  };
  writeFileSync(join(output, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  const rawEvents = [];
  const codexArgs = ['exec', '--json', '--cd', options.cwd, '--sandbox', options.sandbox];
  if (options.model) codexArgs.push('--model', options.model);
  codexArgs.push(prompt);
  console.log(`Recording Codex in ${options.cwd}`);
  console.log(`Session: ${output}`);
  let exitCode = 1;
  let interruptedSignal = null;
  let stderr = '';
  function recordLine(line) {
    try {
      const event = JSON.parse(line);
      const entry = { at: new Date().toISOString(), event };
      rawEvents.push(entry);
      rawStream.write(JSON.stringify(entry) + '\n');
      presentEvent(event);
    } catch { stderr += `Unexpected stdout: ${line.slice(0, 300)}\n`; }
  }
  try {
    exitCode = await new Promise(resolveRun => {
      let child;
      try {
        child = launch('codex', codexArgs, { cwd: options.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      } catch (error) {
        stderr += `${error.message}\n`;
        recordLine(JSON.stringify({ type: 'error', message: error.message }));
        resolveRun(1); return;
      }
      let buffer = '';
      let settled = false;
      let killTimer;
      const interrupt = signal => {
        if (interruptedSignal) return;
        interruptedSignal = signal;
        console.error(`\nStopping Codex (${signal}); finalizing replay...`);
        try { child.kill(signal); } catch { /* child may have exited */ }
        killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* already stopped */ } }, 4000);
        killTimer.unref();
      };
      const onSigint = () => interrupt('SIGINT');
      const onSigterm = () => interrupt('SIGTERM');
      process.on('SIGINT', onSigint);
      process.on('SIGTERM', onSigterm);
      const finish = code => {
        if (settled) return;
        settled = true;
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigterm);
        if (killTimer) clearTimeout(killTimer);
        resolveRun(code);
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
          if (!line) continue;
          recordLine(line);
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
      child.on('error', error => {
        stderr += `${error.message}\n`;
        recordLine(JSON.stringify({ type: 'error', message: error.message }));
        finish(1);
      });
      child.on('close', code => {
        if (settled) return;
        if (buffer.trim()) recordLine(buffer.trim());
        finish(code ?? (interruptedSignal === 'SIGINT' ? 130 : interruptedSignal === 'SIGTERM' ? 143 : 1));
      });
    });
  } finally {
    await new Promise(resolveStream => rawStream.end(resolveStream));
  }
  const after = takeSnapshot(options.cwd, { excludePaths: [output] });
  const changes = compareSnapshots(before, after);
  const finalGit = gitState(options.cwd, { excludePaths: [output] });
  const session = analyze(rawEvents, changes, {
    ...meta, endedAt: new Date().toISOString(),
    exitCode, outcome: interruptedSignal ? 'interrupted' : exitCode === 0 ? 'completed' : 'failed',
    dirtyAfter: finalGit.dirty,
    captureCoverage: coverageFor(before, after),
    snapshotSkipped: before.skipped + after.skipped,
    stderr: stderr.slice(0, 10000)
  });
  const jsonPath = join(output, 'session.json');
  const htmlPath = join(output, 'index.html');
  writeFileSync(jsonPath, JSON.stringify(session, null, 2) + '\n');
  writeHtml(session, htmlPath);
  console.log(`Replay: ${htmlPath}`);
  console.log(`Captured ${session.stats.commands} commands, ${session.stats.filesChanged} changed files, ${session.usage.input_tokens + session.usage.output_tokens} tokens.`);
  if (session.snapshotSkipped) console.log(`Note: ${session.snapshotSkipped} files were skipped by snapshot limits or filters.`);
  if (options.open && process.stdout.isTTY) openFile(htmlPath);
  if (exitCode !== 0) process.exitCode = interruptedSignal === 'SIGINT' ? 130 : interruptedSignal === 'SIGTERM' ? 143 : exitCode;
  return session;
}

export async function main(args) {
  const [command, target, ...rest] = args;
  if (!command || command === '--help' || command === '-h' || command === 'help') { console.log(usage); return; }
  if (command === 'run') {
    if (target !== 'codex') throw new Error('Only `run codex` is supported currently.');
    if (rest.includes('--help')) { console.log(usage); return; }
    await runCodex(rest); return;
  }
  if (command === 'replay') {
    if (!target) throw new Error('Pass a recording directory or session.json.');
    const path = sessionPath(target);
    const htmlPath = join(dirname(path), 'index.html');
    writeHtml(JSON.parse(readFileSync(path, 'utf8')), htmlPath);
    openFile(htmlPath); console.log(`Opened ${htmlPath}`); return;
  }
  if (command === 'recover') {
    if (!target || rest.length) throw new Error('Use `agentlens recover <run-directory>`.');
    const result = recoverRun(target);
    console.log(`Recovered ${result.session.timeline.length} events from ${target}`);
    console.log(`Replay: ${result.htmlPath}`);
    if (result.session.recovery.malformedLines) console.log(`Skipped ${result.session.recovery.malformedLines} incomplete or malformed event lines.`);
    return;
  }
  if (command === 'compare') {
    if (!target || !rest[0]) throw new Error('Use `agentlens compare <run-a> <run-b> [--json]`.');
    const [other, ...options] = rest;
    if (options.some(option => option !== '--json')) throw new Error(`Unknown compare option: ${options.find(option => option !== '--json')}`);
    const a = JSON.parse(readFileSync(sessionPath(target), 'utf8'));
    const b = JSON.parse(readFileSync(sessionPath(other), 'utf8'));
    const report = compareRuns(a, b);
    console.log(options.includes('--json') ? JSON.stringify(report, null, 2) : formatComparison(report));
    return;
  }
  if (command === 'export') {
    if (!target) throw new Error('Pass a recording directory or session.json.');
    const path = sessionPath(target);
    let out = resolve(dirname(path), 'agentlens-replay.html');
    let mode = 'redacted';
    let modeFlag = null;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--out') {
        if (!rest[i + 1]) throw new Error('--out requires a path.');
        out = resolve(rest[++i]);
      } else if (rest[i] === '--raw' || rest[i] === '--redact') {
        if (modeFlag) throw new Error('Choose only one of --raw or --redact.');
        modeFlag = rest[i];
        mode = modeFlag === '--raw' ? 'raw' : 'redacted';
      } else throw new Error(`Unknown export option: ${rest[i]}`);
    }
    mkdirSync(dirname(out), { recursive: true });
    writeHtml(JSON.parse(readFileSync(path, 'utf8')), out, { mode });
    console.log(`Exported ${out} (${mode === 'redacted' ? 'share-safe, pattern-based redaction' : 'raw, contains original data'})`); return;
  }
  throw new Error(`Unknown command: ${command}. Run agentlens --help.`);
}
