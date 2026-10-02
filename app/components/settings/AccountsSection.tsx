import { useState } from "react";
import { Link } from "react-router";
import { Avatar, Badge, Button, Callout, Flex, Spinner, Text } from "@radix-ui/themes";
import { ArrowSquareOutIcon, SignOutIcon, WarningIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AlertDialog } from "~/components/ScaleAwareThemes";
import { SectionCard } from "~/routes/resource/publish/components/shared";
import AfdianAccountSection from "./AfdianAccountSection";
import {
  cancelGithubLogin,
  startGithubLogin,
  useGithubLoginState,
} from "~/logic/account/github-login-state";
import {
  logoutAccount,
  useAccountState,
  type AccountProvider,
} from "~/logic/account/store";

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
  const [logoutProvider, setLogoutProvider] = useState<AccountProvider | null>(null);
  const githubBusy = githubLogin.status === "requesting" || githubLogin.status === "waiting";
  const githubSession = githubLogin.status === "waiting" ? githubLogin.session : undefined;

  const handleLogout = () => {
    if (!logoutProvider) return;
    if (logoutProvider === "github") cancelGithubLogin();
    logoutAccount(logoutProvider);
    setLogoutProvider(null);
    window.location.reload();
  };

  const handleOpenAuthorization = async () => {
    const url = githubSession?.verificationUriComplete || githubSession?.verificationUri;
    if (!url) return;
    try {
      await openUrl(url);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <>
      <SectionCard
        title={hideCardTitle ? undefined : <Text color="gray" highContrast>账号</Text>}
        description={<Text color="gray">AstroBox 和 GitHub 账号必须登录，爱发电账号可选。</Text>}
        className={cardClassName}
      >
        <div>
          {(["astrobox", "github"] as const).map((provider, index) => {
            const account = accounts[provider];
            const connected = Boolean(account?.token?.trim());
            const label = provider === "astrobox" ? "AstroBox" : "GitHub";
            const busy = provider === "github" && githubBusy;

            return (
              <div
                key={provider}
                className={`flex items-center gap-3 px-2 py-3 ${index > 0 ? "border-t border-[var(--gray-a5)]" : ""}`}
              >
                  <Avatar
                    size="3"
                    radius="full"
                    src={account?.avatar || undefined}
                    fallback={provider === "astrobox" ? "AB" : "GH"}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--gray-12)]">
                      {label}
                      <Badge color="gray">必需</Badge>
                    </p>
                    <p className="truncate text-xs text-[var(--gray-11)]">
                      {connected
                        ? account?.name || account?.username || label
                        : provider === "astrobox"
                          ? "登录后使用数据分析与创作者服务"
                          : "登录后发布和管理资源"}
                    </p>
                  </div>
                  {connected ? (
                    <Button variant="soft" color="red" onClick={() => setLogoutProvider(provider)}>
                      <SignOutIcon size={15} />
                      退出登录
                    </Button>
                  ) : provider === "astrobox" ? (
                    <Button asChild><Link to="/login">登录 AstroBox</Link></Button>
                  ) : (
                    <Button disabled={busy} onClick={() => void startGithubLogin()}>
                      {busy && <Spinner size="1" />}
                      {busy ? "等待授权" : "登录 GitHub"}
                    </Button>
                  )}
              </div>
            );
          })}
          {githubSession && (
            <Flex direction="column" gap="3" px="2" py="3" aria-live="polite">
              <Text size="2">在浏览器中输入以下代码，完成 GitHub 授权。</Text>
              <Text size="5" weight="bold" asChild><code>{githubSession.userCode}</code></Text>
              <Flex gap="3" wrap="wrap">
                <Button variant="soft" onClick={() => void handleOpenAuthorization()}>
                  <ArrowSquareOutIcon />
                  打开授权页面
                </Button>
              </Flex>
            </Flex>
          )}
          {githubLogin.status === "error" && (
            <Callout.Root color="red" role="alert">
              <Callout.Icon><WarningIcon /></Callout.Icon>
              <Callout.Text>{githubLogin.error || "GitHub 登录失败，请重试。"}</Callout.Text>
            </Callout.Root>
          )}
          <div id="afdian-account" className="border-t border-[var(--gray-a5)]">
            <AfdianAccountSection showNotifications={!hideNotificationSwitch} />
          </div>
        </div>
      </SectionCard>
      <AlertDialog.Root open={logoutProvider !== null} onOpenChange={(open) => { if (!open) setLogoutProvider(null); }}>
        <AlertDialog.Content>
          <AlertDialog.Title>退出 {logoutProvider === "astrobox" ? "AstroBox" : "GitHub"} 账号</AlertDialog.Title>
          <AlertDialog.Description>退出后需要重新登录，才能继续使用控制台。</AlertDialog.Description>
          <Flex gap="3" mt="4" justify="end">
            <AlertDialog.Cancel><Button variant="soft" color="gray">取消</Button></AlertDialog.Cancel>
            <AlertDialog.Action><Button color="red" onClick={handleLogout}>退出登录</Button></AlertDialog.Action>
          </Flex>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </>
  );
}
