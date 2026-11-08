import { useEffect, useRef, useState } from "react";
import {
  ArrowSquareOutIcon,
  CopyIcon,
  GithubLogoIcon,
  KeyIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import {
  Button,
  Callout,
  Spinner,
  Tabs,
  TextField,
} from "@radix-ui/themes";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Dialog } from "~/components/ScaleAwareThemes";
import { GITHUB_OAUTH_CONFIG } from "~/config/github";
import {
  buildGithubAccountFromToken,
  pollGithubDeviceSession,
  startGithubDeviceSession,
  validateGithubReaderToken,
  type GithubDeviceSession,
} from "~/logic/account/github";
import {
  addGithubReader,
  type GithubAccount,
  type GithubReaderAccount,
} from "~/logic/account/store";

const PAT_CREATE_URL = "https://github.com/settings/personal-access-tokens/new";

type ReaderDeviceStatus = "idle" | "requesting" | "waiting" | "error";

function openExternal(url: string) {
  void openUrl(url).catch(() => {
    window.open(url, "_blank", "noopener,noreferrer");
  });
}

export interface AddGithubReaderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  primary?: GithubAccount;
  canAdd: boolean;
  gateMessage: string;
  onAdded: (reader: GithubReaderAccount) => void;
}

/**
 * 添加读取账号：优先 GitHub 登录（Device Flow），其次 Access Token。
 * Device Flow 在对话框内独立维护，确保授权码和手动跳转始终可见。
 */
export default function AddGithubReaderDialog({
  open,
  onOpenChange,
  primary,
  canAdd,
  gateMessage,
  onAdded,
}: AddGithubReaderDialogProps) {
  const [pat, setPat] = useState("");
  const [patBusy, setPatBusy] = useState(false);
  const [patError, setPatError] = useState("");
  const [deviceSession, setDeviceSession] =
    useState<GithubDeviceSession | null>(null);
  const [deviceStatus, setDeviceStatus] =
    useState<ReaderDeviceStatus>("idle");
  const [deviceError, setDeviceError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open) return;
    abortRef.current?.abort();
    abortRef.current = null;
    setDeviceSession(null);
    setDeviceStatus("idle");
    setDeviceError("");
    setPat("");
    setPatError("");
  }, [open]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const authLink =
    deviceSession?.verificationUriComplete || deviceSession?.verificationUri;

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setPat("");
      setPatError("");
    }
    onOpenChange(next);
  };

  const handleCopy = async (text: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMessage);
    } catch {
      toast.error("复制失败，请手动复制。");
    }
  };

  const handleStartLogin = async () => {
    if (!canAdd) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setDeviceStatus("requesting");
    setDeviceError("");
    setDeviceSession(null);

    try {
      const session = await startGithubDeviceSession(
        GITHUB_OAUTH_CONFIG.readerScopes,
      );
      if (controller.signal.aborted) return;

      setDeviceSession(session);
      setDeviceStatus("waiting");

      const link = session.verificationUriComplete || session.verificationUri;
      if (link) {
        // 不阻塞轮询：自动打开失败时，对话框里的手动按钮仍然可用。
        void openUrl(link).catch(() => {
          // 手动按钮会兜底。
        });
      }

      const payload = await pollGithubDeviceSession(session, {
        signal: controller.signal,
      });
      const account = await buildGithubAccountFromToken(payload, {
        includeEmail: false,
      });
      const primaryLogin = primary?.username?.trim().toLowerCase() ?? "";
      if (
        primaryLogin &&
        account.username.trim().toLowerCase() === primaryLogin
      ) {
        throw new Error(
          "这是当前 GitHub 主账号。请先在浏览器中切换到另一个账号，或使用 Access Token 添加。",
        );
      }

      const reader: GithubReaderAccount = {
        ...account,
        authType: "oauth",
        addedAt: Date.now(),
      };
      addGithubReader(reader);
      onAdded(reader);
      onOpenChange(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (controller.signal.aborted || message === "Login cancelled") {
        return;
      }
      setDeviceStatus("error");
      setDeviceError(message);
    }
  };

  const handleCancelLogin = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setDeviceSession(null);
    setDeviceStatus("idle");
    setDeviceError("");
  };

  const handleAddPat = async () => {
    if (patBusy || !canAdd) return;
    setPatBusy(true);
    setPatError("");
    try {
      const account = await validateGithubReaderToken(pat);
      const primaryLogin = primary?.username?.trim().toLowerCase() ?? "";
      if (
        primaryLogin &&
        account.username.trim().toLowerCase() === primaryLogin
      ) {
        throw new Error("这是当前 GitHub 主账号。请使用另一个账号的 Token。");
      }

      const reader: GithubReaderAccount = {
        ...account,
        authType: "pat",
        addedAt: Date.now(),
      };
      addGithubReader(reader);
      setPat("");
      onAdded(reader);
      onOpenChange(false);
    } catch (error) {
      setPatError(error instanceof Error ? error.message : String(error));
    } finally {
      setPatBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content maxWidth="540px">
        <Dialog.Title>添加读取账号</Dialog.Title>
        <Dialog.Description size="2" className="mb-4 text-white/60">
          读取账号只读公开内容，不参与批准、合并或评论。该入口仅对具备当前社区仓库审核权限的主账号开放，用于审核者绕过 GitHub API 速率限制。
        </Dialog.Description>

        {!canAdd ? (
          <Callout.Root color="amber">
            <Callout.Icon>
              <WarningIcon size={16} />
            </Callout.Icon>
            <Callout.Text>{gateMessage}</Callout.Text>
          </Callout.Root>
        ) : (
          <Tabs.Root defaultValue="login">
            <Tabs.List>
              <Tabs.Trigger value="login">GitHub 登录</Tabs.Trigger>
              <Tabs.Trigger value="token">Access Token</Tabs.Trigger>
            </Tabs.List>

            <div className="pt-4">
              <Tabs.Content value="login">
                {deviceStatus === "requesting" ? (
                  <Callout.Root color="gray" size="1">
                    <Callout.Icon>
                      <Spinner size="1" />
                    </Callout.Icon>
                    <Callout.Text>正在获取 GitHub 授权码…</Callout.Text>
                  </Callout.Root>
                ) : deviceStatus === "waiting" && deviceSession ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-white/60">
                      在浏览器中输入下面的代码完成 GitHub 授权：
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-center text-lg font-semibold tracking-[0.18em] text-white">
                        {deviceSession.userCode}
                      </code>
                      <Button
                        variant="soft"
                        aria-label="复制授权代码"
                        onClick={() =>
                          void handleCopy(
                            deviceSession.userCode,
                            "已复制授权代码",
                          )
                        }
                      >
                        <CopyIcon size={14} />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => authLink && openExternal(authLink)}
                      >
                        <ArrowSquareOutIcon size={14} />
                        打开授权页面
                      </Button>
                      <Button
                        variant="soft"
                        onClick={() =>
                          void handleCopy(authLink || "", "已复制授权链接")
                        }
                      >
                        <CopyIcon size={14} />
                        复制授权链接
                      </Button>
                      <Button
                        variant="soft"
                        color="gray"
                        onClick={handleCancelLogin}
                      >
                        取消
                      </Button>
                    </div>
                    <p className="text-[11px] leading-relaxed text-white/45">
                      GitHub 登录会授权浏览器当前登录的账号。若要添加其他账号，请先在浏览器中退出当前账号，或用隐私窗口打开复制的授权链接；也可以改用 Access Token。
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-white/60">
                      点击后会在系统浏览器打开 GitHub 授权页面；对话框会同时显示授权码，即使浏览器没有自动打开，也可以手动跳转。
                    </p>
                    <Button onClick={() => void handleStartLogin()}>
                      <GithubLogoIcon size={16} />
                      开始 GitHub 登录
                    </Button>
                    <p className="text-[11px] leading-relaxed text-white/45">
                      GitHub 会授权浏览器当前登录的账号。若要添加其他账号，请先在浏览器中切换账号，或使用 Access Token。
                    </p>
                    {deviceStatus === "error" && deviceError && (
                      <Callout.Root color="red" size="1">
                        <Callout.Icon>
                          <WarningIcon size={16} />
                        </Callout.Icon>
                        <Callout.Text>{deviceError}</Callout.Text>
                      </Callout.Root>
                    )}
                  </div>
                )}
              </Tabs.Content>

              <Tabs.Content value="token">
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-white/60">
                    如果已有读取账号的 Access Token，可以直接粘贴；新建时请先在 GitHub 登录该账号。建议使用 fine-grained PAT，Repository access 选择 Public Repositories (read-only)。
                  </p>
                  <div className="flex items-center gap-2">
                    <TextField.Root
                      className="min-w-0 flex-1"
                      type="password"
                      placeholder="github_pat_..."
                      value={pat}
                      onChange={(event) => setPat(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void handleAddPat();
                      }}
                    >
                      <TextField.Slot>
                        <KeyIcon size={16} />
                      </TextField.Slot>
                    </TextField.Root>
                    <Button
                      variant="soft"
                      onClick={() => openExternal(PAT_CREATE_URL)}
                    >
                      <ArrowSquareOutIcon size={14} />
                      创建
                    </Button>
                  </div>
                  <p className="text-[11px] leading-relaxed text-white/45">
                    选择 Public Repositories (read-only) 即可；建议设置过期时间。Token 只保存在本机，不会写入应用服务端。
                  </p>
                  {patError && (
                    <Callout.Root color="red" size="1">
                      <Callout.Icon>
                        <WarningIcon size={16} />
                      </Callout.Icon>
                      <Callout.Text>{patError}</Callout.Text>
                    </Callout.Root>
                  )}
                  <Button
                    disabled={patBusy || !pat.trim()}
                    onClick={() => void handleAddPat()}
                  >
                    {patBusy && <Spinner size="1" />}
                    {patBusy ? "验证中…" : "验证并添加"}
                  </Button>
                </div>
              </Tabs.Content>
            </div>
          </Tabs.Root>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
