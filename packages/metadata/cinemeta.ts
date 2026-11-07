import type { MetaDetail } from 'stremio-addon-sdk';
import type { Title } from '../shared/types.js';
import { TtlCache } from '../shared/cache.js';
import { toMetaPreview } from './mapper.js';

export type MetadataProvider = (title: Title) => Promise<MetaDetail | null>;

/** Cinemeta supplies live detail metadata and, crucially, series episode IDs. */
export function createCinemetaProvider(fetcher: typeof fetch = fetch): MetadataProvider {
  const cache = new TtlCache<MetaDetail>(200, 3_600_000);
  const inFlight = new Map<string, Promise<MetaDetail | null>>();
  return title => {
    const key = `${title.type}:${title.id}`;
    const cached = cache.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const request = (async () => {
      try {
        const response = await fetcher(`https://v3-cinemeta.strem.io/meta/${title.type}/${title.id}.json`, {
          signal: AbortSignal.timeout(6000), headers: { accept: 'application/json' },
        });
        if (!response.ok) throw new Error('Metadata unavailable');
        const data: unknown = await response.json();
        const meta = (data as { meta?: MetaDetail })?.meta;
        if (!meta || meta.id !== title.id || meta.type !== title.type || typeof meta.name !== 'string') throw new Error('Invalid metadata');
        cache.set(key, meta);
        return meta;
      } catch {
        // Do not fabricate episode lists. Stremio's installed Cinemeta can resolve series too.
        if (title.type === 'series') return null;
        return { ...toMetaPreview(title), genres: title.genres, releaseInfo: String(title.year) };
      } finally { inFlight.delete(key); }
    })();
    inFlight.set(key, request);
    return request;
  };
}
