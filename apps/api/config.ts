export interface Config {
  port: number;
  host: string;
  publicBaseUrl: string;
  storageMode: 'persistent' | 'ephemeral';
  registrationKey: string;
  logLevel: string;
}

export function loadConfig(env = process.env): Config {
  const port = Number(env.SERVER_PORT || env.PORT || 7000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SERVER_PORT / PORT');
  const url = new URL(env.PUBLIC_BASE_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${port}`);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('PUBLIC_BASE_URL must be an HTTP(S) origin');
  }
  if (env.NODE_ENV === 'production' && url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('Public production origins must use HTTPS');
  }
  const storageMode = env.STORAGE_MODE ?? 'persistent';
  if (!['persistent', 'ephemeral'].includes(storageMode)) throw new Error('Invalid STORAGE_MODE');
  return {
    port, host: env.HOST || '0.0.0.0', publicBaseUrl: url.origin,
    storageMode: storageMode as Config['storageMode'],
    registrationKey: env.REGISTRATION_KEY || '', logLevel: env.LOG_LEVEL || 'info',
  };
}
