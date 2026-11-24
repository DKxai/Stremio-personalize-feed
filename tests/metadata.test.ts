import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCinemetaProvider } from '../packages/metadata/cinemeta.js';
import { TITLES } from '../packages/metadata/fixtures.js';

test('Cinemeta preserves episode IDs and caches valid responses', async () => {
  const title = TITLES.find(t => t.type === 'series')!;
  let calls = 0;
  const videos = [{ id: title.id + ':1:1', title:'Episode 1', season:1, episode:1 }];
  const provider = createCinemetaProvider((async () => {
    calls++; return new Response(JSON.stringify({ meta:{ id:title.id,type:title.type,name:title.name,videos } }));
  }) as typeof fetch);
  const first = await provider(title);
  assert.deepEqual(first?.videos, videos);
  await provider(title); assert.equal(calls, 1);
});

test('upstream failure falls back for a movie and never invents series episodes', async () => {
  const provider = createCinemetaProvider((async () => { throw new Error('offline'); }) as typeof fetch);
  const movie = TITLES.find(t => t.type === 'movie')!;
  assert.equal((await provider(movie))?.id, movie.id);
  assert.equal(await provider(TITLES.find(t => t.type === 'series')!), null);
});

test('TMDB Retry-After pauses queued lookups and still serves cached titles', async () => {
  const { TmdbClient } = await import('../packages/metadata/tmdb.js');
  let calls = 0;
  const client = new TmdbClient({ token: 'test' }, undefined, async input => {
    calls++;
    if (String(input).includes('/warm?')) return Response.json({ id: 1 });
    return new Response(null, { status: 429, headers: { 'retry-after': '60' } });
  });
  await client.get('warm');
  const results = await Promise.allSettled(Array.from({ length: 18 }, (_, i) => client.get('cold/' + i)));
  assert(results.every(r => r.status === 'rejected'));
  assert(calls <= 5);
  const before = calls;
  await assert.rejects(client.get('other'));
  assert.deepEqual(await client.get('warm'), { id: 1 });
  assert.equal(calls, before);
});
