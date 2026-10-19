import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { isTauriRuntime } from "~/logic/update/update-checker";
import { basenameFromPath, pathToFile } from "./file-picker";
import {
  dropClientPosition,
  isDroppedImage,
  mediaDropError,
  type MediaDropTarget,
} from "./media-drop";

interface MediaFileDropOptions {
  onPreviewUpload: (files: File[]) => void | Promise<void>;
  onIconUpload: (files: File[]) => void | Promise<void>;
  onCoverUpload: (files: File[]) => void | Promise<void>;
  previewUploading?: boolean;
  iconUploading?: boolean;
  disabled?: boolean;
}

/** 仅媒体区接收文件；原生与浏览器事件分别处理，避免重复导入。 */
export function useMediaFileDrop(options: MediaFileDropOptions) {
  const rootRef = useRef<HTMLDivElement>(null);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const [activeTarget, setActiveTarget] = useState<MediaDropTarget | null>(null);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;
    const importing = new Set<MediaDropTarget>();

    const isBusy = (target: MediaDropTarget) =>
      importing.has(target) ||
      optionsRef.current.disabled ||
      (target === "previews" && optionsRef.current.previewUploading) ||
      (target === "icon" && optionsRef.current.iconUploading);

    const targetAt = (x: number, y: number): MediaDropTarget | null => {
      const element = document.elementFromPoint(x, y)?.closest<HTMLElement>(
        "[data-media-drop-target]",
      );
      if (!element || !rootRef.current?.contains(element)) return null;
      const target = element.dataset.mediaDropTarget;
      if (target !== "previews" && target !== "icon" && target !== "cover") return null;
      return isBusy(target) ? null : target;
    };

    const importFiles = async (
      target: MediaDropTarget,
      count: number,
      load: () => Promise<File[]>,
    ) => {
      setActiveTarget(null);
      if (disposed || isBusy(target)) return;
      const error = mediaDropError(target, count);
      if (error) {
        toast.error(error);
        return;
      }
      importing.add(target);
      try {
        const files = await load();
        if (disposed || files.length === 0) return;
        const current = optionsRef.current;
        if (current.disabled) return;
        const upload = target === "previews"
          ? current.onPreviewUpload
          : target === "icon" ? current.onIconUpload : current.onCoverUpload;
        await upload(files);
      } catch (error) {
        console.error("拖入图片导入失败", error);
        if (!disposed) toast.error("图片导入失败，请重试或点击选择文件。");
      } finally {
        importing.delete(target);
      }
    };

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
      unlisten?.();
    };
  }, []);

  return { rootRef, activeTarget };
}
