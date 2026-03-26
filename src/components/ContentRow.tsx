import MovieCard from './MovieCard';

interface ContentRowProps {
  title: string;
  items: Array<{
    title: string;
    image: string;
    link: string;
    provider: string;
    year?: string;
    quality?: string;
    type?: string;
  }>;
  moreLink?: string;
}

export default function ContentRow({ title, items }: ContentRowProps) {
  if (!items || items.length === 0) return null;

  return (
    <div className="section">
      <div className="section-header">
        <h2 className="section-title">{title}</h2>
      </div>
      <div className="content-row">
        {items.map((item, i) => (
          <MovieCard
            key={`${item.provider}-${i}`}
            title={item.title}
            image={item.image}
            provider={item.provider}
            link={item.link}
            year={item.year}
            quality={item.quality}
            type={item.type}
          />
        ))}
      </div>
    </div>
  );
}
