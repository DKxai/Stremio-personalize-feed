import { TtlCache } from '../shared/cache.js';
import type { MetadataStore } from './store.js';

export class UpstreamUnavailable extends Error {
  statusCode = 503;
  constructor(message = 'Nguồn dữ liệu TMDB tạm thời không khả dụng. Hãy thử lại sau.') { super(message); }
}
export interface TmdbCredentials { token?: string; apiKey?: string }

/** Four requests at a time, including across concurrent Stremio catalog calls. */
export class TmdbClient {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  private readonly memory = new TtlCache<unknown>(500, 1_800_000);
  private readonly pending = new Map<string, Promise<any>>();
  constructor(private readonly credentials: TmdbCredentials, private readonly store?: MetadataStore, private readonly fetcher: typeof fetch = fetch) {}
  get configured() { return Boolean(this.credentials.token || this.credentials.apiKey); }
  async get(path: string, params: Record<string, string | number> = {}, ttl = 1_800_000): Promise<any> {
    if (!this.configured) throw new UpstreamUnavailable('Chưa cấu hình TMDB_READ_ACCESS_TOKEN trên máy chủ. Các catalog trực tiếp cần TMDB.');
    const query = new URLSearchParams({ language: 'vi-VN', ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    query.sort();
    // Credentials are never included in database keys, errors or logs.
    const key = `tmdb:${path}?${query}`;
    const cached = this.memory.get(key);
    if (cached !== undefined) return cached;
    const pending = this.pending.get(key);
    if (pending) return pending;
    const task = (async () => {
      const disk = await this.store?.read(key);
      if (disk !== undefined) { this.memory.set(key, disk, Math.min(ttl, 1_800_000)); return disk; }
      if (this.active >= 4) await new Promise<void>(resolve => this.queue.push(resolve));
      else this.active++;
      try {
        if (this.credentials.apiKey && !this.credentials.token) query.set('api_key', this.credentials.apiKey);
        const response = await this.fetcher(`https://api.themoviedb.org/3/${path}?${query}`, {
          headers: { accept: 'application/json', ...(this.credentials.token ? { Authorization: `Bearer ${this.credentials.token}` } : {}) },
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status === 404) return undefined;
        if (!response.ok) throw new UpstreamUnavailable(response.status === 401 ? 'TMDB từ chối API token. Kiểm tra cấu hình máy chủ.' : undefined);
        const data = await response.json();
        if (!data || typeof data !== 'object') throw new UpstreamUnavailable();
        await this.store?.write(key, data, ttl);
        this.memory.set(key, data, Math.min(ttl, 1_800_000));
        return data;
      } catch (error) { throw error instanceof UpstreamUnavailable ? error : new UpstreamUnavailable(); }
      finally { const next = this.queue.shift(); if (next) next(); else this.active--; }
    })().finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }
}
