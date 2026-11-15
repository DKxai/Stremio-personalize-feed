import type { Title } from '../shared/types.js';
import type { CatalogId } from './catalogs.js';

export interface ContentFilter {
  countries?: readonly string[];
  genres?: readonly string[];
  exclude?: readonly string[];
  quality?: number;
  /** Category terms are checked against TMDB English keyword names when available. */
  keywords?: readonly string[];
}
export const WESTERN_VIBES: Partial<Record<CatalogId,ContentFilter>> = {
  'western-hub': { countries:['US','GB','CA','AU','NZ','FR','DE','ES','IT','SE','DK','NO','NL','IE'], exclude:['Animation'] },
  'western-action': { countries:['US','GB','CA','AU'],genres:['Action','Thriller','Adventure'],exclude:['Animation'] },
  'western-prestige': { countries:['US','GB','FR','DE','CA'],genres:['Drama'],exclude:['Animation'],quality:0.64 },
  'western-crime': { countries:['US','GB','IT','FR'],genres:['Crime','Mystery','Thriller'],exclude:['Animation'] },
  'european': { countries:['FR','DE','ES','IT','SE','DK','NO','NL','IE'],exclude:['Animation'] },
  'vibe-mind': { genres:['Sci-Fi','Mystery','Thriller','Fantasy'],keywords:['time loop','time travel','alternate reality','plot twist','psychological'] },
  'vibe-crime': { genres:['Crime','Mystery','Thriller'],exclude:['Animation','Comedy'],keywords:['detective','serial killer','murder','investigation','noir'] },
  'vibe-cyberpunk': { genres:['Sci-Fi'],keywords:['cyberpunk','dystopia','artificial intelligence','post-apocalyptic'] },
  'vibe-survival': { genres:['Action','Adventure','Thriller'],keywords:['survival','heist','escape','battle royale'] },
  'vibe-feelgood': { genres:['Comedy','Romance','Family'],exclude:['Horror','Thriller','Crime'] },
};
export function matchesWesternVibe(title: Title,id: CatalogId): boolean {
  const rule=WESTERN_VIBES[id]; if(!rule)return true;
  if(rule.countries && !title.originCountries?.some(country=>rule.countries!.includes(country))) return false;
  if(rule.exclude?.some(genre=>title.genres.includes(genre)))return false;
  if(rule.quality && title.quality < rule.quality)return false;
  if(rule.genres?.length) {
    const genreMatch=rule.genres.some(g=>title.genres.includes(g));
    const keywords=title.keywords.map(k=>k.toLowerCase());
    const keywordMatch=Boolean(rule.keywords?.some(k=>keywords.some(item=>item.includes(k))));
    if(!genreMatch && !keywordMatch)return false;
  }
  return true;
}
