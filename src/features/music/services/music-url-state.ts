import { resolveMusicCollectionSection } from './music-section-support';
import type {
  MusicCollectionKind,
  MusicCollectionSummaryEntity,
  MusicHomeSectionTab,
} from '../domain/entities';

interface ParsedMusicUrlState {
  section: MusicHomeSectionTab;
  query?: string;
  collectionId?: string;
  collectionKind?: MusicCollectionKind;
}

interface ApplyMusicUrlStateActions {
  clearSelectedCollection: () => void;
  openCollection: (id: string, kind?: MusicCollectionKind) => Promise<void>;
  setActiveSection: (section: MusicHomeSectionTab) => void;
  submitSearch: (query: string) => Promise<unknown>;
}

const MUSIC_HOME_SECTION_TABS: MusicHomeSectionTab[] = [
  'home',
  'rank',
  'hot',
  'playlist',
  'album',
  'artist',
  'daily',
  'fm',
  'library',
  'settings',
  'search',
];

function normalizeOptionalText(
  value: string | null | undefined
): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function isMusicHomeSectionTab(value: string): value is MusicHomeSectionTab {
  return (MUSIC_HOME_SECTION_TABS as string[]).includes(value);
}

export function resolveMusicCollectionKindFromSection(
  section: MusicHomeSectionTab
): MusicCollectionKind | null {
  if (section === 'rank' || section === 'playlist' || section === 'album') {
    return section;
  }

  if (section === 'artist') {
    return 'artist-toplist';
  }

  return null;
}

export function parseMusicUrlState(search: string): ParsedMusicUrlState {
  const searchParams = new URLSearchParams(search);
  const rawQuery = normalizeOptionalText(searchParams.get('q'));
  const rawCollectionId = normalizeOptionalText(searchParams.get('collection'));
  const rawSection = normalizeOptionalText(searchParams.get('section'));
  const normalizedSection =
    rawSection && isMusicHomeSectionTab(rawSection)
      ? rawSection
      : rawQuery
      ? 'search'
      : 'home';
  const collectionKind =
    rawCollectionId && resolveMusicCollectionKindFromSection(normalizedSection)
      ? resolveMusicCollectionKindFromSection(normalizedSection)
      : null;

  return {
    section: normalizedSection,
    query: rawQuery,
    collectionId: rawCollectionId,
    collectionKind: collectionKind || undefined,
  };
}

export function buildMusicUrlStatePath(params: {
  activeSection: MusicHomeSectionTab;
  searchQuery?: string | null;
  selectedCollection?: Pick<MusicCollectionSummaryEntity, 'id' | 'kind'> | null;
}): string {
  const searchParams = new URLSearchParams();

  if (params.activeSection !== 'home') {
    searchParams.set('section', params.activeSection);
  }

  if (params.activeSection === 'search') {
    const normalizedQuery = normalizeOptionalText(params.searchQuery);

    if (normalizedQuery) {
      searchParams.set('q', normalizedQuery);
    }
  }

  if (
    params.selectedCollection &&
    resolveMusicCollectionSection(params.selectedCollection.kind) ===
      params.activeSection
  ) {
    searchParams.set('collection', params.selectedCollection.id);
  }

  const queryString = searchParams.toString();
  return queryString ? `/music?${queryString}` : '/music';
}

export async function applyMusicUrlState(
  search: string,
  actions: ApplyMusicUrlStateActions
): Promise<void> {
  const routeState = parseMusicUrlState(search);

  actions.clearSelectedCollection();

  switch (routeState.section) {
    case 'library':
      actions.setActiveSection('library');
      return;
    case 'settings':
      actions.setActiveSection('settings');
      return;
    case 'search':
      actions.setActiveSection('search');

      if (routeState.query) {
        await actions.submitSearch(routeState.query);
      }
      return;
    case 'rank':
    case 'playlist':
    case 'album':
    case 'artist':
      actions.setActiveSection(routeState.section);

      if (routeState.collectionId && routeState.collectionKind) {
        await actions.openCollection(
          routeState.collectionId,
          routeState.collectionKind
        );
      }
      return;
    case 'hot':
    case 'daily':
    case 'fm':
      actions.setActiveSection(routeState.section);
      return;
    default:
      actions.setActiveSection('home');
      return;
  }
}
