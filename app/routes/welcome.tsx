import { Link } from "react-router";
import { Button, Container, Flex, Heading, Text } from "@radix-ui/themes";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ArrowRightIcon, GearSixIcon } from "@phosphor-icons/react";
import { useState, type MouseEvent } from "react";
import AccountsSection from "~/components/settings/AccountsSection";
import SettingsDrawer from "~/components/settings/SettingsDrawer";
import { hasRequiredAccounts, useAccountState } from "~/logic/account/store";
import "./welcome.css";

export default function Welcome() {
  const accounts = useAccountState();
  const ready = hasRequiredAccounts(accounts);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const isMacOS =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("macos");

  const handleTitlebarMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || !("__TAURI_INTERNALS__" in window)) return;
    void getCurrentWindow().startDragging();
  };

  return (
    <div className="welcome-page">
      {isMacOS && (
        <header
          className="welcome-titlebar tauri-drag-region"
          data-tauri-drag-region
          aria-label="窗口标题栏"
          onMouseDown={handleTitlebarMouseDown}
        />
      )}
      <div className="welcome-shell">
      <Container px="6" py="9" className="welcome-content">
      <Flex direction="column" gap="5">
        <Flex direction="column">
          <Heading as="h1" style={{ fontSize: "22px" }}>欢迎使用 CreatorConsole</Heading>
          <Text color="gray" style={{ fontSize: "22px" }}>请先登录 AstroBox 和 GitHub 账号，完成后即可使用控制台。</Text>
        </Flex>
        <AccountsSection
          hideCardTitle
          hideNotificationSwitch
          cardClassName="welcome-accounts-card"
        />
        <Flex align="center" gap="3">
          {ready ? (
            <Button size="3" radius="full" asChild>
              <Link to="/">
                进入控制台
                <ArrowRightIcon size={16} />
              </Link>
            </Button>
          ) : (
            <Button size="3" radius="full" disabled>
              请完成必需账号登录
              <ArrowRightIcon size={16} />
            </Button>
          )}
          <Button
            size="3"
            radius="full"
            variant="soft"
            color="gray"
            aria-label="账号与设置"
            style={{ width: 40, paddingInline: 0 }}
            onClick={() => setSettingsOpen(true)}
          >
            <GearSixIcon size={18} />
          </Button>
        </Flex>
      </Flex>
      </Container>
      </div>
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
