import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchMeta, fetchEpisodes, fetchStreams } from '../services/api';

interface StreamSource {
  server: string;
  link: string;
  quality?: string;
  type: string;
}

interface QualityOption {
  quality: string;
  sources: StreamSource[];
}

interface Season {
  id: string;
  title: string;
  episodes: { title: string; link: string; sources?: StreamSource[] }[];
}

interface ContentSelectorProps {
  provider: string;
  link: string;
  title: string;
  image: string;
  type: 'movie' | 'series';
  onClose: () => void;
}

export default function ContentSelector({ provider, link, title, image, type, onClose }: ContentSelectorProps) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [streams, setStreams] = useState<StreamSource[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<StreamSource | null>(null);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);

  useEffect(() => {
    loadContent();
  }, [provider, link]);

  const loadContent = async () => {
    setLoading(true);
    setError('');
    try {
      const info = await fetchMeta(provider, link);
      
      if (type === 'movie') {
        if (info?.linkList && info.linkList.length > 0) {
          const firstLink = info.linkList[0];
          if (firstLink.directLinks && firstLink.directLinks.length > 0) {
            const streamLink = firstLink.directLinks[0].link;
            await loadStreams(streamLink, 'movie');
          } else if (info.link) {
            await loadStreams(info.link, 'movie');
          }
        } else if (info?.link) {
          await loadStreams(info.link, 'movie');
        }
      } else {
        if (info?.episodes && info.episodes.length > 0) {
          const eps = info.episodes;
          if (eps.length > 0 && Array.isArray(eps[0].episodes)) {
            const s: Season[] = eps.map((season: any) => ({
              id: season.id || season.title || String(Math.random()),
              title: season.title || `Season ${season.id}`,
              episodes: (season.episodes || []).map((ep: any) => ({
                title: ep.title || ep.name || `Episode ${ep.number || ep.episode}`,
                link: ep.link,
              })),
            }));
            setSeasons(s);
          } else {
            setSeasons([{ id: '1', title: 'Season 1', episodes: eps }]);
          }
        } else if (info?.link) {
          try {
            const eps = await fetchEpisodes(provider, info.link);
            if (eps.length > 0) {
              if (Array.isArray(eps[0]) || (eps[0] && eps[0].episodes)) {
                const s: Season[] = eps.map((season: any, idx: number) => ({
                  id: season.id || String(idx + 1),
                  title: season.title || `Season ${idx + 1}`,
                  episodes: season.episodes || season || [],
                }));
                setSeasons(s);
              } else {
                setSeasons([{ id: '1', title: 'Season 1', episodes: eps }]);
              }
            }
          } catch {}
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load content');
    } finally {
      setLoading(false);
    }
  };

  const loadStreams = async (streamLink: string, linkType: string) => {
    setLoadingStreams(true);
    try {
      const data = await fetchStreams(provider, streamLink, linkType);
      if (data && data.length > 0) {
        setStreams(data);
      }
    } catch (err) {
      console.error('Failed to load streams:', err);
    } finally {
      setLoadingStreams(false);
    }
  };

  const loadSeasonEpisodes = async (season: Season) => {
    setSelectedSeason(season.id);
    if (season.episodes.length > 0 && season.episodes[0].sources) {
      return;
    }
    setLoadingEpisodes(true);
    try {
      if (season.episodes.length > 0 && season.episodes[0].link) {
        const firstEp = season.episodes[0];
        if (!firstEp.sources) {
          const data = await fetchStreams(provider, firstEp.link, 'series');
          setSeasons(prev => prev.map(s => 
            s.id === season.id ? { 
              ...s, 
              episodes: s.episodes.map(ep => ({ ...ep, sources: data }))
            } : s
          ));
        }
      }
    } catch (err) {
      console.error('Failed to load episodes:', err);
    } finally {
      setLoadingEpisodes(false);
    }
  };

  const handleWatch = (stream: StreamSource) => {
    setSelectedSource(stream);
    navigate(`/watch?provider=${provider}&link=${encodeURIComponent(stream.link)}&title=${encodeURIComponent(title)}&image=${encodeURIComponent(image)}&type=${type}`);
    onClose();
  };

  const handleEpisodeWatch = async (ep: { title: string; link: string }) => {
    await loadStreams(ep.link, 'series');
    onClose();
  };

  const groupedStreams = streams.reduce((acc: Record<string, StreamSource[]>, stream) => {
    const quality = stream.quality || 'Unknown';
    if (!acc[quality]) acc[quality] = [];
    acc[quality].push(stream);
    return acc;
  }, {} as Record<string, StreamSource[]>);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content content-selector" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="selector-header">
          {image && <img src={image} alt="" className="selector-image" />}
          <div className="selector-info">
            <h2 className="selector-title">{title}</h2>
            <span className="selector-type">{type === 'series' ? 'TV Series' : 'Movie'}</span>
            <span className="selector-provider">{provider}</span>
          </div>
        </div>

        {loading ? (
          <div className="selector-loading">
            <div className="spinner" />
            <p>Loading streaming options...</p>
          </div>
        ) : error ? (
          <div className="selector-error">
            <p>{error}</p>
            <button className="btn btn-primary" onClick={loadContent}>Retry</button>
          </div>
        ) : type === 'movie' ? (
          <div className="selector-section">
            <div className="section-label">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="23 7 16 12 23 17 23 7"/>
                <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
              </svg>
              Select Quality & Server
            </div>

            {loadingStreams ? (
              <div className="selector-loading">
                <div className="spinner" />
                <p>Finding streams...</p>
              </div>
            ) : streams.length === 0 ? (
              <div className="selector-empty">
                <div className="empty-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4M12 16h.01"/>
                  </svg>
                </div>
                <p>No streaming links found</p>
                <span>Try a different source or search again</span>
                <button className="btn btn-primary" onClick={() => { onClose(); }}>
                  Close
                </button>
              </div>
            ) : (
              <div className="streams-container">
                {Object.entries(groupedStreams).map(([quality, qualityStreams]) => (
                  <div key={quality} className="quality-section">
                    <div className="quality-header">
                      <span className="quality-badge">{quality}</span>
                      <span className="quality-count">{qualityStreams.length} servers</span>
                    </div>
                    <div className="servers-grid">
                      {qualityStreams.map((stream, i) => (
                        <button
                          key={`${quality}-${i}`}
                          className={`server-btn ${selectedSource?.link === stream.link ? 'active' : ''}`}
                          onClick={() => handleWatch(stream)}
                        >
                          <div className="server-info">
                            <span className="server-name">{stream.server || 'Server ' + (i + 1)}</span>
                            {stream.quality && <span className="server-quality">{stream.quality}</span>}
                          </div>
                          <div className="server-play">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="selector-section series-section">
            <div className="section-label">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="2" y="7" width="20" height="15" rx="2" ry="2"/>
                <polyline points="17 2 12 7 7 2"/>
              </svg>
              Select Season
            </div>

            {seasons.length === 0 ? (
              <div className="selector-empty">
                <div className="empty-icon">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <rect x="2" y="7" width="20" height="15" rx="2" ry="2"/>
                    <polyline points="17 2 12 7 7 2"/>
                  </svg>
                </div>
                <p>No seasons found</p>
                <button className="btn btn-primary" onClick={() => { onClose(); }}>
                  Close
                </button>
              </div>
            ) : (
              <>
                <div className="seasons-scroll">
                  {seasons.map(season => (
                    <button
                      key={season.id}
                      className={`season-card ${selectedSeason === season.id ? 'active' : ''}`}
                      onClick={() => loadSeasonEpisodes(season)}
                    >
                      <div className="season-number">{season.id}</div>
                      <div className="season-info">
                        <span className="season-title">{season.title}</span>
                        <span className="season-eps">{season.episodes.length} episodes</span>
                      </div>
                    </button>
                  ))}
                </div>

                {selectedSeason && (
                  <div className="episodes-container">
                    <div className="episodes-header">
                      <span>Episodes</span>
                      {loadingEpisodes && <span className="loading-dots">Loading...</span>}
                    </div>
                    {loadingEpisodes ? (
                      <div className="selector-loading">
                        <div className="spinner" />
                      </div>
                    ) : (
                      <div className="episodes-list-modern">
                        {seasons.find(s => s.id === selectedSeason)?.episodes.map((ep, i) => (
                          <button
                            key={i}
                            className="episode-card"
                            onClick={() => handleEpisodeWatch({ title: ep.title, link: ep.link })}
                          >
                            <div className="episode-num">{i + 1}</div>
                            <div className="episode-info">
                              <span className="episode-title">{ep.title}</span>
                            </div>
                            <div className="episode-play">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8 5v14l11-7z"/>
                              </svg>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}