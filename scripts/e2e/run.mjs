import { spawn } from 'node:child_process';
import { appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { todayInTokyo } from '../../e2e/fake-solidtime/server.mjs';

const root = resolve(import.meta.dirname, '../..');
const screenshots = process.argv.includes('--screenshots');
const env = {
  ...process.env,
  E2E_TODAY: process.env.E2E_TODAY ?? todayInTokyo(),
  ...(screenshots ? { SCREENSHOT_DIR: resolve(process.env.SCREENSHOT_DIR ?? 'screenshots-out/current') } : {}),
};
const project = process.env.E2E_PROJECT ?? `fpm-e2e-${process.pid}`;
// Explicit env file prevents Compose from loading a developer's .env file.
const compose = ['compose', '--env-file', 'e2e/app.env', '-p', project, '-f', 'e2e/compose.yaml'];
let child;
let interrupted = false;
const stop = signal => { interrupted = true; child?.kill(signal); };
const onInt = () => stop('SIGINT');
const onTerm = () => stop('SIGTERM');
process.on('SIGINT', onInt);
process.on('SIGTERM', onTerm);

function run(command, args, capture = false) {
  return new Promise((accept, reject) => {
    child = spawn(command, args, { cwd: root, env, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    const current = child;
    let output = '';
    if (capture) {
      current.stdout.on('data', chunk => { output += chunk; });
      current.stderr.on('data', chunk => { output += chunk; });
    }
    current.on('error', reject);
    current.on('exit', code => {
      if (child === current) child = undefined;
      if (code === 0) accept(output);
      else reject(new Error(`${command} exited with ${code ?? 'a signal'}`));
    });
  });
}

function checkDate() {
  if (env.E2E_TODAY !== todayInTokyo()) throw new Error('The JST date changed; rerun both captures with a fresh E2E_TODAY');
}

try {
  checkDate();
  await run('docker', ['info', '--format', '{{.ServerVersion}}']);
  if (env.E2E_SKIP_BUILD !== '1') await run('docker', [...compose, 'build', 'app']);
  if (interrupted) throw new Error('Interrupted');
  await run('docker', [...compose, 'up', '-d', '--no-build', '--wait', '--wait-timeout', '180']);
  if (interrupted) throw new Error('Interrupted');
  // Always run flow; screenshots.spec skips itself without SCREENSHOT_DIR.
  await run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config=e2e/playwright.config.ts']);
  checkDate();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  await mkdir(resolve(root, 'test-results'), { recursive: true });
  try {
    const log = await run('docker', [...compose, 'logs', '--no-color'], true);
    await appendFile(resolve(root, 'test-results/compose.log'), log);
  } catch { console.error('Could not collect Compose logs'); }
} finally {
  try { await run('docker', [...compose, 'down', '--volumes', '--remove-orphans', '--timeout', '60']); }
  catch { console.error('Compose cleanup failed'); process.exitCode = 1; }
  process.off('SIGINT', onInt);
  process.off('SIGTERM', onTerm);
}
