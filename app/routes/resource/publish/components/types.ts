import type { ManifestUpdateLogEntry } from "~/logic/publish/manifest";
import type { UploadItem } from "./shared";

export type AuthorInput = { name: string; bindABAccount: boolean };

export type LinkInput = { icon: string; title: string; url: string };

export type BundledResourceMode = "required" | "recommend";

export type BundledResourceType = "resource" | "plugin";

export type BundledResourceInput = {
  mode: BundledResourceMode;
  type: BundledResourceType;
  id: string;
  name?: string;
};

export type UpdateLogEntry = ManifestUpdateLogEntry;

export type DownloadVersionSource = "package" | "existing";

export type DownloadIdentityKind = "package" | "watchface-id" | "dial-id";

export type DownloadInput = {
    uid: string;
    platformId: string;
    version: string;
    file: UploadItem | null;
    existingFileName?: string;
    encryptOnUpload?: boolean;
    versionCode?: number;
    updatelogs?: UpdateLogEntry[];
    /** 版本由包体或旧 manifest 派生，UI 只读。 */
    versionLocked?: boolean;
    /** 版本来源：本次包体 / 仓库旧 manifest。 */
    versionSource?: DownloadVersionSource;
    /** 上次发布的展示版本与整数版本，作为递增强制基准。 */
    previousVersion?: string;
    previousVersionCode?: number;
    /** 本次包体内容哈希，用于判断包体是否变化。 */
    packageHash?: string;
    /** 包体标识（快应用 package / 表盘 ID / Vivo dial id）。 */
    packageIdentity?: string;
    packageIdentityKind?: DownloadIdentityKind;
    /** 包体是否支持内置改写版本。 */
    packageWritable?: boolean;
};

export type DeviceOption = { id: string; name: string; vendor?: string };
