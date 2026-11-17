import { TtlCache } from '../shared/cache.js';

interface SeriesInfo { imdb?: string; tags: string[] }
interface Named { name?: string }
interface SeriesRecord {
  id?: number;
  remoteIds?: { id?: string; sourceName?: string }[];
  genres?: Named[];
  tags?: Named[];
}

export class TvdbClient {
  private readonly cache = new TtlCache<SeriesInfo>(500, 86_400_000);
  private readonly pending = new Map<number | string, Promise<SeriesInfo | undefined>>();
  private token?: Promise<string>;
  private retryAt = 0;
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(private readonly key: string, private readonly pin?: string, private readonly fetcher: typeof fetch = fetch) {}

  private async request(path: string, init: RequestInit) {
    const response = await this.fetcher('https://api4.thetvdb.com/v4/' + path, {
      ...init, signal: AbortSignal.timeout(4000), redirect: 'error',
    });
    if (response.status === 404) return undefined;
    if (!response.ok) {
      if (response.status === 401) this.token = undefined;
      throw new Error('TVDB unavailable');
    }
    return (await response.json()).data;
  }

  async series(id: number | string): Promise<SeriesInfo | undefined> {
    const cached = this.cache.get(String(id));
    if (cached) return cached;
    if (Date.now() < this.retryAt) return undefined;
    const pending = this.pending.get(id);
    if (pending) return pending;
    const task = this.load(id).finally(() => this.pending.delete(id));
    this.pending.set(id, task);
    return task;
  }

  private async load(id: number | string) {
    if (this.active >= 3) await new Promise<void>(resolve => this.queue.push(resolve));
    else this.active++;
    try {
      if (Date.now() < this.retryAt) return undefined;
      this.token ??= this.request('login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apikey: this.key, pin: this.pin }),
      }).then(data => {
        if (typeof data?.token !== 'string' || !data.token) throw new Error('Missing TVDB token');
        return data.token as string;
      }).catch(error => { this.token = undefined; throw error; });
      const headers = { Authorization: 'Bearer ' + await this.token };
      let seriesId = id;
      if (typeof id === 'string') {
        if (!/^tt\d{7,10}$/.test(id)) return undefined;
        const matches = await this.request('search/remoteid/' + id, { headers });
        const ids = new Set<number>((matches ?? []).flatMap((m: { series?: { id?: number } }) =>
          m.series?.id && Number.isSafeInteger(m.series.id) ? [m.series.id] : []));
        if (ids.size !== 1) return undefined;
        seriesId = [...ids][0]!;
      }
      const record: SeriesRecord = await this.request('series/' + seriesId + '/extended', { headers });
      if (record?.id !== seriesId) return undefined;
      const imdb = record.remoteIds?.find(r => r.sourceName?.toLowerCase() === 'imdb' && /^tt\d{7,10}$/.test(r.id ?? ''))?.id;
      const tags = [...new Set([...(record.genres ?? []), ...(record.tags ?? [])]
        .map(t => t.name?.trim().toLowerCase()).filter((s): s is string => Boolean(s && s.length <= 80)))].slice(0, 16);
      const result = { imdb, tags };
      this.cache.set(String(id), result);
      return result;
    } catch {
      this.retryAt = Date.now() + 60_000;
      return undefined;
    } finally {
      const next = this.queue.shift();
      if (next) next(); else this.active--;
    }
  }
}
