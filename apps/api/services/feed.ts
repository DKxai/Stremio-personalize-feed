import type { LibrarySource } from '../../../packages/metadata/live-library.js';
import type { Profile, MediaType, Title } from '../../../packages/shared/types.js';
import { feedPreferences } from '../../../packages/shared/preferences.js';
import { RecommendationEngine } from '../../../packages/recommendation/engine.js';
import type { CatalogId } from '../../../packages/recommendation/catalogs.js';
import type { CommunitySignals } from '../../../packages/recommendation/community.js';

export class FeedService {
  private readonly engine = new RecommendationEngine();
  constructor(readonly library: LibrarySource, private readonly community?: CommunitySignals) {}
  async recommend(profile: Profile, type: MediaType, catalog: CatalogId): Promise<Title[]> {
    if (catalog === 'because' && !profile.favorites.length && !profile.likes.length && !profile.watched.length) return [];
    const seedIds = [...new Set([...profile.favorites, ...profile.likes.slice(0, 8), ...profile.watched.slice(0, 8), ...profile.dislikes.slice(0, 4)])].slice(0, 30);
    const region = feedPreferences(profile).region;
    const [batch, resolved, community] = await Promise.all([
      this.library.candidates(profile, type, catalog),
      Promise.all(seedIds.map(id => this.library.resolve(id, undefined, region))),
      this.community?.scores(profile),
    ]);
    const seeds = resolved.filter((t): t is Title => Boolean(t));
    return this.engine.recommend(profile, type, catalog, batch.titles, seeds, `${batch.revision}:${Math.floor(Date.now() / 300_000)}`, community);
  }
}
