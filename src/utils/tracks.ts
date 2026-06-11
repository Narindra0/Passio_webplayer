import type { PublicAlbumDetails, PublicTrack } from '@/types/backend';

export function sortTracksByPosition(tracks: PublicTrack[]): PublicTrack[] {
  return [...tracks].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export function getTrackIndexInQueue(
  albumOrTracks: PublicAlbumDetails | PublicTrack[],
  trackId: string,
): number {
  const tracks = Array.isArray(albumOrTracks)
    ? albumOrTracks
    : albumOrTracks.tracks ?? [];
  return sortTracksByPosition(tracks).findIndex((t) => t.id === trackId);
}

export function getTrackStartOffsetSeconds(
  sortedTracks: PublicTrack[],
  trackIndex: number,
): number {
  let offset = 0;
  for (let i = 0; i < trackIndex; i++) {
    offset += sortedTracks[i]?.duration ?? 0;
  }
  return offset;
}
