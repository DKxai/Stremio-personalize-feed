import { PrismaClient } from '@prisma/client';
import { mkdirSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';

// VACUUM INTO creates a consistent snapshot including committed WAL data.
process.umask(0o077);
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'file:../data/feed.db';
const directory = resolve(process.env.BACKUP_DIR || 'data/backups');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const path = resolve(directory, `feed-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
const db = new PrismaClient();
try {
  await db.$executeRawUnsafe('VACUUM INTO ?', path);
  chmodSync(path, 0o600);
  const backup = new PrismaClient({ datasources: { db: { url: 'file:' + path } } });
  try {
    const check = await backup.$queryRawUnsafe('PRAGMA integrity_check');
    if (check[0]?.integrity_check !== 'ok') throw new Error('Backup integrity check failed');
    console.log(`Backup verified: ${path}`);
  } finally { await backup.$disconnect(); }
} catch {
  console.error('Backup failed. Check database permissions, free disk space and BACKUP_DIR.');
  process.exitCode = 1;
} finally { await db.$disconnect(); }
