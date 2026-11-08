import { useEffect, useState } from "react";
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
import { validateGithubReaderToken } from "~/logic/account/github";
import {
  cancelGithubLogin,
  startGithubLogin,
  useGithubLoginState,
} from "~/logic/account/github-login-state";
import {
  addGithubReader,
  type GithubAccount,
  type GithubReaderAccount,
} from "~/logic/account/store";

const PAT_CREATE_URL = "https://github.com/settings/personal-access-tokens/new";

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
 * 读取账号只读公开内容；入口本身只对具备审核权限的主账号开放。
 */
export default function AddGithubReaderDialog({
  open,
  onOpenChange,
  primary,
  canAdd,
  gateMessage,
  onAdded,
}: AddGithubReaderDialogProps) {
  const githubLogin = useGithubLoginState();
  const [pat, setPat] = useState("");
  const [patBusy, setPatBusy] = useState(false);
  const [patError, setPatError] = useState("");

  const loginBusy =
    githubLogin.status === "requesting" || githubLogin.status === "waiting";
  const primaryLoginBusy =
    loginBusy && githubLogin.target === "primary";
  const readerWaiting =
    githubLogin.status === "waiting" && githubLogin.target === "reader";
  const deviceCode = githubLogin.session?.userCode;
  const authLink =
    githubLogin.session?.verificationUriComplete ||
    githubLogin.session?.verificationUri;

  useEffect(() => {
    if (!open) return;
    if (
      githubLogin.status === "success" &&
      githubLogin.target === "reader" &&
      githubLogin.addedReader
    ) {
      onAdded(githubLogin.addedReader);
      cancelGithubLogin();
      onOpenChange(false);
    }
  }, [
    open,
    githubLogin.status,
    githubLogin.target,
    githubLogin.addedReader,
    onAdded,
    onOpenChange,
  ]);

  useEffect(() => {
    if (open) return;
    setPat("");
    setPatError("");
    if (githubLogin.target === "reader") {
      cancelGithubLogin();
    }
    // 只在对话框关闭时清理，不干扰正在进行的输入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  const handleStartLogin = () => {
    if (!canAdd) return;
    void startGithubLogin("reader");
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
                {primaryLoginBusy ? (
                  <Callout.Root color="gray" size="1">
                    <Callout.Icon>
                      <Spinner size="1" />
                    </Callout.Icon>
                    <Callout.Text>
                      正在登录 GitHub 主账号，请完成后再添加读取账号。
                    </Callout.Text>
                  </Callout.Root>
                ) : readerWaiting ? (
                  <div className="flex flex-col gap-3">
                    <p className="text-sm text-white/60">
                      在浏览器中输入下面的代码完成 GitHub 授权：
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-center text-lg font-semibold tracking-[0.18em] text-white">
                        {deviceCode}
                      </code>
                      <Button
                        variant="soft"
                        onClick={() =>
                          void handleCopy(deviceCode || "", "已复制授权代码")
                        }
                      >
                        <CopyIcon size={14} />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => authLink && openExternal(authLink)}>
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
                        onClick={cancelGithubLogin}
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
                      点击后会在系统浏览器打开 GitHub 授权页面，授权完成会自动添加为读取账号。
                    </p>
                    <Button disabled={loginBusy} onClick={handleStartLogin}>
                      {loginBusy ? (
                        <Spinner size="1" />
                      ) : (
                        <GithubLogoIcon size={16} />
                      )}
                      {loginBusy ? "等待授权…" : "开始 GitHub 登录"}
                    </Button>
                    <p className="text-[11px] leading-relaxed text-white/45">
                      GitHub 会授权浏览器当前登录的账号。若要添加其他账号，请先在浏览器中切换账号，或使用 Access Token。
                    </p>
                    {githubLogin.status === "error" &&
                      githubLogin.target === "reader" &&
                      githubLogin.error && (
                        <Callout.Root color="red" size="1">
                          <Callout.Icon>
                            <WarningIcon size={16} />
                          </Callout.Icon>
                          <Callout.Text>{githubLogin.error}</Callout.Text>
                        </Callout.Root>
                      )}
                  </div>
                )}
              </Tabs.Content>

              <Tabs.Content value="token">
                <div className="flex flex-col gap-3">
                  <p className="text-sm text-white/60">
                    适合不想切换浏览器账号的情况。建议使用 fine-grained PAT，Repository access 选择 Public Repositories (read-only)。
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
                    选择 Public Repositories (read-only) 即可；建议设置过期时间。Token 只保存在本机，不会上传到服务端。
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
