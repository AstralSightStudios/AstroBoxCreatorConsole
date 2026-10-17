import { useEffect, useRef, useState } from "react";
import {
  checkForBetaUpdate,
  isBetaBuildIgnored,
  isBetaBuildNotified,
  isTauriRuntime,
  markBetaBuildNotified,
  type BetaUpdatePrompt,
} from "~/logic/update/update-checker";
import { isBetaUpdateEnabled } from "~/config/betaUpdate";
import BetaUpdateAvailableDialog from "./BetaUpdateAvailableDialog";

// 启动后延迟检查，避免与首屏加载抢网络
const CHECK_DELAY_MS = 5_000;

/** 应用启动时静默检查一次 GitHub Actions 最新 artifact，有新版且未被忽略时弹窗提示。 */
export default function AutoBetaUpdateChecker() {
  const [prompt, setPrompt] = useState<BetaUpdatePrompt | null>(null);
  const [open, setOpen] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          if (!isTauriRuntime() || !isBetaUpdateEnabled()) return;

          const result = await checkForBetaUpdate();
          if (cancelled || result.status !== "available") return;

          const { info, comparison } = result.prompt;
          if (isBetaBuildIgnored(info)) return;

          // 无法比较（本地构建、diverged 等）时，同一个构建只提示一次；
          // 能确认更新的构建则持续提示，直到用户安装或忽略。
          if (comparison === "unknown") {
            if (isBetaBuildNotified(info)) return;
            markBetaBuildNotified(info);
          }

          setPrompt(result.prompt);
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
    <BetaUpdateAvailableDialog
      prompt={prompt}
      open={open}
      onOpenChange={setOpen}
    />
  );
}
