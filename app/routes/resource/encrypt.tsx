import { FingerprintSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router";
import { Tabs } from "~/components/ScaleAwareThemes";
import PageHeader from "~/components/page-header";
import Page from "~/layout/page";
import { hasCreatorPlusOrAbove } from "~/logic/account/permissions";
import { useDisplayAccount } from "~/logic/account/store";
import {
  availableEncryptTabs,
  resolveEncryptTab,
  type EncryptTab,
} from "~/logic/encrypt-tabs";
import { AfdianAutoReissueCard } from "./encrypt/afdian-auto-reissue-card";
import { AfdianReissueManager } from "./encrypt/afdian-reissue-manager";
import { CdkManager } from "./encrypt/cdk-manager";
import { EncryptedFilesCard } from "./encrypt/encrypted-files";
import { EntitlementManager } from "./encrypt/entitlement-manager";
import { ExternalAuthorizationManager } from "./encrypt/external-authorization-manager";
import { PlatformSettingsCard } from "./encrypt/platform-settings";

const TAB_TRIGGER_CLASS =
  "px-4! py-2! text-sm! whitespace-nowrap text-white/55! data-[state=active]:text-white! data-[state=active]:border-b-2! data-[state=active]:border-white! rounded-none! before:content-none! transition!";

export default function ResourceEncrypt() {
  const displayAccount = useDisplayAccount();
  const isVip = hasCreatorPlusOrAbove(displayAccount.plan);
  const [params, setParams] = useSearchParams();
  const tab = resolveEncryptTab(params.get("tab"), isVip);
  const tabs = availableEncryptTabs(isVip);

  // 分页签只在首次打开时才挂载（避免一进页面就并发拉取所有管理卡片的数据），
  // 挂载后保持存活、只隐藏：爱发电凭据、已拉取的订单、选中的资源切换页签不会丢。
  const [visited, setVisited] = useState<ReadonlySet<EncryptTab>>(
    () => new Set([tab]),
  );
  useEffect(() => {
    setVisited((previous) =>
      previous.has(tab) ? previous : new Set(previous).add(tab),
    );
  }, [tab]);

  const setTab = (next: string) => {
    const nextParams = new URLSearchParams(params);
    nextParams.set("tab", next);
    setParams(nextParams, { replace: true });
  };

  const panels: Record<EncryptTab, () => ReactNode> = {
    platform: () => <PlatformSettingsCard isVip={isVip} />,
    files: () => <EncryptedFilesCard isVip={isVip} />,
    cdk: () => <CdkManager />,
    buyers: () => <EntitlementManager />,
    reissue: () => (
      <>
        <AfdianAutoReissueCard />
        <AfdianReissueManager />
      </>
    ),
    external: () => <ExternalAuthorizationManager />,
  };

  return (
    <Page>
      <div className="mx-auto max-w-6xl px-2 w-full pt-1.5 pb-6 flex flex-col gap-4">
        <div className="px-3 py-3.5">
          <PageHeader
            title="资源加解密与激活"
            description="配置付费平台与资源激活方式"
            icon={<FingerprintSimpleIcon size={25} className="text-purple-300" />}
          />
        </div>

        <Tabs.Root value={tab} onValueChange={setTab}>
          <Tabs.List className="flex gap-0 overflow-x-auto border-b border-white/10 [scrollbar-width:none]">
            {tabs.map((item) => (
              <Tabs.Trigger key={item.key} value={item.key} className={TAB_TRIGGER_CLASS}>
                {item.label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </Tabs.Root>

        {tabs.map((item) => {
          if (item.key !== tab && !visited.has(item.key)) return null;
          return (
            <div
              key={item.key}
              role="tabpanel"
              hidden={item.key !== tab}
              className={item.key === tab ? "flex flex-col gap-4" : "hidden"}
            >
              {panels[item.key]()}
            </div>
          );
        })}
      </div>
    </Page>
  );
}
