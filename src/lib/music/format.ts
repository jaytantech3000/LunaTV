import type { MusicRepeatMode, MusicSectionTab } from './types';

export function formatDurationMs(durationMs?: number | null) {
  if (!durationMs || !Number.isFinite(durationMs) || durationMs <= 0) {
    return '--:--';
  }

  return formatDurationSeconds(durationMs / 1000);
}

export function formatDurationSeconds(durationSec?: number | null) {
  if (!durationSec || !Number.isFinite(durationSec) || durationSec < 0) {
    return '0:00';
  }

  const wholeSeconds = Math.floor(durationSec);
  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function getMusicTabLabel(tab: MusicSectionTab) {
  switch (tab) {
    case 'home':
      return '首页';
    case 'rank':
      return '榜单';
    case 'hot':
      return '热门';
    case 'playlist':
      return '歌单';
    case 'album':
      return '专辑';
    case 'library':
      return '曲库';
    case 'search':
      return '搜索';
    default:
      return tab;
  }
}

export function getRepeatModeLabel(repeatMode: MusicRepeatMode) {
  switch (repeatMode) {
    case 'off':
      return '关闭循环';
    case 'one':
      return '单曲循环';
    case 'all':
    default:
      return '列表循环';
  }
}
