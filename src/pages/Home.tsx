import { useState, useEffect, useCallback, useRef } from 'react';
import Hero from '../components/Hero';
import MovieCard from '../components/MovieCard';
import ContentSelector from '../components/ContentSelector';
import { fetchHomePosts, fetchProviders, clearCache } from '../services/api';
import toast from 'react-hot-toast';

interface ContentItem {
  title: string;
  image: string;
  link: string;
  provider: string;
  providerName?: string;
  type?: string;
}

interface ProviderInfo {
  display_name: string;
  value: string;
  type: string;
}

type TabType = 'new' | 'movies' | 'series';

let globalPosts: ContentItem[] = [];
let globalProviders: ProviderInfo[] = [];
let lastFetchTime = 0;
const FETCH_COOLDOWN = 30000;

export default function Home() {
  const [allPosts, setAllPosts] = useState<ContentItem[]>(globalPosts);
  const [newMovies, setNewMovies] = useState<ContentItem[]>([]);
  const [newSeries, setNewSeries] = useState<ContentItem[]>([]);
  const [providers, setProviders] = useState<ProviderInfo[]>(globalProviders);
  const [loading, setLoading] = useState(globalPosts.length === 0);
  const [loadingNew, setLoadingNew] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('new');
  const [activeProvider, setActiveProvider] = useState<string>('all');
  const [selectorItem, setSelectorItem] = useState<ContentItem | null>(null);
  const newMoviesRef = useRef<HTMLDivElement>(null);
  const newSeriesRef = useRef<HTMLDivElement>(null);

  const loadContent = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && globalPosts.length > 0) {
      setAllPosts(globalPosts);
      setProviders(globalProviders);
      setLoading(false);
      return;
    }

    if (forceRefresh && Date.now() - lastFetchTime < FETCH_COOLDOWN) {
      toast('Please wait before refreshing again', { icon: '⏳' });
      return;
    }

    if (forceRefresh) {
      setRefreshing(true);
      clearCache('posts');
    } else {
      setLoading(true);
    }

    try {
      const providerList = await fetchProviders();
      setProviders(providerList);
      globalProviders = providerList;

      const enabledProviders = providerList.filter((p: ProviderInfo) => 
        !['cinemaLuxe', 'movieBox', 'netflixMirror', 'primeMirror', 'ogomovies', 'a111477', 'vadapav', 'moviesApi', 'dooflix', 'katMovieFix', 'skyMovieHD'].includes(p.value)
      );

      const results = await Promise.allSettled(
        enabledProviders.map((p: ProviderInfo) => 
          fetchHomePosts(p.value, '', 1).then(posts => 
            posts.map((post: any) => ({ ...post, provider: p.value, providerName: p.display_name }))
          )
        )
      );

      const allItems: ContentItem[] = [];
      results.forEach((result) => {
        if (result.status === 'fulfilled') {
          allItems.push(...result.value);
        }
      });

      const existingLinks = new Set(globalPosts.map(p => p.link));
      const newItems = allItems.filter(item => !existingLinks.has(item.link));
      
      const merged = forceRefresh ? allItems : [...newItems, ...globalPosts];
      
      globalPosts = merged;
      setAllPosts(merged);
      lastFetchTime = Date.now();

      if (forceRefresh) {
        toast.success(`Refreshed! Loaded ${allItems.length} items`);
      }
    } catch (err) {
      console.error('Home load error:', err);
      toast.error('Failed to load content');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Load new releases separately
  const loadNewReleases = useCallback(async () => {
    setLoadingNew(true);
    try {
      const MOVIE_SOURCES = [
        { name: 'FlixHQ', value: 'flixhq', filter: '/recent' },
        { name: 'Vega', value: 'vega', filter: '' },
        { name: 'Multi', value: 'multi', filter: '' },
        { name: 'AutoEmbed', value: 'autoEmbed', filter: '' },
        { name: 'Primewire', value: 'primewire', filter: '' },
        { name: 'MoviesDrive', value: 'drive', filter: '' },
      ];
      
      const SERIES_SOURCES = [
        { name: 'FlixHQ', value: 'flixhq', filter: '/recent' },
        { name: 'KissKh', value: 'kissKh', filter: '/api/DramaList/DramaList.json?page=0&size=20&type=0' },
        { name: 'HiAnime', value: 'hiAnime', filter: '/recent' },
        { name: 'GuardaHD', value: 'guardahd', filter: '' },
        { name: 'Animetsu', value: 'animetsu', filter: '' },
        { name: 'ShowBox', value: 'showbox', filter: '/series' },
      ];

      const [movieResults, seriesResults] = await Promise.allSettled([
        Promise.all(MOVIE_SOURCES.map(src => 
          fetchHomePosts(src.value, src.filter, 1).then(posts => 
            posts.filter((p: any) => !p.type || p.type !== 'series').map((post: any) => ({ ...post, provider: src.value }))
          )
        )),
        Promise.all(SERIES_SOURCES.map(src => 
          fetchHomePosts(src.value, src.filter, 1).then(posts => 
            posts.filter((p: any) => p.type === 'series').map((post: any) => ({ ...post, provider: src.value }))
          )
        )),
      ]);

      const movies: ContentItem[] = [];
      const series: ContentItem[] = [];

      if (movieResults.status === 'fulfilled') {
        movieResults.value.forEach((result: any) => {
          if (result.status === 'fulfilled') movies.push(...result.value);
        });
      }

      if (seriesResults.status === 'fulfilled') {
        seriesResults.value.forEach((result: any) => {
          if (result.status === 'fulfilled') series.push(...result.value);
        });
      }

      setNewMovies(movies.slice(0, 20));
      setNewSeries(series.slice(0, 20));
    } catch (err) {
      console.error('New releases error:', err);
    } finally {
      setLoadingNew(false);
    }
  }, []);

  useEffect(() => {
    loadContent(false);
    loadNewReleases();
  }, [loadContent, loadNewReleases]);

  const getFilteredPosts = () => {
    let filtered = allPosts;

    if (activeProvider !== 'all') {
      filtered = filtered.filter(p => p.provider === activeProvider);
    }

    if (activeTab === 'movies') {
      filtered = filtered.filter(p => p.type !== 'series');
    } else if (activeTab === 'series') {
      filtered = filtered.filter(p => p.type === 'series');
    }

    return filtered;
  };

  const handleCardClick = (item: ContentItem) => {
    if (item.type === 'series') {
      setSelectorItem(item);
    } else {
      setSelectorItem(item);
    }
  };

  const heroItem = newMovies[0] || allPosts[0];

  if (loading) {
    return (
      <div className="loader">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          <div className="spinner" />
          <p className="loader-text">Loading content from providers...</p>
        </div>
      </div>
    );
  }

  const filteredPosts = getFilteredPosts();
  const providerOptions = [
    { value: 'all', label: 'All Sources' },
    ...providers
      .filter(p => allPosts.some(post => post.provider === p.value))
      .map(p => ({ value: p.value, label: p.display_name }))
  ];

  return (
    <div>
      {heroItem && activeTab === 'new' && (
        <Hero
          title={heroItem.title}
          poster={heroItem.image}
          provider={heroItem.provider}
          link={heroItem.link}
        />
      )}

      <div className="section">
        <div className="section-header">
          <div className="tabs-wrapper">
            <div className="tabs modern-tabs">
              <button
                className={`tab ${activeTab === 'new' ? 'active' : ''}`}
                onClick={() => setActiveTab('new')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                New Releases
              </button>
              <button
                className={`tab ${activeTab === 'movies' ? 'active' : ''}`}
                onClick={() => setActiveTab('movies')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                  <line x1="7" y1="2" x2="7" y2="22" />
                  <line x1="17" y1="2" x2="17" y2="22" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                  <line x1="2" y1="7" x2="7" y2="7" />
                  <line x1="2" y1="17" x2="7" y2="17" />
                  <line x1="17" y1="17" x2="22" y2="17" />
                  <line x1="17" y1="7" x2="22" y2="7" />
                </svg>
                Movies
              </button>
              <button
                className={`tab ${activeTab === 'series' ? 'active' : ''}`}
                onClick={() => setActiveTab('series')}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="7" width="20" height="15" rx="2" ry="2" />
                  <polyline points="17 2 12 7 7 2" />
                </svg>
                TV Series
              </button>
            </div>

            <button
              className="btn btn-outline btn-sm refresh-btn"
              onClick={() => loadContent(true)}
              disabled={refreshing}
            >
              {refreshing ? (
                <span className="btn-spinner" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="m3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              )}
              Refresh
            </button>
          </div>

          <select
            className="form-input provider-select"
            value={activeProvider}
            onChange={e => setActiveProvider(e.target.value)}
          >
            {providerOptions.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* New Releases Section */}
        {activeTab === 'new' && (
          <div className="new-releases-section">
            {/* New Movies */}
            <div className="content-row" ref={newMoviesRef}>
              <div className="content-row-header">
                <h2 className="content-row-title">
                  <span className="badge-new">NEW</span>
                  Latest Movies
                </h2>
                <span className="content-count">{newMovies.length} movies</span>
              </div>
              {loadingNew ? (
                <div className="content-row-scroll">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="movie-card-skeleton">
                      <div className="skeleton-image" />
                      <div className="skeleton-text" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="content-row-scroll">
                  {newMovies.map((item, i) => (
                    <MovieCard
                      key={`new-movie-${item.provider}-${item.link}-${i}`}
                      title={item.title}
                      image={item.image}
                      provider={item.provider}
                      link={item.link}
                      type="movie"
                      onClick={() => handleCardClick(item)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* New Series */}
            <div className="content-row" ref={newSeriesRef}>
              <div className="content-row-header">
                <h2 className="content-row-title">
                  <span className="badge-new series">NEW</span>
                  Latest TV Shows
                </h2>
                <span className="content-count">{newSeries.length} shows</span>
              </div>
              {loadingNew ? (
                <div className="content-row-scroll">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="movie-card-skeleton">
                      <div className="skeleton-image" />
                      <div className="skeleton-text" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="content-row-scroll">
                  {newSeries.map((item, i) => (
                    <MovieCard
                      key={`new-series-${item.provider}-${item.link}-${i}`}
                      title={item.title}
                      image={item.image}
                      provider={item.provider}
                      link={item.link}
                      type="series"
                      onClick={() => handleCardClick(item)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* All Content */}
        {activeTab !== 'new' && (
          <>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
              {filteredPosts.length} items from {activeProvider === 'all' ? 'all sources' : providerOptions.find(p => p.value === activeProvider)?.label}
            </p>

            {filteredPosts.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">&#128253;</div>
                <div className="empty-title">No content found</div>
                <div className="empty-desc">Try selecting a different source or refresh</div>
              </div>
            ) : (
              <div className="movie-grid">
                {filteredPosts.map((item, i) => (
                  <MovieCard
                    key={`${item.provider}-${item.link}-${i}`}
                    title={item.title}
                    image={item.image}
                    provider={item.provider}
                    link={item.link}
                    type={item.type || 'movie'}
                    onClick={() => handleCardClick(item)}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Content Selector Modal */}
      {selectorItem && (
        <ContentSelector
          provider={selectorItem.provider}
          link={selectorItem.link}
          title={selectorItem.title}
          image={selectorItem.image}
          type={selectorItem.type === 'series' ? 'series' : 'movie'}
          onClose={() => setSelectorItem(null)}
        />
      )}
    </div>
  );
}
