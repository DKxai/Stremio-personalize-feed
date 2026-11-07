import type { Manifest } from 'stremio-addon-sdk';
import { CATALOGS } from '../../packages/recommendation/catalogs.js';
import { GENRES, feedPreferences, type FeedPreferences } from '../../packages/shared/preferences.js';

export type FeedManifest = Omit<Manifest, 'resources'> & { resources: Array<string | { name: string; types: string[]; idPrefixes: string[] }> };

export function createManifest(configured = false, preferences: Partial<FeedPreferences> = {}): FeedManifest {
  const prefs = feedPreferences(preferences);
  const event = (name: string) => ({ name, types: ['movie', 'series'], idPrefixes: ['tt'] });
  const skip = { name: 'skip' as const, isRequired: false };
  return {
    id: 'community.dkxai.personalizedfeed', version: '0.4.0', name: 'Personalized Feed',
    description: 'Feed cá nhân: Nhật, Hàn, Trung, Anime, xu hướng tuần, phát hành trong 90 ngày; thư viện và danh sách Đã xem. TMDB / JustWatch.',
    types: ['movie', 'series'],
    resources: ['catalog', event('meta'), ...(configured && prefs.syncLibrary ? [event('library')] : []), ...(configured && prefs.syncPlayback ? [event('player')] : [])],
    catalogs: (['movie', 'series'] as const).flatMap(type => [
      ...CATALOGS.map(c => ({ type, id: `pf-${c.id}`, name: c.name,
        extra: [skip, ...(['saved','watched'].includes(c.id) ? [] : [{ name: 'genre' as const, isRequired: false, options: [...GENRES] }])],
      })),
      { type, id: 'pf-search', name: 'Tìm phim · Nhật / Hàn / Trung / Anime', extra: [{ name: 'search', isRequired: true }, skip] },
    ]),
    behaviorHints: { configurable: true, configurationRequired: !configured },
  };
}
