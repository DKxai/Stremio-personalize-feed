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
