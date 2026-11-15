import type { Manifest } from 'stremio-addon-sdk';
import { HOME_CATALOGS } from '../../packages/recommendation/catalogs.js';
import { feedPreferences, type FeedPreferences } from '../../packages/shared/preferences.js';

import { hubOptions } from '../../packages/recommendation/hubs.js';

export type FeedManifest = Omit<Manifest, 'resources'> & { resources: Array<string | { name: string; types: string[]; idPrefixes: string[] }> };

export function createManifest(configured = false, preferences: Partial<FeedPreferences> = {}): FeedManifest {
  const prefs = feedPreferences(preferences);
  const event = (name: string) => ({ name, types: ['movie', 'series'], idPrefixes: ['tt'] });
  const skip = { name: 'skip' as const, isRequired: false };
  return {
    id: 'community.dkxai.personalizedfeed', version: '0.5.0', name: 'Personalized Feed',
    description: 'Gợi ý đa vùng: Âu-Mỹ, Asian, các mood, phim mới và Xu hướng tuần. Danh mục chuyên sâu trong bộ lọc của từng hub.',
    types: ['movie', 'series'],
    resources: ['catalog', event('meta'), ...(configured && prefs.syncLibrary ? [event('library')] : []), ...(configured && prefs.syncPlayback ? [event('player')] : [])],
    catalogs: (['movie', 'series'] as const).flatMap(type => [
      ...HOME_CATALOGS.map(c => ({ type, id: `pf-${c.id}`, name: c.name,
        extra: [skip, ...(['saved','watched'].includes(c.id) ? [] : [{ name: 'genre' as const, isRequired: false, options: hubOptions(c.id) }])],
      })),
      { type, id: 'pf-search', name: 'Tìm phim · Nhật / Hàn / Trung / Anime', extra: [{ name: 'search', isRequired: true }, skip] },
    ]),
    behaviorHints: { configurable: true, configurationRequired: !configured },
  };
}
