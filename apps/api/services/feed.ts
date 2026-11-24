import type { DiscoverBatch, LibrarySource } from '../../../packages/metadata/live-library.js';
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
const rotatingHomeRows = new Set<CatalogId>(['recommended', 'because', 'gems', 'recent', 'anime', 'anime-season', 'lang-ko', 'lang-en', 'lang-ja', 'lang-zh']);

// Keep a strong match and surface a deeper suggestion within the first three posters.
// Only permute a fixed prefix so a refresh cannot move titles across page boundaries.
function homePreview(titles: Title[], count: number, turn: number, now: number): Title[] {
  const prefix = titles.slice(0, count);
  if (prefix.length < 2) return prefix;
  const split = Math.min(5, Math.ceil(prefix.length / 2));
  const near = prefix[turn % split]!;
  const deeper = prefix.slice(split);
  const today = vietnamDate(new Date(now));
  const fresh = deeper.filter(t => inReleaseWindow(latestRelease(t, today), 0, 89, today));
  const pick = fresh.length && turn % 2 === 0
    ? fresh[Math.floor(turn / 2) % fresh.length]!
    : deeper[turn % deeper.length]!;
  const lead = turn % 2 === 0 ? [near, pick] : [pick, near];
  return [...lead, ...prefix.filter(t => t !== near && t !== pick)];
}

interface DiscoveryList {
  titles: Title[];
  ids: Set<string>;
  nextPage: number;
  finished: boolean;
  revision: number;
  loading?: Promise<void>;
  preview?: { count: number; turn: number; refreshedAt: number };
}

export class FeedService {
  private readonly discovery = new TtlCache<DiscoveryList>(20, 30 * 60_000);
  private revision = 0;
  private readonly engine = new RecommendationEngine();
  private readonly signals = new TtlCache<ProfileSignals>(100, 300_000);
  private readonly loadingSignals = new Map<string, Promise<ProfileSignals>>();

  constructor(readonly library: LibrarySource, private readonly community?: CommunitySignals, private readonly now: () => number = Date.now) {}
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

  private async paginate(key: string, skip: number, size: number, load: (state: DiscoveryList) => Promise<DiscoverBatch>, home = false, rotate = false) {
    let list = this.discovery.get(key);
    if (!list) {
      list = { titles: [], ids: new Set(), nextPage: 0, finished: false, revision: ++this.revision };
      this.discovery.set(key, list);
    }
    const state = list;
    const extend = async () => {
      const { titles: batch, more } = await load(state);
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
    const required = home && skip === 0 ? 1 : skip + size;
    while (!state.finished && state.titles.length < required) {
      if (--budget < 0) {
        if (state.titles.length > skip) break;
        throw new UpstreamUnavailable('Đang chuẩn bị thêm kết quả. Hãy thử lại.');
      }
      state.loading ??= extend().finally(() => { state.loading = undefined; });
      await state.loading;
    }
    if (rotate && skip < 18 && state.titles.length) {
      const now = this.now();
      state.preview ??= { count: Math.min(18, state.titles.length), turn: Math.floor(now / 60_000) + Math.floor(now / 86_400_000), refreshedAt: now };
      const preview = state.preview;
      if (skip === 0 && now - preview.refreshedAt >= 60_000) {
        preview.turn++;
        preview.refreshedAt = now;
      }
      if (skip < preview.count) {
        const prefix = homePreview(state.titles, preview.count, preview.turn, preview.refreshedAt);
        return [...prefix.slice(skip), ...state.titles.slice(preview.count, skip + size)];
      }
    }
    return state.titles.slice(skip, skip + size);
  }

  async page(profile: Profile, type: MediaType, catalog: CatalogId | 'search', query: CatalogQuery): Promise<Title[]> {
    const region = feedPreferences(profile).region;
    const key = JSON.stringify([profile.id, profile.version, type, catalog, query.genre, query.search]);
    if (catalog === 'search') {
      const term = query.search;
      if (!term) return [];
      return this.paginate(key, query.skip, DISCOVERY_PAGE_SIZE, async state => {
        const page = state.nextPage + 1;
        if (this.library.searchPage) return this.library.searchPage(term, region, type, page);
        const titles = await this.library.search(term, region, type, page);
        return { titles, more: titles.length >= 20 };
      });
    }
    const view = selectCatalog(profile, catalog, type, query.genre);
    const id = view.id;
    profile = view.profile;
    if (id === 'saved' || id === 'watched') {
      const ids = [...new Set(id === 'watched' ? [...profile.watched, ...(profile.started ?? [])] : [...(profile.saved ?? []), ...profile.favorites, ...profile.likes])]
        .filter(id => !profile.itemTypes?.[id] || profile.itemTypes[id] === type);
      return this.paginate(key, query.skip, PAGE_SIZE, async state => {
        const start = state.nextPage * PAGE_SIZE;
        const results = await Promise.all(ids.slice(start, start + PAGE_SIZE).map(id => this.library.resolve(id, type, region)));
        const titles = results.filter((t): t is Title => Boolean(t)).map(t => ({ ...t, activityNote: profile.watched.includes(t.id) ? 'Đã xem' : profile.episodeCounts?.[t.id] ? `Đã xem ${profile.episodeCounts[t.id]} tập · chưa đánh dấu cả bộ` : profile.likes.includes(t.id) || profile.favorites.includes(t.id) ? 'Yêu thích' : 'Đã lưu trong thư viện' }));
        return { titles, more: start + PAGE_SIZE < ids.length };
      });
    }
    const theme = view.theme && animeThemes[view.theme];
    const window = view.releaseBand && releaseWindow(view.releaseBand);
    const today = vietnamDate(new Date());
    const eligible = (title: Title) => (id !== 'tv-shows' || title.originCountries?.some(code =>
      view.country ? code === view.country : ['GB', 'JP', 'KR', 'CN'].includes(code))) && (!theme || [...title.genres, ...title.keywords].some(value => theme.test(value)))
      && (!window || inReleaseWindow(latestRelease(title, today), ...window, today));
    return this.paginate(key, query.skip, DISCOVERY_PAGE_SIZE, async state => {
      if (!this.library.discoverPage || (id === 'recommended' && state.nextPage === 0)) {
        const titles = await this.recommend(profile, type, id, { skip: 0, genre: view.genre });
        return { titles: titles.filter(eligible), more: Boolean(this.library.discoverPage) };
      }
      const page = id === 'recommended' ? state.nextPage : state.nextPage + 1;
      const [source, signals] = await Promise.all([
        this.library.discoverPage(profile, type, id, page, view.genre, view.country), this.profileSignals(profile),
      ]);
      if (id === 'because' && !signals.seeds.length) return { titles: [], more: false };
      const candidates = source.titles.filter(t => !state.ids.has(t.id) && eligible(t));
      const titles = this.engine.recommend(view.genre ? { ...profile, genres: [view.genre] } : profile,
        type, id, candidates, signals.seeds, 'discover/' + state.revision + '/' + page,
        signals.community, state.titles.slice(-4));
      return { titles, more: source.more };
    }, !query.genre, !query.genre && rotatingHomeRows.has(id));
  }
}
