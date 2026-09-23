import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { loadConfig } from './config.mjs';
import { applyMigrations, openDatabase, seedDatabase } from './db.mjs';
import { createApplication } from './http.mjs';

export function buildRuntime(overrides = {}) {
  const config = loadConfig(overrides);
  const db = openDatabase(config.databasePath);
  applyMigrations(db, config.migrationsDir);
  seedDatabase(db, config);
  const server = createApplication({ db, config });
  server.on('close', () => db.close());
  return { server, db, config };
}

export async function start(overrides = {}) {
  const runtime = buildRuntime(overrides);
  await new Promise((resolveListen, reject) => {
    runtime.server.once('error', reject);
    runtime.server.listen(runtime.config.port, runtime.config.host, resolveListen);
  });
  const address = runtime.server.address();
  console.log(`LagosPM listening on http://${runtime.config.host}:${address.port}`);
  return runtime;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  start().then((runtime) => {
    let stopping = false;
    const shutdown = async (signal) => {
      if (stopping) return;
      stopping = true;
      console.log(`Received ${signal}; closing LagosPM cleanly.`);
      const deadline = setTimeout(() => {
        console.error('Graceful shutdown timed out.');
        process.exit(1);
      }, 15_000);
      deadline.unref();
      try {
        await new Promise((resolveClose, rejectClose) => runtime.server.close((error) => error ? rejectClose(error) : resolveClose()));
        clearTimeout(deadline);
      } catch (error) {
        console.error(error);
        process.exitCode = 1;
      }
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  }).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
