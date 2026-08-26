import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createApp } from './app.js';

const root = process.cwd();
const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 4310);
const staticDir = join(root, 'dist');
const dbPath = process.env.DB_PATH || join(root, 'data', 'machquote.sqlite');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT: ${process.env.PORT}`);
}

const publicHost = !['127.0.0.1', 'localhost', '::1'].includes(host);
if (publicHost) {
  const missing = [];
  if (!process.env.PUBLIC_BASE_URL) missing.push('PUBLIC_BASE_URL');
  if (!process.env.ONLYOFFICE_JWT_SECRET) missing.push('ONLYOFFICE_JWT_SECRET');
  if (!existsSync(dbPath) && !process.env.INITIAL_ADMIN_PASSWORD) missing.push('INITIAL_ADMIN_PASSWORD');
  if (missing.length) throw new Error(`Public deployment requires: ${missing.join(', ')}`);
}

const app = await createApp({ dbPath, staticDir });
const server = app.listen(port, host, () => {
  console.log(`MFGGO SaaS API listening on http://${host}:${port}`);
});

const shutdown = () => {
  server.close(() => { app.close(); process.exit(0); });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
