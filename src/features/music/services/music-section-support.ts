import type {
  MusicCollectionKind,
  MusicHomeSectionTab,
} from '../domain/entities';

export function resolveMusicCollectionSection(
  kind: MusicCollectionKind
): MusicHomeSectionTab {
  if (kind === 'playlist' || kind === 'album' || kind === 'rank') {
    return kind;
  }

  if (kind === 'artist-toplist') {
    return 'artist';
  }

  return 'home';
}
