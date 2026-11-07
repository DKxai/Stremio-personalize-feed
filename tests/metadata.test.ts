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
