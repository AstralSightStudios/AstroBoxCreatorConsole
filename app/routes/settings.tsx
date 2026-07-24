import { useEffect, useState, type ReactNode } from "react";
import { Button, Callout } from "@radix-ui/themes";
import {
  ArrowClockwiseIcon,
  ArrowUpRightIcon,
  CheckIcon,
  FileTextIcon,
  GlobeIcon,
  HardDrivesIcon,
  type Icon,
  ShieldCheckIcon,
  SignInIcon,
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
  LOGIN_METHODS,
  saveLoginMethod,
  useLoginMethod,
  type AstroboxLoginMethod,
} from "~/config/loginMethod";

const EULA_URL = "https://astrobox.online/eula.html";
const PRIVACY_URL = "https://astrobox.online/privacy.html";
const WEBSITE_URL = "https://astrobox.online";

function openExternal(url: string) {
  openUrl(url).catch(() =>
    window.open(url, "_blank", "noopener,noreferrer"),
  );
}

/** Small label + description above a grouped card, iOS-settings style. */
function SectionHeader({
  icon: IconEl,
  title,
  description,
  action,
}: {
  icon: Icon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3 px-1">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.04] text-white/70">
          <IconEl size={17} weight="duotone" />
        </span>
        <div className="flex min-w-0 flex-col">
          <h2 className="text-[15px] font-semibold leading-tight text-white">
            {title}
          </h2>
          {description && (
            <p className="truncate text-[12.5px] leading-tight text-white/45">
              {description}
            </p>
          )}
        </div>
      </div>
      {action}
    </div>
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
}: {
  selected: boolean;
  pending?: boolean;
  onClick: () => void;
  title: string;
  description: string;
  meta?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group corner-rounded flex items-start gap-3 rounded-[14px] border px-4 py-3.5 text-left transition ${
        selected
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
  icon: IconEl,
  iconClass,
  title,
  subtitle,
  onClick,
  last,
}: {
  icon: Icon;
  iconClass: string;
  title: string;
  subtitle: string;
  onClick: () => void;
  last?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`group flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.035] ${
        last ? "" : "border-b border-white/[0.06]"
      }`}
    >
      <span
        className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${iconClass}`}
      >
        <IconEl size={18} weight="duotone" />
      </span>
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

export default function Settings() {
  const currentEnv = useRepoEnvId();
  const [pending, setPending] = useState<RepoEnvId | null>(null);
  const currentLoginMethod = useLoginMethod();
  const [appVersion, setAppVersion] = useState<string | null>(null);

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

  const confirmSwitch = () => {
    if (!pending) return;
    saveRepoEnvId(pending);
    toast.success(`已切换到 ${REPO_ENVS[pending].label}`);
    setPending(null);
  };

  const reload = () => {
    window.location.reload();
  };

  return (
    <div className="h-full overflow-y-auto px-2 py-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-7 pb-12">
        <header className="flex flex-col gap-1 px-1 pt-1">
          <p className="text-[13px] text-white/50">
            管理控制台的运行环境、登录方式与相关协议。
          </p>
        </header>

        {/* 资源仓库环境 */}
        <section>
          <SectionHeader
            icon={HardDrivesIcon}
            title="资源仓库环境"
            description={`当前：${REPO_ENVS[currentEnv].owner}/${REPO_ENVS[currentEnv].repoName}`}
            action={
              <Button variant="soft" size="2" onClick={reload}>
                <ArrowClockwiseIcon size={16} />
                刷新页面
              </Button>
            }
          />

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
            <div className="mt-3 flex flex-col gap-2">
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
        </section>

        {/* AstroBox 登录方式 */}
        <section>
          <SectionHeader
            icon={SignInIcon}
            title="AstroBox 登录方式"
            description="桌面客户端打开登录页面的方式"
          />

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
        </section>

        {/* 关于与法律 */}
        <section>
          <SectionHeader
            icon={ShieldCheckIcon}
            title="关于与法律"
            description="协议、隐私与版本信息"
          />

          <div className="corner-rounded overflow-hidden rounded-[16px] border border-white/[0.08] bg-nav-item">
            <LinkRow
              icon={FileTextIcon}
              iconClass="bg-sky-400/12 text-sky-300"
              title="用户协议"
              subtitle="AstroBox 最终用户许可协议（EULA）"
              onClick={() => openExternal(EULA_URL)}
            />
            <LinkRow
              icon={ShieldCheckIcon}
              iconClass="bg-emerald-400/12 text-emerald-300"
              title="隐私政策"
              subtitle="了解我们如何收集与处理你的数据"
              onClick={() => openExternal(PRIVACY_URL)}
            />
            <LinkRow
              icon={GlobeIcon}
              iconClass="bg-violet-400/12 text-violet-300"
              title="官方网站"
              subtitle="astrobox.online"
              onClick={() => openExternal(WEBSITE_URL)}
              last
            />
          </div>

          <p className="mt-3 text-center text-[11.5px] text-white/35">
            AstroBox CreatorConsole
            {appVersion ? ` · v${appVersion}` : ""}
          </p>
        </section>
      </div>
    </div>
  );
}
