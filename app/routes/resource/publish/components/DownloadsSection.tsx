import { PlusCircleIcon, UploadSimpleIcon, XCircleIcon } from "@phosphor-icons/react";
import { Button, TextField } from "@radix-ui/themes";
import { useRef } from "react";
import { createUploadItem } from "./uploadUtils";
import { type DeviceOption, type DownloadInput } from "./types";
import { SectionCard } from "./shared";

interface DownloadsSectionProps {
    downloads: DownloadInput[];
    sortedDeviceOptions: DeviceOption[];
    isDeviceLoading: boolean;
    deviceError: string;
    onAddRow: () => void;
    onRemoveRow: (uid: string) => void;
    onUpdateRow: (
        uid: string,
        updater: (row: DownloadInput) => DownloadInput,
    ) => void;
}

export function DownloadsSection({
    downloads,
    sortedDeviceOptions,
    isDeviceLoading,
    deviceError,
    onAddRow,
    onRemoveRow,
    onUpdateRow,
}: DownloadsSectionProps) {
    const downloadFileInputs = useRef<Record<string, HTMLInputElement | null>>({});

    const pickDownloadFile = (uid: string) => {
        const node = downloadFileInputs.current[uid];
        node?.click();
    };

    return (
        <SectionCard title="资源下载配置" description="为不同设备提供不同的资源包体">
            <div className="flex flex-wrap items-center gap-2 pb-1">
                <Button
                    className="styledbtn"
                    onClick={onAddRow}
                    disabled={sortedDeviceOptions.length === 0 || isDeviceLoading}
                >
                    <PlusCircleIcon size={16} /> 添加配置
                </Button>
                {deviceError && (
                    <p className="text-xs text-amber-400">{deviceError}</p>
                )}
                {!deviceError && sortedDeviceOptions.length === 0 && (
                    <p className="text-xs text-amber-400">设备列表不可用，请稍后重试</p>
                )}
            </div>
            <div className="flex flex-col gap-3">
                {downloads.length === 0 && (
                    <p className="text-sm text-white/60">
                        目前没有资源配置，添加后才能发布资源
                    </p>
                )}
                {downloads.map((item, index) => (
                    <div
                        key={item.uid}
                        className="grid gap-2 rounded-xl border border-white/10 bg-white/5 p-3 md:grid-cols-3 md:items-center"
                    >
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-white/70">设备</label>
                            <select
                                className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none transition hover:border-white/25 focus:border-white/40"
                                value={item.platformId}
                                onChange={(e) =>
                                    onUpdateRow(item.uid, (row) => ({
                                        ...row,
                                        platformId: e.target.value,
                                    }))
                                }
                            >
                                <option value="" disabled>
                                    请选择设备
                                </option>
                                {sortedDeviceOptions.map((opt) => {
                                    const usedElsewhere = downloads.some(
                                        (row, idx) => idx !== index && row.platformId === opt.id,
                                    );
                                    return (
                                        <option
                                            key={opt.id}
                                            value={opt.id}
                                            disabled={usedElsewhere}
                                        >
                                            {opt.name}
                                            {usedElsewhere ? "（已使用）" : ""}
                                        </option>
                                    );
                                })}
                            </select>
                            {isDeviceLoading && (
                                <p className="text-xs text-white/60">正在拉取设备列表...</p>
                            )}
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-white/70">版本号</label>
                            <TextField.Root
                                placeholder="版本号"
                                value={item.version}
                                onChange={(e) =>
                                    onUpdateRow(item.uid, (row) => ({
                                        ...row,
                                        version: e.target.value,
                                    }))
                                }
                            />
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="text-xs text-white/70">包体</label>
                            <div className="flex flex-wrap items-center gap-2">
                                <input
                                    type="file"
                                    className="hidden"
                                    ref={(node) => {
                                        downloadFileInputs.current[item.uid] = node;
                                    }}
                                    onChange={(e) => {
                                        const file = e.target.files?.[0];
                                        if (!file) return;
                                        const uploadItem = createUploadItem(file);
                                        onUpdateRow(item.uid, (row) => ({
                                            ...row,
                                            file: uploadItem,
                                        }));
                                        e.target.value = "";
                                    }}
                                />
                                <Button
                                    className="styledbtn"
                                    onClick={() => pickDownloadFile(item.uid)}
                                >
                                    <UploadSimpleIcon size={16} /> 选择文件
                                </Button>
                                {item.file ? (
                                    <span className="rounded-full border border-white/15 bg-black/20 px-3 py-1 text-xs text-white/80">
                                        {item.file.name}
                                    </span>
                                ) : (
                                    <span className="text-xs text-white/60">未选择文件</span>
                                )}
                                {downloads.length > 1 && (
                                    <button
                                        className="ml-auto text-white/60 transition hover:text-red-400"
                                        onClick={() => onRemoveRow(item.uid)}
                                        disabled={downloads.length <= 1}
                                    >
                                        <XCircleIcon size={18} weight="fill" />
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </SectionCard>
    );
}
