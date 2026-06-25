import { downloadManager } from './manager';

export type StartEpisodeDownloadParams = Parameters<
  typeof downloadManager.startEpisodeDownload
>[0];

export type StartBatchEpisodeDownloadsParams = Parameters<
  typeof downloadManager.startBatchEpisodeDownloads
>[0];

export type RestartBatchEpisodeDownloadsParams = Parameters<
  typeof downloadManager.restartBatchEpisodeDownloads
>[0];

export type DownloadTaskId = Parameters<typeof downloadManager.pauseTask>[0];
export type DownloadContentId = Parameters<
  typeof downloadManager.deleteEpisode
>[0];
export type DownloadEpisodeIndex = Parameters<
  typeof downloadManager.deleteEpisode
>[1];

export interface DownloadClient {
  startEpisodeDownload(
    params: StartEpisodeDownloadParams
  ): ReturnType<typeof downloadManager.startEpisodeDownload>;
  startBatchEpisodeDownloads(
    params: StartBatchEpisodeDownloadsParams
  ): ReturnType<typeof downloadManager.startBatchEpisodeDownloads>;
  restartBatchEpisodeDownloads(
    params: RestartBatchEpisodeDownloadsParams
  ): ReturnType<typeof downloadManager.restartBatchEpisodeDownloads>;
  pauseTask(
    taskId: DownloadTaskId
  ): ReturnType<typeof downloadManager.pauseTask>;
  resumeTask(
    taskId: DownloadTaskId
  ): ReturnType<typeof downloadManager.resumeTask>;
  cancelTask(
    taskId: DownloadTaskId
  ): ReturnType<typeof downloadManager.cancelTask>;
  pauseAllTasks(): ReturnType<typeof downloadManager.pauseAllTasks>;
  resumeAllTasks(): ReturnType<typeof downloadManager.resumeAllTasks>;
  cancelAllTasks(): ReturnType<typeof downloadManager.cancelAllTasks>;
  deleteEpisode(
    contentId: DownloadContentId,
    episodeIndex: DownloadEpisodeIndex
  ): ReturnType<typeof downloadManager.deleteEpisode>;
  refreshScheduling(): ReturnType<typeof downloadManager.refreshScheduling>;
  abortAll(): ReturnType<typeof downloadManager.abortAll>;
}

export const downloadClient: DownloadClient = {
  startEpisodeDownload(params) {
    return downloadManager.startEpisodeDownload(params);
  },
  startBatchEpisodeDownloads(params) {
    return downloadManager.startBatchEpisodeDownloads(params);
  },
  restartBatchEpisodeDownloads(params) {
    return downloadManager.restartBatchEpisodeDownloads(params);
  },
  pauseTask(taskId) {
    return downloadManager.pauseTask(taskId);
  },
  resumeTask(taskId) {
    return downloadManager.resumeTask(taskId);
  },
  cancelTask(taskId) {
    return downloadManager.cancelTask(taskId);
  },
  pauseAllTasks() {
    return downloadManager.pauseAllTasks();
  },
  resumeAllTasks() {
    return downloadManager.resumeAllTasks();
  },
  cancelAllTasks() {
    return downloadManager.cancelAllTasks();
  },
  deleteEpisode(contentId, episodeIndex) {
    return downloadManager.deleteEpisode(contentId, episodeIndex);
  },
  refreshScheduling() {
    return downloadManager.refreshScheduling();
  },
  abortAll() {
    return downloadManager.abortAll();
  },
};
