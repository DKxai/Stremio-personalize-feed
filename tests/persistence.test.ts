import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, rmSync, mkdirSync, copyFileSync, closeSync, openSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { MetadataStore } from '../packages/metadata/store.js';
import { TmdbClient } from '../packages/metadata/tmdb.js';
import { ProfileService } from '../apps/api/services/profiles.js';
import { feedPreferences } from '../packages/shared/preferences.js';
import { configureScript, configureStyle } from '../apps/api/ui/assets.js';
import { configureHtml } from '../apps/api/ui/configure.js';
import { Script } from 'node:vm';

const run = (args: string[], env: Record<string,string>) => {
  const result=spawnSync(process.execPath,args,{env:{...process.env,...env},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr || result.stdout);return result;
};
test('migration upgrades a populated Phase 1 database and backup restores profiles and metadata cache',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'pf-upgrade-'));
  const databaseUrl='file:'+join(directory,'feed.db');
  closeSync(openSync(join(directory,'feed.db'),'a'));
  let db = new PrismaClient({datasources:{db:{url:databaseUrl}}});
  try {
    mkdirSync(join(directory,'prisma/migrations/202611070001_init'),{recursive:true});
    copyFileSync('prisma/schema.prisma',join(directory,'prisma/schema.prisma'));
    copyFileSync('prisma/migrations/migration_lock.toml',join(directory,'prisma/migrations/migration_lock.toml'));
    copyFileSync('prisma/migrations/202611070001_init/migration.sql',join(directory,'prisma/migrations/202611070001_init/migration.sql'));
    run(['node_modules/prisma/build/index.js','migrate','deploy','--schema',join(directory,'prisma/schema.prisma')],{DATABASE_URL:databaseUrl});
    await db.$executeRawUnsafe('INSERT INTO "User" (id,tokenHash,version) VALUES (?,?,?)','legacy-user','hash',7);
    await db.$executeRawUnsafe('INSERT INTO "Preference" (userId,genres) VALUES (?,?)','legacy-user','["Drama"]');
    await db.$executeRawUnsafe('INSERT INTO "Favorite" (userId,mediaId) VALUES (?,?)','legacy-user','tt0816692');
    run(['node_modules/prisma/build/index.js','migrate','deploy'],{DATABASE_URL:databaseUrl});
    const legacy=await db.user.findUniqueOrThrow({where:{id:'legacy-user'},include:{preferences:true,favorites:true}});
    assert.equal(legacy.version,7);assert.equal(legacy.favorites[0]?.mediaId,'tt0816692');assert.equal(legacy.preferences?.feed,'{}');
    const profiles=new ProfileService(db);
    const created=await profiles.create(['Animation'],[],feedPreferences({region:'VN',platforms:['netflix']}));
    let store=new MetadataStore(db);
    await store.write('test-persistent',{results:[{id:1}]},60_000);
    await store.write('expired',{old:true},-100);
    await store.prune();assert.equal(await store.read('expired'),undefined);
    await db.$disconnect();db=new PrismaClient({datasources:{db:{url:databaseUrl}}});store=new MetadataStore(db);
    assert.deepEqual(await store.read('test-persistent'),{results:[{id:1}]});
    assert.equal((await new ProfileService(db).find(created.token))?.region,'VN');
    let fetchCalls=0;
    const cachedClient=new TmdbClient({token:'test'},store,(async()=>{fetchCalls++;return new Response('{"results":[1]}');}) as typeof fetch);
    await cachedClient.get('test');assert.equal(fetchCalls,1);
    const restartedClient=new TmdbClient({token:'test'},new MetadataStore(db),(async()=>{throw new Error('network must not be needed');}) as typeof fetch);
    assert.deepEqual(await restartedClient.get('test'),{results:[1]});
    const backupDir=join(directory,'backups');
    run(['scripts/backup.mjs'],{DATABASE_URL:databaseUrl,BACKUP_DIR:backupDir});
    const {readdirSync}=await import('node:fs');
    const backup=new PrismaClient({datasources:{db:{url:'file:'+join(backupDir,readdirSync(backupDir)[0]!)}}});
    try {
      assert.equal((await new ProfileService(backup).find(created.token))?.region,'VN');
      assert.deepEqual(await new MetadataStore(backup).read('test-persistent'),{results:[{id:1}]});
      assert.equal(await backup.user.count(),2);
    } finally { await backup.$disconnect(); }
  } finally { await db.$disconnect();rmSync(directory,{recursive:true,force:true}); }
});

test('onboarding script is syntactically valid and its declared controls exist in the template',()=>{
  assert.doesNotThrow(()=>new Script(configureScript));
  for(const match of configureScript.matchAll(/\$\('([^']+)'\)/g)) assert(configureHtml.includes('id="'+match[1]+'"'),match[1]);
  assert(configureStyle.includes('[hidden]'));assert(configureHtml.includes('JustWatch'));
});
