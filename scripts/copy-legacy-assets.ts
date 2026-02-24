#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const rootFromSource = path.resolve(__dirname, '..');
const rootFromDist = path.resolve(__dirname, '..', '..');
const repoRoot = fs.existsSync(path.join(rootFromSource, 'tsconfig.legacy.json')) ? rootFromSource : rootFromDist;
const distRoot = path.join(repoRoot, 'dist-legacy');
const jsonRoots = ['bin', 'commands', 'lib', 'scripts', 'src-runtime', 'test', 'tests', 'tools'];

function copyFileRel(relPath: string): void {
  const src = path.join(repoRoot, relPath);
  const dst = path.join(distRoot, relPath);
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function walkJsonFiles(relDir: string): void {
  const absDir = path.join(repoRoot, relDir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) return;

  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const childRel = path.join(relDir, entry.name);
    const childAbs = path.join(repoRoot, childRel);

    if (entry.isDirectory()) {
      walkJsonFiles(childRel);
      continue;
    }

    if (entry.isFile() && childAbs.toLowerCase().endsWith('.json')) {
      copyFileRel(childRel);
    }
  }
}

copyFileRel('package.json');
jsonRoots.forEach((root) => walkJsonFiles(root));
