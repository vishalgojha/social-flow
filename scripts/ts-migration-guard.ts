#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const rootFromDist = path.resolve(__dirname, '..', '..');
const rootFromSource = path.resolve(__dirname, '..');
const repoRoot = fs.existsSync(path.join(rootFromSource, 'tsconfig.legacy.json'))
  ? rootFromSource
  : rootFromDist;
const baselinePath = path.resolve(repoRoot, 'scripts', 'ts-migration-baseline.json');

function loadBaseline() {
  const raw = fs.readFileSync(baselinePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Number.isFinite(Number(parsed.max_js_files))) {
    throw new Error('Invalid ts-migration baseline: max_js_files must be numeric.');
  }
  return {
    maxJsFiles: Number(parsed.max_js_files),
    scanRoots: Array.isArray(parsed.scan_roots) ? parsed.scan_roots : [],
    excludePrefixes: Array.isArray(parsed.exclude_prefixes) ? parsed.exclude_prefixes : [],
    disallowedJsRoots: Array.isArray(parsed.disallowed_js_roots) ? parsed.disallowed_js_roots : [],
    allowedJsFiles: Array.isArray(parsed.allowed_js_files) ? parsed.allowed_js_files.map(normalizeRel) : []
  };
}

function normalizeRel(relPath) {
  return String(relPath || '').replace(/\\/g, '/');
}

function shouldExclude(relPath, excludePrefixes) {
  const rel = normalizeRel(relPath);
  const parts = rel.split('/').filter(Boolean);
  if (parts.includes('node_modules') || parts.includes('.git')) return true;
  return excludePrefixes.some((prefix) => rel.startsWith(normalizeRel(prefix)));
}

function walkFiles(absPath, relPath, acc, excludePrefixes) {
  if (shouldExclude(relPath, excludePrefixes)) return;
  const stat = fs.statSync(absPath);
  if (stat.isDirectory()) {
    const entries = fs.readdirSync(absPath, { withFileTypes: true });
    entries.forEach((entry) => {
      const childAbs = path.join(absPath, entry.name);
      const childRel = relPath ? `${relPath}/${entry.name}` : entry.name;
      walkFiles(childAbs, childRel, acc, excludePrefixes);
    });
    return;
  }
  acc.push(normalizeRel(relPath));
}

function collectFiles(scanRoots, excludePrefixes) {
  const files = [];
  scanRoots.forEach((scanRoot) => {
    const rel = normalizeRel(scanRoot);
    const abs = path.resolve(repoRoot, rel);
    if (!fs.existsSync(abs)) return;
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      walkFiles(abs, rel, files, excludePrefixes);
      return;
    }
    if (!shouldExclude(rel, excludePrefixes)) files.push(rel);
  });
  return files;
}

function main() {
  const baseline = loadBaseline();
  const files = collectFiles(baseline.scanRoots, baseline.excludePrefixes);
  const jsFiles = files.filter((file) => file.endsWith('.js'));
  const countedJsFiles = jsFiles.filter((file) => !baseline.allowedJsFiles.includes(file));
  const disallowedJs = jsFiles.filter((file) =>
    !baseline.allowedJsFiles.includes(file) &&
    baseline.disallowedJsRoots.some((root) => file.startsWith(`${normalizeRel(root)}/`))
  );

  let failed = false;

  if (countedJsFiles.length > baseline.maxJsFiles) {
    failed = true;
    // eslint-disable-next-line no-console
    console.error(
      `[ts-guard] JS file count increased: ${countedJsFiles.length} > baseline ${baseline.maxJsFiles}.`
    );
  } else {
    // eslint-disable-next-line no-console
    console.log(`[ts-guard] JS file count: ${countedJsFiles.length}/${baseline.maxJsFiles} (ok)`);
  }

  if (disallowedJs.length > 0) {
    failed = true;
    // eslint-disable-next-line no-console
    console.error('[ts-guard] JS files are not allowed in TS-native roots:');
    disallowedJs.slice(0, 50).forEach((file) => {
      // eslint-disable-next-line no-console
      console.error(`  - ${file}`);
    });
    if (disallowedJs.length > 50) {
      // eslint-disable-next-line no-console
      console.error(`  ...and ${disallowedJs.length - 50} more`);
    }
  }

  if (failed) {
    // eslint-disable-next-line no-console
    console.error('[ts-guard] Fail: reduce JS count or update baseline intentionally.');
    process.exit(1);
  }
}

main();
