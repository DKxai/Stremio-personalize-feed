import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error Deployment tooling is plain Node ESM, independent from app compilation.
import { validateRelease, installFiles } from '../scripts/apply-release.mjs';
const entry=(path:string,content='source')=>({path,content,sha256:createHash('sha256').update(content).digest('hex')});
test('release payload verifies hashes and prevents protected paths or traversal',()=>{
  for(const path of ['.env','data/feed.db','../secret','/absolute','apps/../../.env','.git/config','.botkeep/settings','node_modules/code.js']) assert.throws(()=>validateRelease({tree:'a'.repeat(40),files:[entry(path)]}));
  assert.throws(()=>validateRelease({tree:'a'.repeat(40),files:[{...entry('apps/file.ts'),content:'tampered'}]}));
});
test('source installer preserves database/env and retains rollback source, rejecting symlinks',()=>{
  const root=mkdtempSync(join(tmpdir(),'pf-release-'));
  try{
    writeFileSync(join(root,'.env'),'private');writeFileSync(join(root,'package.json'),'old');
    installFiles({tree:'b'.repeat(40),files:[entry('package.json','new'),entry('apps/file.ts')]},root);
    assert.equal(readFileSync(join(root,'.env'),'utf8'),'private');assert.equal(readFileSync(join(root,'package.json'),'utf8'),'new');
    assert.equal(readFileSync(join(root,'.deploy','b'.repeat(40),'rollback/package.json'),'utf8'),'old');
    symlinkSync(join(root,'package.json'),join(root,'linked.ts'));
    assert.throws(()=>installFiles({tree:'c'.repeat(40),files:[entry('linked.ts')]},root));
  }finally{rmSync(root,{recursive:true,force:true});}
});
