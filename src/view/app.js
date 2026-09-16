(() => {
  const session = JSON.parse(document.getElementById('session-data').textContent);
  const $ = id => document.getElementById(id);
  const state = { view: 'timeline', filter: 'all', query: '', selected: null, position: 0, playing: false, timer: null };
  const events = session.timeline ?? [];
  const make = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const formatNumber = n => new Intl.NumberFormat('en-US').format(n ?? 0);
  const formatDuration = ms => ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))}s` : `${Math.floor(ms / 60000)}m ${Math.round(ms % 60000 / 1000)}s`;
  const time = at => at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  const labels = { command: 'Command', change: 'File edit', message: 'Message', tool: 'Tool', error: 'Error', other: 'Event' };
  const icons = { command: '›_', change: '⌁', message: '✦', tool: '◇', error: '!', other: '•' };

  function init() {
    const workspace = (session.cwd ?? 'Workspace').replaceAll('\\', '/').split('/').filter(Boolean).at(-1);
    $('workspace-name').textContent = workspace || 'Workspace';
    $('run-id').textContent = (session.threadId ?? session.id ?? 'SESSION').slice(0, 10).toUpperCase();
    $('run-status').textContent = ({ completed: 'COMPLETE', interrupted: 'INTERRUPTED', recovered: 'RECOVERED', failed: 'FAILED' })[session.outcome] ?? (session.exitCode === 0 || session.exitCode === undefined ? 'COMPLETE' : 'FAILED');
    $('share-mode').textContent = session.redaction?.mode === 'redacted' ? 'SHARE SAFE' : 'RAW';
    $('share-mode').classList.toggle('safe', session.redaction?.mode === 'redacted');
    $('share-mode').title = session.redaction?.mode === 'redacted' ? `${session.redaction.count ?? 0} redaction matches. Review before sharing.` : 'This local replay contains original commands, outputs, and code.';
    $('run-title').innerHTML = 'Replay every<br><em>captured action.</em>';
    $('run-subtitle').textContent = session.prompt || 'A clear view of what your coding agent saw, ran, and changed.';
    $('run-date').textContent = session.startedAt ? new Date(session.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Sample run';
    $('run-duration').textContent = formatDuration(session.durationMs ?? 0);
    $('stat-commands').textContent = formatNumber(session.stats?.commands);
    $('stat-viewed').textContent = formatNumber(session.stats?.filesViewed);
    $('stat-changed').textContent = formatNumber(session.stats?.filesChanged);
    $('stat-tokens').textContent = formatNumber((session.usage?.input_tokens ?? 0) + (session.usage?.output_tokens ?? 0));
    $('lines-caption').textContent = `+${formatNumber(session.stats?.additions)} / −${formatNumber(session.stats?.deletions)} lines`;
    $('tokens-caption').textContent = `${formatNumber(session.usage?.input_tokens)} in · ${formatNumber(session.usage?.output_tokens)} out`;
    const coverage = session.captureCoverage;
    if (coverage?.status === 'captured') {
      $('coverage-summary').textContent = `${formatNumber(coverage.after?.captured)} files captured · ${formatNumber(coverage.after?.skipped)} skipped`;
      $('coverage-note').textContent = `At start: ${formatNumber(coverage.before?.captured)} captured · ${formatNumber(coverage.before?.skipped)} skipped`;
    } else {
      $('coverage-summary').textContent = 'Workspace snapshot unavailable';
      $('coverage-note').textContent = session.outcome === 'recovered' ? 'Replay rebuilt from saved events; patch may be incomplete' : 'Capture data not provided';
    }
    $('file-count-nav').textContent = String(session.viewedFiles?.length ?? 0).padStart(2, '0');
    $('change-count-nav').textContent = String(session.changes?.length ?? 0).padStart(2, '0');
    $('scrubber').max = Math.max(0, events.length - 1);
    document.querySelectorAll('.side-link').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
    document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => {
      state.filter = button.dataset.filter;
      document.querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item === button));
      renderTimeline();
    }));
    $('search-input').addEventListener('input', event => { state.query = event.target.value.toLowerCase(); renderTimeline(); });
    $('play-btn').addEventListener('click', togglePlayback);
    $('step-btn').addEventListener('click', () => step(1));
    $('scrubber').addEventListener('input', event => selectPosition(Number(event.target.value), true));
    $('inspector-close').addEventListener('click', () => $('inspector').classList.remove('open'));
    $('download-btn').addEventListener('click', download);
    document.addEventListener('keydown', event => {
      if (event.target.matches('input')) return;
      if (event.key === 'ArrowRight') step(1);
      if (event.key === 'ArrowLeft') step(-1);
      if (event.code === 'Space') { event.preventDefault(); togglePlayback(); }
    });
    renderTimeline(); renderFiles(); renderChanges();
    setView('timeline');
    selectPosition(0, false);
  }

  function setView(view) {
    state.view = view;
    $('inspector').classList.remove('open');
    document.querySelectorAll('.side-link').forEach(button => button.classList.toggle('active', button.dataset.view === view));
    $('timeline-view').hidden = view !== 'timeline';
    $('files-view').hidden = view !== 'files';
    $('changes-view').hidden = view !== 'changes';
    $('section-title').textContent = { timeline: 'Activity timeline', files: 'Files viewed', changes: 'Code changes' }[view];
    $('event-counter').textContent = view === 'timeline' ? `${events.length} EVENTS` : view === 'files' ? `${session.viewedFiles?.length ?? 0} FILES` : `${session.changes?.length ?? 0} CHANGES`;
  }

  function renderTimeline() {
    const list = $('timeline-list'); list.replaceChildren();
    const filtered = events.filter(item => (state.filter === 'all' || item.kind === state.filter) &&
      `${item.title} ${item.command ?? ''} ${item.detail ?? ''} ${item.files?.join(' ') ?? ''}`.toLowerCase().includes(state.query));
    if (!filtered.length) { list.append(make('div', 'empty-state', 'No events match this view.')); return; }
    filtered.forEach(item => {
      const card = make('button', 'event-card');
      card.type = 'button'; card.dataset.kind = item.kind; card.dataset.id = item.id;
      card.classList.toggle('active', state.selected === item.id);
      const top = make('div', 'event-top');
      top.append(make('span', 'event-icon', icons[item.kind] ?? '•'), make('span', 'event-title', item.title), make('span', 'event-time', time(item.at)));
      card.append(top);
      const preview = item.command || item.detail || item.output || item.changes?.map(change => change.path).join(', ') || item.status;
      if (preview) card.append(make('div', 'event-preview', String(preview).replaceAll('\n', ' ').slice(0, 240)));
      if (item.files?.length) {
        const tags = make('div', 'event-tags');
        item.files.slice(0, 3).forEach(file => tags.append(make('span', 'tag', file)));
        if (item.files.length > 3) tags.append(make('span', 'tag', `+${item.files.length - 3}`));
        card.append(tags);
      }
      card.addEventListener('click', () => selectEvent(item));
      list.append(card);
    });
  }

  function selectEvent(item, reveal = true) {
    state.selected = item.id;
    state.position = events.findIndex(event => event.id === item.id);
    $('scrubber').value = Math.max(0, state.position);
    $('playback-position').textContent = `${events.length ? state.position + 1 : 0} / ${events.length} events`;
    document.querySelectorAll('.event-card').forEach(card => card.classList.toggle('active', card.dataset.id === item.id));
    renderInspector(item);
    if (reveal && window.matchMedia('(max-width: 1250px)').matches) $('inspector').classList.add('open');
  }

  function selectPosition(index, reveal = false) {
    if (!events.length) { renderInspector(null); return; }
    const bounded = Math.min(Math.max(index, 0), events.length - 1);
    selectEvent(events[bounded], reveal);
    const card = [...document.querySelectorAll('.event-card')].find(node => node.dataset.id === events[bounded].id);
    card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  function step(direction) {
    if (!events.length) return;
    if (state.view !== 'timeline') setView('timeline');
    selectPosition(state.position + direction);
  }

  function togglePlayback() {
    if (state.playing) {
      clearInterval(state.timer); state.playing = false; $('play-btn').textContent = '▶'; $('playback-label').textContent = 'Replay run'; return;
    }
    if (state.position >= events.length - 1) selectPosition(0);
    state.playing = true; $('play-btn').textContent = 'Ⅱ'; $('playback-label').textContent = 'Playing replay';
    state.timer = setInterval(() => {
      if (state.position >= events.length - 1) togglePlayback(); else step(1);
    }, 900);
  }

  function field(parent, label, value) {
    parent.append(make('div', 'field-label', label), make('div', 'field-value', value === undefined || value === null ? '—' : String(value)));
  }
  function code(parent, label, value, diff = false) {
    if (!value) return;
    parent.append(make('div', 'field-label', label));
    const block = make('pre', `code-block${diff ? ' diff' : ''}`);
    if (diff) String(value).split('\n').forEach(line => {
      const span = make('span', `diff-line${line.startsWith('+') && !line.startsWith('+++') ? ' add' : line.startsWith('-') && !line.startsWith('---') ? ' del' : line.startsWith('@@') ? ' hunk' : ''}`, line);
      block.append(span);
    });
    else block.textContent = String(value).slice(0, 30000);
    parent.append(block);
  }

  function renderInspector(item) {
    const container = $('inspector-content'); container.replaceChildren();
    const body = make('div', 'inspector-body');
    body.append(make('div', 'inspector-icon', item ? icons[item.kind] ?? '•' : '✦'));
    body.append(make('div', 'inspector-kicker', item ? labels[item.kind] ?? 'Event' : 'Select an event'));
    body.append(make('h3', '', item?.title ?? 'Run details'));
    body.append(make('p', 'inspector-description', item?.detail || (item ? 'Inspect the command, output, and files associated with this event.' : 'Choose a point on the timeline to see exactly what happened.')));
    body.append(make('div', 'inspector-divider'));
    if (item) {
      field(body, 'TIME', time(item.at));
      field(body, 'STATUS', item.status ?? (item.exitCode === 0 ? 'completed' : item.exitCode !== undefined ? `exit ${item.exitCode}` : 'completed'));
      if (item.files?.length) field(body, 'FILES', item.files.join('\n'));
      code(body, 'COMMAND', item.command);
      code(body, 'OUTPUT', item.output);
      if (item.changes?.length) field(body, 'REPORTED CHANGES', item.changes.map(change => `${change.kind ?? 'changed'}  ${change.path}`).join('\n'));
    } else {
      field(body, 'WORKSPACE', session.cwd ?? '—');
      field(body, 'THREAD', session.threadId ?? '—');
    }
    container.append(body);
  }

  function renderFiles() {
    const list = $('files-list'); list.replaceChildren();
    if (!session.viewedFiles?.length) { list.append(make('div', 'empty-state', 'No file reads could be inferred from commands.')); return; }
    session.viewedFiles.forEach(path => {
      const row = make('div', 'file-row');
      const text = make('div'); text.append(make('strong', '', path), make('small', '', 'Referenced in a read or search command'));
      row.append(make('span', 'file-icon', '▤'), text); list.append(row);
    });
  }

  function renderChanges() {
    const list = $('changes-list'); list.replaceChildren();
    if (!session.changes?.length) { list.append(make('div', 'empty-state', 'No text file changes were captured.')); return; }
    session.changes.forEach(change => {
      const row = make('button', 'change-row'); row.type = 'button';
      const text = make('div'); text.append(make('strong', '', change.path), make('small', '', change.status));
      const stat = make('span', 'diff-stat'); stat.append(make('span', 'plus', `+${change.additions}`), document.createTextNode('  '), make('span', 'minus', `−${change.deletions}`));
      row.append(make('span', 'file-icon', '⌁'), text, stat);
      row.addEventListener('click', () => {
        const container = $('inspector-content'); container.replaceChildren();
        const body = make('div', 'inspector-body');
        body.append(make('div', 'inspector-icon', '⌁'), make('div', 'inspector-kicker', 'Workspace diff'), make('h3', '', change.path), make('p', 'inspector-description', `${change.status} · +${change.additions} / −${change.deletions} lines`), make('div', 'inspector-divider'));
        code(body, 'PATCH', change.diff, true); container.append(body);
        if (window.matchMedia('(max-width: 1250px)').matches) $('inspector').classList.add('open');
      });
      list.append(row);
    });
  }

  function download() {
    const encoded = $('share-html').textContent.trim();
    const bytes = encoded ? Uint8Array.from(atob(encoded), char => char.charCodeAt(0)) : new TextEncoder().encode('<!doctype html>\n' + document.documentElement.outerHTML);
    const blob = new Blob([bytes], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = make('a'); link.href = url; link.download = `agentlens-${session.id ?? 'replay'}.html`;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  init();
})();
