import { spawn } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const apiPort = process.env.PORT || '4310';
const webEnvironment = { ...process.env, VITE_API_TARGET: `http://127.0.0.1:${apiPort}` };
const children = [
  spawn(process.execPath, [join(root, 'server', 'index.js')], { cwd: root, env: process.env, stdio: 'inherit' }),
  spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', '4173'], { cwd: root, env: webEnvironment, stdio: 'inherit' })
];

let shuttingDown = false;

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  setTimeout(() => process.exit(exitCode), 200).unref();
}

for (const child of children) {
  child.once('error', error => {
    console.error(error.message);
    shutdown(1);
  });
  child.once('exit', code => {
    if (!shuttingDown) shutdown(code || 0);
  });
}

process.once('SIGINT', () => shutdown(0));
process.once('SIGTERM', () => shutdown(0));
