import { addonBuilder, type Manifest, type MetaPreview, type MetaDetail } from 'stremio-addon-sdk';
import type { Profile } from '../../packages/shared/types.js';
import type { FeedService } from '../api/services/feed.js';
import { feedPreferences } from '../../packages/shared/preferences.js';
import { isCatalogId, PAGE_SIZE } from '../../packages/recommendation/catalogs.js';
import { toMetaPreview } from '../../packages/metadata/mapper.js';
import type { MetadataProvider } from '../../packages/metadata/cinemeta.js';
import { createManifest } from './manifest.js';

// The SDK 1.6.10 implementation takes positional arguments. DefinitelyTyped's
// AddonInterface.get declaration incorrectly describes a single object argument.
interface RuntimeAddonInterface {
  manifest: Manifest;
  get(resource: 'catalog', type: 'movie' | 'series', id: string, extra?: Record<string, unknown>): Promise<{ metas: MetaPreview[]; cacheMaxAge?: number }>;
  get(resource: 'meta', type: 'movie' | 'series', id: string, extra?: Record<string, unknown>): Promise<{ meta: MetaDetail; cacheMaxAge?: number }>;
}

export function createAddon(profile: Profile, feed: FeedService, metadata: MetadataProvider) {
  const builder = new addonBuilder(createManifest(true));
  builder.defineCatalogHandler(async ({ type, id, extra }) => {
    const catalog = id.startsWith('pf-') ? id.slice(3) : '';
    const skip = Number(extra?.skip ?? 0);
    if ((type !== 'movie' && type !== 'series') || !isCatalogId(catalog) || !Number.isSafeInteger(skip) || skip < 0) return { metas: [] };
    return {
      metas: (await feed.recommend(profile, type, catalog)).slice(skip, skip + PAGE_SIZE).map(toMetaPreview),
      cacheMaxAge: 0,
    };
  });
  builder.defineMetaHandler(async ({ type, id }) => {
    const title = (type === 'movie' || type === 'series') ? await feed.library.resolve(id, type, feedPreferences(profile).region) : undefined;
    const meta = title ? await metadata(title) : null;
    if (!meta) throw new Error('METADATA_UNAVAILABLE');
    return { meta, cacheMaxAge: 3600 };
  });
  return builder.getInterface() as unknown as RuntimeAddonInterface;
}
