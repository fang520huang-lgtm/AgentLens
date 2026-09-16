# AgentLens

**A replay button for AI coding agents.** Record what Codex read, ran, changed, and spent in tokens. Explore the run in a local timeline, then export one HTML file for a PR or teammate.

![AgentLens timeline replay](docs/demo.gif)

[Live demo](https://fang520huang-lgtm.github.io/AgentLens/) · [How it works](#how-it-works) · [中文说明](#中文说明)

## Quick start

Requires **Node.js 20+**, Git, and an installed, authenticated [Codex CLI](https://developers.openai.com/codex/noninteractive).

```bash
git clone https://github.com/fang520huang-lgtm/AgentLens.git
cd AgentLens
npm link

cd /path/to/your/project
agentlens run codex "Find and fix the failing test"
```

AgentLens starts `codex exec --json` in your project, prints progress, and creates `.agentlens/runs/<id>/index.html`. In an interactive terminal, it opens the replay automatically. The default Codex sandbox is `workspace-write`.

```bash
agentlens run codex --cwd /path/to/project --sandbox read-only -- "Explain the architecture"
agentlens run codex --model gpt-5.5 --no-open -- "Add a regression test"
agentlens replay .agentlens/runs/<id>
agentlens export .agentlens/runs/<id> --out agent-run.html
```

On Windows PowerShell, quote paths with spaces. Run `agentlens --help` for all options. You can also run locally without linking: `node E:\vspython\AgentLens\bin\agentlens.js run codex "..."`.

## What you get

- **Timeline:** commands, agent messages, file changes, tool calls, failures, and event playback.
- **Inspector:** the selected command, output, status, files, and patch details.
- **Metrics:** command count, inferred file views, changed files and lines, and Codex input/output tokens.
- **Portable export:** a self-contained HTML file with embedded data, CSS, and JavaScript. Open it offline or attach it to a PR.
- **Raw recording:** timestamped Codex events in `events.jsonl` and a normalized `session.json` for other tools.

## How it works

AgentLens wraps the official [Codex JSONL event stream](https://developers.openai.com/codex/noninteractive). It captures the workspace before and after the run, compares text files, and combines the resulting patch with Codex events. File views are inferred from read/search commands, so they are a useful clue rather than a complete access log. Snapshots cover Git tracked and unignored files up to 1 MB each, 40 MB total, and 4,000 files; binary files and common build directories are skipped. The replay reports skipped files.

Recordings may contain prompts, command output, source code, and secrets printed by commands. Review an HTML export before sharing it. Local recordings live under `.agentlens/`, which this repo ignores by default; add that directory to your own project's `.gitignore` too.

## Demo and development

```bash
npm test
npm run demo
```

The public [demo page](https://fang520huang-lgtm.github.io/AgentLens/) uses a **synthetic sample run**. It never sends your code to a server. AgentLens itself has no runtime npm dependencies.

## 中文说明

AgentLens 用 `agentlens run codex "任务"` 启动 Codex，并记录命令、文件改动与 token 用量。运行完成后，打开 `.agentlens/runs/<id>/index.html` 即可查看时间线；用 `agentlens export <运行目录> --out replay.html` 导出单文件页面。README 和 Pages 中的演示数据为合成示例，分享真实录制前请检查敏感信息。

## License

MIT
