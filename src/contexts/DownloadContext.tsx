'use client';

import React, { createContext, useCallback, useContext,useState } from 'react';

import { M3U8Downloader, M3U8DownloadTask } from '@/lib/m3u8-downloader';

interface DownloadContextType {
  downloader: M3U8Downloader;
  tasks: M3U8DownloadTask[];
  addDownloadTask: (url: string, title: string, type?: 'TS' | 'MP4') => Promise<void>;
  startTask: (taskId: string) => void;
  pauseTask: (taskId: string) => void;
  cancelTask: (taskId: string) => void;
  retryFailedSegments: (taskId: string) => void;
  getProgress: (taskId: string) => number;
  downloadingCount: number;
  showDownloadPanel: boolean;
  setShowDownloadPanel: (show: boolean) => void;
}

const DownloadContext = createContext<DownloadContextType | undefined>(undefined);

export function DownloadProvider({ children }: { children: React.ReactNode }) {
  const [tasks, setTasks] = useState<M3U8DownloadTask[]>([]);
  const [showDownloadPanel, setShowDownloadPanel] = useState(false);
  const [startingTaskIds, setStartingTaskIds] = useState<Set<string>>(new Set());

  // 自动启动下一个等待的任务
  const startNextPendingTask = useCallback((currentDownloader: M3U8Downloader) => {
    // 从localStorage读取最大同时下载限制，默认6个
    const maxConcurrentDownloads = typeof window !== 'undefined'
      ? Number(localStorage.getItem('maxConcurrentDownloads') || 6)
      : 6;

    const allTasks = currentDownloader.getAllTasks();
    const downloadingCount = allTasks.filter(t => t.status === 'downloading').length;

    // 如果当前下载数量小于限制，启动下一个ready任务
    if (downloadingCount < maxConcurrentDownloads) {
      const readyTask = allTasks.find(t => t.status === 'ready');
      if (readyTask) {
        currentDownloader.startTask(readyTask.id);
        setTasks(currentDownloader.getAllTasks());
      }
    }
  }, []);

  const [downloader] = useState(() => new M3U8Downloader({
    onProgress: (task) => {
      setTasks(downloader.getAllTasks());
    },
    onComplete: (task) => {
      setTasks(downloader.getAllTasks());
      // 任务完成后，尝试启动下一个等待的任务
      startNextPendingTask(downloader);
    },
    onError: (task, error) => {
      console.error('下载错误:', error);
      setTasks(downloader.getAllTasks());
      // 任务出错后，尝试启动下一个等待的任务
      startNextPendingTask(downloader);
    },
  }));

  const addDownloadTask = useCallback(async (url: string, title: string, type: 'TS' | 'MP4' = 'TS') => {
    try {
      const taskId = await downloader.createTask(url, title, type);

      // 读取下载模式设置
      const downloadMode = typeof window !== 'undefined'
        ? (localStorage.getItem('downloadMode') as 'browser' | 'filesystem') || 'browser'
        : 'browser';

      // 如果是 filesystem 模式，从 IndexedDB 读取目录句柄
      if (downloadMode === 'filesystem' && typeof window !== 'undefined') {
        try {
          const dbName = 'MoonTVPlus';
          const storeName = 'dirHandles';
          const request = indexedDB.open(dbName, 1);

          request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(storeName)) {
              db.createObjectStore(storeName);
            }
          };

          request.onsuccess = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            // 检查 object store 是否存在
            if (!db.objectStoreNames.contains(storeName)) {
              console.warn('Object store 不存在，跳过读取');
              db.close();
              return;
            }

            const transaction = db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const getRequest = store.get('downloadDir');

            getRequest.onsuccess = () => {
              const dirHandle = getRequest.result as FileSystemDirectoryHandle | undefined;
              if (dirHandle) {
                // 更新任务的下载模式和目录句柄
                const task = downloader.getTask(taskId);
                if (task) {
                  task.downloadMode = 'filesystem';
                  task.filesystemDirHandle = dirHandle;
                }
              } else {
                console.warn('未找到保存目录，使用浏览器下载模式');
              }
            };
          };
        } catch (error) {
          console.error('读取目录句柄失败:', error);
        }
      }

      setTasks(downloader.getAllTasks());

      // 从localStorage读取最大同时下载限制，默认6个
      const maxConcurrentDownloads = typeof window !== 'undefined'
        ? Number(localStorage.getItem('maxConcurrentDownloads') || 6)
        : 6;

      // 检查当前正在下载的任务数量（包括正在启动的）
      setStartingTaskIds(prev => {
        const allTasks = downloader.getAllTasks();
        const currentDownloadingCount = allTasks.filter(t => t.status === 'downloading').length;
        const totalActiveCount = currentDownloadingCount + prev.size;

        // 如果未超过限制，标记为正在启动并启动任务
        if (totalActiveCount < maxConcurrentDownloads) {
          const newSet = new Set(prev);
          newSet.add(taskId);

          // 异步启动任务
          downloader.startTask(taskId).then(() => {
            setTasks(downloader.getAllTasks());
            // 启动完成后，从正在启动列表中移除
            setStartingTaskIds(current => {
              const updated = new Set(current);
              updated.delete(taskId);
              return updated;
            });
          });

          return newSet;
        }

        // 否则任务保持ready状态，等待其他任务完成后自动启动
        return prev;
      });
    } catch (error) {
      console.error('添加下载任务失败:', error);
      throw error;
    }
  }, [downloader]);

  const startTask = useCallback((taskId: string) => {
    // 从localStorage读取最大同时下载限制，默认6个
    const maxConcurrentDownloads = typeof window !== 'undefined'
      ? Number(localStorage.getItem('maxConcurrentDownloads') || 6)
      : 6;

    const currentDownloadingCount = downloader.getAllTasks().filter(t => t.status === 'downloading').length;

    // 如果未超过限制，启动任务
    if (currentDownloadingCount < maxConcurrentDownloads) {
      downloader.startTask(taskId);
      setTasks(downloader.getAllTasks());
    }
  }, [downloader]);

  const pauseTask = useCallback((taskId: string) => {
    downloader.pauseTask(taskId);
    setTasks(downloader.getAllTasks());
    // 暂停任务后，尝试启动下一个等待的任务
    startNextPendingTask(downloader);
  }, [downloader, startNextPendingTask]);

  const cancelTask = useCallback((taskId: string) => {
    downloader.cancelTask(taskId);
    setTasks(downloader.getAllTasks());
    // 取消任务后，尝试启动下一个等待的任务
    startNextPendingTask(downloader);
  }, [downloader, startNextPendingTask]);

  const retryFailedSegments = useCallback((taskId: string) => {
    downloader.retryFailedSegments(taskId);
    setTasks(downloader.getAllTasks());
  }, [downloader]);

  const getProgress = useCallback((taskId: string) => {
    return downloader.getProgress(taskId);
  }, [downloader]);

  const downloadingCount = tasks.filter(t => t.status === 'downloading').length;

  return (
    <DownloadContext.Provider
      value={{
        downloader,
        tasks,
        addDownloadTask,
        startTask,
        pauseTask,
        cancelTask,
        retryFailedSegments,
        getProgress,
        downloadingCount,
        showDownloadPanel,
        setShowDownloadPanel,
      }}
    >
      {children}
    </DownloadContext.Provider>
  );
}

export function useDownload() {
  const context = useContext(DownloadContext);
  if (context === undefined) {
    throw new Error('useDownload must be used within a DownloadProvider');
  }
  return context;
}
