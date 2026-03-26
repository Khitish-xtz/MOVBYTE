import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import ReactPlayer from 'react-player';
import toast from 'react-hot-toast';
import { fetchMeta, fetchStreams, fetchEpisodes, getProxiedUrl, getDownloadUrl, getVlcUrl } from '../services/api';

const AnyReactPlayer = ReactPlayer as any;
const API_BASE = 'http://localhost:4000';

interface StreamItem {
  server: string;
  link: string;
  type: string;
  quality?: string;
  headers?: Record<string, string>;
}

interface EpisodeItem {
  title: string;
  link: string;
}

interface LinkItem {
  title: string;
  quality?: string;
  episodesLink?: string;
  directLinks?: { title: string; link: string; type?: string }[];
}

export default function Watch() {
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const provider = params.get('provider') || 'vega';
  const link = decodeURIComponent(params.get('link') || '');
  const title = decodeURIComponent(params.get('title') || 'Unknown');
  const image = decodeURIComponent(params.get('image') || '');
  const type = params.get('type') || 'movie';

  const [meta, setMeta] = useState<any>(null);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [streams, setStreams] = useState<StreamItem[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeItem[]>([]);
  const [activeStream, setActiveStream] = useState<StreamItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingStream, setLoadingStream] = useState(false);
  const [externalStreams, setExternalStreams] = useState<StreamItem[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mkvError, setMkvError] = useState(false);

  // Fetch external streaming sources
  const fetchExternalStreams = async (tmdbId: string, mediaType: string = 'movie', season?: string, episode?: string) => {
    try {
      const params = new URLSearchParams({ tmdbId, type: mediaType });
      if (season) params.append('season', season);
      if (episode) params.append('episode', episode);
      
      const res = await fetch(`${API_BASE}/api/external/videolinks?${params}`);
      if (res.ok) {
        const data = await res.json();
        setExternalStreams(data);
      }
    } catch (err) {
      console.error('External streams error:', err);
    }
  };

  // Lookup TMDB ID from title
  const lookupTMDB = async (title: string, year?: string, mediaType: string = 'movie') => {
    try {
      const params = new URLSearchParams({ title, type: mediaType });
      if (year) params.append('year', year);
      
      const res = await fetch(`${API_BASE}/api/external/lookup?${params}`);
      if (res.ok) {
        return await res.json();
      }
    } catch (err) {
      console.error('TMDB lookup error:', err);
    }
    return null;
  };

  useEffect(() => {
    setMkvError(false);
  }, [activeStream]);

  useEffect(() => {
    async function loadMeta() {
      setLoading(true);
      try {
        const info = await fetchMeta(provider, link);
        setMeta(info);
        if (info?.linkList) {
          setLinks(info.linkList);
        }
        
        // Try to get TMDB ID for external streaming sources
        const yearMatch = info?.releaseYear || info?.year || title.match(/\((\d{4})\)/)?.[1];
        const tmdbResult = await lookupTMDB(info?.title || title, yearMatch, type);
        if (tmdbResult?.tmdbId) {
          await fetchExternalStreams(String(tmdbResult.tmdbId), type);
        }
      } catch (err: any) {
        console.error('Meta error:', err);
        toast.error('Failed to load details');
      } finally {
        setLoading(false);
      }
    }
    if (link) loadMeta();
  }, [link, provider]);

  const resolveStreamFromLink = async (directLink: string, linkType: string = 'movie') => {
    setLoadingStream(true);
    setStreams([]);
    setActiveStream(null);
    try {
      const data = await fetchStreams(provider, directLink, linkType);
      setStreams(data);
      if (data.length > 0) {
        setActiveStream(data[0]);
      } else {
        toast.error('No streams found for this quality');
      }
    } catch (err) {
      toast.error('Failed to resolve streams');
    } finally {
      setLoadingStream(false);
    }
  };

  const loadEpisodes = async (episodesLink: string) => {
    setLoadingStream(true);
    try {
      const data = await fetchEpisodes(provider, episodesLink);
      setEpisodes(data);
    } catch {
      toast.error('Failed to load episodes');
    } finally {
      setLoadingStream(false);
    }
  };

  const getStreamUrl = (stream: StreamItem): string => {
    // Handle embed streams (iframe)
    if (isEmbed(stream)) {
      return stream.link;
    }
    
    // Handle direct HTTP streams
    if (stream.link.startsWith('http')) {
      // For m3u8/hls streams, return as-is (ReactPlayer handles them natively)
      if (stream.type === 'm3u8' || stream.type === 'hls' || stream.link.includes('.m3u8')) {
        return stream.link;
      }
      
      // For mp4/mkv files, use the proxy
      if (stream.type === 'mkv' || stream.type === 'mp4' || stream.link.includes('.mp4') || stream.link.includes('.mkv')) {
        return getProxiedUrl(stream.link);
      }
      
      // For other types, try direct first
      return stream.link;
    }
    
    return stream.link;
  };

  const isEmbed = (stream: StreamItem): boolean => {
    return stream.link.includes('embed') || 
           stream.link.includes('iframe') || 
           stream.link.includes('player') ||
           stream.type === 'embed' ||
           stream.server?.toLowerCase().includes('embed');
  };

  const formatDuration = (seconds: number) => {
    if (!seconds) return '';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  if (!link) {
    return (
      <div className="empty-state" style={{ minHeight: '80vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div className="empty-icon">&#128249;</div>
        <div className="empty-title">No content selected</div>
        <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => navigate('/')}>Go Home</button>
      </div>
    );
  }

  return (
    <div className="watch-page">
      {/* Header */}
      <div className="watch-header">
        <button className="watch-back" onClick={() => navigate(-1)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m15 18-6-6 6-6"/></svg>
          Back
        </button>
        <span style={{ fontWeight: 600, fontSize: '0.9rem', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {meta?.title || title}
        </span>
      </div>

      {/* Player */}
      <div className="watch-player">
        {activeStream && !loadingStream ? (
          isEmbed(activeStream) ? (
            <iframe
              key={activeStream.link}
              src={activeStream.link}
              style={{ width: '100%', height: '100%', border: 'none' }}
              allowFullScreen
              referrerPolicy="origin"
              title={title}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            />
          ) : (activeStream.type === 'mkv' || activeStream.link.includes('.mkv')) ? (
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              <video
                ref={videoRef}
                src={getProxiedUrl(activeStream.link)}
                controls
                autoPlay
                crossOrigin="anonymous"
                style={{ width: '100%', height: '100%', background: '#000' }}
                onError={() => setMkvError(true)}
                onCanPlay={() => setMkvError(false)}
              />
              {mkvError && (
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'rgba(0,0,0,0.9)',
                  flexDirection: 'column',
                  gap: '1rem',
                  padding: '2rem'
                }}>
                  <div style={{ fontSize: '3rem' }}>🎬</div>
                  <p style={{ color: '#f5c518', fontSize: '1rem' }}>MKV format - Browser playback not supported</p>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', maxWidth: '400px' }}>
                    Use one of these options to watch:
                  </p>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <a
                      href={getVlcUrl(activeStream.link)}
                      className="btn btn-primary"
                      style={{ textDecoration: 'none' }}
                    >
                      🎥 Open in VLC
                    </a>
                    <a
                      href={getDownloadUrl(activeStream.link, `${title}.mkv`)}
                      className="btn btn-secondary"
                      style={{ textDecoration: 'none' }}
                      download
                    >
                      ⬇️ Download
                    </a>
                    <button
                      className="btn btn-outline"
                      onClick={() => {
                        navigator.clipboard.writeText(activeStream.link);
                        toast.success('Direct link copied! Paste in any player.');
                      }}
                    >
                      📋 Copy Link
                    </button>
                  </div>
                  <p style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
                    Or copy the link and open in: PotPlayer, MPC-HC, IINA, mpv
                  </p>
                </div>
              )}
            </div>
          ) : (
            <AnyReactPlayer
              url={getStreamUrl(activeStream)}
              width="100%"
              height="100%"
              controls
              playing
              pip
              style={{ background: '#000' }}
              onError={(e: any) => {
                console.error('Player error:', e);
                toast.error('Playback error, try another source');
              }}
              onReady={() => console.log('Player ready')}
              config={{
                file: {
                  forceHLS: activeStream.type === 'm3u8' || activeStream.link.includes('.m3u8'),
                  forceVideo: activeStream.type === 'mp4' || activeStream.link.includes('.mp4'),
                  attributes: { 
                    crossOrigin: 'anonymous',
                    preload: 'auto'
                  },
                  hlsOptions: {
                    enableWorker: true,
                    lowLatencyMode: true,
                  }
                },
              }}
            />
          )
        ) : loadingStream ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
            <div style={{ textAlign: 'center' }}>
              <div className="spinner" style={{ margin: '0 auto 1rem' }} />
              Resolving streams...
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', background: `linear-gradient(135deg, #000 0%, #111 100%)` }}>
            <div style={{ textAlign: 'center', padding: '2rem' }}>
              {image && <img src={image} alt="" style={{ width: '120px', borderRadius: '8px', margin: '0 auto 1rem', opacity: 0.6 }} />}
              <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>Select a source below to start watching</p>
            </div>
          </div>
        )}
      </div>

      {/* Info & Sources */}
      <div className="watch-info">
        <h1 className="watch-title">{meta?.title || title}</h1>
        <div className="watch-meta">
          {meta?.type && <span>{meta.type === 'series' ? 'Series' : 'Movie'}</span>}
          {meta?.imdbId && <span>IMDb: {meta.imdbId}</span>}
          <span>Source: {provider}</span>
        </div>
        {meta?.synopsis && <p className="watch-desc">{meta.synopsis}</p>}

        {/* Download/Episode Links */}
        {links.length > 0 && (
          <div className="sources-section">
            <h3 className="sources-title">Available Qualities</h3>
            <div className="sources-grid">
              {links.map((linkItem, i) => (
                <div key={i}>
                  {linkItem.directLinks && linkItem.directLinks.length > 0 && (
                    linkItem.directLinks.map((dl, j) => (
                      <button
                        key={`${i}-${j}`}
                        className="source-btn"
                        onClick={() => resolveStreamFromLink(dl.link, dl.type || 'movie')}
                        style={{ marginBottom: '0.4rem', marginRight: '0.4rem' }}
                      >
                        {linkItem.quality && <span className="source-quality">{linkItem.quality}</span>}
                        {dl.title}
                      </button>
                    ))
                  )}
                  {linkItem.episodesLink && (
                    <button
                      className="source-btn"
                      onClick={() => loadEpisodes(linkItem.episodesLink!)}
                      style={{ marginBottom: '0.4rem', marginRight: '0.4rem', borderColor: '#46d369' }}
                    >
                      {linkItem.quality && <span className="source-quality">{linkItem.quality}</span>}
                      Episodes
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Episodes */}
        {episodes.length > 0 && (
          <div className="sources-section">
            <h3 className="sources-title">Episodes ({episodes.length})</h3>
            <div className="sources-grid" style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {episodes.map((ep, i) => (
                <button
                  key={i}
                  className="source-btn"
                  onClick={() => resolveStreamFromLink(ep.link, 'series')}
                >
                  {ep.title}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Stream Sources */}
        {(streams.length > 0 || externalStreams.length > 0) && (
          <div className="sources-section">
            <h3 className="sources-title">Stream Sources</h3>
            <div className="sources-grid">
              {streams.map((s, i) => (
                <button
                  key={`stream-${i}`}
                  className={`source-btn ${activeStream?.server === s.server && activeStream?.link === s.link ? 'active' : ''}`}
                  onClick={() => setActiveStream(s)}
                >
                  {s.server}
                  {s.quality && <span className="source-quality">{s.quality}</span>}
                  {s.type === 'mkv' && <span className="source-quality">MKV</span>}
                </button>
              ))}
              {externalStreams.map((s, i) => (
                <button
                  key={`external-${i}`}
                  className={`source-btn ${activeStream?.server === s.server && activeStream?.link === s.link ? 'active' : ''}`}
                  onClick={() => setActiveStream(s)}
                  style={{ borderColor: '#46d369' }}
                >
                  {s.server}
                  <span className="source-quality">external</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* External Sources Info */}
        {externalStreams.length > 0 && streams.length === 0 && (
          <div className="sources-section">
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Using external streaming sources. If playback doesn't work, try a different source.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
