import assert from 'node:assert/strict';
import { vietnamDate } from '../../packages/recommendation/airing.js';
import { daysAgo } from '../../packages/recommendation/dates.js';
const now = new Date('2026-11-07T09:55:00Z');
const ages = [0,29,30,59,60,89,90,-1,365,700];
export function mockTmdb(requests: URL[] = [], clock = now) {
  const today = vietnamDate(clock);
  return (async (input: any, init?: RequestInit) => {
    const url = new URL(String(input));requests.push(url);
    assert(!url.searchParams.has('api_key'));
    assert.equal((init?.headers as any)?.Authorization, 'Bearer test-private-token');
    const path = url.pathname.replace('/3/', '');
    let result: any;
    if (path.startsWith('watch/providers/')) result={results:[{provider_id:8,provider_name:'Netflix'},{provider_id:337,provider_name:'Disney Plus'},{provider_id:9999,provider_name:'HBO Max'}]};
    else if (/^(trending|discover)/.test(path)) {
      const offset = (path.startsWith('trending/') || url.searchParams.has('air_date.gte')) && url.searchParams.get('page') === '2' ? 20 : 0;
      result = { results: Array.from({ length: 20 }, (_, i) => ({ id: offset + i + 1, adult: i === 19 })) };
    }
    else if (path.startsWith('find/')) { const id=Number(path.split('/')[1]?.replace('tt',''))-1000000;result={movie_results:id>0 && id%2?[{id}]:[],tv_results:id>0 && id%2===0?[{id}]:[]}; }
    else if (path==='search/movie') result={results:[{id:1},{id:3}]};
    else if (path==='search/tv') result={results:[{id:2},{id:4}]};
    else if (path==='search/multi') result={results:[{id:1,media_type:'movie'},{id:2,media_type:'tv'},{id:88,media_type:'person'}]};
    else {
      const id=Number(path.split('/')[1]);
      const type=path.startsWith('movie/')?'movie':'tv';
      result={ id, title:'Movie '+id, name:'Series '+id,
        release_date:daysAgo(ages[(id-1)%ages.length]!,today), first_air_date:daysAgo(id === 31 ? 400 : ages[(id-1)%ages.length]!,today),
        origin_country:id%3===0?['CN']:id%3===1?['JP']:['KR'], original_language:id===5?'en':id%3===1?'ja':id%3===0?'zh':'ko',
        status: id === 7 ? 'Ended' : 'Returning Series',
        seasons: [{ season_number: 1, air_date: daysAgo(id === 31 ? 400 : ages[(id-1)%ages.length]!, today) },
          ...(id === 31 ? [{ season_number: 2, air_date: daysAgo(2, today) }] : [])],
        ...(id === 7 || id === 31 ? { last_episode_to_air: { season_number: id === 31 ? 2 : 1, episode_number: 3, air_date: daysAgo(1, today) } } : {}),
        ...(id === 31 ? { next_episode_to_air: { season_number: 2, episode_number: 4, air_date: daysAgo(-6, today) } } : {}),
        genres:[{id:id%3===1 && id%2===1?16:18}], credits:{cast:[{name:'Actor'}],crew:[{job:'Director',name:'Director'}]},
        external_ids:{imdb_id:id===18?null:'tt'+String(1000000+id)},
        vote_average:8, vote_count:100, popularity:10, poster_path:'/poster.jpg', overview:'Test overview', adult:id===19,
        'watch/providers':{results:{US:{flatrate:id===17?[{provider_name:'Rent-only service'}]:[{provider_name:id%2?'Netflix':'Disney Plus'}],link:'https://www.themoviedb.org/'+type+'/'+id+'/watch'},VN:{flatrate:[]}}},
      };
    }
    return new Response(JSON.stringify(result), {status:200});
  }) as typeof fetch;
}
