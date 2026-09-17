(() => {
  const { a, b, report } = JSON.parse(document.getElementById('comparison-data').textContent);
  const $ = id => document.getElementById(id);
  const make = (tag, className, value) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (value !== undefined) element.textContent = String(value);
    return element;
  };
  const number = value => new Intl.NumberFormat('en-US').format(value ?? 0);
  const signed = value => `${value > 0 ? '+' : ''}${number(value)}`;
  const compact = value => String(value ?? '').replaceAll('\\', '/').replace(/\s+/g, ' ').trim();
  const label = value => value === null || value === undefined || value === '' ? 'Not recorded' : String(value);
  const duration = ms => ms === undefined || ms === null ? '—' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round(ms % 60000 / 1000)}s`;
  const outcome = session => {
    const value = session.outcome ?? (session.exitCode === undefined ? 'unknown' : session.exitCode === 0 ? 'completed' : 'failed');
    return ['completed', 'failed', 'interrupted', 'recovered'].includes(value) ? value.toUpperCase() : 'UNKNOWN';
  };
  const title = event => !event ? 'No event' : event.command || event.detail || event.title || event.kind || 'Event';
  const summary = event => !event ? 'No event captured in this run' : `${title(event)}${event.exitCode !== undefined ? ` · exit ${event.exitCode}` : ''}${event.output ? ` · ${compact(event.output).slice(0, 95)}` : ''}`;
  const action = event => {
    if (!event) return null;
    const subject = event.kind === 'command' ? event.command : event.kind === 'change' ? (event.files ?? []).join('|') : event.detail || event.title;
    return `${event.kind}:${compact(subject)}`;
  };
  const differences = (left, right) => {
    if (!left || !right) return ['event missing'];
    const fields = [];
    if (action(left) !== action(right)) fields.push('action');
    if (left.exitCode !== right.exitCode) fields.push('exit code');
    if ((left.status ?? '') !== (right.status ?? '')) fields.push('status');
    if (compact(left.output) !== compact(right.output)) fields.push('output');
    return fields;
  };

  function alignEvents(left, right) {
    const rows = [];
    let i = 0, j = 0;
    while (i < left.length || j < right.length) {
      if (i >= left.length) { rows.push({ a: null, b: right[j], ai: null, bi: j++ }); continue; }
      if (j >= right.length) { rows.push({ a: left[i], b: null, ai: i++, bi: null }); continue; }
      if (action(left[i]) === action(right[j])) { rows.push({ a: left[i], b: right[j], ai: i++, bi: j++ }); continue; }
      let best = null;
      for (let da = 0; da <= 5 && i + da < left.length; da++) {
        for (let db = 0; db <= 5 && j + db < right.length; db++) {
          if (da + db === 0 || action(left[i + da]) !== action(right[j + db])) continue;
          if (!best || da + db < best.da + best.db) best = { da, db };
        }
      }
      if (best) {
        for (let n = 0; n < best.da; n++) rows.push({ a: left[i], b: null, ai: i++, bi: null });
        for (let n = 0; n < best.db; n++) rows.push({ a: null, b: right[j], ai: null, bi: j++ });
      } else rows.push({ a: left[i], b: right[j], ai: i++, bi: j++ });
    }
    return rows;
  }

  const rows = alignEvents(a.timeline ?? [], b.timeline ?? []);
  const firstFork = rows.findIndex(row => differences(row.a, row.b).length);
  const firstFailure = (b.timeline ?? []).find(event => event.kind === 'error' || (event.kind === 'command' && ((event.exitCode !== undefined && Number(event.exitCode) !== 0) || event.status === 'failed')));
  let selectedRow = firstFork >= 0 ? firstFork : 0;
  let showAll = false;

  function addClue(heading, detail, icon = '↗') {
    const clue = make('div', 'clue');
    const text = make('div');
    text.append(make('strong', '', heading), make('span', '', detail));
    clue.append(make('i', '', icon), text);
    $('clues-list').append(clue);
  }

  function renderOverview() {
    const raw = a.redaction?.mode === 'raw' || b.redaction?.mode === 'raw';
    $('share-mode').textContent = raw ? 'RAW' : 'SHARE SAFE';
    $('share-mode').classList.toggle('raw', raw);
    $('share-mode').title = raw ? 'This comparison contains original session data.' : 'Pattern-based redaction. Review before sharing.';
    if (!raw) document.querySelector('#context .coverage-note').textContent += ' Share-safe redaction can mask sensitive differences; use --raw locally for deeper inspection.';
    if (outcome(a) === outcome(b)) $('hero-title').innerHTML = 'Two runs.<br><em>One clear view.</em>';
    else if (!a.prompt || a.prompt !== b.prompt) $('hero-title').innerHTML = 'Two runs.<br><em>Different ending.</em>';
    for (const [key, session] of [['a', a], ['b', b]]) {
      $(`${key}-id`).textContent = label(session.id ?? session.threadId);
      $(`${key}-outcome`).textContent = outcome(session);
      $(`${key}-outcome`).classList.toggle('failed', outcome(session) === 'FAILED');
      $(`${key}-outcome`).classList.toggle('interrupted', outcome(session) === 'INTERRUPTED');
      $(`${key}-prompt`).textContent = label(session.prompt);
      $(`${key}-commands`).textContent = number(session.stats?.commands ?? (session.timeline ?? []).filter(event => event.kind === 'command').length);
      $(`${key}-files`).textContent = number(session.stats?.filesChanged ?? session.changes?.length);
      $(`${key}-tokens`).textContent = number((session.usage?.input_tokens ?? 0) + (session.usage?.output_tokens ?? 0));
      $(`${key}-duration`).textContent = duration(session.durationMs);
    }
    $('token-delta').textContent = signed(report.tokens.delta.total);
    $('token-breakdown').textContent = `${signed(report.tokens.delta.input)} input · ${signed(report.tokens.delta.output)} output`;
    $('extra-commands').textContent = number(report.commands.onlyB.length);
    $('patch-delta').textContent = number(report.patches.onlyA.length + report.patches.onlyB.length + report.patches.different.length);
    $('file-delta').textContent = number(report.viewedFiles.onlyB.length);
    if (report.firstDifference) {
      $('fork-heading').textContent = `Event ${report.firstDifference.index + 1} is the first observed split.`;
      $('fork-reason').textContent = `The captured ${report.firstDifference.fields.join(' and ')} differs here. Follow the next events and final patches to understand the changed outcome.`;
      $('fork-a').textContent = summary(a.timeline?.[report.firstDifference.index]);
      $('fork-b').textContent = summary(b.timeline?.[report.firstDifference.index]);
    } else {
      $('fork-heading').textContent = 'Captured events follow the same path.';
      $('fork-reason').textContent = 'The recorded event sequence matches. Compare run conditions, outcome and workspace patches below.';
      $('fork-a').textContent = `${number(a.timeline?.length)} captured events`;
      $('fork-b').textContent = `${number(b.timeline?.length)} captured events`;
    }
    if (firstFailure) addClue('Run B has a captured failure', summary(firstFailure), '!');
    else if (outcome(b) === 'FAILED') addClue('Run B ended failed', compact(b.stderr || 'No failing command was captured; inspect the session outcome and logs.'), '!');
    if (report.firstDifference) addClue('The paths split at a captured event', `Event ${report.firstDifference.index + 1}: ${report.firstDifference.fields.join(', ')} changed.`, '↗');
    if (a.gitCommit !== b.gitCommit && (a.gitCommit || b.gitCommit)) addClue('The source revision changed', `A: ${label(a.gitCommit).slice(0, 12)} · B: ${label(b.gitCommit).slice(0, 12)}`, '⌁');
    if (a.prompt !== b.prompt) addClue('The prompt changed', 'Inspect the exact request in the run cards and context table.', '✦');
    if (a.model !== b.model && (a.model || b.model)) addClue('The model changed', `${label(a.model)} → ${label(b.model)}`, '◇');
    if (report.patches.onlyA.length || report.patches.onlyB.length || report.patches.different.length) addClue('The final code differs', `${report.patches.onlyA.length} only in A · ${report.patches.onlyB.length} only in B · ${report.patches.different.length} different patch(es).`, '⌁');
    if (!$('clues-list').children.length) addClue('No difference in the captured evidence', 'The recording may not include the cause. Inspect the original run logs.', '•');
  }

  function eventCell(event, side, index) {
    const button = make('button', `timeline-cell${event ? '' : ' empty'}`);
    button.type = 'button';
    button.disabled = !event;
    if (!event) { button.textContent = '—'; return button; }
    button.setAttribute('aria-label', `Inspect run ${side} event ${index + 1}: ${title(event)}`);
    button.append(make('b', event.exitCode !== undefined && Number(event.exitCode) !== 0 ? 'fail' : '', title(event)), make('small', '', `${event.kind ?? 'event'}${event.exitCode !== undefined ? ` · exit ${event.exitCode}` : ''}`));
    return button;
  }

  function detailPanel(event, side, index) {
    const panel = make('div');
    const heading = make('div', 'detail-title');
    heading.append(make('span', `run-tag ${side}`, `RUN ${side.toUpperCase()}`), make('strong', '', event ? `Event ${index + 1}` : 'No event'));
    panel.append(heading);
    if (!event) { panel.append(make('p', 'detail-empty', 'This run has no corresponding captured event.')); return panel; }
    panel.append(make('div', 'detail-meta', `${event.kind ?? 'event'} · ${label(event.status)}${event.exitCode !== undefined ? ` · exit ${event.exitCode}` : ''}`));
    for (const [name, value] of [['ACTION', event.command || event.detail || event.title], ['OUTPUT', event.output], ['REFERENCED FILES', event.files?.join('\n')]]) {
      if (!value) continue;
      const text = String(value);
      panel.append(make('div', 'detail-label', name), make('pre', 'detail-code', text.slice(0, 30000) + (text.length > 30000 ? '\n\n[Preview truncated at 30,000 characters]' : '')));
    }
    return panel;
  }

  function selectRow(index) {
    selectedRow = index;
    document.querySelectorAll('.timeline-row').forEach(row => row.classList.toggle('selected', Number(row.dataset.index) === index));
    const row = rows[index];
    $('event-detail').replaceChildren(detailPanel(row?.a, 'a', row?.ai), detailPanel(row?.b, 'b', row?.bi));
  }

  function renderTimeline() {
    const list = $('timeline-rows');
    list.replaceChildren();
    const start = !showAll && rows.length > 100 ? Math.max(0, (firstFork < 0 ? 0 : firstFork) - 15) : 0;
    const end = !showAll && rows.length > 100 ? Math.min(rows.length, start + 80) : rows.length;
    $('timeline-note').textContent = rows.length > 100 && !showAll ? `Showing ${start + 1}–${end} of ${rows.length} aligned events around the divergence.` : `${rows.length} aligned event rows · ${report.eventCounts.a} in A · ${report.eventCounts.b} in B`;
    $('show-all').hidden = rows.length <= 100 || showAll;
    for (let index = start; index < end; index++) {
      const row = rows[index];
      const change = differences(row.a, row.b);
      const state = !change.length ? 'same' : !row.a || !row.b ? 'single' : 'changed';
      const wrapper = make('div', `timeline-row ${state}${index === firstFork ? ' first-fork' : ''}${index === selectedRow ? ' selected' : ''}`);
      wrapper.dataset.index = String(index);
      const left = eventCell(row.a, 'A', row.ai);
      const right = eventCell(row.b, 'B', row.bi);
      left.addEventListener('click', () => selectRow(index));
      right.addEventListener('click', () => selectRow(index));
      wrapper.append(left, make('div', 'timeline-step', ''), right);
      wrapper.children[1].append(make('span', '', index + 1));
      list.append(wrapper);
    }
    if (!rows.length) list.append(make('p', 'detail-empty', 'Neither session contains captured events.'));
    selectRow(selectedRow);
  }

  function renderPatch(change, titleId, statId, codeId, path) {
    $(titleId).textContent = path ?? 'No captured patch';
    $(statId).textContent = change ? `+${number(change.additions)} / −${number(change.deletions)}` : '—';
    const target = $(codeId); target.replaceChildren();
    if (!change?.diff) { target.append(make('div', 'patch-empty', 'No patch for this file in this run.')); return; }
    const diff = String(change.diff);
    for (const line of diff.slice(0, 80000).split('\n')) {
      const style = line.startsWith('+') && !line.startsWith('+++') ? 'add' : line.startsWith('-') && !line.startsWith('---') ? 'del' : line.startsWith('@@') ? 'hunk' : '';
      target.append(make('span', `line ${style}`, line));
    }
    if (diff.length > 80000) target.append(make('div', 'patch-empty', 'Patch preview truncated at 80,000 characters. Open the session artifact for the full patch.'));
  }

  function renderPatches() {
    const left = new Map((a.changes ?? []).map(change => [change.path, change]));
    const right = new Map((b.changes ?? []).map(change => [change.path, change]));
    const paths = [...new Set([...left.keys(), ...right.keys()])].sort();
    const first = [...report.patches.different, ...report.patches.onlyA, ...report.patches.onlyB][0] ?? paths[0];
    const index = $('patch-paths');
    if (!paths.length) index.append(make('p', 'detail-empty', 'No workspace patches were captured.'));
    function select(path) {
      document.querySelectorAll('.patch-path').forEach(button => button.classList.toggle('active', button.dataset.path === path));
      renderPatch(left.get(path), 'patch-a-title', 'patch-a-stat', 'patch-a', path);
      renderPatch(right.get(path), 'patch-b-title', 'patch-b-stat', 'patch-b', path);
    }
    for (const path of paths) {
      const kind = !left.has(path) ? 'Only in B' : !right.has(path) ? 'Only in A' : left.get(path).diff === right.get(path).diff ? 'Same patch' : 'Different patch';
      const button = make('button', 'patch-path');
      button.type = 'button'; button.dataset.path = path;
      button.append(make('strong', '', path), make('small', '', kind));
      button.addEventListener('click', () => select(path));
      index.append(button);
    }
    select(first);
  }

  function renderContext() {
    const fields = [
      ['Prompt', a.prompt, b.prompt], ['Started', a.startedAt, b.startedAt], ['Exit code', a.exitCode, b.exitCode],
      ['Model', a.model, b.model], ['Git commit', a.gitCommit, b.gitCommit],
      ['Dirty before', a.dirtyBefore, b.dirtyBefore], ['Dirty after', a.dirtyAfter, b.dirtyAfter],
      ['Sandbox', a.sandbox, b.sandbox], ['Codex version', a.codexVersion, b.codexVersion],
      ['Platform', a.platform?.os && a.platform?.arch ? `${a.platform.os} / ${a.platform.arch}` : null, b.platform?.os && b.platform?.arch ? `${b.platform.os} / ${b.platform.arch}` : null],
      ['Snapshot coverage', a.captureCoverage?.status === 'captured' ? `${a.captureCoverage.after?.captured ?? 0} captured / ${a.captureCoverage.after?.skipped ?? 0} skipped` : null, b.captureCoverage?.status === 'captured' ? `${b.captureCoverage.after?.captured ?? 0} captured / ${b.captureCoverage.after?.skipped ?? 0} skipped` : null]
    ];
    for (const [name, left, right] of fields) {
      const row = make('div', `context-row${left !== right ? ' different' : ''}`);
      row.append(make('span', '', name), make('span', '', label(left)), make('span', '', label(right)));
      $('context-rows').append(row);
    }
    for (const [id, values] of [['commands-a', report.commands.onlyA], ['commands-b', report.commands.onlyB], ['files-a', report.viewedFiles.onlyA], ['files-b', report.viewedFiles.onlyB]]) {
      const target = $(id);
      if (!values.length) target.append(make('p', 'evidence-empty', 'None captured'));
      for (const value of values.slice(0, 15)) target.append(make('div', 'evidence-item', value));
      if (values.length > 15) target.append(make('div', 'evidence-item', `+${values.length - 15} more`));
    }
  }

  function prSummary() {
    const first = report.firstDifference;
    return [
      '## AgentLens: Run A vs Run B',
      `- Outcome: A ${outcome(a).toLowerCase()} → B ${outcome(b).toLowerCase()}`,
      `- First captured divergence: ${first ? `event ${first.index + 1} (${first.fields.join(', ')})` : 'none in the event sequence'}`,
      firstFailure ? `- First captured failure in B: event ${(b.timeline ?? []).indexOf(firstFailure) + 1}${firstFailure.exitCode !== undefined ? ` (exit ${Number(firstFailure.exitCode)})` : ''}` : null,
      `- Commands unique to B: ${report.commands.onlyB.length}; files likely read only by B: ${report.viewedFiles.onlyB.length}`,
      `- Patch differences: ${report.patches.different.length} changed differently, ${report.patches.onlyA.length} only in A, ${report.patches.onlyB.length} only in B`,
      `- Token delta (B − A): ${signed(report.tokens.delta.total)}`,
      '',
      'Observed differences are not proof of cause. Review the attached comparison before sharing.'
    ].filter(value => value !== null).join('\n');
  }

  function download() {
    const encoded = $('share-html').textContent.trim();
    const bytes = encoded ? Uint8Array.from(atob(encoded), char => char.charCodeAt(0)) : new TextEncoder().encode('<!doctype html>\n' + document.documentElement.outerHTML);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'text/html;charset=utf-8' }));
    const link = make('a');
    link.href = url;
    link.download = `agentlens-compare-${String(b.id ?? 'run-b').replace(/[^a-z0-9_-]/gi, '-')}.html`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copySummary() {
    const value = prSummary();
    let copied = false;
    try { await navigator.clipboard.writeText(value); copied = true; }
    catch {
      const input = make('textarea'); input.value = value; document.body.append(input); input.select(); copied = document.execCommand('copy'); input.remove();
    }
    const button = $('copy-summary'); const original = button.textContent;
    button.textContent = copied ? '✓ Copied summary' : 'Copy failed'; setTimeout(() => { button.textContent = original; }, 1800);
  }

  renderOverview(); renderTimeline(); renderPatches(); renderContext();
  $('jump-fork').addEventListener('click', () => document.querySelector('.first-fork')?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
  $('show-all').addEventListener('click', () => { showAll = true; renderTimeline(); });
  $('copy-summary').addEventListener('click', copySummary);
  $('download-btn').addEventListener('click', download);
})();
