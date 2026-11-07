import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { ProfileService } from './services/profiles.js';
import { TITLES } from '../../packages/metadata/fixtures.js';
import { GENRES, PLATFORMS, REGIONS, ORIGINS, feedPreferences, type FeedPreferences } from '../../packages/shared/preferences.js';
import { LiveLibrary, FixtureLibrary, UnconfiguredLibrary, type LibrarySource } from '../../packages/metadata/live-library.js';
import { MetadataStore } from '../../packages/metadata/store.js';
import { TmdbClient } from '../../packages/metadata/tmdb.js';
import { CommunitySignals } from '../../packages/recommendation/community.js';
import { FeedService } from './services/feed.js';
import { createCinemetaProvider, type MetadataProvider } from '../../packages/metadata/cinemeta.js';
import { createManifest } from '../addon/manifest.js';
import { createAddon } from '../addon/addon.js';
import { CATALOGS, isCatalogId } from '../../packages/recommendation/catalogs.js';
import type { Profile } from '../../packages/shared/types.js';
import { configureHtml } from './ui/configure.js';

const preferencesSchema = {
  type: 'object', additionalProperties: false, required: ['genres', 'favorites'],
  properties: {
    genres: { type: 'array', maxItems: 12, uniqueItems: true, items: { type: 'string', enum: GENRES } },
    favorites: { type: 'array', maxItems: 10, uniqueItems: true, items: { type: 'string', pattern: '^tt[0-9]{7,10}$' } },
    region: { type: 'string', enum: REGIONS },
    platforms: { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: { type: 'string', enum: PLATFORMS.map(p => p.id) } },
    preferredOrigins: { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string', enum: ORIGINS } },
    preferAnime: { type: 'boolean' },
  },
} as const;

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function buildServer(db: PrismaClient, config: Config, metadata: MetadataProvider = createCinemetaProvider(), libraryOverride?: LibrarySource) {
  // URL paths contain Stremio capability tokens. Do not log requests, URLs, or bodies.
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: 16_384,
    ajv: { customOptions: { removeAdditional: false } },
  });
  const profiles = new ProfileService(db);
  const store = new MetadataStore(db);
  const library = libraryOverride || ((config.tmdbToken || config.tmdbApiKey)
    ? new LiveLibrary(new TmdbClient({ token: config.tmdbToken, apiKey: config.tmdbApiKey }, store), store)
    : config.demoMode ? new FixtureLibrary() : new UnconfiguredLibrary());
  const feed = new FeedService(library, new CommunitySignals(db));
  await store.prune();
  const maintenance = setInterval(() => { void store.prune().catch(() => app.log.error('Cache maintenance failed')); }, 1_800_000);
  maintenance.unref();
  app.addHook('onClose', async () => clearInterval(maintenance));
  const validateFavorites = async (ids: string[], region: string) => {
    const resolved = await Promise.all(ids.map(id => library.resolve(id, undefined, region)));
    if (resolved.some(t => !t)) throw httpError(400, 'Không tìm thấy IMDb ID trong nguồn metadata.');
  };
  await app.register(cors, { origin: '*', methods: ['GET', 'POST', 'PUT', 'OPTIONS'] });
  await app.register(rateLimit, { max: 150, timeWindow: '1 minute' });
  app.addHook('onRequest', async (_request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://images.metahub.space https://image.tmdb.org https://www.themoviedb.org; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  });
  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const status = error.statusCode ?? 500;
    // Log stable classifications only, not errors that may embed a token or database URL.
    if (status >= 500) app.log.error({ route: request.routeOptions.url, status }, 'Request failed');
    reply.code(status).send({ error: status >= 500 ? 'Service temporarily unavailable' : error.message });
  });

  const authenticate = async (authorization?: string): Promise<Profile> => {
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    const profile = await profiles.find(token);
    if (!profile) throw httpError(401, 'Invalid profile token');
    return profile;
  };
  const fromPath = async (token: string) => {
    const profile = await profiles.find(token);
    if (!profile) throw httpError(401, 'Invalid profile token');
    return profile;
  };
  const links = (token: string) => ({
    manifestUrl: `${config.publicBaseUrl}/${token}/manifest.json`,
    installUrl: `${config.publicBaseUrl.replace(/^https?:/, 'stremio:')}/${token}/manifest.json`,
  });

  app.get('/health', async () => {
    await db.$queryRaw`SELECT 1`;
    return { status: 'ok', version: '0.3.0', metadata: library.mode, feedReady: library.mode === 'tmdb', storage: config.storageMode };
  });
  app.get('/', async (_request, reply) => reply.redirect('/configure'));
  app.get('/configure', async (_request, reply) => reply.type('text/html').send(configureHtml));
  app.get('/:token/configure', async (_request, reply) => reply.type('text/html').send(configureHtml));
  app.get('/assets/configure.js', async (_request, reply) => reply.type('application/javascript').send(configureScript));
  app.get('/assets/style.css', async (_request, reply) => reply.type('text/css').send(configureStyle));
  app.get('/api/library', async () => ({
    genres: GENRES,
    titles: library.mode === 'fixtures' ? TITLES.map(({ id, type, name, year, genres }) => ({ id, type, name, year, genres })) : [],
    catalogs: CATALOGS, platforms: PLATFORMS.map(({ id, name }) => ({ id, name })), regions: REGIONS, origins: ORIGINS, defaults: feedPreferences(),
    demo: library.mode === 'fixtures', source: library.mode, storage: config.storageMode, invitationRequired: Boolean(config.registrationKey),
  }));
  app.post<{ Body: { genres: string[]; favorites: string[]; registrationKey?: string } & Partial<FeedPreferences> }>('/api/profiles', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    schema: { body: { ...preferencesSchema, properties: { ...preferencesSchema.properties, registrationKey: { type: 'string', maxLength: 256 } } } },
  }, async (request, reply) => {
    if (config.registrationKey && !sameSecret(request.body.registrationKey ?? '', config.registrationKey)) throw httpError(403, 'Invalid invitation code');
    const { genres, favorites } = request.body;
    if (!genres.length && !favorites.length) throw httpError(400, 'Choose at least one genre or favorite');
    const prefs = feedPreferences(request.body);
    await validateFavorites(favorites, prefs.region);
    const { token, profile } = await profiles.create(genres, favorites, prefs);
    return reply.code(201).send({ token, profile, ...links(token) });
  });
  app.get('/api/profile', async request => ({ profile: await authenticate(request.headers.authorization) }));
  app.put<{ Body: { genres: string[]; favorites: string[] } & Partial<FeedPreferences> }>('/api/profile', {
    schema: { body: preferencesSchema },
  }, async request => {
    const profile = await authenticate(request.headers.authorization);
    const { genres, favorites } = request.body;
    if (!genres.length && !favorites.length) throw httpError(400, 'Choose at least one genre or favorite');
    const prefs = feedPreferences({ ...profile, ...request.body });
    await validateFavorites(favorites, prefs.region);
    await profiles.update(profile.id, genres, favorites, prefs);
    return { profile: await authenticate(request.headers.authorization) };
  });
  app.post<{ Body: { mediaId: string; kind: 'like' | 'dislike' | 'watched' | 'clear' } }>('/api/interactions', {
    schema: { body: {
      type: 'object', required: ['mediaId', 'kind'], additionalProperties: false,
      properties: {
        mediaId: { type: 'string', pattern: '^tt[0-9]{7,10}$' },
        kind: { type: 'string', enum: ['like', 'dislike', 'watched', 'clear'] },
      },
    } },
  }, async request => {
    const profile = await authenticate(request.headers.authorization);
    await validateFavorites([request.body.mediaId], feedPreferences(profile).region);
    await profiles.interact(profile.id, request.body.mediaId, request.body.kind);
    return { profile: await authenticate(request.headers.authorization) };
  });

  app.get<{ Querystring: { q: string; region?: string } }>('/api/search', {
    config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
    schema: { querystring: { type: 'object', required: ['q'], additionalProperties: false, properties: {
      q: { type: 'string', minLength: 2, maxLength: 80 }, region: { type: 'string', enum: REGIONS },
    } } },
  }, async request => ({ titles: await library.search(request.query.q, request.query.region || 'US') }));
  app.get('/api/favorites', async request => {
    const profile = await authenticate(request.headers.authorization);
    return { titles: (await Promise.all(profile.favorites.map(id => library.resolve(id, undefined, feedPreferences(profile).region)))).filter(Boolean) };
  });

  app.get('/manifest.json', async () => createManifest(false));
  app.get<{ Params: { token: string } }>('/:token/manifest.json', async request => {
    await fromPath(request.params.token);
    return createManifest(true);
  });
  type CatalogParams = { token: string; type: string; id: string; extra?: string };
  const catalogHandler = async (params: CatalogParams) => {
    const profile = await fromPath(params.token);
    if ((params.type !== 'movie' && params.type !== 'series') || !params.id.startsWith('pf-') || !isCatalogId(params.id.slice(3))) throw httpError(404, 'Catalog not found');
    let skip = 0;
    if (params.extra) {
      const extra = new URLSearchParams(params.extra);
      if ([...extra.keys()].some(k => k !== 'skip') || extra.getAll('skip').length !== 1 || !/^\d{1,8}$/.test(extra.get('skip') ?? '')) throw httpError(400, 'Invalid catalog pagination');
      skip = Number(extra.get('skip'));
    }
    const addon = createAddon(profile, feed, metadata);
    const result = await addon.get('catalog', params.type, params.id, { skip });
    return result;
  };
  app.get<{ Params: CatalogParams }>('/:token/catalog/:type/:id.json', async r => catalogHandler(r.params));
  app.get<{ Params: CatalogParams }>('/:token/catalog/:type/:id/:extra.json', async r => catalogHandler(r.params));
  app.get<{ Params: { token: string; type: string; id: string } }>('/:token/meta/:type/:id.json', async request => {
    const profile = await fromPath(request.params.token);
    const { type, id } = request.params;
    if ((type !== 'movie' && type !== 'series') || !/^tt[0-9]{7,10}$/.test(id)) throw httpError(404, 'Title not found');
    try {
      return await createAddon(profile, feed, metadata).get('meta', type, id);
    } catch { return { meta: null }; }
  });
  return app;
}

import { configureScript, configureStyle } from './ui/assets.js';
