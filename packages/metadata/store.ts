import type { PrismaClient } from '@prisma/client';
import type { Title, MediaType } from '../shared/types.js';

/** Bounded SQLite caches survive restarts. Expired upstream responses are never served as live data. */
export class MetadataStore {
  private writes = 0;
  private cleanup?: Promise<void>;
  constructor(private readonly db: PrismaClient) {}
  private async maintain() {
    if (++this.writes < 100) return;
    this.writes = 0;
    if (!this.cleanup) this.cleanup = this.prune().finally(() => { this.cleanup = undefined; });
    await this.cleanup;
  }
  async read(key: string): Promise<unknown | undefined> {
    const row = await this.db.externalCache.findUnique({ where: { key } });
    if (!row || row.expiresAt.getTime() <= Date.now()) return undefined;
    try { return JSON.parse(row.payload); } catch { return undefined; }
  }
  async write(key: string, value: unknown, ttl: number): Promise<void> {
    const payload = JSON.stringify(value);
    if (payload.length > 250_000) return;
    const data = { payload, expiresAt: new Date(Date.now() + ttl) };
    await this.db.externalCache.upsert({ where: { key }, create: { key, ...data }, update: data });
    await this.maintain();
  }
  async save(title: Title, region: string): Promise<void> {
    const key = `${region}:${title.type}:${title.id}`;
    const data = { imdbId: title.id, type: title.type, payload: JSON.stringify(title) };
    await this.db.movieMetadata.upsert({ where: { key }, create: { key, ...data }, update: data });
    await this.maintain();
  }
  async title(id: string, type?: MediaType, region = 'US'): Promise<Title | undefined> {
    const row = type
      ? await this.db.movieMetadata.findUnique({ where: { key: `${region}:${type}:${id}` } })
      : await this.db.movieMetadata.findFirst({ where: { imdbId: id, key: { startsWith: region + ':' } } });
    if (!row) return undefined;
    try { return JSON.parse(row.payload) as Title; } catch { return undefined; }
  }
  async prune(): Promise<void> {
    await this.db.externalCache.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    const upstream = await this.db.externalCache.findMany({ select: { key: true }, orderBy: { updatedAt: 'desc' }, skip: 500 });
    for (let i = 0; i < upstream.length; i += 200) await this.db.externalCache.deleteMany({ where: { key: { in: upstream.slice(i, i + 200).map(r => r.key) } } });
    const titles = await this.db.movieMetadata.findMany({ select: { key: true }, orderBy: { updatedAt: 'desc' }, skip: 2000 });
    for (let i = 0; i < titles.length; i += 200) await this.db.movieMetadata.deleteMany({ where: { key: { in: titles.slice(i, i + 200).map(r => r.key) } } });
  }
}
