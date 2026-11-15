import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Profile,Title } from '../packages/shared/types.js';
import { classifyRegionBucket, balancedTopPicks } from '../packages/recommendation/regions.js';
import { resolveHubChoice,hubOptions,isRecognizedGenreOption } from '../packages/recommendation/hubs.js';
import { createManifest } from '../apps/addon/manifest.js';
import { RecommendationEngine } from '../packages/recommendation/engine.js';

const title = (n:number,region:string):Title=>({
  id:'tt'+String(6000000+n), type:'movie',name:'Candidate '+n,
  year:2026,releaseDate:'2026-10-01',genres:['Drama'],cast:[],directors:[],keywords:[],
  quality:0.76+(n%5)*0.015,popularity:0.5,originCountries:[region],
});
const p:Profile={id:'mix',version:1,genres:['Drama'],favorites:[],likes:[],dislikes:[],watched:[]};

test('nine home hubs expose distinct global, vibe and Asian specialist filters',()=>{
  const manifest=createManifest();
  assert.equal(manifest.catalogs.length,20);
  for(const id of ['recommended','because-west','because-asian','western-hub','vibes','korean','chinese','asian-jp-sea']){
    const row=manifest.catalogs.find(c=>c.id==='pf-'+id && c.type==='movie');
    assert(row,id);
  }
  assert(hubOptions('western-hub').includes('Điện ảnh châu Âu'));
  assert(hubOptions('asian-jp-sea').includes('Kinh dị Thái'));
  assert.equal(resolveHubChoice('vibes','Cyberpunk & AI'),'vibe-cyberpunk');
  assert.equal(resolveHubChoice('chinese','Cổ trang & kỳ ảo'),'c-costume');
  assert(isRecognizedGenreOption('Cyberpunk & AI'));
  assert(!isRecognizedGenreOption('Unexpected filter'));
});

test('region buckets classify each unique film once, including international co-productions',()=>{
  assert.equal(classifyRegionBucket(['KR','US']),'ASIAN');
  assert.equal(classifyRegionBucket(['US']),'WESTERN');
  assert.equal(classifyRegionBucket(['FR']),'WESTERN');
  assert.equal(classifyRegionBucket(['VN']),'ASIAN');
  assert.equal(classifyRegionBucket(['BR']),'GLOBAL_OTHER');
});

test('balanced first slate preserves minimum East/West discovery when inventory supports it',()=>{
  const pool=[...Array.from({length:60},(_,i)=>title(i,'US')),
    ...Array.from({length:30},(_,i)=>title(i+60,'KR')),
    ...Array.from({length:10},(_,i)=>title(i+90,'BR'))];
  const history=Array.from({length:20},(_,i)=>title(i+120,'US'));
  const first=balancedTopPicks(pool,history).slice(0,40);
  const totals=first.reduce((m,t)=>(m[classifyRegionBucket(t.originCountries)]++,m),
    {WESTERN:0,ASIAN:0,GLOBAL_OTHER:0});
  assert(totals.WESTERN<=24,'60% West cap for adequate supply');
  assert(totals.ASIAN>=10,'at least 25% Asia on the first slate');
  assert(totals.GLOBAL_OTHER>=4,'10% exploration when high-quality world candidates exist');
  assert.equal(new Set(first.map(t=>t.id)).size,40);
  assert.deepEqual(balancedTopPicks(pool.slice(0,12),history),pool.slice(0,12),'sparse inventories are never discarded');
});

test('personalized ranking retains non-Asian discoveries even when Asia scores are strong',()=>{
  const pool=[...Array.from({length:50},(_,i)=>title(i,'KR')),
    ...Array.from({length:36},(_,i)=>title(i+50,'US')),
    ...Array.from({length:14},(_,i)=>title(i+86,'BR'))];
  const engine=new RecommendationEngine(pool,()=>new Date('2026-11-16T03:00:00Z'));
  const rows=engine.recommend({...p,preferredOrigins:['KR'],version:2},'movie','recommended');
  assert.equal(rows.length,100);
  const first=rows.slice(0,40);
  const asian=first.filter(t=>classifyRegionBucket(t.originCountries)==='ASIAN').length;
  const west=first.filter(t=>classifyRegionBucket(t.originCountries)==='WESTERN').length;
  assert(asian<=24, 'Asian content must not crowd out Western films');
  assert(west>=10,'Western movies should remain visible');
});
