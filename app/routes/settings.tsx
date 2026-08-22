import { useEffect, useState } from "react";
import { Button, Callout, Spinner, Switch } from "@radix-ui/themes";
import {
  ArrowClockwiseIcon,
  ArrowUpRightIcon,
  CheckIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import {
  REPO_ENVS,
  saveRepoEnvId,
  useRepoEnvId,
  type RepoEnvId,
} from "~/config/repoEnv";
import {
  PUBLISH_MODES,
  saveReviewMode,
  saveSubmitMode,
  useReviewMode,
  useSubmitMode,
  type PublishMode,
} from "~/config/publishMode";
import {
  LOGIN_METHODS,
  saveLoginMethod,
  useLoginMethod,
  type AstroboxLoginMethod,
} from "~/config/loginMethod";
import UpdateAvailableDialog from "~/components/update/UpdateAvailableDialog";
import {
  checkForUpdate,
  isTauriRuntime,
  useUpdateCheckDisabled,
  type UpdateInfo,
} from "~/logic/update/update-checker";
import Page from "~/layout/page";
import { SectionCard } from "./resource/publish/components/shared";

const EULA_URL = "https://astrobox.online/eula.html";
const PRIVACY_URL = "https://astrobox.online/privacy.html";
const WEBSITE_URL = "https://astrobox.online";

function openExternal(url: string) {
  openUrl(url).catch(() =>
    window.open(url, "_blank", "noopener,noreferrer"),
  );
}

/** One selectable option in a settings group (repo env / login method). */
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

/** A tappable row inside a grouped card that opens an external link. */
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

/** A tappable row inside a grouped card that toggles a boolean setting. */
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
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export default function Settings() {
  const currentEnv = useRepoEnvId();
  const currentSubmitMode = useSubmitMode();
  const currentReviewMode = useReviewMode();
  const [pending, setPending] = useState<RepoEnvId | null>(null);
  const currentLoginMethod = useLoginMethod();
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
        /* not running inside Tauri — version is unavailable */
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

  const handleSelect = (id: RepoEnvId) => {
    if (id === currentEnv) return;
    setPending(id);
  };

  const handleSelectSubmitMode = (id: PublishMode) => {
    if (id === currentSubmitMode) return;
    saveSubmitMode(id);
    toast.success(`提交已切换到 ${PUBLISH_MODES[id].label}`);
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

        {/* 提交模式 */}
        <SectionCard
          title="提交模式"
          description={`当前：${PUBLISH_MODES[currentSubmitMode].label}（新版本统一使用新流程提交）`}
        >
          <div className="grid gap-2.5 md:grid-cols-2">
            {(
              Object.values(PUBLISH_MODES) as Array<
                (typeof PUBLISH_MODES)[PublishMode]
              >
            ).map((mode) => (
              <OptionCard
                key={mode.id}
                selected={mode.id === currentSubmitMode}
                onClick={() => handleSelectSubmitMode(mode.id)}
                disabled={mode.id === "legacy"}
                title={mode.label}
                description={mode.description}
              />
            ))}
          </div>
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
          currentVersion={appVersion}
          open={updateDialogOpen}
          onOpenChange={setUpdateDialogOpen}
        />
      </div>
    </Page>
  );
}
