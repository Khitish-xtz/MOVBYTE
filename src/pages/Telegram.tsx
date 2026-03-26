import { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { configureTelegram, fetchTelegramVideos, fetchTelegramStatus } from '../services/api';

const API_BASE = 'http://localhost:4000';

interface TgVideo {
  messageId: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
  duration: number;
  date: number;
  caption: string;
  streamUrl: string;
}

interface TgStatus {
  configured: boolean;
  connected: boolean;
  channelId: string | null;
  mtProtoConfigured: boolean;
  mtProtoReady: boolean;
  fsbConfigured: boolean;
  fsbBaseUrl: string | null;
}

/* ---------- helpers ---------- */
const fmt = {
  size(b: number) {
    if (b > 1_073_741_824) return (b / 1_073_741_824).toFixed(1) + ' GB';
    if (b > 1_048_576) return (b / 1_048_576).toFixed(0) + ' MB';
    return (b / 1024).toFixed(0) + ' KB';
  },
  dur(s: number) {
    if (!s) return '';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    if (h) return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    return `${m}:${String(ss).padStart(2,'0')}`;
  },
  ago(ts: number) {
    const d = Math.floor(Date.now() / 1000) - ts;
    if (d < 3600) return `${Math.floor(d/60)}m ago`;
    if (d < 86400) return `${Math.floor(d/3600)}h ago`;
    return `${Math.floor(d/86400)}d ago`;
  },
};

function extractFileId(url: string) {
  try { return new URL(url, 'http://x').searchParams.get('fileId') ?? ''; }
  catch { return ''; }
}

function isMkv(v: TgVideo) {
  return v.fileName.toLowerCase().endsWith('.mkv') ||
    v.mimeType.toLowerCase().includes('matroska');
}

/** Build the best available stream URL for a video */
function buildStreamUrl(v: TgVideo, mtReady: boolean): { url: string; mode: 'mtproto'|'transcode'|'http' } {
  // MTProto: unlimited size, no transcoding needed — use for everything when ready
  if (mtReady) {
    return {
      url: `${API_BASE}/api/telegram/mtproto/stream?messageId=${v.messageId}`,
      mode: 'mtproto',
    };
  }
  // Fallback: MKV → server-side transcode
  const fileId = extractFileId(v.streamUrl);
  if (isMkv(v) && fileId) {
    return { url: `${API_BASE}/api/telegram/transcode?fileId=${encodeURIComponent(fileId)}`, mode: 'transcode' };
  }
  // Direct Bot API stream (≤20 MB)
  return { url: `${API_BASE}${v.streamUrl}`, mode: 'http' };
}

/* ==========================================================================
   MAIN COMPONENT
   ========================================================================== */
export default function TelegramPage() {
  /* ── core state ── */
  const [status, setStatus] = useState<TgStatus | null>(null);
  const [botToken, setBotToken] = useState('');
  const [channelId, setChannelId] = useState('');
  const [apiId, setApiId]     = useState('');
  const [apiHash, setApiHash] = useState('');
  const [videos, setVideos]   = useState<TgVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [activeTab, setActiveTab] = useState<'bot'|'mtproto'>('bot');

  /* ── player state ── */
  const [playing, setPlaying]       = useState<TgVideo | null>(null);
  const [transcoding, setTranscoding] = useState(false);
  const [videoError, setVideoError]   = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  /* ── MTProto saving state ── */
  const [mtSaving, setMtSaving] = useState(false);

  /* ──────────────────────────────────────────────────────
     Init: check server status, restore from localStorage
  ────────────────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const s = await fetchTelegramStatus() as TgStatus;
        setStatus(s);

        const saved = localStorage.getItem('mb_tg_config');
        const cfg = saved ? JSON.parse(saved) : {};
        if (cfg.botToken) setBotToken(cfg.botToken);
        if (cfg.channelId) setChannelId(cfg.channelId);
        if (cfg.apiId)    setApiId(cfg.apiId);
        if (cfg.apiHash)  setApiHash(cfg.apiHash);

        if (s.configured) {
          await loadVideos();
        } else if (cfg.botToken && cfg.channelId) {
          // Auto-reconnect
          try {
            await configureTelegram(cfg.botToken, cfg.channelId);
            setStatus({ ...s, configured: true, connected: true });
            await loadVideos();
          } catch { /* fall through to setup screen */ }
        }
      } catch (e) {
        console.error('Status check failed', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ── initiate MTProto session if credentials already saved ── */
  useEffect(() => {
    if (status?.mtProtoConfigured && !status.mtProtoReady) {
      warmUpMtProto();
    }
  }, [status?.mtProtoConfigured]);

  async function warmUpMtProto() {
    try {
      await fetch(`${API_BASE}/api/telegram/mtproto/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiId: apiId || localStorage.getItem('mb_mt_apiid'), apiHash: apiHash || localStorage.getItem('mb_mt_apihash') }),
      });
      const fresh = await fetchTelegramStatus() as TgStatus;
      setStatus(fresh);
    } catch { /* silent */ }
  }

  const loadVideos = async () => {
    setLoading(true);
    try {
      const data = await fetchTelegramVideos(100);
      setVideos(data);
      if (!data.length) toast('No videos found in channel.', { icon: 'ℹ️' });
    } catch (err: any) {
      toast.error(err.message || 'Failed to load videos');
      if (err.message?.includes('not configured')) setStatus(null);
    } finally {
      setLoading(false);
    }
  };

  /* ── save MTProto credentials ── */
  const handleMtProtoSave = async () => {
    if (!apiId.trim() || !apiHash.trim()) { toast.error('API ID and Hash required'); return; }
    setMtSaving(true);
    const tid = toast.loading('Connecting via MTProto…');
    try {
      const res = await fetch(`${API_BASE}/api/telegram/mtproto/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiId: apiId.trim(), apiHash: apiHash.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.message, { id: tid });
      // Save locally
      localStorage.setItem('mb_mt_apiid', apiId.trim());
      localStorage.setItem('mb_mt_apihash', apiHash.trim());
      const localCfg = JSON.parse(localStorage.getItem('mb_tg_config') || '{}');
      localStorage.setItem('mb_tg_config', JSON.stringify({ ...localCfg, apiId: apiId.trim(), apiHash: apiHash.trim() }));
      const fresh = await fetchTelegramStatus() as TgStatus;
      setStatus(fresh);
    } catch (err: any) {
      toast.error(err.message || 'MTProto setup failed', { id: tid });
    } finally {
      setMtSaving(false);
    }
  };

  const handleBotConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!botToken.trim() || !channelId.trim()) { toast.error('Both fields required'); return; }
    setLoading(true);
    try {
      await configureTelegram(botToken.trim(), channelId.trim());
      const localCfg = JSON.parse(localStorage.getItem('mb_tg_config') || '{}');
      localStorage.setItem('mb_tg_config', JSON.stringify({ ...localCfg, botToken: botToken.trim(), channelId: channelId.trim() }));
      const fresh = await fetchTelegramStatus() as TgStatus;
      setStatus(fresh);
      setShowConfig(false);
      toast.success('Bot connected!');
      await loadVideos();
    } catch (err: any) {
      toast.error(err.message || 'Connection failed');
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    await fetch(`${API_BASE}/api/telegram/disconnect`, { method: 'POST' }).catch(() => {});
    localStorage.removeItem('mb_tg_config');
    setStatus(null);
    setVideos([]);
    setBotToken(''); setChannelId(''); setApiId(''); setApiHash('');
    toast.success('Disconnected');
  };

  const isConfigured = status?.configured;
  const mtReady = status?.mtProtoReady ?? false;

  /* ══════════════════════════════════════════════════════
     SETUP / SETTINGS SCREEN
  ══════════════════════════════════════════════════════ */
  if (!isConfigured || showConfig) {
    return (
      <div className="config-page">
        <div className="config-card" style={{ maxWidth: 520 }}>
          <h2 className="config-title">Telegram Setup</h2>
          <p className="config-subtitle">Connect your bot and unlock unlimited streaming via MTProto</p>

          {/* Tab switcher */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', background: 'rgba(255,255,255,0.04)', borderRadius: '8px', padding: '4px' }}>
            {(['bot', 'mtproto'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} style={{
                flex: 1, padding: '6px 0', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 600, transition: 'all .15s',
                background: activeTab === tab ? 'rgba(99,102,241,0.3)' : 'transparent',
                color: activeTab === tab ? '#c7d2fe' : '#64748b',
              }}>
                {tab === 'bot' ? '🤖 Step 1: Bot Token' : '⚡ Step 2: MTProto (Unlimited)'}
              </button>
            ))}
          </div>

          {activeTab === 'bot' && (
            <>
              <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.18)', padding: '0.9rem 1rem', borderRadius: '8px', marginBottom: '1.25rem', fontSize: '0.82rem', color: '#93c5fd', lineHeight: 1.7 }}>
                <ol style={{ paddingLeft: '1.2rem', margin: 0 }}>
                  <li>Open <strong>@BotFather</strong> → /newbot → copy the token</li>
                  <li>Create a Telegram channel, add your bot as Admin</li>
                  <li>Get channel ID (starts with -100…) via @MissRose_bot → /id</li>
                  <li>Upload your videos to that channel</li>
                </ol>
              </div>
              <form onSubmit={handleBotConfig}>
                <div className="form-group">
                  <label className="form-label">Bot Token</label>
                  <input className="form-input" placeholder="1234567890:AAH_xxxxx" value={botToken} onChange={e => setBotToken(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Channel ID</label>
                  <input className="form-input" placeholder="-100123456789" value={channelId} onChange={e => setChannelId(e.target.value)} />
                </div>
                <div className="form-actions">
                  <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1, justifyContent: 'center' }}>
                    {loading ? 'Connecting…' : 'Save & Connect'}
                  </button>
                  {isConfigured && <button type="button" className="btn btn-secondary" onClick={() => setShowConfig(false)}>Cancel</button>}
                </div>
              </form>
            </>
          )}

          {activeTab === 'mtproto' && (
            <>
              <div style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', padding: '0.9rem 1rem', borderRadius: '8px', marginBottom: '1.25rem', fontSize: '0.82rem', color: '#c7d2fe', lineHeight: 1.7 }}>
                <strong style={{ color: '#e0e7ff', display: 'block', marginBottom: '0.4rem' }}>⚡ Why MTProto?</strong>
                This is the same protocol Telegram uses internally — and what tools like TG-FileStreamBot are built on.
                Once configured, <strong>all your videos stream without any size limit</strong>, no binary downloads, no forwarding, no manual URLs.
                <div style={{ marginTop: '0.75rem', borderTop: '1px solid rgba(99,102,241,0.2)', paddingTop: '0.75rem' }}>
                  <strong>Get your credentials:</strong>
                  <ol style={{ paddingLeft: '1.2rem', margin: '0.3rem 0 0' }}>
                    <li>Go to <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer" style={{ color: '#818cf8' }}>my.telegram.org/apps</a></li>
                    <li>Log in with your phone number</li>
                    <li>Create an app (any name, select "Other")</li>
                    <li>Copy the <strong>App api_id</strong> and <strong>App api_hash</strong></li>
                  </ol>
                </div>
              </div>

              {!isConfigured && (
                <div style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: '6px', padding: '0.6rem 0.9rem', marginBottom: '1rem', fontSize: '0.8rem', color: '#fde68a' }}>
                  ⚠ Complete Step 1 (Bot Token) first before configuring MTProto.
                </div>
              )}

              <div className="form-group">
                <label className="form-label">API ID <span style={{ color: '#6366f1', fontWeight: 400 }}>(numeric)</span></label>
                <input className="form-input" placeholder="12345678" value={apiId} onChange={e => setApiId(e.target.value)} disabled={!isConfigured} />
              </div>
              <div className="form-group">
                <label className="form-label">API Hash</label>
                <input className="form-input" type="password" placeholder="a1b2c3d4e5f6..." value={apiHash} onChange={e => setApiHash(e.target.value)} disabled={!isConfigured} />
              </div>

              <button className="btn btn-primary" onClick={handleMtProtoSave} disabled={mtSaving || !isConfigured} style={{ width: '100%', justifyContent: 'center' }}>
                {mtSaving ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="spinner" style={{ width: 14, height: 14 }} /> Connecting via MTProto…
                  </span>
                ) : status?.mtProtoReady ? '✅ MTProto Active — Re-save' : '⚡ Enable MTProto Streaming'}
              </button>

              {status?.mtProtoReady && (
                <p style={{ color: '#86efac', fontSize: '0.8rem', marginTop: '0.75rem', textAlign: 'center' }}>
                  ✅ MTProto active. All videos stream without size limits.
                </p>
              )}
            </>
          )}

          {/* Back link if already configured */}
          {isConfigured && showConfig && (
            <button className="btn btn-ghost" onClick={() => setShowConfig(false)} style={{ width: '100%', justifyContent: 'center', marginTop: '1rem', color: '#64748b' }}>
              ← Back to videos
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════
     VIDEO PLAYER SCREEN
  ══════════════════════════════════════════════════════ */
  if (playing) {
    const { url: playUrl, mode } = buildStreamUrl(playing, mtReady);
    const isMkvFile = isMkv(playing);
    const isLarge = playing.fileSize > 20 * 1024 * 1024;

    return (
      <div className="watch-page">
        <div className="watch-header">
          <button className="watch-back" onClick={() => { setPlaying(null); setVideoError(null); setTranscoding(false); }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
            Back
          </button>
          <span style={{ fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem', overflow: 'hidden' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{playing.fileName}</span>
            {mode === 'mtproto' && <span style={{ flexShrink: 0, background: 'rgba(99,102,241,0.25)', color: '#c7d2fe', fontSize: '0.68rem', padding: '2px 7px', borderRadius: '4px' }}>⚡ MTProto</span>}
            {mode === 'transcode' && <span style={{ flexShrink: 0, background: 'rgba(251,191,36,0.2)', color: '#fbbf24', fontSize: '0.68rem', padding: '2px 7px', borderRadius: '4px' }}>🔄 Transcoding</span>}
          </span>
        </div>

        <div className="watch-player" style={{ position: 'relative' }}>
          {transcoding && mode === 'transcode' && (
            <div style={{ position:'absolute', inset:0, zIndex:10, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.8)', gap:'1rem' }}>
              <div className="spinner" style={{ width:40, height:40 }} />
              <p style={{ color:'#fbbf24', fontSize:'0.9rem' }}>Transcoding MKV → MP4…</p>
              <p style={{ color:'#888', fontSize:'0.78rem' }}>Playback starts automatically once ready</p>
            </div>
          )}

          {videoError && (
            <div style={{ position:'absolute', inset:0, zIndex:10, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.9)', gap:'1rem', padding:'2rem', textAlign:'center' }}>
              <div style={{ fontSize:'3rem' }}>⚠️</div>
              <p style={{ color:'#f87171', fontSize:'0.95rem', maxWidth:400 }}>{videoError}</p>
              {!mtReady && (isLarge || isMkvFile) && (
                <div style={{ background:'rgba(99,102,241,0.1)', border:'1px solid rgba(99,102,241,0.25)', borderRadius:'10px', padding:'1rem 1.2rem', maxWidth:380, fontSize:'0.82rem', color:'#c7d2fe', textAlign:'left' }}>
                  <strong style={{ color:'#e0e7ff' }}>💡 Enable MTProto for unlimited streaming</strong>
                  <p style={{ marginTop:'0.5rem', lineHeight:1.6 }}>
                    Go to <strong>Settings → Step 2: MTProto</strong> and enter your API ID &amp; Hash from{' '}
                    <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer" style={{ color:'#818cf8' }}>my.telegram.org</a>.
                    Once set up, this and every other video will stream instantly — no size limits.
                  </p>
                  <button className="btn btn-primary" style={{ width:'100%', justifyContent:'center', marginTop:'0.75rem' }} onClick={() => { setPlaying(null); setShowConfig(true); setActiveTab('mtproto'); }}>
                    ⚡ Set up MTProto
                  </button>
                </div>
              )}
              <button className="btn btn-secondary" onClick={() => setVideoError(null)}>Retry</button>
            </div>
          )}

          <video
            ref={videoRef}
            src={playUrl}
            controls autoPlay crossOrigin="anonymous"
            style={{ width:'100%', height:'100%', background:'#000' }}
            onWaiting={() => mode === 'transcode' && setTranscoding(true)}
            onCanPlay={() => { setTranscoding(false); setVideoError(null); }}
            onPlaying={() => setTranscoding(false)}
            onError={e => {
              const vid = e.currentTarget;
              setTranscoding(false);
              setVideoError(
                vid.error?.code === 4
                  ? mode === 'http' && isLarge
                    ? 'File exceeds Telegram Bot API 20 MB limit. Enable MTProto in Settings for unlimited streaming.'
                    : 'Could not load video — format may not be supported by your browser.'
                  : `Playback error (${vid.error?.message || 'unknown'})`
              );
            }}
          />
        </div>

        <div className="watch-info">
          <h2 className="watch-title">{playing.fileName}</h2>
          <div className="watch-meta">
            <span>{fmt.size(playing.fileSize)}</span>
            {playing.duration > 0 && <span>{fmt.dur(playing.duration)}</span>}
            <span>{fmt.ago(playing.date)}</span>
            {mode === 'mtproto' && <span style={{ color:'#c7d2fe' }}>⚡ MTProto stream</span>}
            {mode === 'transcode' && <span style={{ color:'#fbbf24' }}>🔄 Server-transcoded</span>}
            {mode === 'http' && isLarge && <span style={{ color:'#f59e0b' }}>⚠ &gt;20 MB</span>}
          </div>
          {playing.caption && <p className="watch-desc">{playing.caption}</p>}
        </div>
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════
     VIDEO LIST SCREEN
  ══════════════════════════════════════════════════════ */
  return (
    <div className="telegram-page">
      <div className="tg-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexWrap:'wrap', gap:'1rem' }}>
        <div>
          <h1 className="tg-title">Telegram Videos</h1>
          <p className="tg-subtitle" style={{ display:'flex', alignItems:'center', gap:'0.5rem' }}>
            Stream from your channel
            {mtReady
              ? <span style={{ color:'#c7d2fe', fontSize:'0.78rem' }}>⚡ MTProto — unlimited size</span>
              : <span style={{ color:'#f59e0b', fontSize:'0.78rem' }}>⚠ Bot API only (≤20 MB)</span>
            }
          </p>
        </div>
        <div style={{ display:'flex', gap:'0.5rem' }}>
          <button className="btn btn-secondary btn-sm" onClick={loadVideos} disabled={loading}>{loading ? 'Loading…' : 'Refresh'}</button>
          <button className="btn btn-outline btn-sm" onClick={() => setShowConfig(true)}>Settings</button>
          <button className="btn btn-ghost btn-sm" onClick={handleDisconnect} style={{ color:'#ef4444' }}>Disconnect</button>
        </div>
      </div>

      {/* MTProto setup nudge */}
      {!mtReady && (
        <div style={{ background:'rgba(99,102,241,0.07)', border:'1px solid rgba(99,102,241,0.18)', borderRadius:'8px', padding:'0.6rem 1rem', marginBottom:'1rem', fontSize:'0.8rem', color:'#c7d2fe', display:'flex', alignItems:'center', justifyContent:'space-between', gap:'1rem', flexWrap:'wrap' }}>
          <span>⚡ <strong>Stream any file size</strong> — same tech as TG-FileStreamBot, built in. Add API ID &amp; Hash to activate.</span>
          <button className="btn btn-primary btn-sm" style={{ whiteSpace:'nowrap' }} onClick={() => { setShowConfig(true); setActiveTab('mtproto'); }}>Enable MTProto</button>
        </div>
      )}

      {loading && !videos.length ? (
        <div className="loader"><div className="spinner" /></div>
      ) : !videos.length ? (
        <div className="empty-state">
          <div className="empty-icon">📹</div>
          <div className="empty-title">No videos found</div>
          <div className="empty-desc">Upload video files to your Telegram channel and refresh</div>
        </div>
      ) : (
        <div className="tg-grid">
          {videos.map(v => {
            const large = v.fileSize > 20 * 1024 * 1024;
            const mkv = isMkv(v);
            return (
              <div key={v.messageId} className="tg-card"
                onClick={() => { setPlaying(v); setVideoError(null); setTranscoding(!mtReady && mkv); }}>
                <div className="tg-card-thumb">
                  <span className="tg-card-thumb-icon">▶</span>
                  {v.duration > 0 && <span className="tg-card-duration">{fmt.dur(v.duration)}</span>}
                  {/* Stream mode badges */}
                  <div style={{ position:'absolute', top:6, right:6, display:'flex', flexDirection:'column', gap:3, alignItems:'flex-end' }}>
                    {mtReady && <span style={{ background:'rgba(99,102,241,0.85)', color:'#fff', fontSize:'0.6rem', padding:'1px 5px', borderRadius:'3px', fontWeight:700 }}>⚡ MTProto</span>}
                    {!mtReady && mkv && <span style={{ background:'rgba(251,191,36,0.85)', color:'#000', fontSize:'0.6rem', padding:'1px 5px', borderRadius:'3px', fontWeight:700 }}>MKV</span>}
                    {!mtReady && large && !mkv && <span style={{ background:'rgba(239,68,68,0.8)', color:'#fff', fontSize:'0.6rem', padding:'1px 5px', borderRadius:'3px', fontWeight:700 }}>&gt; 20MB</span>}
                  </div>
                </div>
                <div className="tg-card-body">
                  <div className="tg-card-title">{v.fileName}</div>
                  <div className="tg-card-meta">
                    <span>{fmt.size(v.fileSize)}</span>
                    <span>{fmt.ago(v.date)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
