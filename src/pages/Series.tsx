import { useState, useEffect, useCallback } from 'react';
import MovieCard from '../components/MovieCard';
import ContentSelector from '../components/ContentSelector';
import { fetchHomePosts, clearCache } from '../services/api';
import toast from 'react-hot-toast';

interface ContentItem {
  title: string;
  image: string;
  link: string;
  provider: string;
  providerName?: string;
  type?: string;
}

const SERIES_SOURCES = [
  { name: 'FlixHQ', value: 'flixhq', filter: '/recent' },
  { name: 'KissKh', value: 'kissKh', filter: '/api/DramaList/DramaList.json?page=0&size=20&type=0' },
  { name: 'HiAnime', value: 'hiAnime', filter: '/recent' },
  { name: 'ShowBox', value: 'showbox', filter: '/series' },
  { name: 'Animetsu', value: 'animetsu', filter: '' },
  { name: 'TokyoInsider', value: 'tokyoInsider', filter: '' },
];

// Global state to persist across navigation
let globalPosts: ContentItem[] = [];
let lastFetchTime = 0;
const FETCH_COOLDOWN = 30000;

export default function Series() {
  const [allPosts, setAllPosts] = useState<ContentItem[]>(globalPosts);
  const [loading, setLoading] = useState(globalPosts.length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [activeSource, setActiveSource] = useState('all');
  const [selectorItem, setSelectorItem] = useState<ContentItem | null>(null);

  const loadContent = useCallback(async (forceRefresh = false) => {
    if (!forceRefresh && globalPosts.length > 0) {
      setAllPosts(globalPosts);
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
      const results = await Promise.allSettled(
        SERIES_SOURCES.map(src => 
          fetchHomePosts(src.value, src.filter, 1).then(posts => 
            posts.map((post: any) => ({ 
              ...post, 
              provider: src.value, 
              providerName: src.name,
              type: 'series'
            }))
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
        toast.success(`Refreshed! Loaded ${allItems.length} series`);
      }
    } catch (err) {
      console.error('Series load error:', err);
      toast.error('Failed to load series');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadContent(false);
  }, [loadContent]);

  const filteredPosts = activeSource === 'all'
    ? allPosts
    : allPosts.filter(p => p.provider === activeSource);

  const handleCardClick = (item: ContentItem) => {
    setSelectorItem(item);
  };

  return (
    <div className="grid-page">
      <div className="grid-header" style={{ flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 className="grid-title">TV Series</h1>
          <button
            className="btn btn-outline btn-sm"
            onClick={() => loadContent(true)}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing...' : '🔄 Refresh'}
          </button>
        </div>
        <div className="genre-filters">
          <button
            className={`genre-btn ${activeSource === 'all' ? 'active' : ''}`}
            onClick={() => setActiveSource('all')}
          >
            All Sources
          </button>
          {SERIES_SOURCES.map(s => (
            <button
              key={s.value}
              className={`genre-btn ${activeSource === s.value ? 'active' : ''}`}
              onClick={() => setActiveSource(s.value)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loader">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <div className="spinner" />
            <p className="loader-text">Loading series from all sources...</p>
          </div>
        </div>
      ) : filteredPosts.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">&#128250;</div>
          <div className="empty-title">No series found</div>
          <div className="empty-desc">Try a different source or refresh</div>
        </div>
      ) : (
        <>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            {filteredPosts.length} series from {activeSource === 'all' ? 'all sources' : SERIES_SOURCES.find(s => s.value === activeSource)?.name}
          </p>
          <div className="movie-grid">
            {filteredPosts.map((item, i) => (
              <MovieCard
                key={`${item.provider}-${item.link}-${i}`}
                title={item.title}
                image={item.image}
                provider={item.provider}
                link={item.link}
                type="series"
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
          type="series"
          onClose={() => setSelectorItem(null)}
        />
      )}
    </div>
  );
}
