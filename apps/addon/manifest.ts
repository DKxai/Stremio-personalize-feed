import type { Manifest } from 'stremio-addon-sdk';
import { CATALOGS } from '../../packages/recommendation/catalogs.js';

export function createManifest(configured = false): Manifest {
  return {
    id: 'community.dkxai.personalizedfeed',
    version: '0.1.0',
    name: 'Personalized Feed',
    description: 'Phase 1 demo: personal Movie & Series catalogs using a small fixture library. Configure genres and favorites. No streams. Trending weights are illustrative, not live.',
    types: ['movie', 'series'],
    resources: ['catalog', { name: 'meta', types: ['movie', 'series'], idPrefixes: ['tt'] }],
    catalogs: (['movie', 'series'] as const).flatMap(type => CATALOGS.map(c => ({
      type, id: `pf-${c.id}`, name: c.name,
      extra: [{ name: 'skip', isRequired: false }],
    }))),
    behaviorHints: { configurable: true, configurationRequired: !configured },
  };
}
