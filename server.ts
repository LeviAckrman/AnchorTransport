/**
 * AnchorTransport TMS - Full-Stack Express Server Entry Point
 * Mounts secure API proxy routes alongside Vite middleware on Port 3000
 * Supports direct execution via 'node server.ts' and 'tsx server.ts'
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Check if TSX loader is already active
const isTsxActive =
  process.execArgv.some((arg) => arg.includes('tsx') || arg.includes('loader.mjs')) ||
  process.env.ANCHOR_TSX_ACTIVE === '1';

if (!isTsxActive) {
  // Production / Raw Node runtime: Spawn via tsx import to support TypeScript ESM execution without compilation
  const scriptPath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, ['--import', 'tsx', scriptPath, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, ANCHOR_TSX_ACTIVE: '1' },
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });

  // Relay process termination signals
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
} else {
  // TSX is active: dynamically boot the full-stack server application
  await import('./src/server/app');
}
