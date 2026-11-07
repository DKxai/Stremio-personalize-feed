import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { mkdtempSync, rmSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { buildServer } from '../apps/api/server.js';
import { loadConfig } from '../apps/api/config.js';
import { ProfileService } from '../apps/api/services/profiles.js';
import { FeedService } from '../apps/api/services/feed.js';
import { RecommendationEngine } from '../packages/recommendation/engine.js';
import { parseLibraryEvent, parsePlayerEvent } from '../packages/shared/stremio-events.js';
import { TITLES } from '../packages/metadata/fixtures.js';
import { LiveLibrary } from '../packages/metadata/live-library.js';
import { TmdbClient } from '../packages/metadata/tmdb.js';
import { mockTmdb } from './helpers/tmdb.js';

const dir=mkdtempSync(join(tmpdir(),'pf-activity-')), databaseUrl='file:'+join(dir,'feed.db');
const config=loadConfig({PUBLIC_BASE_URL:'https://feed.example',LOG_LEVEL:'silent',DEMO_MODE:'true'});
let db:PrismaClient, app:Awaited<ReturnType<typeof buildServer>>, token='', id='';
const auth=()=>({authorization:'Bearer '+token});
const event=(type:string,mediaId:string,action:string,videoId?:string)=>'/'+token+'/library/'+type+'/'+mediaId+'/'+new URLSearchParams({action,...(videoId ? {videoId} : {})})+'.json';
const profile=async()=> (await app.inject({url:'/api/profile',headers:auth()})).json().profile;
const interact=async(mediaId:string,kind:string)=>app.inject({method:'POST',url:'/api/interactions',headers:auth(),payload:{mediaId,kind}});
const row=async(name:string,type='movie')=>(await app.inject('/'+token+'/catalog/'+type+'/pf-'+name+'.json')).json().metas;
before(async()=>{
  closeSync(openSync(join(dir,'feed.db'),'a'));
  const migrated=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env:{...process.env,DATABASE_URL:databaseUrl},encoding:'utf8'});assert.equal(migrated.status,0,migrated.stderr);
  db=new PrismaClient({datasources:{db:{url:databaseUrl}}});app=await buildServer(db,config);
  const created=await app.inject({method:'POST',url:'/api/profiles',payload:{genres:['Sci-Fi'],favorites:['tt0816692'],watched:['tt0108778']}});
  assert.equal(created.statusCode,201,created.body);({token}=created.json());id=created.json().profile.id;
});
after(async()=>{await app?.close();await db?.$disconnect();rmSync(dir,{recursive:true,force:true});});

test('manifest exposes separate Home rows, genre filtering and search-only rows, with library tracking opt-in settings',async()=>{
  const m=(await app.inject('/'+token+'/manifest.json')).json();
  assert.equal(m.version,'0.4.0');assert.equal(m.catalogs.length,34);
  const home=m.catalogs.filter((c:any)=>!c.extra.some((e:any)=>e.isRequired));assert.equal(home.length,32);
  for(const name of ['japanese','korean','chinese','anime','watched','saved']) assert.equal(home.filter((c:any)=>c.id==='pf-'+name).length,2);
  assert.equal(m.catalogs.filter((c:any)=>c.extra.some((e:any)=>e.name==='search')).length,2);
  assert(m.resources.some((r:any)=>r.name==='library'));assert(!m.resources.some((r:any)=>r.name==='player'));
});
test('initial watched series has its real type and appears only in the series watched row',async()=>{
  assert((await profile()).watched.includes('tt0108778'));
  assert(!(await row('watched')).some((t:any)=>t.id==='tt0108778'));
  assert((await row('watched','series')).some((t:any)=>t.id==='tt0108778'));
});
test('like and watched coexist; unwatching preserves a like, and unliking preserves watched',async()=>{
  await interact('tt2543164','like');await interact('tt2543164','watched');let p=await profile();
  assert(p.likes.includes('tt2543164'));assert(p.watched.includes('tt2543164'));
  assert((await row('watched')).some((t:any)=>t.id==='tt2543164'));assert((await row('saved')).some((t:any)=>t.id==='tt2543164'));
  await interact('tt2543164','unwatched');p=await profile();assert(p.likes.includes('tt2543164'));assert(!p.watched.includes('tt2543164'));
  await interact('tt2543164','watched');await interact('tt2543164','unlike');p=await profile();assert(!p.likes.includes('tt2543164'));assert(p.watched.includes('tt2543164'));
});
test('native library save and watched callbacks are independent, idempotent, isolated, invalidate ranking and persist through restart',async()=>{
  const before=await profile();
  assert.equal((await app.inject(event('movie','tt0470752','libraryAdd'))).statusCode,200);
  await app.inject(event('movie','tt0470752','watched'));
  let p=await profile();assert(p.saved.includes('tt0470752'));assert(p.watched.includes('tt0470752'));assert(!p.likes.includes('tt0470752'));assert(p.version>before.version);
  const version=p.version;await app.inject(event('movie','tt0470752','watched'));assert.equal((await profile()).version,version);
  await app.inject(event('movie','tt0470752','libraryRemove'));p=await profile();assert(!p.saved.includes('tt0470752'));assert(p.watched.includes('tt0470752'));
  assert(!(await row('recommended')).some((t:any)=>t.id==='tt0470752'));
  const other=await new ProfileService(db).create(['Comedy'],[]);assert(!(other.profile.watched.includes('tt0470752')));
  await app.close();await db.$disconnect();db=new PrismaClient({datasources:{db:{url:databaseUrl}}});app=await buildServer(db,config);
  assert.deepEqual(await profile(),p);
});
test('episode callbacks track exact episodes without claiming the whole series is complete',async()=>{
  const ep='tt4574334:1:1';await app.inject(event('series','tt4574334','watched',ep));let p=await profile();
  assert(!p.watched.includes('tt4574334'));assert(p.started.includes('tt4574334'));assert.equal(p.episodeCounts.tt4574334,1);
  await app.inject(event('series','tt4574334','watched',ep));assert.equal((await profile()).episodeCounts.tt4574334,1);
  await app.inject(event('series','tt4574334','watched',ep+',tt4574334:1:2'));p=await profile();assert.equal(p.episodeCounts.tt4574334,2);
  const metas=await row('watched','series');assert.match(metas.find((m:any)=>m.id==='tt4574334').description,/2 tập/);
  await app.inject(event('series','tt4574334','unwatched',ep));assert.equal((await profile()).episodeCounts.tt4574334,1);
});
test('playback completion is off by default and only stores completed titles or episodes when enabled',async()=>{
  const path='/'+token+'/player/movie/tt1375666/action=stop&currentTime=5400000&duration=6000000.json';
  await app.inject(path);assert(!(await profile()).watched.includes('tt1375666'));
  let p=await profile();await app.inject({method:'PUT',url:'/api/profile',headers:auth(),payload:{genres:p.genres,favorites:p.favorites,syncPlayback:true}});
  await app.inject(path.replace('action=stop','action=pause'));assert(!(await profile()).watched.includes('tt1375666'));
  await app.inject(path.replace('5400000','60000'));assert(!(await profile()).watched.includes('tt1375666'));
  await app.inject(path);p=await profile();assert(p.watched.includes('tt1375666'));assert(p.lastPlayerEventAt);
  assert((await app.inject('/'+token+'/manifest.json')).json().resources.some((r:any)=>r.name==='player'));
});
test('turning off native library sync stops writes; malformed events and HEAD do not mutate state',async()=>{
  let p=await profile();await app.inject({method:'PUT',url:'/api/profile',headers:auth(),payload:{genres:p.genres,favorites:p.favorites,syncLibrary:false}});
  await app.inject(event('movie','tt0111161','watched'));assert(!(await profile()).watched.includes('tt0111161'));
  assert.equal((await app.inject({method:'HEAD',url:event('movie','tt0111161','watched')})).statusCode,404);
  assert.equal((await app.inject(event('series','tt4574334','watched','tt0903747:1:1'))).statusCode,400);
  assert.equal((await app.inject(event('stream','tt4574334','watched'))).statusCode,400);
  assert.equal((await app.inject(event('movie','tt0111161','watched').replace(token,'x'.repeat(43)))).statusCode,401);
  p=await profile();assert(!(await app.inject('/'+token+'/manifest.json')).json().resources.some((r:any)=>r.name==='library'));
  assert(p.watched.includes('tt0470752'));
});
test('Discover genre results are isolated in cache; search can find a previously watched title by name and IMDb ID',async()=>{
  for(const genre of ['Animation','Crime']){
    const r=await app.inject('/'+token+'/catalog/movie/pf-recommended/genre='+genre+'.json');assert.equal(r.statusCode,200,r.body);
    for(const meta of r.json().metas) assert(meta.genres.includes(genre));
  }
  const found=await app.inject('/'+token+'/catalog/movie/pf-search/search=tt2543164.json');assert.equal(found.json().metas[0].id,'tt2543164');
  assert.equal((await app.inject('/'+token+'/catalog/movie/pf-search.json')).statusCode,400);
  assert.equal((await app.inject('/'+token+'/catalog/movie/pf-recommended/search=Arrival.json')).statusCode,400);
  for(const extra of ['genre=Bad','skip=1&skip=2','search=','skip=10001']) assert.equal((await app.inject('/'+token+'/catalog/movie/pf-search/'+extra+'.json')).statusCode,400);
});
test('typed multilingual search preserves ampersands and plus signs, uses TMDB relevance and requested media type',async()=>{
  const calls:URL[]=[];const source=new LiveLibrary(new TmdbClient({token:'test-private-token'},undefined,mockTmdb(calls)));
  const live=await buildServer(db,config,undefined,source);
  try{
    const query='日本映画 & 韓国 C++';
    for(const type of ['movie','series']){
      const r=await live.inject('/'+token+'/catalog/'+type+'/pf-search/'+new URLSearchParams({search:query})+'.json');
      assert.equal(r.statusCode,200,r.body);assert(r.json().metas.length);assert(r.json().metas.every((m:any)=>m.type===type));
    }
    assert(calls.filter(u=>u.pathname.includes('/search/')).every(u=>u.searchParams.get('query')===query));
  }finally{await live.close();}
});
test('watched-only input changes Because ranking without inventing a like',()=>{
  const engine=new RecommendationEngine(TITLES), p={id:'watched-test',version:1,genres:[],favorites:[],likes:[],dislikes:[],watched:[] as string[]};
  assert.equal(engine.recommend(p,'movie','because').length,0);
  const ranked=engine.recommend({...p,version:2,watched:['tt0816692']},'movie','because');assert(ranked.length);assert(!ranked.some(t=>t.id==='tt0816692'));assert.equal(p.likes.length,0);
});
test('event parser rejects duplicate actions, invalid batches and spoofed playback data',()=>{
  assert.throws(()=>parseLibraryEvent('movie','tt0816692','action=watched&action=unwatched'));
  assert.throws(()=>parseLibraryEvent('series','tt4574334','action=watched&videoId='+Array.from({length:101},(_,i)=>'tt4574334:1:'+i).join(',')));
  assert.throws(()=>parsePlayerEvent('movie','tt0816692','action=stop&currentTime=Infinity&duration=6000000'));
  assert.throws(()=>parsePlayerEvent('series','tt4574334:1:1','action=stop&currentTime=60000000&duration=6000000'));
});

test('watched lists paginate beyond 100 items without repeating, preserving actual type',async()=>{
  const ids=Array.from({length:125},(_,i)=>'tt'+String(9000000+i));
  const base=TITLES.find(t=>t.type==='movie')!;
  const source={mode:'fixtures' as const,resolve:async(id:string)=>({...base,id}),search:async()=>[],candidates:async()=>({titles:[],revision:'test',source:'fixtures' as const})};
  const feed=new FeedService(source), p={id:'many-watched',version:1,genres:[],favorites:[],likes:[],dislikes:[],watched:ids};
  const first=await feed.page(p,'movie','watched',{skip:0}),second=await feed.page(p,'movie','watched',{skip:100});
  assert.equal(first.length,100);assert.equal(second.length,25);assert.deepEqual([...first,...second].map(t=>t.id),ids);
});
