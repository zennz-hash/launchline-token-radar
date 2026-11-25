// Launchline: empirical pre-token protocol valuation and costed farm-plan radar.
// Node 22+ standard library only. Deterministic across runs: identical inputs
// always produce identical output bytes.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, parseSnapshot, serializeDataScript, validateBoard } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT_DIR = fileURLToPath(new URL('.', import.meta.url));
const DOSSIER_TEXT_MAX = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function readFlag(name: string, fallback: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < process.argv.length) return process.argv[idx + 1]!;
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit === undefined ? fallback : hit.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function copyDirectoryFiles(srcDir: string, dstDir: string): string[] {
  if (!existsSync(srcDir)) return [];
  mkdirSync(dstDir, { recursive: true });
  const names = readdirSync(srcDir)
    .filter((n) => !n.startsWith('.'))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const copied: string[] = [];
  for (const name of names) {
    const srcPath = join(srcDir, name);
    if (!statSync(srcPath).isFile()) continue;
    copyFileSync(srcPath, join(dstDir, name));
    copied.push(name);
  }
  return copied;
}

const inputArg = readFlag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`launchline: snapshot not found at ${inputFile}\n`);
  process.exit(2);
}

const outDir = readFlag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const prepareUi = hasFlag('prepare-ui');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = validateBoard(board, snapshot);
if (issue !== null) {
  process.stderr.write(`launchline: board validation failed: ${issue}\n`);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), serializeDataScript(radar));

const dashFiles = copyDirectoryFiles(join(ROOT_DIR, 'dashboard'), join(outDir, 'dashboard'));
if (!prepareUi) {
  const shotFiles = copyDirectoryFiles(join(ROOT_DIR, 'screenshots'), join(outDir, 'screenshots'));
  if (shotFiles.length < 3 || shotFiles.length > 4) {
    process.stderr.write(`launchline: screenshots/ has ${shotFiles.length} images (expected 3 or 4)\n`);
    process.exit(1);
  }
  for (const name of shotFiles) {
    if (!PLAIN_IMAGE_NAME.test(name)) {
      process.stderr.write(`launchline: invalid screenshot name screenshots/${name}\n`);
      process.exit(1);
    }
  }
  const dossierBytes = buildDossier(outDir, {
    text_max_bytes: DOSSIER_TEXT_MAX,
    screenshots: SCREENSHOT_CAPS,
    dashboard: DASHBOARD_CAPS,
  });
  writeFileSync(join(outDir, 'dossier.json'), dossierBytes);
  const u = radar.universe_counts;
  process.stdout.write(
    `launchline: ${u.total} protocols (${u.watchlist} watchlist + ${u.early} early = ${u.ranked} ranked, ${u.live_total} live, ${u.excluded_total} excluded)\n` +
      `launchline: stage1 LOOCV RMSE=${radar.model.stage1.loocv_rmse} (starter=${radar.model.stage1.starter_rmse}), stage2 10f AUC=${radar.model.stage2.cv_auc}\n` +
      `launchline: wrote board.json, data.js, dashboard (${dashFiles.length} files), screenshots (${shotFiles.length} images), dossier.json (${dossierBytes.length} bytes)\n`,
  );
} else {
  const u = radar.universe_counts;
  process.stdout.write(
    `launchline: prepared UI data for ${u.ranked} ranked protocols (${u.watchlist} watchlist, ${u.early} early) in ${outDir}\n`,
  );
}
