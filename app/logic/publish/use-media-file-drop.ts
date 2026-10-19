import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { isTauriRuntime } from "~/logic/update/update-checker";
import { basenameFromPath, pathToFile, pickFiles } from "./file-picker";
import {
  dropClientPosition,
  isDroppedImage,
  mediaDropError,
  type MediaDropTarget,
} from "./media-drop";
import { createMediaImportGate } from "./media-import";
import { PUBLISH_IMAGE_ACCEPT } from "./pre-publish-checks";

interface MediaFileDropOptions {
  onPreviewUpload: (files: File[]) => void | Promise<void>;
  onIconUpload: (files: File[]) => void | Promise<void>;
  onCoverUpload: (files: File[]) => void | Promise<void>;
  previewUploading?: boolean;
  iconUploading?: boolean;
  disabled?: boolean;
}

type ImportMediaFiles = (
  target: MediaDropTarget,
  count: number | undefined,
  load: () => Promise<File[]>,
) => Promise<void>;

const PICK_TITLES: Record<MediaDropTarget, string> = {
  previews: "选择预览图",
  icon: "选择图标",
  cover: "选择封面",
};

/** 媒体区的文件选择与拖放共用导入流程；原生与浏览器拖放分别处理。 */
export function useMediaFileDrop(options: MediaFileDropOptions) {
  const rootRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef(options);
  const importFilesRef = useRef<ImportMediaFiles | null>(null);
  optionsRef.current = options;
  const [activeTarget, setActiveTarget] = useState<MediaDropTarget | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    const imports = createMediaImportGate();

    const isUnavailable = (target: MediaDropTarget) =>
      optionsRef.current.disabled ||
      (target === "previews" && optionsRef.current.previewUploading) ||
      (target === "icon" && optionsRef.current.iconUploading);

    const isBusy = (target: MediaDropTarget) =>
      imports.isBusy(target) || isUnavailable(target);

    const targetAt = (x: number, y: number): MediaDropTarget | null => {
      const element = document.elementFromPoint(x, y)?.closest<HTMLElement>(
        "[data-media-drop-target]",
      );
      if (!element || !rootRef.current?.contains(element)) return null;
      const target = element.dataset.mediaDropTarget;
      if (target !== "previews" && target !== "icon" && target !== "cover") return null;
      return isBusy(target) ? null : target;
    };

    const importFiles: ImportMediaFiles = async (target, count, load) => {
      if (disposed || isBusy(target)) return;
      setActiveTarget(null);
      // 拖入时先检查数量，避免单图区域读入整批文件；选择器取消则不报错。
      if (count !== undefined) {
        const error = mediaDropError(target, count);
        if (error) {
          toast.error(error);
          return;
        }
      }
      await imports.run(target, async () => {
        try {
          const files = await load();
          if (disposed || files.length === 0 || isUnavailable(target)) return;
          const current = optionsRef.current;
          const uploads = {
            previews: current.onPreviewUpload,
            icon: current.onIconUpload,
            cover: current.onCoverUpload,
          };
          await uploads[target](files);
        } catch (error) {
          console.error("图片导入失败", error);
          if (!disposed) toast.error("图片导入失败，请重试或重新选择文件。");
        }
      });
    };
    importFilesRef.current = importFiles;

    if (isTauriRuntime()) {
      void getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (disposed) return;
        if (payload.type === "leave") {
          setActiveTarget(null);
          return;
        }
        const { x, y } = dropClientPosition(
          payload.position,
          window.devicePixelRatio,
          navigator.platform,
        );
        const target = targetAt(x, y);
        if (payload.type !== "drop") {
          setActiveTarget(target);
          return;
        }
        setActiveTarget(null);
        if (!target) return;
        const paths = payload.paths.filter((path) => isDroppedImage(path));
        void importFiles(target, paths.length, async () => {
          const files: File[] = [];
          for (const path of paths) {
            if (disposed) break;
            try {
              files.push(await pathToFile(path));
            } catch (error) {
              console.error("拖入文件读取失败", error);
              if (!disposed) toast.error(`无法读取图片：${basenameFromPath(path)}`);
            }
          }
          return files;
        });
      }).then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      }).catch((error: unknown) => {
        console.error("注册图片拖放失败", error);
      });
    } else {
      const hasFiles = (event: DragEvent) =>
        Array.from(event.dataTransfer?.types ?? []).includes("Files");
      const over = (event: DragEvent) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        const target = targetAt(event.clientX, event.clientY);
        if (event.dataTransfer) event.dataTransfer.dropEffect = target ? "copy" : "none";
        setActiveTarget(target);
      };
      const drop = (event: DragEvent) => {
        if (!hasFiles(event)) return;
        // 阻止浏览器在拖入区域以外打开文件，避免丢失发布草稿。
        event.preventDefault();
        setActiveTarget(null);
        const target = targetAt(event.clientX, event.clientY);
        if (!target) return;
        const files = Array.from(event.dataTransfer?.files ?? []).filter(
          (file) => isDroppedImage(file.name, file.type),
        );
        void importFiles(target, files.length, async () => files);
      };
      const leave = (event: DragEvent) => {
        if (!event.relatedTarget) setActiveTarget(null);
      };
      window.addEventListener("dragover", over);
      window.addEventListener("drop", drop);
      window.addEventListener("dragleave", leave);
      unlisten = () => {
        window.removeEventListener("dragover", over);
        window.removeEventListener("drop", drop);
        window.removeEventListener("dragleave", leave);
      };
    }

    return () => {
      disposed = true;
      importFilesRef.current = null;
      unlisten?.();
    };
  }, []);

  const pickMediaFiles = async (target: MediaDropTarget) => {
    await importFilesRef.current?.(target, undefined, () => pickFiles({
      multiple: target === "previews",
      accept: PUBLISH_IMAGE_ACCEPT,
      title: PICK_TITLES[target],
    }));
  };

  return { rootRef, activeTarget, pickMediaFiles };
}
