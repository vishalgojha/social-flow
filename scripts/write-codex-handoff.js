#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ZERO_SHA = '0000000000000000000000000000000000000000';

function run(cmd) {
  return cp.execFileSync('git', cmd, { encoding: 'utf8' }).trim();
}

function parseArgs(argv) {
  const out = {
    remote: '',
    url: ''
  };
  for (let i = 0; i < argv.length; i += 1) {
    const v = argv[i];
    if (v === '--remote') out.remote = String(argv[i + 1] || '').trim();
    if (v === '--url') out.url = String(argv[i + 1] || '').trim();
  }
  return out;
}

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parsePushLines(stdin) {
  return String(stdin || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      if (parts.length < 4) return null;
      return {
        localRef: parts[0],
        localSha: parts[1],
        remoteRef: parts[2],
        remoteSha: parts[3]
      };
    })
    .filter(Boolean)
    .filter((x) => x.localSha !== ZERO_SHA);
}

function safe(cmd, fallback = '') {
  try {
    return run(cmd);
  } catch {
    return fallback;
  }
}

function mdList(title, rows) {
  if (!rows.length) return `## ${title}\n- (none)\n`;
  return `## ${title}\n${rows.map((r) => `- ${r}`).join('\n')}\n`;
}

function commitsForRange(oldSha, newSha) {
  if (!newSha || newSha === ZERO_SHA) return [];
  if (oldSha && oldSha === newSha) {
    const single = safe(['log', '-1', '--no-merges', '--oneline', newSha]);
    if (!single) return [];
    return [single];
  }
  const range = oldSha && oldSha !== ZERO_SHA ? `${oldSha}..${newSha}` : newSha;
  const raw = safe(['log', '--no-merges', '--max-count=25', '--oneline', range]);
  if (!raw) return [];
  return raw.split(/\r?\n/).filter(Boolean);
}

function changedFilesForRange(oldSha, newSha) {
  if (!newSha || newSha === ZERO_SHA) return [];
  if (oldSha && oldSha === newSha) {
    const rawSingle = safe(['show', '--name-only', '--pretty=format:', newSha]);
    return rawSingle ? rawSingle.split(/\r?\n/).filter(Boolean) : [];
  }
  if (oldSha && oldSha !== ZERO_SHA) {
    const raw = safe(['diff', '--name-only', `${oldSha}..${newSha}`]);
    return raw ? raw.split(/\r?\n/).filter(Boolean) : [];
  }
  const raw = safe(['show', '--name-only', '--pretty=format:', newSha]);
  return raw ? raw.split(/\r?\n/).filter(Boolean) : [];
}

function resolveGitDir(repoRoot) {
  const dotGit = path.join(repoRoot, '.git');
  if (fs.existsSync(dotGit) && fs.statSync(dotGit).isDirectory()) {
    return dotGit;
  }
  if (fs.existsSync(dotGit) && fs.statSync(dotGit).isFile()) {
    const raw = fs.readFileSync(dotGit, 'utf8');
    const m = /^gitdir:\s*(.+)\s*$/im.exec(raw || '');
    if (m && m[1]) {
      const resolved = path.resolve(repoRoot, m[1].trim());
      if (fs.existsSync(resolved)) return resolved;
    }
  }
  return '';
}

function readPackedRef(gitDir, refName) {
  try {
    const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8');
    const lines = packed.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#') || line.startsWith('^')) continue;
      const parts = line.split(/\s+/);
      if (parts.length >= 2 && parts[1] === refName) return parts[0];
    }
  } catch {
    // ignore
  }
  return '';
}

function readRefSha(gitDir, refName) {
  try {
    const refPath = path.join(gitDir, ...String(refName || '').split('/'));
    if (fs.existsSync(refPath)) {
      return fs.readFileSync(refPath, 'utf8').trim();
    }
  } catch {
    // ignore
  }
  return readPackedRef(gitDir, refName);
}

function readHeadSha(repoRoot) {
  const gitDir = resolveGitDir(repoRoot);
  if (!gitDir) return '';
  try {
    const headRaw = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const match = /^ref:\s*(.+)$/.exec(headRaw);
    if (match && match[1]) {
      return readRefSha(gitDir, match[1].trim());
    }
    return headRaw;
  } catch {
    return '';
  }
}

function resolvePushDirection(update, headSha) {
  if (headSha) {
    if (update.localSha === headSha && update.remoteSha !== headSha) {
      return {
        fromSha: update.remoteSha,
        toSha: update.localSha,
        commits: []
      };
    }
    if (update.remoteSha === headSha && update.localSha !== headSha) {
      return {
        fromSha: update.localSha,
        toSha: update.remoteSha,
        commits: []
      };
    }
  }
  const forwardCommits = commitsForRange(update.remoteSha, update.localSha);
  if (forwardCommits.length) {
    return {
      fromSha: update.remoteSha,
      toSha: update.localSha,
      commits: forwardCommits
    };
  }
  const reverseCommits = commitsForRange(update.localSha, update.remoteSha);
  if (reverseCommits.length) {
    return {
      fromSha: update.localSha,
      toSha: update.remoteSha,
      commits: reverseCommits
    };
  }
  return {
    fromSha: update.remoteSha,
    toSha: update.localSha,
    commits: []
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const stdin = readStdin();
  const updates = parsePushLines(stdin);
  if (!updates.length) {
    // Nothing pushed (or delete-only push). Keep last handoff file untouched.
    process.exit(0);
  }

  const repoRoot = safe(['rev-parse', '--show-toplevel'], process.cwd());
  const activeBranch = safe(['rev-parse', '--abbrev-ref', 'HEAD'], '');
  const preferred = updates.find((u) => activeBranch && u.localRef === `refs/heads/${activeBranch}`) || updates[0];
  const branchFromRefMatch = /^refs\/heads\/(.+)$/.exec(preferred.localRef);
  const branchFromRef = branchFromRefMatch ? branchFromRefMatch[1] : '';
  const branch = activeBranch || branchFromRef || 'unknown';
  const headSha = readHeadSha(repoRoot);
  const direction = resolvePushDirection(preferred, headSha);
  const pushedCommitsRaw = direction.commits;
  const filesRaw = changedFilesForRange(direction.fromSha, direction.toSha);
  const pushedCommits = pushedCommitsRaw.length
    ? pushedCommitsRaw
    : [`${direction.toSha || preferred.localSha} (details unavailable)`];
  const files = filesRaw.length
    ? filesRaw
    : ['(unavailable: history lookup failed)'];
  const latestCommit = safe(['show', '-s', '--oneline', '--no-patch', direction.toSha], '');
  const generatedAt = new Date().toISOString();

  const remoteLabel = args.remote || 'unknown';
  const remoteUrl = args.url || safe(['remote', 'get-url', remoteLabel], '');

  const body = [
    '# Codex Handoff',
    '',
    `Generated: ${generatedAt}`,
    `Repo: ${repoRoot}`,
    `Branch: ${branch}`,
    `Remote: ${remoteLabel}${remoteUrl ? ` (${remoteUrl})` : ''}`,
    `Push Ref: ${preferred.localRef} -> ${preferred.remoteRef}`,
    `Head: ${latestCommit || direction.toSha || preferred.localSha}`,
    '',
    mdList('Pushed Commits', pushedCommits),
    mdList('Files Changed In Push', files),
    '## Next Agent Notes',
    '- Start by reading this file and then run `git status`.',
    '- If tests are required, run `node test/run.js`.',
    ''
  ].join('\n');

  fs.writeFileSync(path.join(repoRoot, 'codex.md'), body, 'utf8');
}

main();
