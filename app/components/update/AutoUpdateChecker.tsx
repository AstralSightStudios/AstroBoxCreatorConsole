import { useEffect, useRef, useState } from "react";
import {
  checkForUpdate,
  isIgnored,
  isTauriRuntime,
  isUpdateCheckDisabled,
  type UpdateInfo,
} from "~/logic/update/update-checker";
import UpdateAvailableDialog from "./UpdateAvailableDialog";

// 启动后延迟检查，避免与首屏加载抢网络
const CHECK_DELAY_MS = 3_000;

/** 应用启动时静默检查一次 GitHub 最新 release，有新版且未被忽略时弹窗提示。 */
export default function AutoUpdateChecker() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [open, setOpen] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          if (!isTauriRuntime() || isUpdateCheckDisabled()) return;
          const { getVersion } = await import("@tauri-apps/api/app");
          const version = await getVersion();
          if (cancelled) return;
          const update = await checkForUpdate(version);
          if (cancelled || !update || isIgnored(update.tagName)) return;
          setInfo(update);
          setOpen(true);
        } catch {
          // 更新检测失败不打扰用户
        }
      })();
    }, CHECK_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return (
    <UpdateAvailableDialog
      info={info}
      open={open}
      onOpenChange={setOpen}
    />
  );
}
