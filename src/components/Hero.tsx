import { useNavigate } from 'react-router-dom';

interface HeroProps {
  title: string;
  description?: string;
  poster: string;
  rating?: string;
  year?: string;
  quality?: string;
  provider?: string;
  link?: string;
  type?: string;
}

export default function Hero({
  title, description, poster, rating, year, quality, provider, link, type = 'movie',
}: HeroProps) {
  const navigate = useNavigate();

  const handlePlay = () => {
    if (provider && link) {
      navigate(`/watch?provider=${provider}&link=${encodeURIComponent(link)}&title=${encodeURIComponent(title)}&image=${encodeURIComponent(poster)}&type=${type}`);
    }
  };

  return (
    <div className="hero">
      <img
        className="hero-bg"
        src={poster}
        alt={title}
        onError={(e) => {
          (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><rect fill="%23111" width="1920" height="1080"/></svg>';
        }}
      />
      <div className="hero-overlay" />
      <div className="hero-content">
        <h1 className="hero-title">{title}</h1>
        <div className="hero-meta">
          {rating && <span className="hero-rating">&#9733; {rating}</span>}
          {year && <span>{year}</span>}
          {quality && <span className="quality-badge">{quality}</span>}
          {type === 'series' && <span className="quality-badge" style={{ borderColor: '#46d369', color: '#46d369' }}>SERIES</span>}
        </div>
        {description && <p className="hero-desc">{description}</p>}
        <div className="hero-actions">
          <button className="btn btn-primary btn-lg" onClick={handlePlay}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            Play
          </button>
          <button className="btn btn-secondary btn-lg">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            More Info
          </button>
        </div>
      </div>
    </div>
  );
}
