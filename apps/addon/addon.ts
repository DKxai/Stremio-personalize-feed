import { addonBuilder, type Manifest, type MetaPreview, type MetaDetail } from 'stremio-addon-sdk';
import type { Profile } from '../../packages/shared/types.js';
import type { FeedService } from '../api/services/feed.js';
import { feedPreferences } from '../../packages/shared/preferences.js';
import { isCatalogId } from '../../packages/recommendation/catalogs.js';
import { toMetaPreview } from '../../packages/metadata/mapper.js';
import type { MetadataProvider } from '../../packages/metadata/cinemeta.js';
import { parseCatalogQuery } from '../../packages/recommendation/catalog-query.js';
import { createManifest } from './manifest.js';

// The SDK 1.6.10 implementation takes positional arguments. DefinitelyTyped's
// AddonInterface.get declaration incorrectly describes a single object argument.
interface RuntimeAddonInterface {
  manifest: Manifest;
  get(resource: 'catalog', type: 'movie' | 'series', id: string, extra?: Record<string, unknown>): Promise<{ metas: MetaPreview[]; cacheMaxAge?: number }>;
  get(resource: 'meta', type: 'movie' | 'series', id: string, extra?: Record<string, unknown>): Promise<{ meta: MetaDetail; cacheMaxAge?: number }>;
}

export function createAddon(profile: Profile, feed: FeedService, metadata: MetadataProvider) {
  // The SDK's legacy linter does not know event resources and caps manifests at 8KB.
  // Fastify serves the full manifest and receives events; SDK handles catalog/meta.
  const manifest = createManifest(true, profile);
  const builder = new addonBuilder({ ...manifest, resources: ['catalog', { name: 'meta', types: ['movie','series'], idPrefixes: ['tt'] }], catalogs: manifest.catalogs.map(c => ({ ...c, extra: c.extra?.map(e => ({ name: e.name, isRequired: e.isRequired })) })) });
  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const catalog = id.startsWith('pf-') ? id.slice(3) : '';
    const query = parseCatalogQuery(new URLSearchParams(Object.entries(extra ?? {}).filter(([,v]) => v !== undefined).map(([k,v]) => [k,String(v)])).toString());
    if ((type !== 'movie' && type !== 'series') || (catalog !== 'search' && !isCatalogId(catalog))) return { metas: [] };
    return { metas: (await feed.page(profile, type, catalog, query)).map(toMetaPreview), cacheMaxAge: 0 };
  });
  builder.defineMetaHandler(async ({ type, id }) => {
    const title = (type === 'movie' || type === 'series') ? await feed.library.resolve(id, type, feedPreferences(profile).region) : undefined;
    const meta = title ? await metadata(title) : null;
    if (!meta) throw new Error('METADATA_UNAVAILABLE');
    return { meta, cacheMaxAge: 3600 };
  });
  return builder.getInterface() as unknown as RuntimeAddonInterface;
}
