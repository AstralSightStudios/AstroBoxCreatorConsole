import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button, Callout, Spinner, Switch } from "@radix-ui/themes";
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ArrowUpRightIcon,
  CheckIcon,
  DotsSixVerticalIcon,
  DownloadSimpleIcon,
  FolderOpenIcon,
  ShareNetworkIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import { appLogDir } from "@tauri-apps/api/path";
import { toast } from "sonner";
import {
  getLogLevel,
  setLogLevel,
  type LogLevel,
} from "~/logic/logging";
import { reportFailure, reportSuccess } from "~/logic/logging/feedback";
import {
  REPO_ENVS,
  saveRepoEnvId,
  useRepoEnvId,
  type RepoEnvId,
} from "~/config/repoEnv";
import {
  PUBLISH_MODES,
  saveReviewMode,
  useReviewMode,
  type PublishMode,
} from "~/config/publishMode";
import {
  LOGIN_METHODS,
  saveLoginMethod,
  useLoginMethod,
  type AstroboxLoginMethod,
} from "~/config/loginMethod";
import {
  saveUiScale,
  UI_SCALE_OPTIONS,
  useUiScale,
} from "~/config/uiScale";
import {
  resetNavItemPreferences,
  saveNavAccountCollapse,
  saveNavItemOrder,
  saveNavItemVisibility,
  useNavAccountCollapse,
  useNavItemPreferences,
  type NavItemPreferences,
} from "~/config/nav";
import UpdateAvailableDialog from "~/components/update/UpdateAvailableDialog";
import AfdianAccountSection from "~/components/settings/AfdianAccountSection";
import AfdianAiAutoReplySection from "~/components/settings/AfdianAiAutoReplySection";
import {
  checkForUpdate,
  isTauriRuntime,
  useUpdateCheckDisabled,
  type UpdateInfo,
} from "~/logic/update/update-checker";
import Page from "~/layout/page";
import {
  hasRequiredNavRole,
  NAV_PRIMARY_ACTION,
  NAV_SECTIONS,
  sortNavItems,
  type NavLinkConfig,
  type NavSectionConfig,
} from "~/layout/nav-config";
import { useAccountState } from "~/logic/account/store";
import { SectionCard } from "./resource/publish/components/shared";

const EULA_URL = "https://astrobox.online/eula.html";
const PRIVACY_URL = "https://astrobox.online/privacy.html";
const WEBSITE_URL = "https://astrobox.online";

const NAV_PREFERENCE_SECTIONS: NavSectionConfig[] = [
  ...NAV_SECTIONS,
  {
    id: "primary-action",
    title: "快捷操作",
    items: [NAV_PRIMARY_ACTION],
  },
];

const LOG_LEVEL_OPTIONS: LogLevel[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
];

interface LogArchivePayload {
  fileName: string;
  mimeType: string;
  dataBase64: string;
}

function detectPlatformFromUserAgent(): string | null {
  const ua = `${navigator.userAgent} ${navigator.platform}`;
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPad|iPod|iOS/i.test(ua)) return "ios";
  return null;
}

function decodeBase64ToUint8Array(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function isShareCanceled(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }
  return typeof error === "string" && error.toLowerCase().includes("abort");
}

/** 日志与诊断：级别调节、打开日志目录、导出日志包。 */
function LogsSection() {
  const [level, setLevelState] = useState<LogLevel>(getLogLevel());
  const [exporting, setExporting] = useState(false);
  const [platform, setPlatform] = useState<string | null>(() =>
    isTauriRuntime() ? detectPlatformFromUserAgent() : "web",
  );
  const isNativeMobile = platform === "android" || platform === "ios";

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let alive = true;
    invoke<string>("runtime_platform")
      .then((value) => {
        if (alive) setPlatform(value);
      })
      .catch(() => {
        /* 平台探测失败时沿用 UA 初值 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleSelectLevel = (next: LogLevel) => {
    if (next === level) return;
    setLogLevel(next);
    setLevelState(next);
    toast.success(`日志级别已切换为 ${next.toUpperCase()}`);
  };

  const handleOpenLogDir = async () => {
    if (!isTauriRuntime) return;
    try {
      await openPath(await appLogDir());
      reportSuccess("settings/logs", "已打开日志文件夹");
    } catch (error) {
      reportFailure("settings/logs", "无法打开日志文件夹", error);
    }
  };

  const handleExportArchive = async () => {
    setExporting(true);
    try {
      const stamp = new Date()
        .toISOString()
        .replace(/[:T]/g, "-")
        .slice(0, 19);
      const targetPath = await save({
        title: "导出日志包（含构建与设备信息）",
        defaultPath: `astroboxcc-logs-${stamp}.tar.gz`,
        filters: [{ name: "日志包", extensions: ["gz"] }],
      });
      if (!targetPath) return;
      const clientDiagnostics = buildClientDiagnostics();
      const result = await invoke<{
        savedPath: string;
        fileSize: number;
      }>("export_logs_archive", { targetPath, clientDiagnostics });
      reportSuccess(
        "settings/logs",
        `日志包已保存（${(result.fileSize / 1024).toFixed(1)} KB）`,
        { data: result },
      );
    } catch (error) {
      reportFailure("settings/logs", "导出日志包失败", error);
    } finally {
      setExporting(false);
    }
  };

  const shareViaWebShareApi = async (archive: LogArchivePayload) => {
    if (typeof navigator.share !== "function") {
      throw new Error("当前环境不支持系统分享");
    }
    const shareFile = new File(
      [decodeBase64ToUint8Array(archive.dataBase64)],
      archive.fileName,
      { type: archive.mimeType },
    );
    const shareData: ShareData = {
      files: [shareFile],
      title: archive.fileName,
    };
    if (
      typeof navigator.canShare === "function" &&
      !navigator.canShare(shareData)
    ) {
      throw new Error("当前环境不支持分享文件");
    }
    await navigator.share(shareData);
  };

  const handleShareArchive = async () => {
    setExporting(true);
    try {
      const archive = await invoke<LogArchivePayload>("prepare_logs_archive");
      if (platform === "android") {
        await invoke("share_logs_archive", { payload: archive });
        reportSuccess("settings/logs", "已通过系统分享导出日志包");
      } else {
        await shareViaWebShareApi(archive);
        reportSuccess("settings/logs", "已通过系统分享导出日志包");
      }
    } catch (error) {
      if (isShareCanceled(error)) return;
      reportFailure("settings/logs", "分享日志包失败", error);
    } finally {
      setExporting(false);
    }
  };

  function buildClientDiagnostics() {
    const nav = navigator as Navigator & {
      deviceMemory?: number;
      connection?: {
        effectiveType?: string;
        downlink?: number;
        rtt?: number;
        saveData?: boolean;
      };
    };
    const screenInfo = window.screen
      ? {
          width: window.screen.width,
          height: window.screen.height,
          availWidth: window.screen.availWidth,
          availHeight: window.screen.availHeight,
          colorDepth: window.screen.colorDepth,
          pixelRatio: window.devicePixelRatio || 1,
        }
      : undefined;
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform || undefined,
      language: navigator.language || undefined,
      languages: navigator.languages?.length ? Array.from(navigator.languages) : undefined,
      timezone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || undefined,
      screen: screenInfo,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      hardwareConcurrency: navigator.hardwareConcurrency || undefined,
      deviceMemory: nav.deviceMemory,
      maxTouchPoints: navigator.maxTouchPoints,
      online: navigator.onLine,
      connection: nav.connection
        ? {
            effectiveType: nav.connection.effectiveType,
            downlink: nav.connection.downlink,
            rtt: nav.connection.rtt,
            saveData: nav.connection.saveData,
          }
        : undefined,
      tauri: isTauriRuntime(),
      probeUrls: [
        "https://api.github.com",
        "https://github.com",
        "https://astrobox-api.astralsight.space",
        "https://cas.astralsight.space",
        "https://astrobox.online",
      ],
    };
  }

  return (
    <SectionCard
      title="日志"
      description="运行日志与资源发布/编辑流程记录，用于问题排查；敏感密钥已自动脱敏"
    >
      <div className="flex flex-col gap-3 px-2 pb-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-white/50">全局日志级别</span>
          <div className="flex overflow-hidden rounded-lg border border-white/[0.08]">
            {LOG_LEVEL_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => handleSelectLevel(option)}
                className={`px-3 py-1.5 font-mono-sarasa text-[11.5px] uppercase transition ${
                  option === level
                    ? "bg-emerald-400/[0.15] text-emerald-300"
                    : "text-white/55 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {isNativeMobile ? (
            <Button
              variant="soft"
              size="2"
              disabled={exporting}
              onClick={() => void handleShareArchive()}
            >
              <ShareNetworkIcon size={15} />
              {exporting ? "正在打包..." : "分享日志包 (.tar.gz)"}
            </Button>
          ) : (
            <>
              <Button
                variant="soft"
                size="2"
                onClick={() => void handleOpenLogDir()}
              >
                <FolderOpenIcon size={15} />
                打开日志文件夹
              </Button>
              <Button
                variant="soft"
                size="2"
                disabled={exporting}
                onClick={() => void handleExportArchive()}
              >
                <DownloadSimpleIcon size={15} />
                {exporting ? "正在打包..." : "拉取日志包 (.tar.gz)"}
              </Button>
            </>
          )}
        </div>
        <p className="text-[11.5px] leading-snug text-white/40">
          {isNativeMobile ? (
            <>
              手机系统不允许直接打开应用日志目录，请通过系统分享导出日志包
              （可选择「存储到文件」等保存位置）后再附上。日志包含最近运行日志与资源发布/编辑会话记录。
              全局日志保留 7 天，资源会话日志保留 30 天。
            </>
          ) : (
            <>
              日志包内含最近运行日志、资源发布/编辑会话记录以及构建与设备诊断信息，
              可在反馈问题时附上。全局日志保留 7 天，资源会话日志保留 30 天。
            </>
          )}
        </p>
      </div>
    </SectionCard>
  );
}

function openExternal(url: string) {
  openUrl(url).catch(() =>
    window.open(url, "_blank", "noopener,noreferrer"),
  );
}

/** 设置分组中的单选项 */
function OptionCard({
  selected,
  pending,
  onClick,
  title,
  description,
  meta,
  disabled,
}: {
  selected: boolean;
  pending?: boolean;
  onClick: () => void;
  title: string;
  description: string;
  meta?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      aria-pressed={selected}
      className={`group flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition ${
        disabled
          ? "cursor-not-allowed border-white/[0.06] bg-white/[0.01] opacity-45"
          : selected
            ? "border-emerald-400/40 bg-emerald-400/[0.07]"
            : pending
              ? "border-amber-300/45 bg-amber-300/[0.07]"
              : "border-white/[0.08] bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.045]"
      }`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[13.5px] font-semibold text-white">
          {title}
        </span>
        <p className="text-[12px] leading-snug text-white/50">{description}</p>
        {meta && (
          <p className="mt-0.5 truncate font-mono-sarasa text-[11px] text-white/40">
            {meta}
          </p>
        )}
      </div>
      <span className="mt-0.5 shrink-0">
        {selected ? (
          <span className="flex size-[18px] items-center justify-center rounded-full bg-emerald-400 text-black">
            <CheckIcon size={12} weight="bold" />
          </span>
        ) : pending ? (
          <span className="block size-[18px] rounded-full border-2 border-amber-300/70" />
        ) : (
          <span className="block size-[18px] rounded-full border border-white/20 transition group-hover:border-white/45" />
        )}
      </span>
    </button>
  );
}

/** 打开外部链接的设置行 */
function LinkRow({
  title,
  subtitle,
  onClick,
  last,
}: {
  title: string;
  subtitle: string;
  onClick: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-3 px-2 py-3 text-left hover:bg-white/[0.035] ${
        last ? "" : "border-b border-white/[0.06]"
      }`}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13.5px] font-medium text-white">{title}</span>
        <span className="truncate text-[12px] text-white/45">{subtitle}</span>
      </div>
      <ArrowUpRightIcon
        size={15}
        className="shrink-0 text-white/30 transition group-hover:text-white/65"
      />
    </button>
  );
}

/** 切换布尔设置的设置行 */
function ToggleRow({
  title,
  subtitle,
  checked,
  onChange,
  last,
}: {
  title: string;
  subtitle: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  last?: boolean;
}) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onChange(!checked);
        }
      }}
      className={`flex w-full cursor-pointer items-center gap-3 px-2 py-3 select-none hover:bg-white/[0.035] ${
        last ? "" : "border-b border-white/[0.06]"
      }`}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[13.5px] font-medium text-white">{title}</span>
        <span className="truncate text-[12px] text-white/45">{subtitle}</span>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        onClick={(event) => event.stopPropagation()}
      />
    </div>
  );
}

interface NavDragState {
  sectionId: string;
  itemId: string;
  items: NavLinkConfig[];
}

function NavItemSettingsRow({
  item,
  visible,
  draggable,
  dragging,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
  onKeyboardMove,
  last,
}: {
  item: NavLinkConfig;
  visible: boolean;
  draggable: boolean;
  dragging: boolean;
  onDragStart: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragEnd: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onDragCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onKeyboardMove: (direction: -1 | 1) => void;
  last: boolean;
}) {
  const IconComponent = item.icon;
  const isAlwaysVisible = Boolean(item.alwaysVisible);

  return (
    <div
      data-nav-settings-item={item.id}
      className={`flex items-center gap-2 px-2 py-2.5 transition-colors ${dragging ? "bg-white/[0.08]" : ""} ${last ? "" : "border-b border-white/[0.06]"}`}
    >
      <button
        type="button"
        disabled={!draggable}
        aria-label={`拖动排序${item.label}`}
        aria-pressed={dragging}
        className="flex size-8 shrink-0 touch-none items-center justify-center rounded-md text-white/35 outline-none transition-colors enabled:cursor-grab enabled:hover:bg-white/[0.06] enabled:hover:text-white/70 enabled:active:cursor-grabbing disabled:opacity-25"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragCancel}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            onKeyboardMove(-1);
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            onKeyboardMove(1);
          }
        }}
      >
        <DotsSixVerticalIcon size={18} weight="bold" aria-hidden="true" />
      </button>
      <IconComponent
        size={18}
        weight="regular"
        className="shrink-0 text-white/60"
        aria-hidden="true"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13.5px] font-medium text-white">
          {item.label}
        </span>
        {isAlwaysVisible ? (
          <span className="text-[11px] text-white/40">始终显示</span>
        ) : item.fixedPosition ? (
          <span className="text-[11px] text-white/40">固定在导航底部</span>
        ) : null}
      </div>
      <Switch
        checked={isAlwaysVisible || visible}
        disabled={isAlwaysVisible}
        aria-label={`显示${item.label}`}
        onCheckedChange={(checked) =>
          saveNavItemVisibility(item.id, checked)
        }
      />
    </div>
  );
}

function NavigationItemsSettings({
  preferences,
  roles,
}: {
  preferences: NavItemPreferences;
  roles: readonly string[];
}) {
  const [dragState, setDragState] = useState<NavDragState | null>(null);
  const dragStateRef = useRef<NavDragState | null>(null);
  const availableSections = NAV_PREFERENCE_SECTIONS.map((section) => ({
    section,
    items: sortNavItems(section.items, preferences.itemOrder).filter((item) =>
      hasRequiredNavRole(item, roles),
    ),
  })).filter(({ items }) => items.length > 0);

  const updateDragState = (nextState: NavDragState | null) => {
    dragStateRef.current = nextState;
    setDragState(nextState);
  };

  const saveSectionOrder = (
    section: NavSectionConfig,
    orderedAvailableItems: readonly NavLinkConfig[],
  ) => {
    const availableIds = new Set(
      orderedAvailableItems.map((item) => item.id),
    );
    let availableIndex = 0;
    const orderedSectionItems = sortNavItems(
      section.items,
      preferences.itemOrder,
    ).map((item) =>
      availableIds.has(item.id)
        ? orderedAvailableItems[availableIndex++]
        : item,
    );

    const itemOrder = NAV_SECTIONS.flatMap((currentSection) => {
      const items =
        currentSection.id === section.id
          ? orderedSectionItems
          : sortNavItems(currentSection.items, preferences.itemOrder);
      return items.map((item) => item.id);
    });
    saveNavItemOrder(itemOrder);
  };

  const handleDragStart = (
    section: NavSectionConfig,
    items: readonly NavLinkConfig[],
    itemId: string,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    updateDragState({ sectionId: section.id, itemId, items: [...items] });
  };

  const handleDragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = dragStateRef.current;
    if (!current) return;

    const target = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-nav-settings-item]");
    const targetItemId = target?.dataset.navSettingsItem;
    if (!targetItemId || targetItemId === current.itemId) return;

    const currentIndex = current.items.findIndex(
      (item) => item.id === current.itemId,
    );
    const targetIndex = current.items.findIndex(
      (item) => item.id === targetItemId,
    );
    if (currentIndex < 0 || targetIndex < 0) return;

    const items = [...current.items];
    const [draggedItem] = items.splice(currentIndex, 1);
    items.splice(targetIndex, 0, draggedItem);
    updateDragState({ ...current, items });
  };

  const handleDragEnd = (
    section: NavSectionConfig,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const current = dragStateRef.current;
    if (current?.sectionId === section.id) {
      saveSectionOrder(section, current.items);
    }
    updateDragState(null);
  };

  const handleDragCancel = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    updateDragState(null);
  };

  const handleKeyboardMove = (
    section: NavSectionConfig,
    items: readonly NavLinkConfig[],
    itemId: string,
    direction: -1 | 1,
  ) => {
    const currentIndex = items.findIndex((item) => item.id === itemId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= items.length) {
      return;
    }

    const nextItems = [...items];
    [nextItems[currentIndex], nextItems[targetIndex]] = [
      nextItems[targetIndex],
      nextItems[currentIndex],
    ];
    saveSectionOrder(section, nextItems);
  };

  return (
    <div className="flex flex-col gap-3 px-2 pb-1">
      {availableSections.map(({ section, items }) => {
        const displayedItems =
          dragState?.sectionId === section.id ? dragState.items : items;
        const draggable =
          displayedItems.length > 1 && !displayedItems[0]?.fixedPosition;

        return (
          <div
            key={section.id}
            data-nav-settings-section={section.id}
            className="flex flex-col gap-1.5"
          >
            <p className="px-1 text-[12px] font-medium text-white/50">
              {section.title ?? "常用"}
            </p>
            <div className="overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.02]">
              {displayedItems.map((item, index) => (
                <NavItemSettingsRow
                  key={item.id}
                  item={item}
                  visible={
                    item.alwaysVisible ||
                    !preferences.hiddenItemIds.includes(item.id)
                  }
                  draggable={draggable}
                  dragging={dragState?.itemId === item.id}
                  onDragStart={(event) =>
                    handleDragStart(section, displayedItems, item.id, event)
                  }
                  onDragMove={handleDragMove}
                  onDragEnd={(event) => handleDragEnd(section, event)}
                  onDragCancel={handleDragCancel}
                  onKeyboardMove={(direction) =>
                    handleKeyboardMove(
                      section,
                      displayedItems,
                      item.id,
                      direction,
                    )
                  }
                  last={index === displayedItems.length - 1}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Settings() {
  const accountState = useAccountState();
  const currentEnv = useRepoEnvId();
  const currentReviewMode = useReviewMode();
  const [pending, setPending] = useState<RepoEnvId | null>(null);
  const currentLoginMethod = useLoginMethod();
  const currentUiScale = useUiScale();
  const selectedUiScaleOption =
    UI_SCALE_OPTIONS.find((option) => option.factor === currentUiScale) ??
    UI_SCALE_OPTIONS.find((option) => option.factor === 1)!;
  const collapseAccountOnScroll = useNavAccountCollapse();
  const navItemPreferences = useNavItemPreferences();
  const navRoles = accountState.astrobox?.roles ?? [];
  const hasCustomNavItems =
    navItemPreferences.hiddenItemIds.length > 0 ||
    navItemPreferences.itemOrder.length > 0;
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [autoCheckDisabled, setAutoCheckDisabled] = useUpdateCheckDisabled();
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  useEffect(() => {
    let alive = true;
    import("@tauri-apps/api/app")
      .then(({ getVersion }) => getVersion())
      .then((v) => {
        if (alive) setAppVersion(v);
      })
      .catch(() => {
        /* 非 Tauri 环境无法读取应用版本 */
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleSelectLoginMethod = (id: AstroboxLoginMethod) => {
    if (id === currentLoginMethod) return;
    saveLoginMethod(id);
    toast.success(`已切换到 ${LOGIN_METHODS[id].label}`);
  };

  const handleSelectUiScale = (factor: number) => {
    if (factor === currentUiScale) return;
    const option = UI_SCALE_OPTIONS.find((item) => item.factor === factor);
    saveUiScale(factor);
    toast.success(
      option ? `界面显示比例已调整为 ${option.label}` : "界面显示比例已更新",
    );
  };

  const handleSelect = (id: RepoEnvId) => {
    if (id === currentEnv) return;
    setPending(id);
  };

  const handleSelectReviewMode = (id: PublishMode) => {
    if (id === currentReviewMode) return;
    saveReviewMode(id);
    toast.success(`审核已切换到 ${PUBLISH_MODES[id].label}`);
  };

  const confirmSwitch = () => {
    if (!pending) return;
    saveRepoEnvId(pending);
    toast.success(`已切换到 ${REPO_ENVS[pending].label}`);
    setPending(null);
  };

  const reload = () => {
    window.location.reload();
  };

  const handleCheckUpdate = async () => {
    if (checkingUpdate) return;
    if (!isTauriRuntime() && !appVersion) {
      toast.info("更新检测仅支持桌面端应用。");
      return;
    }
    setCheckingUpdate(true);
    try {
      const version =
        appVersion ??
        (await import("@tauri-apps/api/app").then((m) => m.getVersion()));
      if (!version) throw new Error("无法读取当前应用版本号。");
      const update = await checkForUpdate(version);
      if (update) {
        // 手动检查无视「忽略此版本」，始终弹出
        setUpdateInfo(update);
        setUpdateDialogOpen(true);
      } else {
        toast.success(`当前已是最新版本（v${version}）`);
      }
    } catch (err) {
      toast.error(
        `检查更新失败：${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setCheckingUpdate(false);
    }
  };


  return (
    <Page>
      <div className="mx-auto max-w-6xl px-2 w-full pt-1.5 pb-6 flex flex-col gap-4">
        {/* 界面显示比例 */}
        <SectionCard
          title="界面显示比例"
          description="调整手机、平板和桌面窗口中的整体界面比例，修改立即生效"
        >
          <div className="flex flex-col gap-2 px-2 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-white/50">显示比例</span>
              <div className="flex flex-wrap overflow-hidden rounded-lg border border-white/[0.08]">
                {UI_SCALE_OPTIONS.map((option) => {
                  const selected = option.factor === currentUiScale;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => handleSelectUiScale(option.factor)}
                      aria-pressed={selected}
                      className={`px-3 py-1.5 text-[12.5px] transition ${
                        selected
                          ? "bg-emerald-400/[0.15] text-emerald-300"
                          : "text-white/55 hover:bg-white/[0.05] hover:text-white"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <p className="text-[11.5px] leading-snug text-white/40">
              {selectedUiScaleOption.description}
              导航、提示和浮层会同步缩放；系统安全区与 macOS 原生标题栏区域保持原始尺寸。壁纸编辑器不随比例缩放。
              此设置仅保存在本设备。
            </p>
          </div>
        </SectionCard>

        {/* 导航 */}
        <SectionCard
          title="导航"
          description="选择导航栏中显示的项目，拖动左侧手柄调整组内顺序"
          headerExtra={
            <Button
              type="button"
              size="1"
              variant="ghost"
              color="gray"
              disabled={!hasCustomNavItems}
              onClick={() => {
                resetNavItemPreferences();
                toast.success("已恢复默认导航设置");
              }}
            >
              <ArrowCounterClockwiseIcon size={14} />
              恢复默认
            </Button>
          }
        >
          <ToggleRow
            title="账号区域随滚动收缩"
            subtitle="滚动导航内容时收起顶部账号信息，方便浏览更多功能"
            checked={collapseAccountOnScroll}
            onChange={saveNavAccountCollapse}
          />
          <NavigationItemsSettings
            preferences={navItemPreferences}
            roles={navRoles}
          />
        </SectionCard>

        {/* 资源仓库环境 */}
        <SectionCard
          title="资源仓库环境"
          description={`当前：${REPO_ENVS[currentEnv].owner}/${REPO_ENVS[currentEnv].repoName}`}
        >
          <div className="flex justify-end px-2">
            <Button variant="ghost" color="gray" onClick={reload}>
              <ArrowClockwiseIcon size={15} />
              刷新页面
            </Button>
          </div>

          <div className="grid gap-2.5 md:grid-cols-2">
            {(Object.values(REPO_ENVS) as Array<(typeof REPO_ENVS)[RepoEnvId]>).map(
              (env) => (
                <OptionCard
                  key={env.id}
                  selected={env.id === currentEnv}
                  pending={env.id === pending}
                  onClick={() => handleSelect(env.id)}
                  title={env.label}
                  description={env.description}
                  meta={`${env.owner}/${env.repoName}@${env.defaultBranch}`}
                />
              ),
            )}
          </div>

          {pending && (
            <div className="flex flex-col gap-2">
              <Callout.Root color="amber">
                <Callout.Icon>
                  <WarningIcon size={16} />
                </Callout.Icon>
                <Callout.Text>
                  即将切换到 <strong>{REPO_ENVS[pending].label}</strong>
                  。已加载的本地草稿、缓存的设备目录仍会保留，建议切换后刷新页面再继续编辑。
                </Callout.Text>
              </Callout.Root>
              <div className="flex gap-2">
                <Button onClick={confirmSwitch}>确认切换</Button>
                <Button variant="soft" onClick={() => setPending(null)}>
                  取消
                </Button>
              </div>
            </div>
          )}
        </SectionCard>

        {/* 审核模式 */}
        <SectionCard
          title="审核模式"
          description={`当前：${PUBLISH_MODES[currentReviewMode].label}`}
        >
          <div className="grid gap-2.5 md:grid-cols-2">
            {(
              Object.values(PUBLISH_MODES) as Array<
                (typeof PUBLISH_MODES)[PublishMode]
              >
            ).map((mode) => (
              <OptionCard
                key={mode.id}
                selected={mode.id === currentReviewMode}
                onClick={() => handleSelectReviewMode(mode.id)}
                title={mode.label}
                description={mode.description}
              />
            ))}
          </div>
        </SectionCard>

        {/* AstroBox 登录方式 */}
        <SectionCard
          title="AstroBox 登录方式"
          description="桌面客户端打开登录页面的方式"
        >
          <div className="grid gap-2.5 md:grid-cols-2">
            {(
              Object.values(LOGIN_METHODS) as Array<
                (typeof LOGIN_METHODS)[AstroboxLoginMethod]
              >
            ).map((method) => (
              <OptionCard
                key={method.id}
                selected={method.id === currentLoginMethod}
                onClick={() => handleSelectLoginMethod(method.id)}
                title={method.label}
                description={method.description}
              />
            ))}
          </div>
        </SectionCard>

        <AfdianAccountSection />

        <AfdianAiAutoReplySection />

        {/* 日志与诊断 */}
        <LogsSection />

        {/* 关于与法律 */}
        <SectionCard
          title="关于与法律"
          description="协议、隐私、更新与版本信息"
        >
            <button
              type="button"
              onClick={() => void handleCheckUpdate()}
              disabled={checkingUpdate}
              className={`group flex w-full items-center gap-3 px-2 py-3 text-left hover:bg-white/[0.035] ${
                autoCheckDisabled ? "" : "border-b border-white/[0.06]"
              }`}
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13.5px] font-medium text-white">
                  检查更新
                  {checkingUpdate ? "…" : ""}
                </span>
                <span className="truncate text-[12px] text-white/45">
                  {appVersion
                    ? `当前版本 v${appVersion}，前往 GitHub 查看最新版本`
                    : "前往 GitHub 查看最新版本"}
                </span>
              </div>
              {checkingUpdate ? (
                <Spinner size="1" />
              ) : (
                <ArrowUpRightIcon
                  size={15}
                  className="shrink-0 text-white/30 transition group-hover:text-white/65"
                />
              )}
            </button>
            <ToggleRow
              title="自动检查更新"
              subtitle="启动时自动检测新版本并弹窗提示"
              checked={!autoCheckDisabled}
              onChange={(next) => setAutoCheckDisabled(!next)}
              last
            />
            <LinkRow
              title="用户协议"
              subtitle="AstroBox 最终用户许可协议（EULA）"
              onClick={() => openExternal(EULA_URL)}
            />
            <LinkRow
              title="隐私政策"
              subtitle="了解我们如何收集与处理你的数据"
              onClick={() => openExternal(PRIVACY_URL)}
            />
            <LinkRow
              title="官方网站"
              subtitle="astrobox.online"
              onClick={() => openExternal(WEBSITE_URL)}
              last
            />
        </SectionCard>

        <p className="text-center text-[11.5px] text-white/35">
          AstroBox CreatorConsole
          {appVersion ? ` · v${appVersion}` : ""}
        </p>

        <UpdateAvailableDialog
          info={updateInfo}
          open={updateDialogOpen}
          onOpenChange={setUpdateDialogOpen}
        />
      </div>
    </Page>
  );
}
