import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { analyze } from './analyze.js';
import { compareSnapshots, takeSnapshot } from './snapshot.js';
import { writeHtml } from './render.js';

const usage = `AgentLens — record and replay AI coding agent runs

Usage:
  agentlens run codex [options] [--] "Your task"
  agentlens replay <run-directory-or-session.json>
  agentlens export <run-directory-or-session.json> [--out replay.html]

Run options:
  --cwd <path>        Workspace to run Codex in (default: current directory)
  --sandbox <mode>    Codex sandbox: read-only, workspace-write (default), danger-full-access
  --model <name>      Pass a model name to Codex
  --output <path>     Directory for the recording
  --no-open           Do not open the replay in a browser
  --help              Show this help

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

export async function runCodex(args) {
  const options = parseRun(args);
  const prompt = options.prompt.join(' ').trim() || await promptFromInput();
  if (!prompt) throw new Error('A task prompt is required. Pass it after `run codex` or type it when prompted.');
  const start = new Date();
  const id = `${start.toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-')}-${Math.random().toString(36).slice(2, 7)}`;
  const output = resolve(options.output ?? join(options.cwd, '.agentlens', 'runs', id));
  mkdirSync(output, { recursive: true });
  const rawPath = join(output, 'events.jsonl');
  const rawStream = createWriteStream(rawPath, { encoding: 'utf8' });
  const before = takeSnapshot(options.cwd);
  const rawEvents = [];
  const codexArgs = ['exec', '--json', '--cd', options.cwd, '--sandbox', options.sandbox];
  if (options.model) codexArgs.push('--model', options.model);
  codexArgs.push(prompt);
  console.log(`Recording Codex in ${options.cwd}`);
  console.log(`Session: ${output}`);
  let exitCode;
  let stderr = '';
  try {
    exitCode = await new Promise((resolveRun, rejectRun) => {
      const child = spawn('codex', codexArgs, { cwd: options.cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        buffer += chunk;
        let index;
        while ((index = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            const entry = { at: new Date().toISOString(), event };
            rawEvents.push(entry);
            rawStream.write(JSON.stringify(entry) + '\n');
            presentEvent(event);
          } catch { stderr += `Unexpected stdout: ${line.slice(0, 300)}\n`; }
        }
      });
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); });
      child.on('error', rejectRun);
      child.on('close', code => {
        if (buffer.trim()) {
          try {
            const event = JSON.parse(buffer.trim());
            const entry = { at: new Date().toISOString(), event };
            rawEvents.push(entry); rawStream.write(JSON.stringify(entry) + '\n'); presentEvent(event);
          } catch { stderr += `Unexpected stdout: ${buffer.slice(0, 300)}\n`; }
        }
        resolveRun(code ?? 1);
      });
    });
  } finally {
    await new Promise(resolveStream => rawStream.end(resolveStream));
  }
  const after = takeSnapshot(options.cwd);
  const changes = compareSnapshots(before, after);
  const session = analyze(rawEvents, changes, {
    id, agent: 'codex', prompt, cwd: options.cwd,
    startedAt: start.toISOString(), endedAt: new Date().toISOString(),
    exitCode, snapshotSkipped: before.skipped + after.skipped,
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
  if (exitCode !== 0) process.exitCode = exitCode;
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
    if (!existsSync(htmlPath)) writeHtml(JSON.parse(readFileSync(path, 'utf8')), htmlPath);
    openFile(htmlPath); console.log(`Opened ${htmlPath}`); return;
  }
  if (command === 'export') {
    if (!target) throw new Error('Pass a recording directory or session.json.');
    const path = sessionPath(target);
    let out = resolve(dirname(path), 'agentlens-replay.html');
    if (rest.length) {
      if (rest[0] !== '--out' || !rest[1] || rest.length !== 2) throw new Error('Use `--out <file.html>` to choose an export path.');
      out = resolve(rest[1]);
    }
    mkdirSync(dirname(out), { recursive: true });
    writeHtml(JSON.parse(readFileSync(path, 'utf8')), out);
    console.log(`Exported ${out}`); return;
  }
  throw new Error(`Unknown command: ${command}. Run agentlens --help.`);
}
