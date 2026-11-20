// Harbor Heat — entrypoint for the make.fun gta6-01 entry.
//
// What this program is: the hand-in step for a finished game. The game itself
// is the static site under game/ (an original open-world crime game set in the
// coastal city of Porto Serena, played offline in a desktop browser), and
// screenshots/ holds the four renders the judges see first. Running this file
// ships both trees into the output directory and writes the dossier the house
// grades from, then adds a manifest of its own so anyone can verify, byte for
// byte, exactly what was handed in.
//
//   MAKEFUN_OUTPUT_DIR=<dir> node main.ts     # <dir> stands in for /output
//
// The dossier is produced by the vendored make.fun library and written
// untouched: the scorer rebuilds it from the shipped trees and expects the
// file to match its own rebuild exactly, so nothing may be added to it. The
// manifest therefore lives beside it, in manifest.json, never inside it.

import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The bounty gate's own limits, passed to buildDossier whole: only the text
// cap shapes what the dossier contains, the rest make this program refuse an
// entry at exactly the points the scorer would refuse it.
const GATE = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

const SHOTS_WANTED_AT_LEAST = 3; // a cover plus enough views to judge by
const SHOT_BYTE_LIMIT = GATE.screenshots.max_bytes;

// The first bytes of the two still formats the bounty accepts.
const JPEG_HEAD = [0xff, 0xd8, 0xff];
const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const repoDir = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** Stop the hand-in with a message that says what is wrong and where. */
function refuse(what: string): never {
  throw new Error(`harbor-heat hand-in refused: ${what}`);
}

/** Code-unit order: the same ordering on every machine, locale-free. */
function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Every regular file under a directory, as paths relative to the repository
 * root in POSIX spelling (game/src/main.js), sorted once so that copying,
 * hashing and reporting all walk the trees in the same order every run.
 */
function collectFiles(treeName: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((x, y) => byName(x.name, y.name));
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push(full.slice(repoDir.length).split(sep).join('/'));
      else refuse(`${treeName}: ${entry.name} is not a regular file or directory`);
    }
  };
  walk(join(repoDir, treeName));
  return found.sort(byName);
}

/** True when the file at `path` starts with every byte of `head`. */
function startsWith(path: string, head: number[]): boolean {
  const bytes = readFileSync(path);
  return head.every((byte, i) => bytes[i] === byte);
}

/**
 * Check the entry before a single byte is copied: a hand-in that cannot be
 * played or cannot be judged should fail here, in the open, rather than at
 * the scorer's desk. buildDossier re-checks most of this on the shipped
 * copies; catching it first keeps a broken tree out of the output directory.
 */
function preflight(): { gameFiles: string[]; shotFiles: string[] } {
  const indexPath = join(repoDir, 'game', 'index.html');
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    refuse('game/index.html is missing — the game has no front door');
  }
  if (statSync(indexPath).size === 0) refuse('game/index.html is empty');

  const shotsDir = join(repoDir, 'screenshots');
  if (!existsSync(shotsDir) || !statSync(shotsDir).isDirectory()) {
    refuse('screenshots/ is missing — the judges would have nothing to see');
  }
  const shotFiles = collectFiles('screenshots');
  if (shotFiles.length < SHOTS_WANTED_AT_LEAST) {
    refuse(`screenshots/ holds ${shotFiles.length} image(s); at least ${SHOTS_WANTED_AT_LEAST} are required`);
  }
  for (const rel of shotFiles) {
    const full = join(repoDir, rel);
    const size = statSync(full).size;
    if (size > SHOT_BYTE_LIMIT) {
      refuse(`${rel} is ${size} bytes; a screenshot may be at most ${SHOT_BYTE_LIMIT}`);
    }
    if (!startsWith(full, JPEG_HEAD) && !startsWith(full, PNG_HEAD)) {
      refuse(`${rel} is neither a JPEG nor a PNG image`);
    }
  }
  return { gameFiles: collectFiles('game'), shotFiles };
}

interface ShippedFile {
  path: string;
  bytes: number;
  sha256: string;
}

/** Copy one tree into the output directory, recording each file shipped. */
function shipTree(treeName: string, files: string[], manifest: ShippedFile[]): number {
  let total = 0;
  for (const rel of files) {
    const source = join(repoDir, rel);
    const target = join(outDir, rel);
    mkdirSync(join(target, '..'), { recursive: true });
    copyFileSync(source, target);
    const bytes = readFileSync(source);
    manifest.push({ path: rel, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
    total += bytes.length;
  }
  return total;
}

function main(): void {
  const { gameFiles, shotFiles } = preflight();

  mkdirSync(outDir, { recursive: true });
  const manifest: ShippedFile[] = [];
  const gameBytes = shipTree('game', gameFiles, manifest);
  const shotBytes = shipTree('screenshots', shotFiles, manifest);
  manifest.sort((x, y) => byName(x.path, y.path));

  // The dossier, exactly as the vendored library writes it from the shipped
  // trees — see the note at the top of this file on why it stays untouched.
  const dossier = buildDossier(outDir, GATE);
  writeFileSync(join(outDir, 'dossier.json'), dossier);

  const manifestDoc = {
    entry: 'Harbor Heat (gta6-01)',
    files: manifest,
    totals: {
      files: manifest.length,
      bytes: gameBytes + shotBytes,
      game_files: gameFiles.length,
      game_bytes: gameBytes,
      screenshot_files: shotFiles.length,
      screenshot_bytes: shotBytes,
    },
  };
  writeFileSync(join(outDir, 'manifest.json'), `${JSON.stringify(manifestDoc, null, 2)}\n`);

  console.log(`Harbor Heat handed in to ${outDir}`);
  console.log(`  game:        ${gameFiles.length} files, ${gameBytes} bytes`);
  console.log(`  screenshots: ${shotFiles.length} files, ${shotBytes} bytes (cover: ${shotFiles[0]})`);
  console.log(`  dossier:     ${Buffer.byteLength(dossier, 'utf8')} bytes, plus manifest.json (${manifest.length} files hashed)`);
}

main();
