// TONE3000 API type definitions

export type Demo = 'select' | 'load-tone' | 'load-model' | 'full-api' | 'lan-flow';

export enum Gear {
  Amp = 'amp',
  AmpCab = 'amp-cab',
  Pedal = 'pedal',
  Outboard = 'outboard',
  Cab = 'cab',
  Space = 'space',
  Experimental = 'experimental',
  /** @deprecated alias for AmpCab — accepted on input, normalized on persist. */
  FullRig = 'full-rig',
  /** @deprecated stripped from gears; use Format.Ir instead. */
  Ir = 'ir',
}

export enum Format {
  Nam = 'nam',
  Ir = 'ir',
  AidaX = 'aida-x',
  AaSnapshot = 'aa-snapshot',
  Proteus = 'proteus',
}

export enum License {
  T3k = 't3k',
  CcBy = 'cc-by',
  CcBySa = 'cc-by-sa',
  CcByNc = 'cc-by-nc',
  CcByNcSa = 'cc-by-nc-sa',
  CcByNd = 'cc-by-nd',
  CcByNcNd = 'cc-by-nc-nd',
  Cco = 'cco',
}

export enum Size {
  Standard = 'standard',
  Lite = 'lite',
  Feather = 'feather',
  Nano = 'nano',
  Custom = 'custom',
}

export enum TonesSort {
  BestMatch = 'best-match',
  Newest = 'newest',
  Oldest = 'oldest',
  Trending = 'trending',
  DownloadsAllTime = 'downloads-all-time',
}

export enum UsersSort {
  Tones = 'tones',
  Downloads = 'downloads',
  Favorites = 'favorites',
  Models = 'models',
}

export interface EmbeddedUser {
  id: string;
  username: string;
  avatar_url: string | null;
  url: string;
}

export interface User extends EmbeddedUser {
  bio: string | null;
  links: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface PublicUser {
  id: number;
  username: string;
  bio: string | null;
  links: string[] | null;
  avatar_url: string | null;
  downloads_count: number;
  favorites_count: number;
  models_count: number;
  tones_count: number;
  url: string;
}

export interface Make {
  id?: number; // absent when returned via RPC (search results)
  name: string;
}

export interface Tag {
  id?: number; // absent when returned via RPC (search results)
  name: string;
}

export interface Tone {
  id: number;
  user_id: string;
  user: EmbeddedUser;
  created_at?: string; // absent from GET /tones/{id} — present on search/created/favorited
  updated_at?: string; // absent from GET /tones/{id} — present on search/created/favorited
  title: string;
  description: string | null;
  gear: Gear;
  images: string[] | null;
  is_public: boolean | null;
  links: string[] | null;
  format: Format;
  license: License;
  sizes: Size[];
  makes: Make[];
  tags: Tag[];
  models_count: number;
  downloads_count: number;
  favorites_count: number;
  url: string;
}

/** Neural model architecture version. 'custom' covers user-supplied architectures. */
export type ArchitectureVersion = '1' | '2' | 'custom';

export interface Model {
  id: number;
  created_at: string;
  updated_at: string;
  user_id: string;
  model_url: string;
  name: string;
  size: Size;
  architecture_version: ArchitectureVersion;
  tone_id: number;
}

/** Response from GET /api/v1/tones/{id}/download — a zip archive of all the tone's models. */
export interface ToneDownload {
  /** Temporary download URL for the zip. No auth needed; expires one hour after being issued. */
  url: string;
  /** ISO 8601 timestamp at which `url` stops working. */
  expires_at: string;
  /** Suggested filename for the archive, derived from the tone title (e.g. "My Tone.zip"). */
  filename: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  page: number;
  page_size: number;
  total: number;
  total_pages: number;
}

export interface SearchTonesParams {
  query?: string;
  page?: number;
  pageSize?: number;
  sort?: TonesSort;
  gears?: Gear[];
  sizes?: Size[];
  architecture?: number;
}

export interface ListModelsParams {
  page?: number;
  pageSize?: number;
  architecture?: number;
}

/** Pagination params shared by the created / favorited / downloaded tone lists. */
export interface ListTonesParams {
  page?: number;
  pageSize?: number;
}

export interface ListUsersParams {
  sort?: UsersSort;
  page?: number;
  pageSize?: number;
  query?: string;
}
