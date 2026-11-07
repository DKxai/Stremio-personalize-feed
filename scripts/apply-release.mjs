import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';

const hash = value => createHash('sha256').update(value).digest('hex');
export function validateRelease(release) {
  if (!release || !/^[a-f0-9]{40}$/.test(release.tree) || !Array.isArray(release.files) || !release.files.length || release.files.length > 200) throw new Error('Invalid release');
  const seen = new Set();
  for (const file of release.files) {
    if (typeof file.path !== 'string' || typeof file.content !== 'string' || seen.has(file.path)) throw new Error('Invalid release entry');
    const parts = file.path.split('/');
    if (parts.some(p => !p || p === '.' || p === '..' || !/^[\w.\-]+$/.test(p)) || file.path.startsWith('/') || file.path.includes('\\')) throw new Error('Unsafe release path');
    if (parts.some(p => ['.git','.botkeep','.deploy','node_modules','dist','data'].includes(p)) || (file.path.startsWith('.env') && file.path !== '.env.example') || /\.(db|log)$/.test(file.path)) throw new Error('Protected release path');
    if (hash(file.content) !== file.sha256) throw new Error('Release checksum mismatch');
    seen.add(file.path);
  }
  return release;
}
export function installFiles(release, root = process.cwd()) {
  validateRelease(release);
  const checkpoint = resolve(root, '.deploy', release.tree);
  // Reject links before writing even staging/checkpoint directories.
  for (const path of ['.deploy', '.deploy/'+release.tree, ...release.files.map(f => f.path)]) {
    let current = root;
    for (const part of path.split('/')) { current = resolve(current, part); if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error('Symlink in deployment path'); }
  }
  mkdirSync(checkpoint, {recursive:true,mode:0o700});
  for (const file of release.files) {
    const target=resolve(root,file.path), staged=resolve(checkpoint,'stage',file.path), previous=resolve(checkpoint,'rollback',file.path);
    mkdirSync(dirname(staged),{recursive:true});writeFileSync(staged,file.content,{mode:0o600});
    if(existsSync(target) && !existsSync(previous)){mkdirSync(dirname(previous),{recursive:true});copyFileSync(target,previous);}
  }
  for (const file of release.files) {
    const target=resolve(root,file.path);mkdirSync(dirname(target),{recursive:true});renameSync(resolve(checkpoint,'stage',file.path),target);
  }
  console.log('Release source installed and previous source retained:',release.tree);
}
const run = (args) => { const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});if(result.status!==0) throw new Error('Deployment step failed'); };
export async function applyRelease(release) {
  validateRelease(release);
  if(process.argv.includes('--verify-only')) { console.log('Release checksums verified:',release.files.length,'files, tree',release.tree);return; }
  const previous = JSON.parse(readFileSync('package.json','utf8'));
  const next = JSON.parse(release.files.find(f=>f.path==='package.json')?.content || '{}');
  // Must succeed before source changes or database migration. Database/env are never in the payload.
  run(['--env-file-if-exists=.env','scripts/backup.mjs']);
  installFiles(release);
  const dependencies = p => JSON.stringify([p.dependencies,p.devDependencies,p.overrides]);
  if(dependencies(previous)!==dependencies(next)) { const result=spawnSync('npm',['ci','--include=dev'],{stdio:'inherit',env:process.env});if(result.status!==0) throw new Error('Dependency install failed'); }
  // Existing dependencies are managed by Botkeep; no unpinned remote installer.
  run(['node_modules/prisma/build/index.js','generate']);
  run(['node_modules/typescript/bin/tsc']);
  await import(resolve('scripts/start.mjs'));
}
