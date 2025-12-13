import type { UploadItem } from "./shared";

export const createUploadItem = (file: File): UploadItem => ({
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36),
    name: file.name,
    url: URL.createObjectURL(file),
    file,
    source: "upload",
});

export const createExistingUploadItem = (
    name: string,
    url: string,
    pathOverride?: string,
): UploadItem => ({
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36),
    name,
    url,
    file: new File([new Uint8Array()], name),
    pathOverride,
    skipUpload: true,
    source: "existing",
});

export const revokeUrl = (item: UploadItem | null | undefined) => {
    if (item?.url?.startsWith("blob:")) {
        URL.revokeObjectURL(item.url);
    }
};
