import type { Manifest } from 'stremio-addon-sdk';
import { catalogViews } from '../../packages/recommendation/views.js';
import type { Profile } from '../../packages/shared/types.js';
import { feedPreferences, type FeedPreferences } from '../../packages/shared/preferences.js';

export type FeedManifest = Omit<Manifest, 'resources'> & { resources: Array<string | { name: string; types: string[]; idPrefixes: string[] }> };

export function createManifest(configured = false, preferences: Partial<FeedPreferences & Profile> = {}): FeedManifest {
  const prefs = feedPreferences(preferences);
  const event = (name: string) => ({ name, types: ['movie', 'series'], idPrefixes: ['tt'] });
  const skip = { name: 'skip' as const, isRequired: false };
  const hasHistory = Boolean(preferences.favorites?.length || preferences.likes?.length || preferences.watched?.length || preferences.started?.length || preferences.saved?.length);
  return {
    id: 'community.dkxai.personalizedfeed', version: '0.4.4', name: 'Personalized Feed',
    description: 'Gợi ý theo gu, phim tiếng Hàn, Anh, Nhật và Trung, anime theo mùa, tập mới và xu hướng tuần theo nền tảng. TMDB / JustWatch.',
    types: ['movie', 'series'],
    resources: ['catalog', event('meta'), ...(configured && prefs.syncLibrary ? [event('library')] : []), ...(configured && prefs.syncPlayback ? [event('player')] : [])],
    catalogs: [
      ...catalogViews(prefs, hasHistory).map(view => ({ type: view.type, id: `pf-${view.id}`,
        name: view.id === 'anime' && view.type === 'movie' ? 'Anime điện ảnh' : view.name,
        extra: [skip, { name: 'genre' as const, isRequired: !view.home, options: [...view.options] }],
      })),
      ...(['movie', 'series'] as const).map(type => ({ type, id: 'pf-search', name: 'Tìm phim & anime',
        extra: [{ name: 'search' as const, isRequired: true }, skip],
      })),
    ],
    behaviorHints: { configurable: true, configurationRequired: !configured },
  };
}
