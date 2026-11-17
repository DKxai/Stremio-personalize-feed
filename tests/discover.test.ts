import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FeedService } from '../apps/api/services/feed.js';
import { LiveLibrary } from '../packages/metadata/live-library.js';
import { TmdbClient } from '../packages/metadata/tmdb.js';
import { TvdbClient } from '../packages/metadata/tvdb.js';
import type { Profile } from '../packages/shared/types.js';

const profile: Profile = { id: 'p', version: 1, genres: [], favorites: [], likes: [], dislikes: [], watched: [] };

function source(tvdb?: TvdbClient) {
  const urls: URL[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    urls.push(url);
    const page = Number(url.searchParams.get('page') || 1);
    const isMovie = url.pathname.includes('/movie');
    if (url.pathname.includes('/discover/')) {
      const offset = 19 * (page - 1);
      return Response.json({ total_pages: 6, results: Array.from({ length: 20 }, (_, i) => ({ id: offset + i + 1 })) });
    }
    const id = Number(url.pathname.split('/').at(-1));
    return Response.json({
      title: 'Movie ' + id, name: 'Series ' + id, first_air_date: '2020-01-01', release_date: '2020-01-01',
      external_ids: { imdb_id: id === 1 && !isMovie ? null : 'tt' + (1000000 + id), tvdb_id: id },
      genres: [{ id: isMovie ? 16 : 10764 }],
      origin_country: [id % 9 === 0 ? 'JP' : 'GB'], original_language: 'en',
    });
  };
  return { library: new LiveLibrary(new TmdbClient({ token: 'test' }, undefined, fetcher), undefined, undefined, tvdb), urls };
}

test('animation pages join without duplicates across retries, exclude anime and stop at the end', async () => {
  const { library, urls } = source();
  const feed = new FeedService(library);
  const page = (skip: number) => feed.page(profile, 'movie', 'animation', { skip, genre: 'Tất cả' });
  const [first, retry] = await Promise.all([page(0), page(0)]);
  assert.deepEqual(first, retry);
  const second = await page(first.length);
  const third = await page(first.length + second.length);
  const last = await page(90);
  assert.deepEqual([first.length, second.length, third.length, last.length], [30, 30, 30, 13]);
  const all = [...first, ...second, ...third, ...last];
  assert(all.every(t => !t.isAnime));
  assert.equal(new Set(all.map(t => t.id)).size, all.length);
  assert.deepEqual(await page(all.length), []);
  assert.deepEqual(await page(0), first);
  const requests = urls.filter(url => url.pathname.includes('/discover/'));
  assert.equal(requests.length, 6);
  assert(requests.every(url => url.searchParams.get('with_genres') === '16'));
});

test('TV shows filter by origin, recover IMDb IDs and enrich ranking keywords from TVDB', async () => {
  let logins = 0;
  const tvdb = new TvdbClient('key', undefined, async input => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/login')) { logins++; return Response.json({ data: { token: 'token' } }); }
    const id = Number(path.split('/').at(-2));
    return Response.json({ data: { id, tags: [{ name: 'Cooking' }], remoteIds: [{ sourceName: 'IMDB', id: 'tt' + (1000000 + id) }] } });
  });
  const { library, urls } = source(tvdb);
  const results = await new FeedService(library).page(profile, 'series', 'tv-shows', { genre: 'Anh', skip: 0 });
  assert.equal(results.length, 30);
  assert(results.some(t => t.id === 'tt1000001'));
  assert(results.every(t => t.originCountries?.includes('GB') && t.keywords.includes('cooking')));
  assert.equal(logins, 1);
  assert(urls.filter(u => u.pathname.includes('/discover/')).every(u => u.searchParams.get('with_origin_country') === 'GB'));
});

test('an unavailable TVDB allows TMDB-only shows to be served and suppresses repeated logins', async () => {
  let calls = 0;
  const tvdb = new TvdbClient('key', undefined, async () => { calls++; return new Response(null, { status: 429 }); });
  const { library } = source(tvdb);
  const result = await new FeedService(library).page(profile, 'series', 'tv-shows', { genre: 'Anh', skip: 0 });
  assert.equal(result.length, 30);
  assert(!result.some(t => t.id === 'tt1000001'));
  assert.equal(calls, 1);
});

test('every selectable catalog and option can continue past an empty filtered source page', async () => {
  const { catalogViews, selectCatalog } = await import('../packages/recommendation/views.js');
  const { feedPreferences } = await import('../packages/shared/preferences.js');
  const p = { ...profile, ...feedPreferences(), homeExtras: ['because', 'regional-movies'], likes: ['tt1234567'] };
  for (const view of catalogViews(p)) {
    for (const option of view.options) {
      const selection = selectCatalog(p, view.id, view.type, option);
      if (['saved', 'watched'].includes(selection.id)) continue;
      const calls: number[] = [];
      const library = {
        mode: 'tmdb' as const,
        async candidates() { return { titles: [], source: 'tmdb' as const, revision: 'test' }; },
        async resolve() {
          return { id: 'tt1234567', type: view.type, name: 'Seed', year: 2020, quality: 1, popularity: 1, genres: [], cast: [], directors: [], keywords: [] };
        },
        async search() { return []; },
        async discoverPage(_p: Profile, type: string, id: string, page: number, genre?: string, country?: string) {
          assert.equal(type, view.type);
          assert.equal(id, selection.id);
          assert.equal(genre, selection.genre);
          assert.equal(country, selection.country);
          calls.push(page);
          return { titles: [], more: page < 2 };
        },
      };
      const service = new FeedService(library);
      assert.deepEqual(await service.page(p, view.type, view.id, { skip: 0, genre: option }), []);
      assert.deepEqual(calls, [1, 2], view.id + '/' + option);
    }
  }
});

test('typed search and incomplete saved metadata paginate by visible items', async () => {
  const base = { type: 'movie' as const, name: 'Title', year: 2020, genres: [], cast: [], directors: [], keywords: [], quality: 1, popularity: 1 };
  const ids = Array.from({ length: 125 }, (_, i) => 'tt' + (1000000 + i));
  const source = {
    mode: 'tmdb' as const,
    async resolve(id: string) { return id === ids[0] ? undefined : { ...base, id }; },
    async search() { return []; },
    async candidates() { return { titles: [], source: 'tmdb' as const, revision: 'test' }; },
    async searchPage(_term: string, _region: string, _type: string, page: number) {
      // First page lost all its IMDb mappings. Adjacent pages share one title.
      const titles = page === 1 ? [] : ids.slice((page - 2) * 19, (page - 2) * 19 + 20).map(id => ({ ...base, id }));
      return { titles, more: page < 4 };
    },
  };
  const service = new FeedService(source);
  const search = (skip: number) => service.page(profile, 'movie', 'search', { search: 'film', skip });
  assert.deepEqual([...(await search(0)), ...(await search(30))].map(t => t.id), ids.slice(0, 58));
  assert.deepEqual(await search(58), []);
  const library = (skip: number) => service.page({ ...profile, saved: ids }, 'movie', 'library', { genre: 'Đã lưu & Yêu thích', skip });
  assert.deepEqual([...(await library(0)), ...(await library(100))].map(t => t.id), ids.slice(1));
});

test('filtered language and anime rows fetch deeper matching TMDB pages', async () => {
  const { library, urls } = source();
  for (const id of ['lang-en', 'anime', 'japanese', 'gems'] as const) {
    urls.length = 0;
    await library.discoverPage(profile, 'movie', id, 2);
    const requests = urls.filter(u => u.pathname.includes('/discover/'));
    assert(requests.some(u => u.searchParams.get('page') === '3'));
    assert(requests.some(u => u.searchParams.get('page') === '4'));
    if (id === 'lang-en') assert(requests.every(u => u.searchParams.get('with_original_language') === 'en'));
    if (id === 'anime') assert(requests.every(u => u.searchParams.get('with_genres') === '16'));
  }
});
