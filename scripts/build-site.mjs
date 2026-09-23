import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(root, 'public');
const destination = resolve(root, 'dist');
const client = resolve(destination, 'client');
const server = resolve(destination, 'server');

await rm(destination, { recursive: true, force: true });
await mkdir(client, { recursive: true });
await mkdir(server, { recursive: true });
await cp(source, client, { recursive: true });
await cp(resolve(root, 'tokens.css'), resolve(client, 'theme-tokens.css'));
await cp(resolve(root, 'worker', 'index.mjs'), resolve(server, 'index.js'));

const indexPath = resolve(client, 'index.html');
let html = await readFile(indexPath, 'utf8');
html = html
  .replace(
    '</head>',
    '    <meta name="robots" content="noindex, nofollow">\n  </head>',
  )
  .replace(
    '<div id="application" class="app" hidden>',
    `<div id="application" class="app" hidden>
      <aside class="demo-banner" aria-label="Public demonstration notice">
        <span><strong>Hosted demonstration</strong> · Shared sample data with persistent role-based accounts.</span>
      </aside>`,
  )
  .replace(
    '<span>Local SQLite · Dated audit history</span>',
    '<span>Hosted D1 · Dated audit history</span>',
  )
  .replace(
    '<div><dt>Proxy</dt><dd>Nginx</dd></div>',
    '<div><dt>Edge</dt><dd>Sites</dd></div>',
  )
  .replace(
    '<div><dt>Service</dt><dd>localhost</dd></div>',
    '<div><dt>API</dt><dd>Worker</dd></div>',
  )
  .replace(
    '<div><dt>Data</dt><dd>SQLite</dd></div>',
    '<div><dt>Data</dt><dd>D1</dd></div>',
  );

await writeFile(indexPath, html, 'utf8');
await writeFile(resolve(client, '_headers'), `/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`);
await writeFile(resolve(server, 'wrangler.json'), `${JSON.stringify({
  name: 'lagospm-tracker',
  main: 'index.js',
  compatibility_date: '2026-05-22',
  compatibility_flags: ['nodejs_compat'],
  no_bundle: true,
  assets: { directory: '../client', binding: 'ASSETS', run_worker_first: true, not_found_handling: 'single-page-application' },
  d1_databases: [{ binding: 'DB', database_name: 'lagospm-local', database_id: '00000000-0000-4000-8000-000000000000', migrations_dir: '../../drizzle' }],
}, null, 2)}\n`);
console.log(`Hosted Sites build created at ${destination}`);
