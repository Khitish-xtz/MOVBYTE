/**
 * MovieBytes Unified Server
 * - Vega Providers API (movies/series scraping)
 * - Telegram MTProto streaming proxy
 * - YTS torrent proxy
 * - Stream URL proxy
 */
import express from 'express';
import cors from 'cors';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

// ffmpeg for on-the-fly MKV → browser-compatible MP4 transcoding
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
console.log('[ffmpeg] Binary:', ffmpegInstaller.path);


const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const PORT = process.env.PORT || 4000;

// ─── Vega Providers Setup ────────────────────────────────────────────────────

const VEGA_DIST = join(__dirname, 'vega-providers', 'dist');
const MANIFEST_PATH = join(VEGA_DIST, '..', 'manifest.json');

// Load getBaseUrl from vega-providers dist
let getBaseUrlFn;
try {
  const getBaseUrlModule = require(join(VEGA_DIST, 'getBaseUrl.js'));
  getBaseUrlFn = getBaseUrlModule.getBaseUrl;
  console.log('[Vega] getBaseUrl loaded');
} catch (e) {
  console.warn('[Vega] getBaseUrl not available, using fallback');
  getBaseUrlFn = async () => '';
}

// Base URL cache
const baseUrlCache = new Map();
const BASE_URL_CACHE_TTL = 60 * 60 * 1000;

async function getCachedBaseUrl(providerValue) {
  const cached = baseUrlCache.get(providerValue);
  if (cached && Date.now() - cached.time < BASE_URL_CACHE_TTL) {
    return cached.url;
  }
  try {
    const url = await getBaseUrlFn(providerValue);
    if (url) {
      baseUrlCache.set(providerValue, { url, time: Date.now() });
    }
    return url;
  } catch {
    return cached?.url || '';
  }
}

// Lazy init provider context
let _providerContext = null;
async function getProviderContext() {
  if (!_providerContext) {
    const axios = (await import('axios')).default;
    const cheerio = await import('cheerio');
    _providerContext = {
      axios,
      cheerio,
      getBaseUrl: getCachedBaseUrl,
      commonHeaders: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      Aes: null,
    };
  }
  return _providerContext;
}

// Load provider module from dist
function loadProvider(providerValue) {
  try {
    const providerDir = join(VEGA_DIST, providerValue);
    if (!fs.existsSync(providerDir)) return null;

    const mod = {};
    const postsPath = join(providerDir, 'posts.js');
    const metaPath = join(providerDir, 'meta.js');
    const streamPath = join(providerDir, 'stream.js');
    const catalogPath = join(providerDir, 'catalog.js');
    const episodesPath = join(providerDir, 'episodes.js');

    if (fs.existsSync(postsPath)) {
      const p = require(postsPath);
      mod.getPosts = p.getPosts;
      mod.getSearchPosts = p.getSearchPosts;
    }
    if (fs.existsSync(metaPath)) {
      const m = require(metaPath);
      mod.getMeta = m.getMeta || m.getInfo || m.getMetaData;
    }
    if (fs.existsSync(streamPath)) {
      const s = require(streamPath);
      mod.getStream = s.getStream;
    }
    if (fs.existsSync(catalogPath)) {
      const c = require(catalogPath);
      mod.catalog = c.catalog;
      mod.genres = c.genres;
    }
    if (fs.existsSync(episodesPath)) {
      const e = require(episodesPath);
      mod.getEpisodeLinks = e.getEpisodeLinks;
    }

    return mod.getPosts ? mod : null;
  } catch (err) {
    console.error(`[Vega] Failed to load provider ${providerValue}:`, err.message);
    return null;
  }
}

// Load manifest
function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf-8'));
  } catch {
    return [];
  }
}

// ─── Health ──────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ─── Providers API ───────────────────────────────────────────────────────────

app.get('/api/providers', (req, res) => {
  const manifest = loadManifest();
  const providers = manifest.filter(p => !p.disabled);
  res.json(providers);
});

// Home posts from a provider
app.get('/api/providers/:providerValue/home', async (req, res) => {
  try {
    const { providerValue } = req.params;
    const { filter = '', page = '1' } = req.query;

    const provider = loadProvider(providerValue);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });

    const ctx = await getProviderContext();
    const signal = AbortSignal.timeout(30000);

    const posts = await provider.getPosts({
      filter,
      page: parseInt(page),
      providerValue,
      signal,
      providerContext: ctx,
    });

    res.json(posts || []);
  } catch (err) {
    console.error(`[${req.params.providerValue}] home error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Search posts
app.get('/api/providers/:providerValue/search', async (req, res) => {
  try {
    const { providerValue } = req.params;
    const { q, page = '1' } = req.query;
    if (!q) return res.status(400).json({ error: 'Missing search query (q)' });

    const provider = loadProvider(providerValue);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });

    const ctx = await getProviderContext();
    const signal = AbortSignal.timeout(30000);

    const posts = await provider.getSearchPosts({
      searchQuery: q,
      page: parseInt(page),
      providerValue,
      signal,
      providerContext: ctx,
    });

    res.json(posts || []);
  } catch (err) {
    console.error(`[${req.params.providerValue}] search error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get metadata/detail
app.get('/api/providers/:providerValue/meta', async (req, res) => {
  try {
    const { providerValue } = req.params;
    const { link } = req.query;
    if (!link) return res.status(400).json({ error: 'Missing link' });

    const provider = loadProvider(providerValue);
    if (!provider || !provider.getMeta) {
      return res.status(404).json({ error: 'Provider or meta not found' });
    }

    const ctx = await getProviderContext();
    const info = await provider.getMeta({
      link: decodeURIComponent(link),
      providerContext: ctx,
    });

    res.json(info);
  } catch (err) {
    console.error(`[${req.params.providerValue}] meta error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get streams
app.get('/api/providers/:providerValue/stream', async (req, res) => {
  try {
    const { providerValue } = req.params;
    const { link, type = 'movie' } = req.query;
    if (!link) return res.status(400).json({ error: 'Missing link' });

    const provider = loadProvider(providerValue);
    if (!provider || !provider.getStream) {
      return res.status(404).json({ error: 'Provider or stream not found' });
    }

    const ctx = await getProviderContext();
    const signal = AbortSignal.timeout(30000);

    const streams = await provider.getStream({
      link: decodeURIComponent(link),
      type,
      signal,
      providerContext: ctx,
    });

    res.json(streams || []);
  } catch (err) {
    console.error(`[${req.params.providerValue}] stream error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get episode links
app.get('/api/providers/:providerValue/episodes', async (req, res) => {
  try {
    const { providerValue } = req.params;
    const { link } = req.query;
    if (!link) return res.status(400).json({ error: 'Missing link' });

    const provider = loadProvider(providerValue);
    if (!provider || !provider.getEpisodeLinks) {
      return res.status(404).json({ error: 'Provider or episodes not found' });
    }

    const ctx = await getProviderContext();
    const episodes = await provider.getEpisodeLinks({
      url: decodeURIComponent(link),
      providerContext: ctx,
    });

    res.json(episodes || []);
  } catch (err) {
    console.error(`[${req.params.providerValue}] episodes error:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// Get provider catalog info
app.get('/api/providers/:providerValue/catalog', (req, res) => {
  try {
    const { providerValue } = req.params;
    const provider = loadProvider(providerValue);
    if (!provider) return res.status(404).json({ error: 'Provider not found' });

    res.json({
      catalog: provider.catalog || [],
      genres: provider.genres || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Telegram Bot API + MTProto ──────────────────────────────────────────────

let tgBotToken = '';
let tgChannelId = '';
let fsbBaseUrl = '';     // FileStream Bot base URL (optional)
let mtProtoApiId = 0;    // Telegram App API ID (my.telegram.org)
let mtProtoApiHash = ''; // Telegram App API Hash (my.telegram.org)

const tgConfigPath = join(__dirname, 'telegram-config.json');

function loadTgConfig() {
  if (fs.existsSync(tgConfigPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(tgConfigPath, 'utf-8'));
      tgBotToken      = config.botToken || '';
      tgChannelId     = config.channelId || '';
      fsbBaseUrl      = config.fsbBaseUrl || '';
      mtProtoApiId    = parseInt(config.apiId) || 0;
      mtProtoApiHash  = config.apiHash || '';
      if (tgBotToken)    console.log('[Telegram] Loaded config for:', tgChannelId);
      if (fsbBaseUrl)    console.log('[FSB] FileStream Bot URL:', fsbBaseUrl);
      if (mtProtoApiId)  console.log('[MTProto] API ID loaded:', mtProtoApiId);
    } catch (e) {
      console.log('[Telegram] Failed to load config:', e.message);
    }
  }
}

function saveTgConfig() {
  fs.writeFileSync(tgConfigPath, JSON.stringify({
    botToken: tgBotToken,
    channelId: tgChannelId,
    fsbBaseUrl,
    apiId: mtProtoApiId || undefined,
    apiHash: mtProtoApiHash || undefined,
  }, null, 2));
}

// ─── MTProto client singleton ─────────────────────────────────────────────────
let _mtClient = null;
let _mtClientReady = false;

async function getMtClient() {
  if (_mtClient && _mtClientReady) return _mtClient;
  if (!mtProtoApiId || !mtProtoApiHash || !tgBotToken) {
    throw new Error('MTProto not configured. Provide API ID, API Hash, and Bot Token in Settings.');
  }

  const { TelegramClient } = await import('telegram');
  const { StringSession } = await import('telegram/sessions/index.js');

  console.log('[MTProto] Initialising bot session...');
  _mtClient = new TelegramClient(
    new StringSession(''),
    mtProtoApiId,
    mtProtoApiHash,
    { connectionRetries: 5, useWSS: false }
  );

  // Bot auth — NO OTP required, uses bot token not user phone
  await _mtClient.start({ botAuthToken: tgBotToken });
  _mtClientReady = true;
  console.log('[MTProto] ✓ Bot session ready');
  return _mtClient;
}

// Reset client when config changes
function resetMtClient() {
  if (_mtClient) {
    _mtClient.disconnect().catch(() => {});
    _mtClient = null;
    _mtClientReady = false;
  }
}

loadTgConfig(); // Load saved config from disk

// ─── MTProto Config endpoint ─────────────────────────────────────────────────
// Save API_ID + API_HASH so we can open a proper MTProto bot session
app.post('/api/telegram/mtproto/config', async (req, res) => {
  try {
    const { apiId, apiHash } = req.body;
    if (!apiId || !apiHash) return res.status(400).json({ error: 'Missing apiId or apiHash' });
    if (!tgBotToken) return res.status(400).json({ error: 'Configure bot token first' });

    const newApiId = parseInt(apiId);
    if (isNaN(newApiId)) return res.status(400).json({ error: 'apiId must be a number' });

    // Reset existing client so it reconnects with new credentials
    resetMtClient();
    mtProtoApiId   = newApiId;
    mtProtoApiHash = apiHash.trim();
    saveTgConfig();

    // Eagerly connect to validate credentials
    console.log('[MTProto] Testing credentials...');
    const client = await getMtClient();
    const me = await client.getMe();
    console.log('[MTProto] ✓ Connected as bot:', me.username);

    res.json({ success: true, message: `MTProto ready. Connected as @${me.username}` });
  } catch (err) {
    console.error('[MTProto] Config error:', err.message);
    resetMtClient();
    mtProtoApiId = 0;
    mtProtoApiHash = '';
    res.status(500).json({ error: err.message });
  }
});

// ─── MTProto stream endpoint ─────────────────────────────────────────────────
// Streams any Telegram file (no size limit) using MTProto protocol.
// ?messageId=<N>  — The message ID in the channel that contains the video
app.get('/api/telegram/mtproto/stream', async (req, res) => {
  const { messageId } = req.query;
  console.log('[MTProto] Stream request for messageId:', messageId);

  try {
    if (!messageId) return res.status(400).json({ error: 'Missing messageId' });

    const client = await getMtClient();
    const { Api } = await import('telegram');

    // Fetch the message from the channel
    const channelIdNum = parseInt(tgChannelId.replace('-100', ''));
    const peer = await client.getInputEntity(tgChannelId);

    const messages = await client.getMessages(peer, { ids: [parseInt(messageId)] });
    const message = messages[0];
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const media = message.media;
    if (!media) return res.status(404).json({ error: 'No media in this message' });

    // Get document/video info
    const doc = media.document || media.video;
    if (!doc) return res.status(404).json({ error: 'No video/document in this message' });

    const totalSize = doc.size ? Number(doc.size) : 0;
    const mimeType = doc.mimeType || 'video/mp4';
    const fileName = (doc.attributes || []).find(a => a.fileName)?.fileName || `video_${messageId}.mkv`;

    // Handle Range requests for seek support
    const rangeHeader = req.headers.range;
    let start = 0;
    let end = totalSize > 0 ? totalSize - 1 : undefined;
    let statusCode = 200;

    if (rangeHeader && totalSize > 0) {
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      start = parseInt(parts[0], 10);
      end = parts[1] ? parseInt(parts[1], 10) : totalSize - 1;
      statusCode = 206;
    }

    const chunkSize = end !== undefined ? (end - start + 1) : undefined;

    // Set response headers
    res.writeHead(statusCode, {
      'Content-Type': mimeType,
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
      ...(totalSize > 0 && {
        'Content-Length': String(chunkSize ?? totalSize),
        'Content-Range': statusCode === 206 ? `bytes ${start}-${end}/${totalSize}` : undefined,
      }),
    });

    console.log(`[MTProto] Streaming ${fileName} (${mimeType}) range: ${start}-${end ?? '?'} / ${totalSize}`);

    // Stream using iterDownload for memory-efficient chunked delivery
    const iter = client.iterDownload({
      file: new Api.InputDocumentFileLocation({
        id: doc.id,
        accessHash: doc.accessHash,
        fileReference: doc.fileReference,
        thumbSize: '',
      }),
      requestSize: 1024 * 1024,  // 1 MB per request
      offset: BigInt(start),
      limit: chunkSize ? Math.ceil(chunkSize / (1024 * 1024)) : undefined,
      dcId: doc.dcId,
    });

    let bytesWritten = 0;
    for await (const chunk of iter) {
      if (res.destroyed) break;
      const buf = Buffer.from(chunk);
      if (chunkSize && bytesWritten + buf.length > chunkSize) {
        res.write(buf.slice(0, chunkSize - bytesWritten));
        break;
      }
      res.write(buf);
      bytesWritten += buf.length;
    }
    res.end();
    console.log(`[MTProto] ✓ Done streaming ${fileName} (${bytesWritten} bytes)`);

  } catch (err) {
    console.error('[MTProto] ✗ Stream error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});


app.post('/api/telegram/config', async (req, res) => {
  console.log('[Telegram] Config request received');
  try {
    const { botToken, channelId } = req.body;
    console.log('[Telegram] Received botToken:', botToken?.substring(0, 10), 'channelId:', channelId);
    
    if (!botToken || !channelId) {
      console.log('[Telegram] Missing parameters');
      return res.status(400).json({ error: 'Missing botToken or channelId' });
    }

    const axios = (await import('axios')).default;
    
    // Use full channel ID for API calls
    const cleanChannelId = channelId.toString();
    console.log('[Telegram] Channel ID:', cleanChannelId);
    
    // Test bot token
    console.log('[Telegram] Testing bot token...');
    const botInfo = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`);
    console.log('[Telegram] Bot info:', botInfo.data.result?.username);
    
    if (!botInfo.data.ok) {
      throw new Error('Invalid bot token');
    }

    // Get channel info
    console.log('[Telegram] Getting channel info...');
    let chatInfo;
    try {
      chatInfo = await axios.get(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${cleanChannelId}`);
      console.log('[Telegram] Channel info:', chatInfo.data.result?.title);
    } catch (chatErr) {
      console.error('[Telegram] Chat error:', chatErr.response?.data || chatErr.message);
      return res.status(400).json({ 
        error: `Cannot access channel. Make sure bot is admin and has read permission. Error: ${chatErr.response?.data?.description || chatErr.message}` 
      });
    }

    tgBotToken = botToken;
    tgChannelId = cleanChannelId;
    saveTgConfig();
    
    console.log('[Telegram] ✓ Configured successfully:', botInfo.data.result.username, '->', chatInfo.data.result.title);
    
    res.json({ success: true, message: `Connected to ${chatInfo.data.result.title}` });
  } catch (err) {
    console.error('[Telegram] ✗ Config error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/telegram/videos', async (req, res) => {
  console.log('[Telegram] Videos request received');
  try {
    if (!tgBotToken || !tgChannelId) {
      console.log('[Telegram] Not configured');
      return res.status(400).json({ error: 'Telegram not configured. Configure first.' });
    }

    const axios = (await import('axios')).default;
    const limit = Math.min(parseInt(req.query.limit) || 100, 100);
    
    console.log('[Telegram] Fetching from channel:', tgChannelId);
    
    let videos = [];
    
    try {
      console.log('[Telegram] Getting chat history...');
      console.log('[Telegram] Using channel ID:', tgChannelId);
      const historyRes = await axios.get(
        `https://api.telegram.org/bot${tgBotToken}/getChatHistory?chat_id=${tgChannelId}&limit=100`
      );
      
      console.log('[Telegram] History response:', historyRes.data);
      
      console.log('[Telegram] History response:', historyRes.data.ok ? 'OK' : 'Failed', 'count:', historyRes.data.result?.length || 0);
      
      if (historyRes.data.ok && historyRes.data.result?.length > 0) {
        for (const msg of historyRes.data.result) {
          if (!msg) continue;
          
          if (msg.video || (msg.document && msg.document.mime_type?.startsWith('video'))) {
            const doc = msg.video || msg.document;
            const fileId = msg.video?.file_id || msg.document?.file_id;
            
            const fsbHash = msg.text?.match(/\/(\w+)\?hash=(\w+)/)?.[2] || '';
            videos.push({
              messageId: msg.message_id,
              fileName: doc.file_name || `video_${fileId}.mp4`,
              fileSize: doc.file_size || 0,
              mimeType: doc.mime_type || 'video/mp4',
              duration: doc.duration || 0,
              date: msg.date,
              caption: msg.caption || msg.text || '',
              streamUrl: fsbHash ? `/api/telegram/fsb-proxy?hash=${fsbHash}&msgId=${msg.message_id}` : null,
              fsbStreamUrl: fsbHash ? `${fsbBaseUrl || '[FSB_URL]'}/${msg.message_id}?hash=${fsbHash}` : null,
            });
          }
        }
      }
    } catch (historyErr) {
      console.error('[Telegram] getChatHistory error:', historyErr.response?.data || historyErr.message);
      console.log('[Telegram] Trying getUpdates as fallback...');
      try {
        const updatesRes = await axios.get(
          `https://api.telegram.org/bot${tgBotToken}/getUpdates?timeout=30`
        );
        console.log('[Telegram] Updates response:', updatesRes.data);
        if (updatesRes.data.ok && updatesRes.data.result?.length > 0) {
          for (const update of updatesRes.data.result) {
            const msg = update.channel_post || update.message;
            if (!msg) continue;
            if (msg.video || (msg.document && msg.document.mime_type?.startsWith('video'))) {
              const doc = msg.video || msg.document;
              const fileId = msg.video?.file_id || msg.document?.file_id;
              const fsbHash2 = msg.text?.match(/\/(\w+)\?hash=(\w+)/)?.[2] || '';
              videos.push({
                messageId: msg.message_id,
                fileName: doc.file_name || `video_${fileId}.mp4`,
                fileSize: doc.file_size || 0,
                mimeType: doc.mime_type || 'video/mp4',
                duration: doc.duration || 0,
                date: msg.date,
                caption: msg.caption || msg.text || '',
                streamUrl: fsbHash2 ? `/api/telegram/fsb-proxy?hash=${fsbHash2}&msgId=${msg.message_id}` : null,
                fsbStreamUrl: fsbHash2 ? `${fsbBaseUrl || '[FSB_URL]'}/${msg.message_id}?hash=${fsbHash2}` : null,
              });
            }
          }
        }
      } catch (updateErr) {
        console.error('[Telegram] getUpdates fallback error:', updateErr.message);
      }
    }
    
    console.log('[Telegram] ✓ Found videos:', videos.length);
    res.json(videos);
    
  } catch (err) {
    console.error('[Telegram] ✗ Videos error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: resolve Telegram file URL from fileId ─────────────────────────
async function resolveTelegramFileUrl(fileId) {
  const axios = (await import('axios')).default;
  const fileInfo = await axios.get(
    `https://api.telegram.org/bot${tgBotToken}/getFile?file_id=${fileId}`
  );
  if (!fileInfo.data.ok) {
    const errDesc = fileInfo.data.description || '';
    if (errDesc.includes('too big')) {
      throw Object.assign(new Error('FILE_TOO_BIG'), { code: 'FILE_TOO_BIG' });
    }
    throw new Error('File not found or expired: ' + errDesc);
  }
  const filePath = fileInfo.data.result.file_path;
  return {
    fileUrl: `https://api.telegram.org/file/bot${tgBotToken}/${filePath}`,
    filePath,
    fileSize: fileInfo.data.result.file_size || 0,
  };
}

// ── Direct stream (non-MKV, ≤20 MB) ─────────────────────────────────────────
app.get('/api/telegram/stream', async (req, res) => {
  console.log('[Telegram] Stream request for fileId:', req.query.fileId);
  try {
    const { fileId } = req.query;
    if (!fileId) return res.status(400).json({ error: 'Missing fileId' });
    if (!tgBotToken) return res.status(400).json({ error: 'Telegram not configured' });

    const axios = (await import('axios')).default;
    let resolved;
    try {
      resolved = await resolveTelegramFileUrl(fileId);
    } catch (e) {
      if (e.code === 'FILE_TOO_BIG') {
        return res.status(400).json({ error: 'File too large for Telegram Bot API (>20 MB). Try the transcode endpoint.' });
      }
      throw e;
    }

    const { fileUrl, filePath, fileSize } = resolved;
    console.log('[Telegram] Streaming:', filePath, 'size:', fileSize);

    // Determine content-type
    const fp = filePath.toLowerCase();
    let contentType = 'video/mp4';
    if (fp.endsWith('.mkv') || fp.includes('matroska')) contentType = 'video/x-matroska';
    else if (fp.endsWith('.webm')) contentType = 'video/webm';
    else if (fp.endsWith('.avi')) contentType = 'video/x-msvideo';

    const rangeHeader = req.headers.range;
    const axiosConfig = { responseType: 'stream', timeout: 300000, headers: {} };
    if (rangeHeader) axiosConfig.headers.Range = rangeHeader;

    const response = await axios.get(fileUrl, axiosConfig);

    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Accept-Ranges', 'bytes');
    if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
    if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);

    res.status(response.status);
    console.log('[Telegram] ✓ Direct streaming started');
    response.data.pipe(res);
  } catch (err) {
    console.error('[Telegram] ✗ Stream error:', err.response?.data || err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

// ── Transcode endpoint: MKV → MP4 (H.264/AAC) via ffmpeg ────────────────────
// Works for any video format; remuxes/transcodes on-the-fly so browser can play
app.get('/api/telegram/transcode', async (req, res) => {
  console.log('[Transcode] Request for fileId:', req.query.fileId);
  try {
    const { fileId } = req.query;
    if (!fileId) return res.status(400).json({ error: 'Missing fileId' });
    if (!tgBotToken) return res.status(400).json({ error: 'Telegram not configured' });

    let resolved;
    try {
      resolved = await resolveTelegramFileUrl(fileId);
    } catch (e) {
      if (e.code === 'FILE_TOO_BIG') {
        return res.status(400).json({ error: 'File too large for Telegram Bot API (>20 MB).' });
      }
      throw e;
    }

    const { fileUrl, filePath } = resolved;
    console.log('[Transcode] Transcoding:', filePath);

    // Send fragmented MP4 so the browser can start playing instantly
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Transfer-Encoding', 'chunked');

    const proc = ffmpeg(fileUrl)
      .inputOptions([
        '-user_agent', 'Mozilla/5.0',
        '-headers', `Authorization: `,
      ])
      .videoCodec('libx264')
      .audioCodec('aac')
      .outputOptions([
        '-preset', 'ultrafast',   // minimal CPU latency
        '-crf', '23',
        '-movflags', 'frag_keyframe+empty_moov+faststart', // fragmented MP4 = streamable
        '-f', 'mp4',
      ])
      .on('start', (cmd) => console.log('[Transcode] ffmpeg started:', cmd.substring(0, 120)))
      .on('error', (err, stdout, stderr) => {
        console.error('[Transcode] ffmpeg error:', err.message);
        console.error('[Transcode] stderr:', stderr?.substring(0, 300));
        if (!res.headersSent) res.status(500).json({ error: 'Transcode failed: ' + err.message });
        else res.end();
      })
      .on('end', () => {
        console.log('[Transcode] ✓ Done');
        res.end();
      });

    // Pipe ffmpeg output directly to response
    proc.pipe(res, { end: true });

    // Cleanup if client disconnects
    req.on('close', () => {
      console.log('[Transcode] Client disconnected, killing ffmpeg');
      proc.kill('SIGKILL');
    });

  } catch (err) {
    console.error('[Transcode] ✗ Error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

app.get('/api/telegram/status', (req, res) => {
  res.json({
    configured: !!(tgBotToken && tgChannelId),
    connected: !!tgBotToken,
    channelId: tgChannelId || null,
    fsbConfigured: !!fsbBaseUrl,
    fsbBaseUrl: fsbBaseUrl || null,
    mtProtoConfigured: !!(mtProtoApiId && mtProtoApiHash),
    mtProtoReady: _mtClientReady,
  });
});

// ── FSB Config: save FileStream Bot base URL ──────────────────────────────────
app.post('/api/telegram/fsb-config', async (req, res) => {
  try {
    const { fsbUrl } = req.body;
    if (!fsbUrl) {
      // Clear FSB config
      fsbBaseUrl = '';
      saveTgConfig();
      return res.json({ success: true, message: 'FSB disabled' });
    }

    // Validate: try to reach the FSB instance
    const axios = (await import('axios')).default;
    const cleanUrl = fsbUrl.replace(/\/$/, ''); // remove trailing slash
    try {
      await axios.get(cleanUrl, { timeout: 5000, validateStatus: (s) => s < 500 });
    } catch (e) {
      return res.status(400).json({ error: `Cannot reach FSB at ${cleanUrl}: ${e.message}` });
    }

    fsbBaseUrl = cleanUrl;
    saveTgConfig();
    console.log('[FSB] Configured:', fsbBaseUrl);
    res.json({ success: true, message: `FSB connected at ${fsbBaseUrl}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── FSB Proxy: stream using messageId and hash ────────────────────────────────
app.get('/api/telegram/fsb-proxy', async (req, res) => {
  try {
    const { msgId, hash } = req.query;
    if (!msgId || !hash) return res.status(400).json({ error: 'Missing msgId or hash' });
    if (!fsbBaseUrl) return res.status(400).json({ error: 'FSB not configured. Configure FSB URL in Settings.' });

    const targetUrl = `${fsbBaseUrl}/${msgId}?hash=${hash}`;
    console.log('[FSB-Proxy] Streaming from:', targetUrl);

    const axios = (await import('axios')).default;
    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;

    const response = await axios.get(targetUrl, {
      responseType: 'stream',
      timeout: 0,
      headers,
      validateStatus: (s) => s < 500 || s === 416,
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Accept-Ranges', 'bytes');
    if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
    if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
    if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
    res.status(response.status);
    response.data.pipe(res);
  } catch (err) {
    console.error('[FSB-Proxy] Error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

// ── FSB Proxy: stream a file via local FSB instance ───────────────────────────
// The FSB URL format is <base>/<msgId>/<hash> — the user must have forwarded
// the file to their FSB bot first. This endpoint accepts a full FSB stream URL
// and proxies it through our server (handles CORS, range requests, etc.)
app.get('/api/telegram/fsb-stream', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });
    if (!fsbBaseUrl) return res.status(400).json({ error: 'FSB not configured' });

    const targetUrl = decodeURIComponent(url);
    // Validate the URL starts with our configured FSB base
    if (!targetUrl.startsWith(fsbBaseUrl)) {
      return res.status(403).json({ error: 'URL does not match configured FSB base URL' });
    }

    const axios = (await import('axios')).default;
    const headers = {};
    if (req.headers.range) headers.Range = req.headers.range;

    const response = await axios.get(targetUrl, {
      responseType: 'stream',
      timeout: 0,
      headers,
      validateStatus: (s) => s < 500 || s === 416,
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Range');
    res.setHeader('Accept-Ranges', 'bytes');
    if (response.headers['content-type']) res.setHeader('Content-Type', response.headers['content-type']);
    if (response.headers['content-length']) res.setHeader('Content-Length', response.headers['content-length']);
    if (response.headers['content-range']) res.setHeader('Content-Range', response.headers['content-range']);
    res.status(response.status);
    response.data.pipe(res);
  } catch (err) {
    console.error('[FSB] Proxy error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

app.post('/api/telegram/disconnect', async (req, res) => {
  resetMtClient();
  tgBotToken = '';
  tgChannelId = '';
  mtProtoApiId = 0;
  mtProtoApiHash = '';
  fsbBaseUrl = '';
  saveTgConfig();
  res.json({ success: true, message: 'Disconnected' });
});

// ─── YTS Torrent API ─────────────────────────────────────────────────────────

app.get('/api/yts/list', async (req, res) => {
  try {
    const axios = (await import('axios')).default;
    const { page = '1', limit = '20', quality, genre, sort = 'date_added', query_term } = req.query;

    const params = new URLSearchParams({ page, limit, sort_by: sort });
    if (quality) params.append('quality', quality);
    if (genre) params.append('genre', genre);
    if (query_term) params.append('query_term', query_term);

    const response = await axios.get(`https://yts.mx/api/v2/list_movies.json?${params}`);
    res.json(response.data);
  } catch (err) {
    console.error('[YTS] List error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/yts/movie/:id', async (req, res) => {
  try {
    const axios = (await import('axios')).default;
    const response = await axios.get(
      `https://yts.mx/api/v2/movie_details.json?movie_id=${req.params.id}&with_images=true&with_cast=true`
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/yts/search', async (req, res) => {
  try {
    const axios = (await import('axios')).default;
    const { q, page = '1' } = req.query;
    const response = await axios.get(
      `https://yts.mx/api/v2/list_movies.json?query_term=${encodeURIComponent(q)}&page=${page}`
    );
    res.json(response.data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Stream Proxy ────────────────────────────────────────────────────────────

function getContentType(url) {
  const lower = url.toLowerCase();
  if (lower.includes('.mkv')) return 'video/x-matroska';
  if (lower.includes('.mp4')) return 'video/mp4';
  if (lower.includes('.webm')) return 'video/webm';
  if (lower.includes('.avi')) return 'video/x-msvideo';
  if (lower.includes('.m3u8')) return 'application/vnd.apple.mpegurl';
  if (lower.includes('.mpd')) return 'application/dash+xml';
  return 'video/mp4';
}

app.get('/api/proxy', async (req, res) => {
  try {
    console.log('[Proxy] Handler called!', req.query.url?.substring(0, 50));
    const axios = (await import('axios')).default;
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    const targetUrl = decodeURIComponent(url);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://example.com',
      'Referer': 'https://example.com/',
    };
    if (req.headers.range) headers.Range = req.headers.range;
    
    // Pass through any custom headers from query
    if (req.query.referer) headers.Referer = decodeURIComponent(req.query.referer);
    if (req.query.origin) headers.Origin = decodeURIComponent(req.query.origin);

    const response = await axios({
      method: 'GET',
      url: targetUrl,
      headers,
      responseType: 'stream',
      timeout: 60000,
      maxRedirects: 10,
      validateStatus: (s) => s < 400 || s === 416,
    });

    const upstreamContentType = response.headers['content-type'] || '';
    const inferredType = getContentType(targetUrl);
    
    const resHeaders = {
      'Content-Type': upstreamContentType || inferredType,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Content-Type, Accept, Origin, Referer',
      'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges, Content-Type',
      'Cache-Control': 'public, max-age=3600',
    };
    
    const cl = response.headers['content-length'];
    const ar = response.headers['accept-ranges'];
    const cr = response.headers['content-range'];
    if (cl != null && cl !== '') resHeaders['Content-Length'] = cl;
    if (ar != null && ar !== '') resHeaders['Accept-Ranges'] = ar;
    if (cr != null && cr !== '') resHeaders['Content-Range'] = cr;
    
    console.log('[Proxy] Content-Type:', resHeaders['Content-Type']);
    res.writeHead(response.status, resHeaders);

    response.data.pipe(res);
  } catch (err) {
    console.error('[Proxy] Error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

app.get('/api/download', async (req, res) => {
  try {
    const { url, filename } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });

    const targetUrl = decodeURIComponent(url);
    const downloadName = filename ? decodeURIComponent(filename) : 'video.mkv';
    
    const axios = (await import('axios')).default;
    const response = await axios({
      method: 'GET',
      url: targetUrl,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      responseType: 'stream',
      timeout: 0,
      maxRedirects: 10,
    });

    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    if (response.headers['content-length']) {
      res.setHeader('Content-Length', response.headers['content-length']);
    }
    
    response.data.pipe(res);
  } catch (err) {
    console.error('[Download] Error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

// ─── External Stream APIs ────────────────────────────────────────────────────

app.get('/api/external/videolinks', async (req, res) => {
  try {
    const axios = (await import('axios')).default;
    const { tmdbId, type = 'movie', season, episode } = req.query;
    if (!tmdbId) return res.status(400).json({ error: 'Missing tmdbId' });

    const streams = [];
    
    // Try multiple external streaming APIs
    const apis = [
      {
        name: 'vidsrc',
        url: `https://vidsrc.to/embed/${type === 'series' ? 'tv' : 'movie'}/${tmdbId}${type === 'series' ? `/${season}/${episode}` : ''}`,
        type: 'embed'
      },
      {
        name: 'vidsrc-me',
        url: `https://vidsrc.me/embed/${type === 'series' ? 'tv' : 'movie'}/${tmdbId}${type === 'series' ? `/${season}/${episode}` : ''}`,
        type: 'embed'
      },
      {
        name: '2embed',
        url: `https://www.2embed.cc/embed${type === 'series' ? 'tv' : 'movie'}/${tmdbId}${type === 'series' ? `/${season}/${episode}` : ''}`,
        type: 'embed'
      },
      {
        name: 'superembed',
        url: `https://multiembed.mov/directstream.php?video_id=${tmdbId}&tmdb=1${type === 'series' ? `&s=${season}&e=${episode}` : ''}`,
        type: 'embed'
      },
      {
        name: 'smashystream',
        url: `https://embed.smashystream.com/playerr.php?tmdb=${tmdbId}${type === 'series' ? `&season=${season}&episode=${episode}` : ''}`,
        type: 'embed'
      }
    ];

    // Add all embed sources
    for (const api of apis) {
      streams.push({
        server: api.name,
        link: api.url,
        type: 'embed',
        quality: 'auto'
      });
    }

    res.json(streams);
  } catch (err) {
    console.error('[External API] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/external/lookup', async (req, res) => {
  try {
    const axios = (await import('axios')).default;
    const { title, year, type = 'movie' } = req.query;
    if (!title) return res.status(400).json({ error: 'Missing title' });

    // Search TMDB for the movie/show
    const tmdbApiKey = '3fd2be6f0c70a2a598f084ddfb75487c'; // Public API key
    const searchUrl = `https://api.themoviedb.org/3/search/${type === 'series' ? 'tv' : 'movie'}?api_key=${tmdbApiKey}&query=${encodeURIComponent(title)}${year ? `&year=${year}` : ''}`;
    
    const searchRes = await axios.get(searchUrl, { timeout: 10000 });
    const results = searchRes.data.results;
    
    if (results && results.length > 0) {
      const bestMatch = results[0];
      res.json({
        tmdbId: bestMatch.id,
        title: bestMatch.title || bestMatch.name,
        year: (bestMatch.release_date || bestMatch.first_air_date || '').split('-')[0],
        poster: bestMatch.poster_path ? `https://image.tmdb.org/t/p/w500${bestMatch.poster_path}` : null,
        overview: bestMatch.overview
      });
    } else {
      res.json({ error: 'Not found' });
    }
  } catch (err) {
    console.error('[External Lookup] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Start Server ────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  MovieBytes Server running on http://localhost:${PORT}`);
  console.log(`  API endpoints:`);
  console.log(`    GET  /api/health`);
  console.log(`    GET  /api/providers`);
  console.log(`    GET  /api/providers/:name/home`);
  console.log(`    GET  /api/providers/:name/search?q=...`);
  console.log(`    GET  /api/providers/:name/meta?link=...`);
  console.log(`    GET  /api/providers/:name/stream?link=...`);
  console.log(`    GET  /api/providers/:name/episodes?link=...`);
  console.log(`    POST /api/telegram/config`);
  console.log(`    GET  /api/telegram/videos`);
  console.log(`    GET  /api/telegram/stream?messageId=...`);
  console.log(`    GET  /api/yts/list`);
  console.log(`    GET  /api/yts/search?q=...`);
  console.log(`    GET  /api/proxy?url=...\n`);
});
