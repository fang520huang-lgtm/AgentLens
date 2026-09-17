function normalized(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/\s+/g, ' ').trim();
}

function eventSignature(item) {
  if (!item) return null;
  const subject = item.kind === 'command' ? item.command :
    item.kind === 'change' ? (item.files ?? []).join('|') :
    item.detail || item.title;
  return `${item.kind}:${normalized(subject)}`;
}

function eventDifferences(a, b) {
  if (!a || !b) return ['event missing'];
  const fields = [];
  if (eventSignature(a) !== eventSignature(b)) fields.push('action');
  if (a.exitCode !== b.exitCode) fields.push('exit code');
  if ((a.status ?? '') !== (b.status ?? '')) fields.push('status');
  if (normalized(a.output) !== normalized(b.output)) fields.push('output');
  return fields;
}

function difference(left, right) {
  const other = new Set(right);
  return [...new Set(left)].filter(item => !other.has(item)).sort();
}

function extraCommands(left, right) {
  const counts = new Map();
  for (const command of right) counts.set(command, (counts.get(command) ?? 0) + 1);
  const extra = [];
  for (const command of left) {
    const available = counts.get(command) ?? 0;
    if (available) counts.set(command, available - 1);
    else extra.push(command);
  }
  return extra;
}

export function compareRuns(a, b) {
  const timelineA = a.timeline ?? [];
  const timelineB = b.timeline ?? [];
  let firstDifferentIndex = 0;
  while (firstDifferentIndex < timelineA.length && firstDifferentIndex < timelineB.length &&
    eventDifferences(timelineA[firstDifferentIndex], timelineB[firstDifferentIndex]).length === 0) firstDifferentIndex++;
  const commandsA = timelineA.filter(item => item.kind === 'command').map(item => normalized(item.command));
  const commandsB = timelineB.filter(item => item.kind === 'command').map(item => normalized(item.command));
  const changesA = new Map((a.changes ?? []).map(item => [item.path, item]));
  const changesB = new Map((b.changes ?? []).map(item => [item.path, item]));
  const inputA = a.usage?.input_tokens ?? 0;
  const inputB = b.usage?.input_tokens ?? 0;
  const outputA = a.usage?.output_tokens ?? 0;
  const outputB = b.usage?.output_tokens ?? 0;
  const additionsA = a.stats?.additions ?? [...changesA.values()].reduce((sum, item) => sum + (item.additions ?? 0), 0);
  const additionsB = b.stats?.additions ?? [...changesB.values()].reduce((sum, item) => sum + (item.additions ?? 0), 0);
  const deletionsA = a.stats?.deletions ?? [...changesA.values()].reduce((sum, item) => sum + (item.deletions ?? 0), 0);
  const deletionsB = b.stats?.deletions ?? [...changesB.values()].reduce((sum, item) => sum + (item.deletions ?? 0), 0);
  return {
    schemaVersion: 1,
    runs: [{ id: a.id ?? 'run-a', outcome: a.outcome ?? null }, { id: b.id ?? 'run-b', outcome: b.outcome ?? null }],
    firstDifference: firstDifferentIndex === timelineA.length && firstDifferentIndex === timelineB.length ? null : {
      index: firstDifferentIndex,
      fields: eventDifferences(timelineA[firstDifferentIndex], timelineB[firstDifferentIndex]),
      a: timelineA[firstDifferentIndex] ? { kind: timelineA[firstDifferentIndex].kind, signature: eventSignature(timelineA[firstDifferentIndex]) } : null,
      b: timelineB[firstDifferentIndex] ? { kind: timelineB[firstDifferentIndex].kind, signature: eventSignature(timelineB[firstDifferentIndex]) } : null
    },
    eventCounts: { a: timelineA.length, b: timelineB.length },
    commands: { onlyA: extraCommands(commandsA, commandsB), onlyB: extraCommands(commandsB, commandsA) },
    viewedFiles: { onlyA: difference(a.viewedFiles ?? [], b.viewedFiles ?? []), onlyB: difference(b.viewedFiles ?? [], a.viewedFiles ?? []) },
    patches: {
      onlyA: difference([...changesA.keys()], [...changesB.keys()]),
      onlyB: difference([...changesB.keys()], [...changesA.keys()]),
      different: [...changesA.keys()].filter(path => changesB.has(path) && changesA.get(path).diff !== changesB.get(path).diff).sort()
    },
    patchLines: {
      a: { additions: additionsA, deletions: deletionsA },
      b: { additions: additionsB, deletions: deletionsB },
      delta: { additions: additionsB - additionsA, deletions: deletionsB - deletionsA }
    },
    tokens: {
      a: { input: inputA, output: outputA, total: inputA + outputA },
      b: { input: inputB, output: outputB, total: inputB + outputB },
      delta: { input: inputB - inputA, output: outputB - outputA, total: inputB + outputB - inputA - outputA }
    }
  };
}

export function formatComparison(report) {
  const lines = [
    `AgentLens comparison: ${report.runs[0].id} → ${report.runs[1].id}`,
    report.firstDifference ? `First difference: event ${report.firstDifference.index + 1} (${report.firstDifference.fields.join(', ')})` : 'Captured event sequence: identical',
    `  A: ${report.firstDifference?.a?.signature ?? '—'}`,
    `  B: ${report.firstDifference?.b?.signature ?? '—'}`,
    `Commands only in A (${report.commands.onlyA.length}): ${report.commands.onlyA.join(' | ') || '—'}`,
    `Commands only in B (${report.commands.onlyB.length}): ${report.commands.onlyB.join(' | ') || '—'}`,
    `Files viewed only in A: ${report.viewedFiles.onlyA.join(', ') || '—'}`,
    `Files viewed only in B: ${report.viewedFiles.onlyB.join(', ') || '—'}`,
    `Patches only in A: ${report.patches.onlyA.join(', ') || '—'}`,
    `Patches only in B: ${report.patches.onlyB.join(', ') || '—'}`,
    `Different patches: ${report.patches.different.join(', ') || '—'}`,
    `Patch lines: A +${report.patchLines.a.additions}/−${report.patchLines.a.deletions} → B +${report.patchLines.b.additions}/−${report.patchLines.b.deletions}`,
    `Tokens: A ${report.tokens.a.total} → B ${report.tokens.b.total} (${report.tokens.delta.total >= 0 ? '+' : ''}${report.tokens.delta.total})`
  ];
  return lines.join('\n');
}
