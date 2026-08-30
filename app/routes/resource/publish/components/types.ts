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

export type DownloadInput = {
    uid: string;
    platformId: string;
    version: string;
    file: UploadItem | null;
    existingFileName?: string;
    encryptOnUpload?: boolean;
    versionCode?: number;
    updatelogs?: UpdateLogEntry[];
};

export type DeviceOption = { id: string; name: string; vendor?: string };
