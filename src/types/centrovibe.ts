export type SpaceType = 'green_area' | 'main_hall';

export type EventCluster =
  | 'brasil_raiz'
  | 'urbano_hype'
  | 'latinidades'
  | 'povao_coracao'
  | 'open_format'
  | 'eclectic';

export interface TicketBatch {
  id: string;
  name: string;
  price: number;
  status: 'sold_out' | 'active' | 'scheduled';
  soldCount?: number;
  totalCount?: number;
}

export interface VenueEvent {
  id: string;
  title: string;
  description: string;
  startTime: string;
  endTime: string;
  space: SpaceType;
  cluster: EventCluster;
  genre: string;
  lineup?: string[];
  tickets?: TicketBatch[];
}

export type ScrapedSource = 'manual' | 'sympla' | 'shotgun' | 'blacktag';

export interface Competitor {
  id: string;
  name: string;
  neighborhood: string;
  address: string;
  capacity: number;
  mainClusters: EventCluster[];
  priceRange: 'low' | 'mid' | 'high';
  source?: 'manual' | 'scraped';
  sourceUrl?: string;
}

export interface ExternalEvent {
  id: string;
  competitorId: string;
  title: string;
  date: string;
  cluster: EventCluster;
  lineupNames: string[];
  ticketPrice?: number;
  tickets?: TicketBatch[];
  notes?: string;
  source?: ScrapedSource;
  sourceUrl?: string;
  sourceId?: string;
  imageUrl?: string;
  scrapedAt?: string;
}

export interface DaySchedule {
  day: string;
  theme: string;
  events: VenueEvent[];
}

export interface CentroVibeMessage {
  role: 'user' | 'model';
  text: string;
  isThinking?: boolean;
}

export interface CompatibilityResult {
  isCompatible: boolean;
  score: number;
  reasoning: string;
  suggestion: string;
}

export interface Season {
  id: string;
  months: number[];
  label: string;
  theme: string;
  color: string;
  description: string;
}

export type ArtistRole = 'dj' | 'band' | 'producer' | 'performer';

export interface Artist {
  id: string;
  name: string;
  role: ArtistRole;
  cluster: EventCluster;
  subGenre: string;
  instagram?: string;
  rate?: string;
}

export type CentroVibeViewMode = 'week' | 'month' | 'year' | 'artists' | 'vibes' | 'radar';

export interface CentroVibeData {
  schedule: DaySchedule[];
  artists: Artist[];
  competitors: Competitor[];
  externalEvents: ExternalEvent[];
}

export interface PlatformStatus {
  lastSuccess: string | null;
  eventsFound: number;
  error?: string;
  disabled?: boolean;
}

export interface ScraperStatus {
  lastRun: string | null;
  isRunning: boolean;
  platforms: {
    sympla: PlatformStatus;
    shotgun: PlatformStatus;
    blacktag: PlatformStatus;
  };
  totalNewEvents: number;
  totalUpdated: number;
}

export type ScraperSourceKey = 'sympla' | 'shotgun' | 'blacktag';

export interface ScraperSourceConfig {
  enabled: boolean;
  url: string;
  maxPages?: number;
}

export interface ScraperConfig {
  autoRun: boolean;
  intervalHours: number;
  sources: Record<ScraperSourceKey, ScraperSourceConfig>;
}

export interface RawScrapedEvent {
  sourceId: string;
  source: 'sympla' | 'shotgun' | 'blacktag';
  title: string;
  date: string;
  venueName: string;
  venueAddress?: string;
  venueNeighborhood?: string;
  venueCapacity?: number;
  lineupNames: string[];
  ticketPrice?: number;
  isFree?: boolean;
  description?: string;
  imageUrl?: string;
  sourceUrl: string;
  genre?: string;
}
