import { useState } from "react";
import { Button, Callout } from "@radix-ui/themes";
import { ArrowClockwiseIcon, WarningIcon } from "@phosphor-icons/react";
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

export default function Settings() {
  const currentEnv = useRepoEnvId();
  const [pending, setPending] = useState<RepoEnvId | null>(null);
  const currentLoginMethod = useLoginMethod();

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
    <div className="h-full overflow-y-auto px-4 py-5 md:px-6">
      <div className="mx-auto flex w-full max-w-[920px] flex-col gap-5">
        <header className="flex flex-col gap-1 px-1">
          <h1 className="text-[26px] font-semibold text-white">设置</h1>
          <p className="text-sm text-white/60">
            控制台行为的全局设置；切换资源仓库会影响所有涉及到仓库读写的功能。
          </p>
        </header>

        <section className="rounded-2xl border border-white/10 bg-nav-item p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[16px] font-semibold text-white">资源仓库环境</h2>
              <p className="text-sm text-white/55">
                当前环境：
                <span className="ml-1 font-mono-sarasa text-white/85">
                  {REPO_ENVS[currentEnv].owner}/{REPO_ENVS[currentEnv].repoName}
                </span>
              </p>
            </div>
            <Button variant="soft" size="2" onClick={reload}>
              <ArrowClockwiseIcon size={16} />
              刷新页面
            </Button>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            {(Object.values(REPO_ENVS) as Array<typeof REPO_ENVS[RepoEnvId]>).map(
              (env) => {
                const isCurrent = env.id === currentEnv;
                const isPending = env.id === pending;
                return (
                  <button
                    key={env.id}
                    type="button"
                    onClick={() => handleSelect(env.id)}
                    className={`flex flex-col gap-1 rounded-xl border px-4 py-3 text-left transition ${
                      isCurrent
                        ? "border-emerald-300/45 bg-emerald-400/10"
                        : isPending
                          ? "border-amber-300/45 bg-amber-300/10"
                          : "border-white/10 bg-black/20 hover:border-white/25 hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{env.label}</span>
                      {isCurrent && (
                        <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] text-emerald-100">
                          当前
                        </span>
                      )}
                      {isPending && (
                        <span className="rounded-full bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-100">
                          待确认
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/55">{env.description}</p>
                    <p className="mt-1 font-mono-sarasa text-[11px] text-white/45">
                      {env.owner}/{env.repoName}@{env.defaultBranch}
                    </p>
                  </button>
                );
              },
            )}
          </div>

          {pending && (
            <div className="mt-3 flex flex-col gap-2">
              <Callout.Root color="amber">
                <Callout.Icon>
                  <WarningIcon size={16} />
                </Callout.Icon>
                <Callout.Text>
                  即将切换到 <strong>{REPO_ENVS[pending].label}</strong>。已加载的本地草稿、缓存的设备目录仍会保留，建议切换后刷新页面再继续编辑。
                </Callout.Text>
              </Callout.Root>
              <div className="flex gap-2">
                <Button onClick={confirmSwitch}>确认切换</Button>
                <Button variant="soft" onClick={() => setPending(null)}>取消</Button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-nav-item p-4">
          <div className="mb-3">
            <h2 className="text-[16px] font-semibold text-white">AstroBox 登录方式</h2>
            <p className="text-sm text-white/55">
              选择桌面客户端登录 AstroBox 账号时打开登录页面的方式。浏览器版本不受此设置影响。
            </p>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            {(Object.values(LOGIN_METHODS) as Array<typeof LOGIN_METHODS[AstroboxLoginMethod]>).map(
              (method) => {
                const isCurrent = method.id === currentLoginMethod;
                return (
                  <button
                    key={method.id}
                    type="button"
                    onClick={() => handleSelectLoginMethod(method.id)}
                    className={`flex flex-col gap-1 rounded-xl border px-4 py-3 text-left transition ${
                      isCurrent
                        ? "border-emerald-300/45 bg-emerald-400/10"
                        : "border-white/10 bg-black/20 hover:border-white/25 hover:bg-white/[0.04]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{method.label}</span>
                      {isCurrent && (
                        <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] text-emerald-100">
                          当前
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/55">{method.description}</p>
                  </button>
                );
              },
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
