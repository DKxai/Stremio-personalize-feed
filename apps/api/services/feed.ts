import type { LibrarySource } from '../../../packages/metadata/live-library.js';
import type { Profile, MediaType, Title } from '../../../packages/shared/types.js';
import { feedPreferences } from '../../../packages/shared/preferences.js';
import { RecommendationEngine } from '../../../packages/recommendation/engine.js';
import { PAGE_SIZE, type CatalogId } from '../../../packages/recommendation/catalogs.js';
import type { CatalogQuery } from '../../../packages/recommendation/catalog-query.js';
import type { CommunitySignals } from '../../../packages/recommendation/community.js';

export class FeedService {
  private readonly engine = new RecommendationEngine();
  constructor(readonly library: LibrarySource, private readonly community?: CommunitySignals) {}
  async recommend(profile: Profile, type: MediaType, catalog: CatalogId, query: CatalogQuery = { skip: 0 }): Promise<Title[]> {
    if (catalog === 'because' && !profile.favorites.length && !profile.likes.length && !profile.watched.length && !profile.started?.length && !profile.saved?.length) return [];
    const seedIds = [...new Set([...profile.favorites, ...profile.likes.slice(0, 8), ...profile.watched.slice(0, 8), ...(profile.started ?? []).slice(0, 5), ...(profile.saved ?? []).slice(0, 5), ...profile.dislikes.slice(0, 4)])].slice(0, 30);
    const region = feedPreferences(profile).region;
    const [batch, resolved, community] = await Promise.all([
      this.library.candidates(profile, type, catalog, query),
      Promise.all(seedIds.map(id => this.library.resolve(id, undefined, region))),
      this.community?.scores(profile),
    ]);
    const seeds = resolved.filter((t): t is Title => Boolean(t));
    return this.engine.recommend(query.genre ? { ...profile, genres: [query.genre] } : profile, type, catalog, batch.titles.filter(t => !query.genre || t.genres.includes(query.genre)), seeds, `${batch.revision}:${query.genre || 'all'}:${Math.floor(Date.now() / 300_000)}`, community);
  }
  async page(profile: Profile, type: MediaType, catalog: CatalogId | 'search', query: CatalogQuery): Promise<Title[]> {
    const region = feedPreferences(profile).region;
    if (catalog === 'search') {
      if (!query.search || query.skip % PAGE_SIZE) return [];
      const pages = await Promise.all(Array.from({ length: PAGE_SIZE / 20 }, (_, i) => this.library.search(query.search!, region, type, query.skip / 20 + i + 1)));
      return [...new Map(pages.flat().map(t => [t.id, t])).values()];
    }
    if (catalog === 'saved' || catalog === 'watched') {
      const ids = [...new Set(catalog === 'watched' ? [...profile.watched, ...(profile.started ?? [])] : [...(profile.saved ?? []), ...profile.favorites, ...profile.likes])]
        .filter(id => !profile.itemTypes?.[id] || profile.itemTypes[id] === type);
      const titles = await Promise.all(ids.slice(query.skip, query.skip + PAGE_SIZE).map(id => this.library.resolve(id, type, region)));
      return titles.filter((t): t is Title => Boolean(t)).map(t => ({ ...t, activityNote: profile.watched.includes(t.id) ? 'Đã xem' : profile.episodeCounts?.[t.id] ? `Đã xem ${profile.episodeCounts[t.id]} tập · chưa đánh dấu cả bộ` : profile.likes.includes(t.id) || profile.favorites.includes(t.id) ? 'Yêu thích' : 'Đã lưu trong thư viện' }));
    }
    return (await this.recommend(profile, type, catalog, query)).slice(query.skip, query.skip + PAGE_SIZE);
  }

}
