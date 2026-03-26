import { useState, useEffect, useCallback } from 'react';
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

// Global state to persist across navigation
let globalPosts: ContentItem[] = [];
let globalProviders: ProviderInfo[] = [];
let lastFetchTime = 0;
const FETCH_COOLDOWN = 30000;

export default function Movies() {
  const [allPosts, setAllPosts] = useState<ContentItem[]>(globalPosts);
  const [providers, setProviders] = useState<ProviderInfo[]>(globalProviders);
  const [loading, setLoading] = useState(globalPosts.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [activeProvider, setActiveProvider] = useState<string>('all');
  const [selectorItem, setSelectorItem] = useState<ContentItem | null>(null);

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
            posts
              .filter((post: any) => post.type !== 'series')
              .map((post: any) => ({ ...post, provider: p.value, providerName: p.display_name }))
          )
        )
      );

      const allItems: ContentItem[] = [];
      results.forEach(result => {
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
        toast.success(`Refreshed! Loaded ${allItems.length} movies`);
      }
    } catch (err) {
      console.error('Movies load error:', err);
      toast.error('Failed to load movies');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadContent(false);
  }, [loadContent]);

  const filteredPosts = activeProvider === 'all' 
    ? allPosts 
    : allPosts.filter(p => p.provider === activeProvider);

  const handleCardClick = (item: ContentItem) => {
    setSelectorItem(item);
  };

  const providerOptions = [
    { value: 'all', label: 'All Sources' },
    ...providers
      .filter(p => allPosts.some(post => post.provider === p.value))
      .map(p => ({ value: p.value, label: p.display_name }))
  ];

  return (
    <div className="grid-page">
      <div className="grid-header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 className="grid-title">Movies</h1>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => loadContent(true)}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : '🔄 Refresh'}
          </button>
        </div>
        <select
          className="form-input"
          value={activeProvider}
          onChange={e => setActiveProvider(e.target.value)}
          style={{ width: 'auto', padding: '0.5rem 1rem', fontSize: '0.85rem' }}
        >
          {providerOptions.map(p => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="loader">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <div className="spinner" />
            <p className="loader-text">Loading movies from all sources...</p>
          </div>
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">&#127916;</div>
          <div className="empty-title">No movies found</div>
          <div className="empty-desc">Try selecting a different source or refresh</div>
        </div>
      ) : (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {filteredPosts.length} movies from {activeProvider === 'all' ? 'all sources' : providerOptions.find(p => p.value === activeProvider)?.label}
          </p>
          <div className="movie-grid">
            {filteredPosts.map((item, i) => (
              <MovieCard
                key={`${item.provider}-${item.link}-${i}`}
                title={item.title}
                image={item.image}
                provider={item.provider}
                link={item.link}
                type="movie"
                onClick={() => handleCardClick(item)}
              />
            ))}
          </div>
        </>
      )}

      {selectorItem && (
        <ContentSelector
          provider={selectorItem.provider}
          link={selectorItem.link}
          title={selectorItem.title}
          image={selectorItem.image}
          type="movie"
          onClose={() => setSelectorItem(null)}
        />
      )}
    </div>
  );
}
