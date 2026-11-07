import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync, closeSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { buildServer } from '../apps/api/server.js';
import { loadConfig } from '../apps/api/config.js';
import { CATALOGS } from '../packages/recommendation/catalogs.js';

const directory = mkdtempSync(join(tmpdir(), 'pf-test-'));
const databaseUrl = 'file:' + join(directory, 'feed.db');
const config = loadConfig({ PUBLIC_BASE_URL: 'https://feed.example', LOG_LEVEL: 'silent' });
let db: PrismaClient;
let app: Awaited<ReturnType<typeof buildServer>>;
let token = '';
let otherToken = '';
let userId = '';
const authorization = () => ({ authorization: 'Bearer ' + token });
const catalog = (id = 'recommended', type = 'movie', extra = '') => '/' + token + '/catalog/' + type + '/pf-' + id + extra + '.json';

before(async () => {
  closeSync(openSync(join(directory, 'feed.db'), 'a'));
  const migrate = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8',
  });
  assert.equal(migrate.status, 0, migrate.stderr);
  db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  // Offline, injected metadata: transport tests do not depend on an external service.
  app = await buildServer(db, config, async title => ({ id: title.id, type: title.type, name: title.name }));
});
after(async () => { await app?.close(); await db?.$disconnect(); rmSync(directory, { recursive: true, force: true }); });

test('health, onboarding assets, unconfigured manifest and CORS work', async () => {
  assert.equal((await app.inject('/health')).json().status, 'ok');
  assert.equal((await app.inject('/configure')).statusCode, 200);
  assert.match((await app.inject('/assets/configure.js')).body, /api\/profiles/);
  const response = await app.inject('/manifest.json');
  const manifest = response.json();
  assert.equal(manifest.catalogs.length, 12);
  assert.equal(manifest.behaviorHints.configurationRequired, true);
  assert.equal(response.headers['access-control-allow-origin'], '*');
  assert(!manifest.resources.includes('stream'));
});

test('create two isolated profiles and store only a token hash', async () => {
  const a = await app.inject({ method: 'POST', url: '/api/profiles', payload: { genres: ['Sci-Fi'], favorites: ['tt0816692'] } });
  assert.equal(a.statusCode, 201, a.body);
  const data = a.json(); token = data.token; userId = data.profile.id;
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(data.manifestUrl, 'https://feed.example/' + token + '/manifest.json');
  assert.match(data.installUrl, /^stremio:\/\//);
  const b = await app.inject({ method: 'POST', url: '/api/profiles', payload: { genres: ['Comedy', 'Romance'], favorites: ['tt0108778'] } });
  assert.equal(b.statusCode, 201, b.body); otherToken = b.json().token;
  assert.notEqual(token, otherToken);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  assert.notEqual(user.tokenHash, token); assert.equal(user.tokenHash.length, 64);
  assert.equal((await app.inject('/' + token + '/manifest.json')).json().behaviorHints.configurationRequired, false);
  assert.equal((await app.inject({ url: '/api/profile', headers: authorization() })).json().profile.id, userId);
});

test('every catalog serves valid IMDb previews for both types', async () => {
  for (const type of ['movie', 'series']) for (const { id } of CATALOGS) {
    const response = await app.inject(catalog(id, type));
    assert.equal(response.statusCode, 200, response.body);
    const { metas } = response.json();
    assert(metas.length > 0, type + ':' + id);
    for (const meta of metas) { assert.match(meta.id, /^tt\d+$/); assert.equal(meta.type, type); assert(meta.name); assert.match(meta.poster, /^https:/); }
    assert.match(response.headers['cache-control'] as string, /no-store/);
  }
});

test('profiles return different recommendations and pagination does not repeat titles', async () => {
  const a = (await app.inject(catalog())).json().metas;
  const b = (await app.inject('/' + otherToken + '/catalog/movie/pf-recommended.json')).json().metas;
  assert.notDeepEqual(a.slice(0, 5).map((t: { id: string }) => t.id), b.slice(0, 5).map((t: { id: string }) => t.id));
  const second = (await app.inject(catalog('recommended', 'movie', '/skip=20'))).json().metas;
  assert(second.length > 0); assert(second.every((t: { id: string }) => !a.some((x: { id: string }) => x.id === t.id)));
  assert.deepEqual((await app.inject(catalog('recommended', 'movie', '/skip=9999'))).json().metas, []);
  assert.equal((await app.inject(catalog('recommended', 'movie', '/skip=-1'))).statusCode, 400);
});

test('dislike invalidates cache and does not change another profile', async () => {
  const before = (await app.inject('/' + otherToken + '/catalog/movie/pf-recommended.json')).json();
  const first = (await app.inject(catalog())).json().metas[0].id;
  const response = await app.inject({ method:'POST', url:'/api/interactions', headers:authorization(), payload:{ mediaId:first, kind:'dislike' } });
  assert.equal(response.statusCode, 200, response.body);
  assert(!(await app.inject(catalog())).json().metas.some((t: { id: string }) => t.id === first));
  assert.deepEqual((await app.inject('/' + otherToken + '/catalog/movie/pf-recommended.json')).json(), before);
});

test('editing preferences updates ranking; manual watched and clear are persistent signals', async () => {
  const changed = await app.inject({ method:'PUT', url:'/api/profile', headers:authorization(), payload:{ genres:['Animation'], favorites:['tt0910970'] } });
  assert.equal(changed.statusCode, 200, changed.body);
  const genres = (await app.inject(catalog('genres'))).json().metas;
  assert(genres.length > 0);
  assert(!genres.some((t: { id: string }) => t.id === 'tt0910970'));
  assert.equal((await app.inject({ method:'POST', url:'/api/interactions', headers:authorization(), payload:{ mediaId:'tt0266543', kind:'watched' } })).statusCode, 200);
  assert((await app.inject({ url:'/api/profile', headers:authorization() })).json().profile.watched.includes('tt0266543'));
  await app.inject({ method:'POST', url:'/api/interactions', headers:authorization(), payload:{ mediaId:'tt0266543', kind:'clear' } });
  assert(!(await app.inject({ url:'/api/profile', headers:authorization() })).json().profile.watched.includes('tt0266543'));
});

test('unknown tokens, IDs, types and invalid bodies are rejected', async () => {
  assert.equal((await app.inject('/' + 'x'.repeat(43) + '/manifest.json')).statusCode, 401);
  assert.equal((await app.inject('/api/profile')).statusCode, 401);
  assert.equal((await app.inject(catalog('unknown'))).statusCode, 404);
  assert.equal((await app.inject(catalog('recommended', 'stream'))).statusCode, 404);
  for (const payload of [{ genres:['unknown'], favorites:[] }, { genres:[], favorites:['tt999'] }, { genres:[], favorites:[] }, { genres:['Drama'], favorites:[], unexpected:'value' }]) {
    assert.equal((await app.inject({ method:'POST', url:'/api/profiles', remoteAddress:'127.0.0.2', payload })).statusCode, 400);
  }
});

test('metadata uses the SDK bridge and does not serve streams', async () => {
  const response = await app.inject('/' + token + '/meta/movie/tt0816692.json');
  assert.equal(response.statusCode, 200, response.body); assert.equal(response.json().meta.id, 'tt0816692');
  assert.equal((await app.inject('/' + token + '/stream/movie/tt0816692.json')).statusCode, 404);
});

test('profile survives closing the server and reopening the same database', async () => {
  const expected = (await app.inject({ url:'/api/profile', headers:authorization() })).json();
  await app.close(); await db.$disconnect();
  db = new PrismaClient({ datasources:{ db:{ url:databaseUrl } } });
  app = await buildServer(db, config);
  assert.deepEqual((await app.inject({ url:'/api/profile', headers:authorization() })).json(), expected);
});

test('registration invitation is enforced when configured', async () => {
  const locked = await buildServer(db, { ...config, registrationKey:'invitation-test' });
  try {
    const payload = { genres:['Drama'], favorites:[] };
    assert.equal((await locked.inject({ method:'POST', url:'/api/profiles', payload })).statusCode, 403);
    assert.equal((await locked.inject({ method:'POST', url:'/api/profiles', payload:{...payload,registrationKey:'invitation-test'} })).statusCode, 201);
  } finally { await locked.close(); }
});
