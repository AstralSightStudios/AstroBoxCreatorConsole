import type { MediaDropTarget } from "./media-drop";

interface MediaImportGate {
  isBusy: (target: MediaDropTarget) => boolean;
  run: (target: MediaDropTarget, task: () => Promise<void>) => Promise<void>;
}

/** 同一媒体区域从选文件/读文件到处理完成共用一把锁，不阻塞其他区域。 */
export function createMediaImportGate(): MediaImportGate {
  const importing = new Set<MediaDropTarget>();

  return {
    isBusy: (target) => importing.has(target),
    async run(target, task) {
      if (importing.has(target)) return;
      importing.add(target);
      try {
        await task();
      } finally {
        importing.delete(target);
      }
    },
  };
}
