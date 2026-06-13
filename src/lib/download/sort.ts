import { DownloadTask } from './types';

export function sortActiveDownloadTasks(tasks: DownloadTask[]): DownloadTask[] {
  return [...tasks].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }

    if (left.title !== right.title) {
      return left.title.localeCompare(right.title, 'zh-CN');
    }

    if (left.episodeIndex !== right.episodeIndex) {
      return left.episodeIndex - right.episodeIndex;
    }

    return left.id.localeCompare(right.id, 'zh-CN');
  });
}

export function sortActiveDownloadTaskGroups<
  T extends {
    createdAt: number;
    title: string;
    contentId: string;
  }
>(groups: T[]): T[] {
  return [...groups].sort((left, right) => {
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }

    if (left.title !== right.title) {
      return left.title.localeCompare(right.title, 'zh-CN');
    }

    return left.contentId.localeCompare(right.contentId, 'zh-CN');
  });
}
