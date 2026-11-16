import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './build.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

function git(args, cwd = ROOT) {
  return execFileSync('git', args, { cwd, stdio: 'inherit' });
}

buildSite();

const worktreeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aki-deploy-'));
try {
  execFileSync('git', ['fetch', 'origin', 'deployment'], { cwd: ROOT, stdio: 'inherit' });
  git(['worktree', 'add', '--detach', worktreeDir, 'origin/deployment']);

  for (const entry of fs.readdirSync(worktreeDir)) {
    if (entry === '.git') continue;
    fs.rmSync(path.join(worktreeDir, entry), { recursive: true, force: true });
  }
  fs.cpSync(PUBLIC_DIR, worktreeDir, { recursive: true });

  git(['add', '-A'], worktreeDir);
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: worktreeDir, encoding: 'utf8' });
  if (!status.trim()) {
    console.log('No changes to deploy.');
  } else {
    const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
    git(['commit', '-m', `Site updated: ${stamp}`], worktreeDir);
    git(['push', 'origin', 'HEAD:deployment'], worktreeDir);
  }
} finally {
  try {
    execFileSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: ROOT, stdio: 'ignore' });
  } catch (_) {
    fs.rmSync(worktreeDir, { recursive: true, force: true });
  }
}
