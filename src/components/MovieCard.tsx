import { useNavigate } from 'react-router-dom';

interface MovieCardProps {
  title: string;
  image: string;
  provider: string;
  link: string;
  year?: string;
  quality?: string;
  type?: string;
  onClick?: () => void;
}

export default function MovieCard({
  title, image, provider, link, year, quality, type = 'movie', onClick,
}: MovieCardProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate(`/watch?provider=${provider}&link=${encodeURIComponent(link)}&title=${encodeURIComponent(title)}&image=${encodeURIComponent(image)}&type=${type}`);
    }
  };

  return (
    <div className="card" onClick={handleClick}>
      <div className="card-image-wrapper">
        {image ? (
          <img
            className="card-image"
            src={image}
            alt={title}
            loading="lazy"
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
              const parent = target.parentElement;
              if (parent && !parent.querySelector('.card-placeholder')) {
                const placeholder = document.createElement('div');
                placeholder.className = 'card-placeholder';
                placeholder.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m21 15-5-5L5 21"/></svg>';
                parent.appendChild(placeholder);
              }
            }}
          />
        ) : (
          <div className="card-placeholder">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2" y="2" width="20" height="20" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m21 15-5-5L5 21"/></svg>
          </div>
        )}
        <div className="card-overlay">
          <div className="card-title">{title}</div>
          <div className="card-meta">
            <span>{year || ''}</span>
            {quality && <span className="quality-badge">{quality}</span>}
          </div>
        </div>
        <div className="card-play">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
      <div className="card-provider">{provider}</div>
    </div>
  );
}
