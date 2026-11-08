import { useCallback, useState } from "react";
import { Link } from "react-router";
import {
  Avatar,
  Badge,
  Button,
  Callout,
  Flex,
  Spinner,
  Text,
} from "@radix-ui/themes";
import {
  ArrowSquareOutIcon,
  GithubLogoIcon,
  SignOutIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { AlertDialog } from "~/components/ScaleAwareThemes";
import { SectionCard } from "~/routes/resource/publish/components/shared";
import {
  clearGithubQuotas,
  forgetGithubQuota,
} from "~/logic/account/github-tokens";
import { refreshGithubQuotas } from "~/logic/account/github-quota-refresh";
import {
  cancelGithubLogin,
  startGithubLogin,
  useGithubLoginState,
} from "~/logic/account/github-login-state";
import {
  logoutAccount,
  removeGithubReader,
  useAccountState,
  type AccountProvider,
  type GithubReaderAccount,
} from "~/logic/account/store";
import { useCommunityRepoManageAccess } from "~/logic/account/repo-permission";
import AddGithubReaderDialog from "./AddGithubReaderDialog";
import AfdianAccountSection from "./AfdianAccountSection";
import GithubAccountsDrawer from "./GithubAccountsDrawer";
import GithubAccountStack from "./GithubAccountStack";
import {
  canAddGithubReader,
  getGithubReaderGateMessage,
} from "./github-reader-gate";

export default function AccountsSection({
  hideCardTitle = false,
  hideNotificationSwitch = false,
  cardClassName = "bg-[var(--gray-a3)]! border-[var(--gray-a5)]!",
}: {
  hideCardTitle?: boolean;
  hideNotificationSwitch?: boolean;
  cardClassName?: string;
}) {
  const accounts = useAccountState();
  const githubLogin = useGithubLoginState();
  const access = useCommunityRepoManageAccess();

  const [logoutProvider, setLogoutProvider] = useState<AccountProvider | null>(
    null,
  );
  const [accountsDrawerOpen, setAccountsDrawerOpen] = useState(false);
  const [addReaderOpen, setAddReaderOpen] = useState(false);
  const [readerToRemove, setReaderToRemove] =
    useState<GithubReaderAccount | null>(null);
  const [refreshingQuota, setRefreshingQuota] = useState(false);

  const githubBusy =
    githubLogin.status === "requesting" || githubLogin.status === "waiting";
  const primaryLogin =
    githubLogin.target === "primary" ? githubLogin : null;
  const githubSession =
    primaryLogin?.status === "waiting" ? primaryLogin.session : undefined;
  const primaryLoginError =
    primaryLogin?.status === "error" ? primaryLogin.error : undefined;

  const readers = accounts.githubReaders ?? [];
  const canAddReader =
    canAddGithubReader(access) && Boolean(accounts.github?.token?.trim());
  const gateMessage = getGithubReaderGateMessage(access);

  const handleRefreshQuota = useCallback(async () => {
    setRefreshingQuota(true);
    try {
      await refreshGithubQuotas();
    } finally {
      setRefreshingQuota(false);
    }
  }, []);

  const handleAddedReader = useCallback(
    (reader: GithubReaderAccount) => {
      setAddReaderOpen(false);
      toast.success(`已添加读取账号 @${reader.username}`);
      void handleRefreshQuota();
    },
    [handleRefreshQuota],
  );

  const handleOpenAddReader = () => {
    setAccountsDrawerOpen(false);
    setAddReaderOpen(true);
  };

  const confirmRemoveReader = () => {
    if (!readerToRemove) return;
    removeGithubReader(readerToRemove.username);
    forgetGithubQuota(readerToRemove.username);
    toast.success(`已移除读取账号 @${readerToRemove.username}`);
    setReaderToRemove(null);
  };

  const handleLogout = () => {
    if (!logoutProvider) return;
    if (logoutProvider === "github") {
      cancelGithubLogin();
      clearGithubQuotas();
    }
    logoutAccount(logoutProvider);
    setLogoutProvider(null);
    window.location.reload();
  };

  const handleOpenAuthorization = async () => {
    const url =
      githubSession?.verificationUriComplete ||
      githubSession?.verificationUri;
    if (!url) return;
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const handleLogoutPrimaryClick = () => {
    setAccountsDrawerOpen(false);
    setLogoutProvider("github");
  };

  return (
    <>
      <SectionCard
        title={
          hideCardTitle ? undefined : (
            <Text color="gray" highContrast>
              账号
            </Text>
          )
        }
        description={
          <Text color="gray">
            AstroBox 和 GitHub 主账号必须登录；读取账号仅对具备社区仓库审核权限的主账号开放，用于审核者绕过 API 速率限制。
          </Text>
        }
        className={cardClassName}
      >
        <div>
          <div className="flex items-center gap-3 px-2 py-3">
            <Avatar
              size="3"
              radius="full"
              src={accounts.astrobox?.avatar || undefined}
              fallback="AB"
            />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--gray-12)]">
                AstroBox <Badge color="gray">必需</Badge>
              </p>
              <p className="truncate text-xs text-[var(--gray-11)]">
                {accounts.astrobox?.token?.trim()
                  ? accounts.astrobox?.name ||
                    accounts.astrobox?.username ||
                    "AstroBox"
                  : "登录后使用数据分析与创作者服务"}
              </p>
            </div>
            {accounts.astrobox?.token?.trim() ? (
              <Button
                variant="soft"
                color="red"
                onClick={() => setLogoutProvider("astrobox")}
              >
                <SignOutIcon size={15} />
                退出登录
              </Button>
            ) : (
              <Button asChild>
                <Link to="/login">登录 AstroBox</Link>
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-[var(--gray-a5)] px-2 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-[var(--gray-12)]">
              <GithubLogoIcon size={22} weight="duotone" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--gray-12)]">
                GitHub
                {accounts.github?.token?.trim() ? (
                  <>
                    <Badge color="gray">主账号</Badge>
                    <Badge color="gray">审核/合并</Badge>
                  </>
                ) : (
                  <Badge color="gray">必需</Badge>
                )}
              </p>
              <p className="truncate text-xs text-[var(--gray-11)]">
                {accounts.github?.token?.trim()
                  ? `@${accounts.github.username} · 主账号负责审核/合并；读取账号分摊内容浏览额度`
                  : "登录后发布和管理资源；审核者可以添加读取账号分摊额度"}
              </p>
            </div>
            {accounts.github?.token?.trim() ? (
              <GithubAccountStack
                primary={accounts.github}
                readers={readers}
                canAdd={canAddReader}
                addDisabledReason={gateMessage}
                onManage={() => setAccountsDrawerOpen(true)}
                onAdd={handleOpenAddReader}
              />
            ) : (
              <Button
                disabled={githubBusy}
                onClick={() => void startGithubLogin()}
              >
                {githubBusy && <Spinner size="1" />}
                {githubBusy ? "等待授权" : "登录 GitHub"}
              </Button>
            )}
          </div>

          {githubSession && (
            <Flex direction="column" gap="3" px="2" py="3" aria-live="polite">
              <Text size="2">
                在浏览器中输入以下代码，完成 GitHub 授权。
              </Text>
              <Text size="5" weight="bold" asChild>
                <code>{githubSession.userCode}</code>
              </Text>
              <Flex gap="3" wrap="wrap">
                <Button
                  variant="soft"
                  onClick={() => void handleOpenAuthorization()}
                >
                  <ArrowSquareOutIcon />
                  打开授权页面
                </Button>
              </Flex>
            </Flex>
          )}
          {primaryLoginError && (
            <Callout.Root color="red" role="alert">
              <Callout.Icon>
                <WarningIcon />
              </Callout.Icon>
              <Callout.Text>
                {primaryLoginError || "GitHub 登录失败，请重试。"}
              </Callout.Text>
            </Callout.Root>
          )}

          <div id="afdian-account" className="border-t border-[var(--gray-a5)]">
            <AfdianAccountSection showNotifications={!hideNotificationSwitch} />
          </div>
        </div>
      </SectionCard>

      <GithubAccountsDrawer
        open={accountsDrawerOpen}
        onClose={() => setAccountsDrawerOpen(false)}
        primary={accounts.github}
        readers={readers}
        access={access}
        canAdd={canAddReader}
        onAdd={handleOpenAddReader}
        onRemoveReader={setReaderToRemove}
        onLogoutPrimary={handleLogoutPrimaryClick}
        onRefreshQuota={handleRefreshQuota}
        refreshingQuota={refreshingQuota}
      />

      <AddGithubReaderDialog
        open={addReaderOpen}
        onOpenChange={setAddReaderOpen}
        primary={accounts.github}
        canAdd={canAddReader}
        gateMessage={gateMessage}
        onAdded={handleAddedReader}
      />

      <AlertDialog.Root
        open={readerToRemove !== null}
        onOpenChange={(open) => {
          if (!open) setReaderToRemove(null);
        }}
      >
        <AlertDialog.Content>
          <AlertDialog.Title>移除读取账号</AlertDialog.Title>
          <AlertDialog.Description>
            移除 @{readerToRemove?.username}{" "}
            后，它不会再参与内容浏览。若要彻底撤销，请到 GitHub
            设置中删除该 Token 或撤销 OAuth 授权。
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                取消
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" onClick={confirmRemoveReader}>
                移除
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>

      <AlertDialog.Root
        open={logoutProvider !== null}
        onOpenChange={(open) => {
          if (!open) setLogoutProvider(null);
        }}
      >
        <AlertDialog.Content>
          <AlertDialog.Title>
            退出 {logoutProvider === "astrobox" ? "AstroBox" : "GitHub"} 账号
          </AlertDialog.Title>
          <AlertDialog.Description>
            {logoutProvider === "github"
              ? "退出后会同时移除所有读取账号，审核与合并将不可用。"
              : "退出后需要重新登录，才能继续使用控制台。"}
          </AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                取消
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" onClick={handleLogout}>
                退出登录
              </Button>
            </AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
