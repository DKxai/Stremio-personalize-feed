import type { LibrarySource } from '../../../packages/metadata/live-library.js';
import type { Profile, MediaType, Title } from '../../../packages/shared/types.js';
import { feedPreferences } from '../../../packages/shared/preferences.js';
import { RecommendationEngine } from '../../../packages/recommendation/engine.js';
import { PAGE_SIZE, type CatalogId } from '../../../packages/recommendation/catalogs.js';
import type { CatalogQuery } from '../../../packages/recommendation/catalog-query.js';
import type { CommunitySignals } from '../../../packages/recommendation/community.js';
import { latestRelease, vietnamDate } from '../../../packages/recommendation/airing.js';
import { inReleaseWindow, releaseWindow } from '../../../packages/recommendation/dates.js';
import { animeThemes, selectCatalog } from '../../../packages/recommendation/views.js';
import { TtlCache } from '../../../packages/shared/cache.js';
import { UpstreamUnavailable } from '../../../packages/metadata/tmdb.js';

interface ProfileSignals {
  seeds: Title[];
  community: ReadonlyMap<string, number> | undefined;
}

const DISCOVERY_PAGE_SIZE = 30;

interface DiscoveryList {
  titles: Title[];
  ids: Set<string>;
  nextPage: number;
  finished: boolean;
  revision: number;
  loading?: Promise<void>;
}

export class FeedService {
  private readonly discovery = new TtlCache<DiscoveryList>(20, 30 * 60_000);
  private revision = 0;
  private readonly engine = new RecommendationEngine();
  private readonly signals = new TtlCache<ProfileSignals>(100, 300_000);
  private readonly loadingSignals = new Map<string, Promise<ProfileSignals>>();

  constructor(readonly library: LibrarySource, private readonly community?: CommunitySignals) {}
  async recommend(profile: Profile, type: MediaType, catalog: CatalogId, query: CatalogQuery = { skip: 0 }, sourceProfile = profile): Promise<Title[]> {
    if (catalog === 'because' && !profile.favorites.length && !profile.likes.length && !profile.watched.length && !profile.started?.length && !profile.saved?.length) return [];
    const [batch, signals] = await Promise.all([
      this.library.candidates(sourceProfile, type, catalog, query),
      this.profileSignals(profile),
    ]);
    const platformKey = catalog === 'trending' ? [...feedPreferences(profile).platforms].sort().join(',') : '';
    return this.engine.recommend(
      query.genre ? { ...profile, genres: [query.genre] } : profile,
      type, catalog, batch.titles.filter(title => !query.genre || title.genres.includes(query.genre)),
      signals.seeds, `${batch.revision}:${platformKey}:${query.genre || 'all'}:${Math.floor(Date.now() / 300_000)}`, signals.community,
    );
  }

  private async profileSignals(profile: Profile) {
    const key = `${profile.id}:${profile.version}`;
    const cached = this.signals.get(key);
    if (cached) return cached;
    const pending = this.loadingSignals.get(key);
    if (pending) return pending;

    const seedIds = [...new Set([
      ...profile.favorites, ...profile.likes.slice(0, 8), ...profile.watched.slice(0, 8),
      ...(profile.started ?? []).slice(0, 5), ...(profile.saved ?? []).slice(0, 5),
      ...profile.dislikes.slice(0, 4),
    ])].slice(0, 30);
    const region = feedPreferences(profile).region;
    const task = (async () => {
      const [results, community] = await Promise.all([
        Promise.allSettled(seedIds.map(id => this.library.resolve(id, profile.itemTypes?.[id], region))),
        this.community?.scores(profile),
      ]);
      const seeds: Title[] = [];
      let incomplete = false;
      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value) seeds.push(result.value);
        } else {
          if (!(result.reason instanceof UpstreamUnavailable)) throw result.reason;
          incomplete = true;
        }
      }
      const signals = { seeds, community };
      this.signals.set(key, signals, incomplete ? 30_000 : 300_000);
      return signals;
    })().finally(() => this.loadingSignals.delete(key));
    this.loadingSignals.set(key, task);
    return task;
  }

  private async discoveryPage(profile: Profile, type: MediaType, catalog: CatalogId, query: CatalogQuery, country?: string) {
    const key = JSON.stringify([profile.id, profile.version, type, catalog, query.genre, country]);
    let list = this.discovery.get(key);
    if (!list) {
      list = { titles: [], ids: new Set(), nextPage: 0, finished: false, revision: ++this.revision };
      this.discovery.set(key, list);
    }
    const state = list;
    const extend = async () => {
      let batch: Title[];
      let more = true;
      if (catalog === 'recommended' && state.nextPage === 0) {
        batch = await this.recommend(profile, type, catalog, query);
      } else {
        const page = catalog === 'recommended' ? state.nextPage : state.nextPage + 1;
        const [source, signals] = await Promise.all([
          this.library.discoverPage!(profile, type, catalog, page, query.genre, country), this.profileSignals(profile),
        ]);
        more = source.more;
        const candidates = source.titles.filter(t => !state.ids.has(t.id));
        batch = this.engine.recommend(query.genre ? { ...profile, genres: [query.genre] } : profile,
          type, catalog, candidates, signals.seeds, 'discover/' + state.revision + '/' + page,
          signals.community, state.titles.slice(-4));
      }
      for (const title of batch) {
        if (state.ids.has(title.id)) continue;
        state.titles.push(title);
        state.ids.add(title.id);
      }
      state.nextPage++;
      state.finished = !more;
    };
    // Bound upstream work for stale offsets and exceptionally sparse filters.
    // Progress survives retries, including a failure while fetching a later batch.
    let budget = 16;
    while (!state.finished && state.titles.length < query.skip + DISCOVERY_PAGE_SIZE) {
      if (--budget < 0) throw new UpstreamUnavailable('Đang chuẩn bị thêm kết quả. Hãy thử lại.');
      state.loading ??= extend().finally(() => { state.loading = undefined; });
      await state.loading;
    }
    return state.titles.slice(query.skip, query.skip + DISCOVERY_PAGE_SIZE);
  }

  async page(profile: Profile, type: MediaType, catalog: CatalogId | 'search', query: CatalogQuery): Promise<Title[]> {
    const region = feedPreferences(profile).region;
    if (catalog === 'search') {
      if (!query.search || query.skip % PAGE_SIZE) return [];
      const pages = await Promise.all(Array.from({ length: PAGE_SIZE / 20 }, (_, i) => this.library.search(query.search!, region, type, query.skip / 20 + i + 1)));
      return [...new Map(pages.flat().map(t => [t.id, t])).values()];
    }
    const sourceProfile = profile;
    const view = selectCatalog(profile, catalog, type, query.genre);
    profile = view.profile;
    catalog = view.id;
    if (catalog === 'saved' || catalog === 'watched') {
      const ids = [...new Set(catalog === 'watched' ? [...profile.watched, ...(profile.started ?? [])] : [...(profile.saved ?? []), ...profile.favorites, ...profile.likes])]
        .filter(id => !profile.itemTypes?.[id] || profile.itemTypes[id] === type);
      const titles = await Promise.all(ids.slice(query.skip, query.skip + PAGE_SIZE).map(id => this.library.resolve(id, type, region)));
      return titles.filter((t): t is Title => Boolean(t)).map(t => ({ ...t, activityNote: profile.watched.includes(t.id) ? 'Đã xem' : profile.episodeCounts?.[t.id] ? `Đã xem ${profile.episodeCounts[t.id]} tập · chưa đánh dấu cả bộ` : profile.likes.includes(t.id) || profile.favorites.includes(t.id) ? 'Yêu thích' : 'Đã lưu trong thư viện' }));
    }
    if (this.library.discoverPage && ['recommended', 'animation', 'tv-shows'].includes(catalog)) {
      return this.discoveryPage(profile, type, catalog, { skip: query.skip, genre: view.genre }, view.country);
    }
    const titles = await this.recommend(profile, type, catalog, { ...query, genre: view.genre }, sourceProfile);
    const theme = view.theme && animeThemes[view.theme];
    const window = view.releaseBand && releaseWindow(view.releaseBand);
    const today = vietnamDate(new Date());
    const filtered = titles.filter(title => (catalog !== 'tv-shows' || title.originCountries?.some(code =>
      view.country ? code === view.country : ['GB', 'JP', 'KR', 'CN'].includes(code))) && (!theme || [...title.genres, ...title.keywords].some(value => theme.test(value)))
      && (!window || inReleaseWindow(latestRelease(title, today), ...window, today)));
    return filtered.slice(query.skip, query.skip + PAGE_SIZE);
  }

}
