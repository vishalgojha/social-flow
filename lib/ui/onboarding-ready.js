function nextActions() {
  return [
    { label: 'Open Hatch UI', command: 'social hatch' },
    { label: 'Run diagnostics', command: 'social doctor --quick' },
    { label: 'Start with a plain-English command', command: 'social ai "check auth status"' }
  ];
}

function readyLines(input = {}) {
  const profile = String(input.profile || 'default').trim() || 'default';
  const actions = nextActions();
  const lines = [];
  lines.push('You are now ready.');
  lines.push(`Profile: ${profile}`);
  lines.push('Next 3 actions:');
  actions.forEach((row, idx) => {
    lines.push(`${idx + 1}. ${row.label}: ${row.command}`);
  });
  return lines;
}

module.exports = {
  nextActions,
  readyLines
};
