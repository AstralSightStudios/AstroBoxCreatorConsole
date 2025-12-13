import type { UploadItem } from "./shared";

export type AuthorInput = { name: string; bindABAccount: boolean };

export type LinkInput = { icon: string; title: string; url: string };

export type DownloadInput = {
    uid: string;
    platformId: string;
    version: string;
    file: UploadItem | null;
    existingFileName?: string;
};

export type DeviceOption = { id: string; name: string; vendor?: string };
