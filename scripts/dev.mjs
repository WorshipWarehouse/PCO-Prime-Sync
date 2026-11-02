#!/usr/bin/env node
/**
 * Start the API server (tsx watch) and the Vite dev server together.
 * Ctrl-C stops both. Kept dependency-free on purpose.
 */
import { spawn } from 'node:child_process';

const children = [];

function run(name, command, args) {
  const child = spawn(command, args, { stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('exit', (code) => {
    if (code !== 0) console.error(`[dev] ${name} exited with code ${code}`);
  });
  return child;
}

run('api', process.execPath, ['--import', 'tsx', 'src/server/index.ts']);
run('vite', process.execPath, ['node_modules/vite/bin/vite.js']);

function shutdown() {
  for (const child of children) {
    if (!child.killed) child.kill('SIGINT');
  }
  setTimeout(() => process.exit(0), 500).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
