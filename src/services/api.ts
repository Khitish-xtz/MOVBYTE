const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// ─── Cache System ───────────────────────────────────────────────────────────

interface CacheEntry {
  data: any;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.data as T;
  }
  return null;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, timestamp: Date.now() });
}

export function clearCache(pattern?: string): void {
  if (!pattern) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
    }
  }
}

// ─── Vega Provider API ──────────────────────────────────────────────────────

export async function fetchProviders(): Promise<any[]> {
  const cacheKey = 'providers';
  const cached = getCached<any[]>(cacheKey);
  if (cached) return cached;
  
  const res = await fetch(`${API_BASE}/api/providers`);
  if (!res.ok) throw new Error('Failed to fetch providers');
  const data = await res.json();
  setCache(cacheKey, data);
  return data;
}

export async function fetchHomePosts(providerValue: string, filter = '', page = 1): Promise<any[]> {
  const cacheKey = `posts-${providerValue}-${filter}-${page}`;
  const cached = getCached<any[]>(cacheKey);
  if (cached) return cached;
  
  const params = new URLSearchParams({ filter, page: String(page) });
  const res = await fetch(`${API_BASE}/api/providers/${providerValue}/home?${params}`);
  if (!res.ok) throw new Error(`Failed to fetch from ${providerValue}`);
  const data = await res.json();
  setCache(cacheKey, data);
  return data;
}

export async function searchPosts(providerValue: string, query: string, page = 1): Promise<any[]> {
  const params = new URLSearchParams({ q: query, page: String(page) });
  const res = await fetch(`${API_BASE}/api/providers/${providerValue}/search?${params}`);
  if (!res.ok) throw new Error(`Search failed on ${providerValue}`);
  return res.json();
}

export async function fetchMeta(providerValue: string, link: string): Promise<any> {
  const params = new URLSearchParams({ link: encodeURIComponent(link) });
  const res = await fetch(`${API_BASE}/api/providers/${providerValue}/meta?${params}`);
  if (!res.ok) throw new Error('Failed to fetch metadata');
  return res.json();
}

export async function fetchStreams(providerValue: string, link: string, type = 'movie'): Promise<any[]> {
  const params = new URLSearchParams({ link: encodeURIComponent(link), type });
  const res = await fetch(`${API_BASE}/api/providers/${providerValue}/stream?${params}`);
  if (!res.ok) throw new Error('Failed to fetch streams');
  return res.json();
}

export async function fetchEpisodes(providerValue: string, link: string): Promise<any[]> {
  const params = new URLSearchParams({ link: encodeURIComponent(link) });
  const res = await fetch(`${API_BASE}/api/providers/${providerValue}/episodes?${params}`);
  if (!res.ok) throw new Error('Failed to fetch episodes');
  return res.json();
}

export async function fetchProviderCatalog(providerValue: string): Promise<{ catalog: any[]; genres: any[] }> {
  const res = await fetch(`${API_BASE}/api/providers/${providerValue}/catalog`);
  if (!res.ok) throw new Error('Failed to fetch catalog');
  return res.json();
}

// ─── YTS Torrent API ────────────────────────────────────────────────────────

export async function fetchYTSList(params: Record<string, string> = {}): Promise<any> {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${API_BASE}/api/yts/list?${qs}`);
  if (!res.ok) throw new Error('Failed to fetch YTS');
  return res.json();
}

export async function fetchYTSSearch(query: string, page = 1): Promise<any> {
  const params = new URLSearchParams({ q: query, page: String(page) });
  const res = await fetch(`${API_BASE}/api/yts/search?${params}`);
  if (!res.ok) throw new Error('YTS search failed');
  return res.json();
}

export async function fetchYTSMovie(id: number | string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/yts/movie/${id}`);
  if (!res.ok) throw new Error('Failed to fetch YTS movie');
  return res.json();
}

// ─── Telegram API ───────────────────────────────────────────────────────────

export async function configureTelegram(botToken: string, channelId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/telegram/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botToken, channelId }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Telegram config failed');
  }
  return res.json();
}

export async function fetchTelegramVideos(limit = 50): Promise<any[]> {
  const res = await fetch(`${API_BASE}/api/telegram/videos?limit=${limit}`);
  if (!res.ok) throw new Error('Failed to fetch Telegram videos');
  return res.json();
}

/** Check if the server already has a saved Telegram config (no re-auth needed). */
export async function fetchTelegramStatus(): Promise<{ configured: boolean; channelId: string | null }> {
  const res = await fetch(`${API_BASE}/api/telegram/status`);
  if (!res.ok) return { configured: false, channelId: null };
  return res.json();
}

export function getTelegramStreamUrl(messageIdOrFileId: number | string): string {
  return `${API_BASE}/api/telegram/stream?fileId=${messageIdOrFileId}`;
}

/** Configure or clear the local FSB instance URL */
export async function configureFsbUrl(fsbUrl: string): Promise<any> {
  const res = await fetch(`${API_BASE}/api/telegram/fsb-config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fsbUrl }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'FSB config failed');
  }
  return res.json();
}

/** Build a proxied FSB stream URL (handles CORS via our server) */
export function getFsbStreamUrl(fsbDirectUrl: string): string {
  return `${API_BASE}/api/telegram/fsb-stream?url=${encodeURIComponent(fsbDirectUrl)}`;
}

// ─── Proxy ──────────────────────────────────────────────────────────────────

export function getProxiedUrl(url: string): string {
  return `${API_BASE}/api/proxy?url=${encodeURIComponent(url)}`;
}

export function getDownloadUrl(url: string, filename?: string): string {
  const params = new URLSearchParams({ url: encodeURIComponent(url) });
  if (filename) params.append('filename', encodeURIComponent(filename));
  return `${API_BASE}/api/download?${params}`;
}

export function getVlcUrl(url: string): string {
  return `vlc://${url}`;
}

// ─── External Streaming APIs ─────────────────────────────────────────────────

export async function fetchExternalStreams(tmdbId: string, type: string = 'movie', season?: string, episode?: string): Promise<any[]> {
  const params = new URLSearchParams({ tmdbId, type });
  if (season) params.append('season', season);
  if (episode) params.append('episode', episode);
  
  const res = await fetch(`${API_BASE}/api/external/videolinks?${params}`);
  if (!res.ok) throw new Error('Failed to fetch external streams');
  return res.json();
}

export async function lookupTMDB(title: string, year?: string, type: string = 'movie'): Promise<any> {
  const params = new URLSearchParams({ title, type });
  if (year) params.append('year', year);
  
  const res = await fetch(`${API_BASE}/api/external/lookup?${params}`);
  if (!res.ok) throw new Error('TMDB lookup failed');
  return res.json();
}

// ─── Utils ──────────────────────────────────────────────────────────────────

export function buildMagnetLink(hash: string, name: string, trackers: string[] = []): string {
  const defaultTrackers = [
    'udp://open.demonii.com:1337/announce',
    'udp://tracker.openbittorrent.com:80',
    'udp://tracker.coppersurfer.tk:6969',
    'udp://glotorrents.pw:6969/announce',
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://torrent.gresille.org:80/announce',
    'udp://p4p.arenabg.com:1337',
    'udp://tracker.leechers-paradise.org:6969',
  ];
  const allTrackers = [...defaultTrackers, ...trackers];
  const tr = allTrackers.map(t => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${hash}&dn=${encodeURIComponent(name)}${tr}`;
}
