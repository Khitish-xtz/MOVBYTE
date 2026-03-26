export interface Movie {
  id: string;
  title: string;
  year?: string;
  poster: string;
  backdrop?: string;
  rating?: string;
  quality?: string;
  description?: string;
  genres?: string[];
  duration?: string;
  type: 'movie' | 'series';
  provider?: string;
  link?: string;
  torrents?: Torrent[];
}

export interface Series extends Movie {
  type: 'series';
  seasons?: Season[];
  totalEpisodes?: number;
  status?: string;
}

export interface Season {
  season: number;
  episodes: Episode[];
}

export interface Episode {
  title: string;
  link: string;
  episode?: number;
}

export interface Torrent {
  url: string;
  hash: string;
  quality: string;
  seeds: number;
  peers: number;
  size: string;
}

export interface StreamSource {
  name: string;
  url: string;
  quality?: string;
  type: string;
  isEmbed?: boolean;
  headers?: Record<string, string>;
}

export interface VegaPost {
  title: string;
  link: string;
  image: string;
  provider?: string;
}

export interface VegaInfo {
  title: string;
  image: string;
  synopsis: string;
  imdbId: string;
  type: string;
  tags?: string[];
  cast?: string[];
  rating?: string;
  linkList: VegaLink[];
}

export interface VegaLink {
  title: string;
  quality?: string;
  episodesLink?: string;
  directLinks?: { title: string; link: string; type?: string }[];
}

export interface VegaStream {
  server: string;
  link: string;
  type: string;
  quality?: string;
  headers?: Record<string, string>;
}

export interface VegaCatalog {
  title: string;
  filter: string;
}

export interface ProviderInfo {
  display_name: string;
  value: string;
  version: string;
  type: string;
  disabled: boolean;
}

export interface TelegramVideo {
  messageId: number;
  fileName: string;
  fileSize: number;
  mimeType: string;
  duration: number;
  date: number;
  caption: string;
  thumbnail: string | null;
  streamUrl: string;
}

export interface TelegramConfig {
  botToken: string;
  channelId: string;
}
