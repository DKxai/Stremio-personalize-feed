import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RecommendationEngine } from '../packages/recommendation/engine.js';
import { TITLES } from '../packages/metadata/fixtures.js';
import { CATALOGS } from '../packages/recommendation/catalogs.js';
import type { Profile } from '../packages/shared/types.js';

const profile = (id: string, genres: string[], favorites: string[] = []): Profile => ({ id, version: 1, genres, favorites, likes: [], dislikes: [], watched: [] });

test('different tastes produce different deterministic movie and series rankings', () => {
  const engine = new RecommendationEngine(TITLES);
  const sciFi = profile('science', ['Sci-Fi'], ['tt0816692']);
  const comedy = profile('comedy', ['Comedy', 'Romance'], ['tt0108778']);
  for (const type of ['movie', 'series'] as const) {
    const a = engine.recommend(sciFi, type, 'recommended').slice(0, 5).map(t => t.id);
    const b = engine.recommend(comedy, type, 'recommended').slice(0, 5).map(t => t.id);
    assert.notDeepEqual(a, b);
    assert.deepEqual(engine.recommend(sciFi, type, 'recommended').slice(0, 5).map(t => t.id), a);
  }
});

test('all strategies exclude favorites, watched titles and dislikes, without duplicate IDs', () => {
  const engine = new RecommendationEngine(TITLES);
  const p = profile('one', ['Sci-Fi'], ['tt0816692']);
  p.dislikes = ['tt1375666']; p.watched = ['tt0133093'];
  for (const catalog of CATALOGS) for (const type of ['movie', 'series'] as const) {
    const results = engine.recommend(p, type, catalog.id);
    assert.equal(new Set(results.map(t => t.id)).size, results.length);
    assert(results.every(t => t.type === type && ![...p.dislikes, ...p.favorites, ...p.watched].includes(t.id)));
  }
});

test('Because requires a seed, genre row matches selected genres, gems use the fixture threshold', () => {
  const engine = new RecommendationEngine(TITLES);
  const p = profile('p', ['Comedy']);
  assert.deepEqual(engine.recommend(p, 'movie', 'because'), []);
  assert(engine.recommend(p, 'movie', 'genres').every(t => t.genres.includes('Comedy')));
  assert(engine.recommend(p, 'movie', 'gems').every(t => t.popularity <= 0.45));
  assert(engine.recommend({ ...p, version: 2, favorites: ['tt0107048'] }, 'movie', 'because').length > 0);
});

test('cache reuses a ranking only for the same profile and version', () => {
  const engine = new RecommendationEngine(TITLES);
  const p = profile('v', ['Sci-Fi']);
  const first = engine.recommend(p, 'movie', 'recommended');
  assert.strictEqual(engine.recommend(p, 'movie', 'recommended'), first);
  const changed = engine.recommend({ ...p, version: 2, dislikes: [first[0]!.id] }, 'movie', 'recommended');
  assert(!changed.some(t => t.id === first[0]!.id));
});
