import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { searchPosts, fetchProviders } from '../services/api';

interface SearchResult {
  title: string;
  link: string;
  image: string;
  provider: string;
}

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchProviders, setSearchProviders] = useState<string[]>([]);
  const searchRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 30);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    fetchProviders().then(providers => {
      const enabled = providers
        .filter((p: any) => !p.disabled)
        .map((p: any) => p.value)
        .slice(0, 10);
      setSearchProviders(enabled);
    }).catch(() => {
      setSearchProviders(['vega', 'flixhq', 'kissKh', 'multi', 'autoEmbed', 'primewire']);
    });
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    try {
      const providers = searchProviders.length > 0 ? searchProviders : ['vega', 'flixhq', 'kissKh', 'multi', 'autoEmbed', 'primewire'];
      const promises = providers.map(p =>
        searchPosts(p, q).then(r => r.map((item: any) => ({ ...item, provider: p }))).catch(() => [])
      );
      const all = await Promise.all(promises);
      const flatResults = all.flat();
      const uniqueMap = new Map<string, SearchResult>();
      flatResults.forEach((item: SearchResult) => {
        const key = `${item.title.toLowerCase()}-${item.provider}`;
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, item);
        }
      });
      setResults(Array.from(uniqueMap.values()).slice(0, 20));
      setShowResults(true);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [searchProviders]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 500);
  };

  const handleResultClick = (result: SearchResult) => {
    setShowResults(false);
    setQuery('');
    navigate(`/watch?provider=${result.provider}&link=${encodeURIComponent(result.link)}&title=${encodeURIComponent(result.title)}&image=${encodeURIComponent(result.image)}`);
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <nav className={`navbar ${scrolled ? 'scrolled' : ''}`}>
      <div className="nav-left">
        <Link to="/" className="nav-brand">
          <svg viewBox="0 0 24 24" fill="currentColor" width="28" height="28"><path d="M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2zm0 2v12h16V6H4zm2 2h2v2H6V8zm4 0h8v2h-8V8zm-4 4h2v2H6v-2zm4 0h8v2h-8v-2z"/></svg>
          MOVIEBYTES
        </Link>
        <div className="nav-links">
          <Link to="/" className={`nav-link ${isActive('/') ? 'active' : ''}`}>Home</Link>
          <Link to="/movies" className={`nav-link ${isActive('/movies') ? 'active' : ''}`}>Movies</Link>
          <Link to="/series" className={`nav-link ${isActive('/series') ? 'active' : ''}`}>Series</Link>
        </div>
      </div>
      <div className="nav-right">
        <div className="search-wrapper" ref={searchRef}>
          <span className="search-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          </span>
          <input
            className="search-input"
            placeholder="Search movies, series..."
            value={query}
            onChange={handleSearch}
            onFocus={() => query.length >= 2 && setShowResults(true)}
          />
          {showResults && (
            <div className="search-results modern-search">
              <div className="search-header">
                <span className="search-title">{searching ? 'Searching...' : `Results for "${query}"`}</span>
                <span className="search-count">{results.length} found</span>
              </div>
              {results.length === 0 && !searching && query.length >= 2 && (
                <div className="search-empty">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="11" cy="11" r="8"/>
                    <path d="m21 21-4.3-4.3"/>
                  </svg>
                  <p>No results found</p>
                  <span>Try different keywords</span>
                </div>
              )}
              <div className="search-list">
                {results.map((r, i) => (
                  <div key={`${r.provider}-${i}`} className="search-result-item" onClick={() => handleResultClick(r)}>
                    <div className="search-result-image">
                      {r.image ? (
                        <img src={r.image} alt="" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      ) : (
                        <div className="search-result-placeholder">
                          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <rect x="2" y="2" width="20" height="20" rx="2"/>
                            <circle cx="8" cy="8" r="2"/>
                            <path d="m21 15-5-5L5 21"/>
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="search-result-info">
                      <div className="search-result-title">{r.title}</div>
                      <div className="search-result-meta">
                        <span className="search-provider-badge">{r.provider}</span>
                      </div>
                    </div>
                    <div className="search-result-arrow">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="m9 18 6-6-6-6"/>
                      </svg>
                    </div>
                  </div>
                ))}
              </div>
              <div className="search-footer">
                <span>Search across {searchProviders.length} providers</span>
              </div>
            </div>
          )}
        </div>
        <Link to="/config" className="btn btn-ghost btn-sm">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12.22 2h-.44a2 2 0 00-2 2v.18a2 2 0 01-1 1.73l-.43.25a2 2 0 01-2 0l-.15-.08a2 2 0 00-2.73.73l-.22.38a2 2 0 00.73 2.73l.15.1a2 2 0 011 1.72v.51a2 2 0 01-1 1.74l-.15.09a2 2 0 00-.73 2.73l.22.38a2 2 0 002.73.73l.15-.08a2 2 0 012 0l.43.25a2 2 0 011 1.73V20a2 2 0 002 2h.44a2 2 0 002-2v-.18a2 2 0 011-1.73l.43-.25a2 2 0 012 0l.15.08a2 2 0 002.73-.73l.22-.39a2 2 0 00-.73-2.73l-.15-.08a2 2 0 01-1-1.74v-.5a2 2 0 011-1.74l.15-.09a2 2 0 00.73-2.73l-.22-.38a2 2 0 00-2.73-.73l-.15.08a2 2 0 01-2 0l-.43-.25a2 2 0 01-1-1.73V4a2 2 0 00-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
        </Link>
      </div>
    </nav>
  );
}
