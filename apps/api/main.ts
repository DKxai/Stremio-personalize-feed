import { PrismaClient } from '@prisma/client';
import { buildServer } from './server.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const db = new PrismaClient();
await db.$connect();
await db.$queryRawUnsafe('PRAGMA journal_mode=WAL');
await db.$queryRawUnsafe('PRAGMA busy_timeout=5000');
const app = await buildServer(db, config);
app.addHook('onClose', async () => db.$disconnect());
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    await app.close();
  });
}
try {
  await app.listen({ host: config.host, port: config.port });
} catch {
  app.log.error('Server startup failed; check runtime and database configuration');
  await app.close();
  process.exitCode = 1;
}
