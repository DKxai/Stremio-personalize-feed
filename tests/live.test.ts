import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TmdbClient, UpstreamUnavailable } from '../packages/metadata/tmdb.js';
import { LiveLibrary, UnconfiguredLibrary } from '../packages/metadata/live-library.js';
import { RecommendationEngine } from '../packages/recommendation/engine.js';
import { communityScores } from '../packages/recommendation/community.js';
import { daysAgo, inReleaseWindow, releaseAge } from '../packages/recommendation/dates.js';
import { feedPreferences } from '../packages/shared/preferences.js';
import type { Profile, Title } from '../packages/shared/types.js';
import { CATALOGS } from '../packages/recommendation/catalogs.js';

import { mockTmdb } from './helpers/tmdb.js';
const now = new Date('2026-11-07T23:55:00Z');
const profile: Profile = { id:'test', version:1, genres:['Animation', 'Drama'], favorites:[], likes:[], dislikes:[], watched:[], ...feedPreferences() };

test('release windows use UTC and exclude future, invalid, old and missing dates', () => {
  assert(inReleaseWindow('2026-11-07',0,29,now));
  assert(inReleaseWindow(daysAgo(29,now),0,29,now));
  assert(!inReleaseWindow(daysAgo(30,now),0,29,now));
  assert(inReleaseWindow(daysAgo(30,now),30,59,now));
  assert(inReleaseWindow(daysAgo(89,now),60,89,now));
  for(const date of [undefined,'2026-11-08','2026-02-31','2026-01-01']) assert(!inReleaseWindow(date,0,89,now));
  assert.equal(releaseAge('invalid',now),Infinity);
  assert.equal(daysAgo(1,new Date('2024-03-01T00:01:00Z')),'2024-02-29');
});

test('live feeds enforce real date, country, anime and subscription availability filters for both media types', async () => {
  const requests:URL[]=[];
  const library=new LiveLibrary(new TmdbClient({token:'test-private-token'},undefined,mockTmdb(requests)),undefined,()=>now);
  for(const type of ['movie','series'] as const) {
    for(const {id} of CATALOGS) {
      const batch=await library.candidates(profile,type,id);
      assert.equal(batch.source,'tmdb');
      for(const title of batch.titles) {
        assert.match(title.id,/^tt\d{7,10}$/);assert.equal(title.type,type);
        assert(!['tt1000018','tt1000019','tt1000020'].includes(title.id));
        assert(releaseAge(title.releaseDate,now)>=0);
        if(id==='new30') assert(inReleaseWindow(title.releaseDate,0,29,now));
        if(id==='new60') assert(inReleaseWindow(title.releaseDate,30,59,now));
        if(id==='new90') assert(inReleaseWindow(title.releaseDate,60,89,now));
        if(id==='anime-new') assert(inReleaseWindow(title.releaseDate,0,89,now));
        if(id.startsWith('anime')) assert(title.isAnime);
        if(id==='korean') assert(title.originCountries?.includes('KR'));
        if(id==='chinese') assert(title.originCountries?.includes('CN'));
        if(id==='japanese') { assert(title.originCountries?.includes('JP')); assert(!title.genres.includes('Animation')); }
        if(id==='trending' || id.startsWith('new')) {
          assert(title.providers?.some(n=>['Netflix','Disney Plus'].includes(n)));
          assert.notEqual(title.id,'tt1000017');
        }
        if(id==='trending') assert.equal(typeof title.weeklyTrend,'number');
      }
      if(['new30','new60','new90','korean','chinese','japanese','anime','anime-new','trending'].includes(id)) assert(batch.titles.length>0,id);
    }
  }
  assert(requests.some(u=>u.pathname==='/3/trending/movie/week'));
  assert(requests.some(u=>u.pathname==='/3/trending/tv/week'));
  const fresh=requests.find(u=>u.pathname==='/3/discover/movie' && u.searchParams.get('primary_release_date.gte')===daysAgo(29,now));
  assert(fresh);assert.equal(fresh.searchParams.get('with_watch_providers'),'8|337|9999');
  assert.equal(fresh.searchParams.get('watch_region'),'US');assert.equal(fresh.searchParams.get('with_watch_monetization_types'),'flatrate');
  assert(requests.some(u=>u.pathname==='/3/discover/tv' && u.searchParams.get('with_origin_country')==='JP' && u.searchParams.get('without_genres')?.includes('16')), 'J-Drama pool must exclude animation');
  const vietnam=await library.candidates({...profile,region:'VN'},'movie','trending');
  assert.deepEqual(vietnam.titles,[],'Do not substitute US availability for VN');
});

test('anime search preserves IMDb interoperability and filters people',async()=>{
  const library=new LiveLibrary(new TmdbClient({token:'test-private-token'},undefined,mockTmdb()),undefined,()=>now);
  const titles=await library.search('anime','US');assert.equal(titles.length,2);
  assert.deepEqual(titles.map(t=>t.type),['movie','series']);assert(titles[0]?.isAnime);
});

test('upstream client deduplicates requests, limits concurrency and does not leak credentials on errors',async()=>{
  let calls=0,active=0,peak=0;
  const fetcher=(async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,5));active--;return new Response('{"results":[]}');}) as typeof fetch;
  const client=new TmdbClient({token:'test-private-token'},undefined,fetcher);
  await Promise.all(Array.from({length:20},(_,i)=>client.get('discover/movie',{page:i%10})));
  assert.equal(calls,10);assert(peak<=4);
  await client.get('discover/movie',{page:0});assert.equal(calls,10);
  const unauthorized=new TmdbClient({token:'secret-should-not-appear'},undefined,(async()=>new Response('',{status:401})) as typeof fetch);
  await assert.rejects(unauthorized.get('movie/1'),error=>error instanceof UpstreamUnavailable && !error.message.includes('secret-should-not-appear'));
  const unconfigured=new UnconfiguredLibrary();assert.equal(unconfigured.mode,'unconfigured');
  await assert.rejects(unconfigured.candidates(),/TMDB_READ_ACCESS_TOKEN/);
});

test('freshness and Asian/anime preferences can lift a comparable recent title above old popular content',()=>{
  const base:Title={id:'tt1000001',type:'movie',name:'Old',year:2010,genres:['Drama'],cast:[],directors:[],keywords:[],quality:.8,popularity:.8,releaseDate:'2010-01-01'};
  const recent:Title={...base,id:'tt1000002',name:'New Korean',year:2026,releaseDate:'2026-11-01',originCountries:['KR']};
  const anime:Title={...recent,id:'tt1000003',name:'New anime',isAnime:true,originCountries:['JP']};
  const engine=new RecommendationEngine([base,recent,anime],()=>now);
  const rows=engine.recommend(profile,'movie','recommended');assert.notEqual(rows[0]?.id,base.id);assert.equal(rows.at(-1)?.id,base.id);
  assert.deepEqual(engine.recommend(profile,'movie','anime').map(t=>t.id),[anime.id]);
});

test('collaborative ranking has a cold-start fallback and requires three distinct supporting neighbors',()=>{
  const p={...profile,favorites:['tt1000001']};
  const signals=[1,2,3].flatMap(n=>[{userId:'u'+n,mediaId:'tt1000001'},{userId:'u'+n,mediaId:'tt1000002'}]);
  assert.equal(communityScores(p,signals).get('tt1000002'),.3);
  assert.equal(communityScores(p,signals.slice(0,4)).size,0);
  assert.equal(communityScores(p,[...signals.slice(0,2),...signals.slice(0,2),...signals.slice(0,2)]).size,0);
  assert.equal(communityScores({...p,id:'u3'},signals).size,0,'Exclude the current profile from social evidence');
});
