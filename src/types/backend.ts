export type ApiHealth = {
  status: string;
  message: string;
  timestamp: string;
  env?: string;
};

export type PublicTrack = {
  id: string;
  album_id: string;
  title: string;
  duration?: number | null;
  position?: number | null;
  encrypted_audio_url?: string | null;
  preview_url?: string | null;
  audio_storage_provider?: string | null;
  audio_storage_key?: string | null;
  stream_url?: string | null;
  stream_status?: 'idle' | 'processing' | 'ready' | 'failed' | string;
  lyrics_url?: string | null;
  has_lyrics?: boolean;
  is_encrypted?: boolean;
};

export type PublicAlbumSummary = {
  id: string;
  artist_id: string;
  title: string;
  description?: string | null;
  price_ariary: number;
  cover_url?: string | null;
  status: 'draft' | 'published' | 'archived' | string;
  is_free?: boolean;
  type?: 'single' | 'album' | 'ep' | string;
  stream_status?: 'idle' | 'processing' | 'ready' | 'failed' | string;
  stream_url?: string | null;
  stream_error_message?: string | null;
  artist_name?: string;
  artist_pdp?: string | null;
  artist?: {
    id?: string;
    name?: string;
    slug?: string;
    profile_picture_url?: string | null;
  } | null;
  artists?: {
    id: string;
    name: string;
    profile_picture_url?: string | null;
  }[];
  publication_date?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type PublicAlbumDetails = PublicAlbumSummary & {
  artist?: {
    id?: string;
    name?: string;
    slug?: string;
    profile_picture_url?: string | null;
  } | null;
  tracks: PublicTrack[];
};

export type PassCodeRecord = {
  id: string;
  code: string;
  transaction_id?: string | null;
  device_id?: string | null;
  activated_at?: string | null;
  expires_at?: string | null;
  created_at?: string | null;
};

export type PassCodeActivationResponse = {
  passcode: PassCodeRecord;
  transaction: {
    id: string;
    album_id: string;
    amount: number;
    status: string;
    payment_reference?: string | null;
  };
  album: PublicAlbumDetails;
  device_id: string;
  decryption_key?: string | null;
};
