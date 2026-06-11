export type Track = {
  id: string;
  album_id?: string;
  title: string;
  duration?: number | null;
  position?: number | null;
  encrypted_audio_url?: string | null;
  preview_url?: string | null;
  stream_url?: string | null;
  stream_status?: 'idle' | 'processing' | 'ready' | 'failed' | string;
};
