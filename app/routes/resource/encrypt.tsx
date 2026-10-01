import { FingerprintSimpleIcon } from "@phosphor-icons/react";
import { useDisplayAccount } from "~/logic/account/store";
import { hasCreatorPlusOrAbove } from "~/logic/account/permissions";
import PageHeader from "~/components/page-header";
import Page from "~/layout/page";
import { PlatformSettingsCard } from "./encrypt/platform-settings";
import { EncryptedFilesCard } from "./encrypt/encrypted-files";
import { AfdianReissueManager } from "./encrypt/afdian-reissue-manager";
import { CdkManager } from "./encrypt/cdk-manager";
import { ExternalAuthorizationManager } from "./encrypt/external-authorization-manager";

export default function ResourceEncrypt() {
  const displayAccount = useDisplayAccount();
  const isVip = hasCreatorPlusOrAbove(displayAccount.plan);

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

        <PlatformSettingsCard isVip={isVip} />

        <EncryptedFilesCard isVip={isVip} />

        {isVip && <AfdianReissueManager />}

        {isVip && <CdkManager />}

        {isVip && <ExternalAuthorizationManager />}
      </div>
    </Page>
  );
}