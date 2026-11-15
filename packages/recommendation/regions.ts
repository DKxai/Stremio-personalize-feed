import type { Title } from '../shared/types.js';
export type RegionBucket = 'WESTERN' | 'ASIAN' | 'GLOBAL_OTHER';
const ASIAN = new Set(['KR','CN','HK','TW','JP','TH','VN','ID','IN','PH','MY','SG']);
const WESTERN = new Set(['US','GB','CA','AU','NZ','FR','DE','ES','IT','SE','DK','NO','NL','IE']);
export function classifyRegionBucket(countries: readonly string[] = []): RegionBucket {
  // An international co-production is a single title: place it in exactly one bucket.
  if (countries.some(c => ASIAN.has(c))) return 'ASIAN';
  if (countries.some(c => WESTERN.has(c))) return 'WESTERN';
  return 'GLOBAL_OTHER';
}
export function isInBucket(title: Title, bucket: RegionBucket): boolean {
  return classifyRegionBucket(title.originCountries) === bucket;
}
/** Keeps both cinema regions discoverable without fabricating missing inventory.
 * Quotas apply to each first-screen slate; remaining items keep their relevance order.
 */
export function balancedTopPicks(titles: Title[], history: readonly Title[], slate = 40): Title[] {
  if (!titles.length) return [];
  const westernHistory = history.filter(t => isInBucket(t,'WESTERN')).length;
  const asianHistory = history.filter(t => isInBucket(t,'ASIAN')).length;
  const historyTotal = westernHistory + asianHistory;
  const westRatio = historyTotal ? westernHistory / historyTotal : 0.5;
  const desired = Math.max(0.35,Math.min(0.6,westRatio));
  const size = Math.min(slate, titles.length);
  const buckets: Record<RegionBucket,Title[]> = { WESTERN: [], ASIAN: [], GLOBAL_OTHER: [] };
  for (const t of titles) buckets[classifyRegionBucket(t.originCountries)].push(t);
  const otherTarget = Math.min(buckets.GLOBAL_OTHER.length,Math.floor(size*0.1));
  const westTarget = Math.min(buckets.WESTERN.length,Math.round((size-otherTarget)*desired));
  const asianTarget = Math.min(buckets.ASIAN.length,(size-otherTarget)-westTarget);
  const target: Record<RegionBucket,number> = { WESTERN:westTarget,ASIAN:asianTarget,GLOBAL_OTHER:otherTarget };
  // If a region has no content, backfill rather than emit a short row.
  let missing = size-Object.values(target).reduce((s,v)=>s+v,0);
  while (missing>0) {
    const best = (['WESTERN','ASIAN','GLOBAL_OTHER'] as const)
      .filter(b=>target[b]<buckets[b].length)
      .sort((a,b)=>(buckets[a][target[a]]?titles.indexOf(buckets[a][target[a]]!):Infinity)
        -(buckets[b][target[b]]?titles.indexOf(buckets[b][target[b]]!):Infinity))[0];
    if (!best) break;
    target[best]++;missing--;
  }
  const used: Record<RegionBucket,number> = { WESTERN:0,ASIAN:0,GLOBAL_OTHER:0 };
  const selected: Title[]=[];
  while(selected.length<size) {
    const available = (['WESTERN','ASIAN','GLOBAL_OTHER'] as const)
      .filter(b=>used[b]<target[b] && used[b]<buckets[b].length);
    if(!available.length)break;
    // Choose the most underrepresented allocated region first; use original rank as tie-break.
    const best = available.sort((a,b)=>
      used[a]/Math.max(1,target[a])-used[b]/Math.max(1,target[b])
      || titles.indexOf(buckets[a][used[a]]!)-titles.indexOf(buckets[b][used[b]]!))[0]!;
    selected.push(buckets[best][used[best]++]!);
  }
  const seen = new Set(selected.map(t=>t.id));
  return [...selected,...titles.filter(t=>!seen.has(t.id))];
}
