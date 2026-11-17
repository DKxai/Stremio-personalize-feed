import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtempSync, rmSync, closeSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { buildServer } from '../apps/api/server.js';
import { loadConfig } from '../apps/api/config.js';
import { LiveLibrary } from '../packages/metadata/live-library.js';
import { TmdbClient } from '../packages/metadata/tmdb.js';
import { mockTmdb } from './helpers/tmdb.js';
import { vietnamDate } from '../packages/recommendation/airing.js';
import { inReleaseWindow } from '../packages/recommendation/dates.js';
import { CATALOGS } from '../packages/recommendation/catalogs.js';

const directory = mkdtempSync(join(tmpdir(), 'pf-test-'));
const databaseUrl = 'file:' + join(directory, 'feed.db');
const config = loadConfig({ PUBLIC_BASE_URL: 'https://feed.example', LOG_LEVEL: 'silent', DEMO_MODE: 'true' });
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
  assert.equal(manifest.catalogs.length, 22);
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
    const filters: Record<string, string> = { languages: 'Tiếng Anh', origins: 'Nhật Bản', library: 'Đã xem' };
    if (id === 'languages' && type === 'series') continue;
    const filter = filters[id] ? '/' + new URLSearchParams({ genre: filters[id] }) : '';
    const response = await app.inject(catalog(id, type, filter));
    assert.equal(response.statusCode, 200, response.body);
    const { metas } = response.json();
    if (['recommended', 'because', 'genres', 'gems', 'top'].includes(id)) assert(metas.length > 0, type + ':' + id);
    if (['trending', 'new30', 'new60', 'new90', 'anime-new'].includes(id)) assert.equal(metas.length, 0, 'Demo must not pretend to serve live releases');
    for (const meta of metas) { assert.match(meta.id, /^tt\d+$/); assert.equal(meta.type, type); assert(meta.name); assert.match(meta.poster, /^https:/); }
    assert.match(response.headers['cache-control'] as string, /no-store/);
  }
});

test('profiles return different recommendations and pagination does not repeat titles', async () => {
  const a = (await app.inject(catalog())).json().metas;
  const b = (await app.inject('/' + otherToken + '/catalog/movie/pf-recommended.json')).json().metas;
  assert.notDeepEqual(a.slice(0, 5).map((t: { id: string }) => t.id), b.slice(0, 5).map((t: { id: string }) => t.id));
  const second = (await app.inject(catalog('recommended', 'movie', '/skip=100'))).json().metas;
  assert.equal(second.length, 0); assert(second.every((t: { id: string }) => !a.some((x: { id: string }) => x.id === t.id)));
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
    const created=await locked.inject({ method:'POST', url:'/api/profiles', payload:{...payload,registrationKey:'invitation-test'} });
    assert.equal(created.statusCode,201);assert(!JSON.stringify(created.json().profile).includes('invitation-test'));
    const stored=await db.preference.findUniqueOrThrow({where:{userId:created.json().profile.id}});assert(!stored.feed.includes('invitation-test'));
  } finally { await locked.close(); }
});


test('live TMDB catalog flow accepts searched IMDb IDs, persists feed preferences and updates profile-specific anime recommendations', async () => {
  const clock=new Date();
  const source=new LiveLibrary(new TmdbClient({token:'test-private-token'},undefined,mockTmdb([],clock)),undefined,()=>clock);
  const live=await buildServer(db,config,async t=>({id:t.id,type:t.type,name:t.name}),source);
  try {
    const library=(await live.inject('/api/library')).json();assert.equal(library.demo,false);assert.equal(library.source,'tmdb');
    assert(library.catalogs.some((c:{id:string})=>c.id==='anime-new'));
    const search=(await live.inject('/api/search?q=anime&region=US')).json();assert.equal(search.titles.length,2);
    const created=await live.inject({method:'POST',url:'/api/profiles',payload:{genres:['Animation'],favorites:['tt1000001'],region:'US',platforms:['netflix','disney'],preferredOrigins:['JP'],preferAnime:true}});
    assert.equal(created.statusCode,201,created.body);
    const {token:liveToken,profile}=created.json();assert.equal(profile.region,'US');assert.deepEqual(profile.preferredOrigins,['JP']);
    const header={authorization:'Bearer '+liveToken};
    const saved=(await live.inject({url:'/api/favorites',headers:header})).json();assert.equal(saved.titles[0].id,'tt1000001');
    for(const type of ['movie','series']) for(const id of ['trending','new30','new60','new90','anime','anime-new','korean','chinese','japanese']) {
      const response=await live.inject('/'+liveToken+'/catalog/'+type+'/pf-'+id+'.json');assert.equal(response.statusCode,200,response.body);
      const metas=response.json().metas;assert(metas.length>0,type+id);
      assert(!metas.some((m:{id:string})=>m.id==='tt1000001'));
      if (id === 'trending') {
        const platforms = metas.map((m: { description: string }) => m.description.includes('Có trên: Netflix') ? 'Netflix' : 'Disney Plus');
        const firstDisney = platforms.indexOf('Disney Plus');
        assert(firstDisney > 0);
        assert(!platforms.slice(firstDisney).includes('Netflix'));
      }
      if(id==='new30') assert(metas.every((m:{description:string})=>inReleaseWindow(m.description.slice(0,10),0,29,vietnamDate(clock))));
      if(id==='anime-new') assert(metas.every((m:{description:string})=>inReleaseWindow(m.description.slice(0,10),0,89,vietnamDate(clock))));
    }
    const seriesView = (id: string, genre: string) => '/' + liveToken + '/catalog/series/pf-' + id + '/' + new URLSearchParams({ genre }) + '.json';
    const episodes = (await live.inject('/' + liveToken + '/catalog/series/pf-anime-episodes.json')).json().metas;
    assert.match(episodes.find((meta: { id: string }) => meta.id === 'tt1000031')?.description ?? '', /Tập 3, mùa 2/);
    const next = (await live.inject(seriesView('anime', 'Sắp phát sóng'))).json().metas;
    assert.match(next.find((meta: { id: string }) => meta.id === 'tt1000031')?.description ?? '', /Dự kiến phát sóng/);
    const recentSeason = (await live.inject(seriesView('recent', 'Trong 30 ngày'))).json().metas;
    assert.match(recentSeason.find((meta: { id: string }) => meta.id === 'tt1000031')?.description ?? '', /Mùa mới/);
    const disneyOnly = (await live.inject(seriesView('trending', 'Disney+'))).json().metas;
    assert(disneyOnly.length > 0 && disneyOnly.every((meta: { description: string }) => meta.description.includes('Có trên: Disney Plus')));
    assert.equal((await live.inject(seriesView('trending', 'Prime Video'))).statusCode, 400);
    const english = (await live.inject('/' + liveToken + '/catalog/movie/pf-languages/' + new URLSearchParams({ genre: 'Tiếng Anh' }) + '.json')).json().metas;
    assert.deepEqual(english.map((meta: { id: string }) => meta.id), ['tt1000005']);
    const first=(await live.inject('/'+liveToken+'/catalog/movie/pf-anime.json')).json().metas[0].id;
    assert.equal((await live.inject({method:'POST',url:'/api/interactions',headers:header,payload:{mediaId:first,kind:'dislike'}})).statusCode,200);
    assert(!(await live.inject('/'+liveToken+'/catalog/movie/pf-anime.json')).json().metas.some((m:{id:string})=>m.id===first));
    const changed=await live.inject({method:'PUT',url:'/api/profile',headers:header,payload:{genres:['Animation'],favorites:['tt1000001'],region:'VN',preferredLanguages:['en'],homeExtras:['regional-movies']}});
    assert.equal(changed.statusCode,200,changed.body);assert.deepEqual(changed.json().profile.platforms,['netflix','disney']);
    assert.deepEqual(changed.json().profile.preferredLanguages,['en']);
    const installed = (await live.inject('/' + liveToken + '/manifest.json')).json();
    assert(installed.catalogs.some((row: { id: string; type: string }) => row.id === 'pf-lang-en' && row.type === 'movie'));
    assert.deepEqual((await live.inject('/'+liveToken+'/catalog/movie/pf-trending.json')).json().metas,[]);
    assert.equal((await live.inject('/api/search?q=x')).statusCode,400);
    assert.equal((await live.inject('/api/search?q=anime&region=XX')).statusCode,400);
  } finally { await live.close(); }
});

test('missing TMDB credentials are visible and never silently enable fixture recommendations',async()=>{
  const unconfigured=await buildServer(db,{...config,demoMode:false});
  try {
    assert.equal((await unconfigured.inject('/api/library')).json().source,'unconfigured');
    assert.equal((await unconfigured.inject('/health')).json().feedReady,false);
    const response=await unconfigured.inject('/'+token+'/catalog/movie/pf-recommended.json');assert.equal(response.statusCode,503);
  } finally { await unconfigured.close(); }
});
