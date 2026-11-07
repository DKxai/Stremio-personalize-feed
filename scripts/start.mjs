import { spawnSync } from 'node:child_process';
import { mkdirSync, closeSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

// Prisma resolves relative SQLite paths against prisma/schema.prisma.
process.env.DATABASE_URL ||= 'file:../data/feed.db';
if (!process.env.DATABASE_URL.startsWith('file:')) throw new Error('This build requires a SQLite file DATABASE_URL');
const databasePath = process.env.DATABASE_URL.slice(5);
if (databasePath.includes('?') || databasePath === ':memory:') throw new Error('Use a plain SQLite file path');
const absoluteDatabasePath = resolve('prisma', databasePath);
mkdirSync(dirname(absoluteDatabasePath), { recursive: true });
// Pre-create a fresh SQLite file; do not truncate an existing database.
closeSync(openSync(absoluteDatabasePath, 'a', 0o600));
const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'inherit', env: process.env });
if (result.status !== 0) process.exit(result.status || 1);
await import('../dist/apps/api/main.js');
