export type DeviceTrack = {
  id: string;
  uri: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  artworkUri?: string | null;
};

export type LocalLibraryData = {
  deviceTracks: DeviceTrack[];
  vaultAlbums: import('@/types/backend').PublicAlbumSummary[];
};
