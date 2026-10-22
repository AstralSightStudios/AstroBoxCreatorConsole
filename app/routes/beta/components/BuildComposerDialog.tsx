import {
    CheckCircleIcon,
    FileArrowUpIcon,
    PlusIcon,
    TrashIcon,
    WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
    BetaApi,
    formatBytes,
    uploadBetaFile,
    type BetaBuild,
    type BetaRestype,
} from "~/api/astrobox/beta";
import {
    Button,
    Checkbox,
    Dialog,
    Progress,
    Text,
    TextArea,
    TextField,
} from "~/components/ScaleAwareThemes";
import type { DeviceOption } from "~/logic/devices/catalog";
import { pickFiles } from "~/logic/publish/file-picker";
import {
    formatPackageVersion,
    readPackageVersion,
    type PackageVersionInfo,
} from "~/logic/publish/package-version";
import DeviceMultiSelect from "./DeviceMultiSelect";
import { describeBetaError } from "./shared";

const PACKAGE_ACCEPT: Record<BetaRestype, string> = {
    quick_app: "rpk,zip,bin",
    watchface: "bin,face,zip,mwz",
    canopus: "canopus,zip",
    res_pack: "crpack,zip,rpk,bin",
};

type PackageRow = {
    key: string;
    file: File | null;
    devices: string[];
    progress: number;
    uploadedId: string | null;
    error: string;
    /** 从包体里读出的版本；还没选文件或正在读时为 null */
    info: PackageVersionInfo | null;
};

function newRow(devices: string[] = []): PackageRow {
    return {
        key: Math.random().toString(36).slice(2),
        file: null,
        devices,
        progress: 0,
        uploadedId: null,
        error: "",
        info: null,
    };
}

function parseCode(text: string) {
    return /^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined;
}

export default function BuildComposerDialog({
    open,
    onOpenChange,
    programId,
    restype,
    deviceOptions,
    previous,
    topVersionCode,
    maxPackageBytes,
    onCreated,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    programId: string;
    restype: BetaRestype;
    deviceOptions: DeviceOption[];
    /** 上一个版本，用来预填设备分配 */
    previous: BetaBuild | null;
    /** 已发布过的最大 versionCode */
    topVersionCode: number;
    maxPackageBytes: number;
    onCreated: (build: BetaBuild) => void;
}) {
    const [version, setVersion] = useState("");
    const [versionEdited, setVersionEdited] = useState(false);
    // 包里读不出 versionCode 时才手填
    const [manualCode, setManualCode] = useState("");
    const [changelog, setChangelog] = useState("");
    const [notify, setNotify] = useState(true);
    const [rows, setRows] = useState<PackageRow[]>(() => [newRow()]);
    const [submitting, setSubmitting] = useState(false);
    const busyRef = useRef(false);

    const reset = () => {
        setVersion("");
        setVersionEdited(false);
        setManualCode("");
        setChangelog("");
        setNotify(true);
        // 沿用上个版本的设备分配，一般只是换个包
        setRows(previous && previous.files.length > 0 ? previous.files.map((file) => newRow(file.devices)) : [newRow()]);
    };

    // 每次打开都从干净的表单开始
    useEffect(() => {
        if (open) reset();
    }, [open]);

    const handleOpenChange = (next: boolean) => {
        if (submitting) return;
        onOpenChange(next);
    };

    const takenFor = (key: string) => {
        const map = new Map<string, string>();
        rows.forEach((row, index) => {
            if (row.key === key) return;
            const label = row.file?.name || `包体 ${index + 1}`;
            row.devices.forEach((device) => map.set(device, label));
        });
        return map;
    };

    const updateRow = (key: string, patch: Partial<PackageRow>) => {
        setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    };

    const pickFor = async (key: string) => {
        const [file] = await pickFiles({ accept: PACKAGE_ACCEPT[restype], title: "选择测试包" });
        if (!file) return;
        if (file.size > maxPackageBytes) {
            toast.error(`包体不能超过 ${formatBytes(maxPackageBytes)}`);
            return;
        }
        updateRow(key, { file, uploadedId: null, progress: 0, error: "", info: null });
        const info = await readPackageVersion(file);
        // 读的过程中换了文件就丢掉旧结果
        setRows((current) => current.map((row) => (row.key === key && row.file === file ? { ...row, info } : row)));
        if (info.version && !versionEdited) setVersion(info.version);
    };

    // 检查更新比较的是包体自己的 versionCode，所以一律以包为准，读不出才用手填的
    const packageCodes = Array.from(
        new Set(rows.flatMap((row) => (row.info?.versionCode !== undefined ? [row.info.versionCode] : []))),
    );
    const versionCode = packageCodes.length === 1 ? packageCodes[0] : packageCodes.length === 0 ? parseCode(manualCode) : undefined;
    const reading = rows.some((row) => row.file && !row.info);

    const problems = useMemo(() => {
        const list: string[] = [];
        if (!version.trim()) list.push("填写版本号");
        if (reading) list.push("正在读取包体版本");
        else if (packageCodes.length > 1) list.push(`各包体的 versionCode 不一致（${packageCodes.join(" / ")}）`);
        else if (versionCode === undefined || versionCode < 1) list.push("填写 versionCode");
        else if (versionCode <= topVersionCode) list.push(`versionCode 需大于 ${topVersionCode}`);
        if (rows.length === 0) list.push("至少添加一个包体");
        rows.forEach((row, index) => {
            if (!row.file) list.push(`包体 ${index + 1} 还没选择文件`);
            if (row.devices.length === 0) list.push(`包体 ${index + 1} 还没选择设备`);
        });
        return list;
    }, [packageCodes.length, reading, rows, topVersionCode, version, versionCode]);

    const submit = async () => {
        if (busyRef.current || problems.length > 0 || versionCode === undefined) return;
        busyRef.current = true;
        setSubmitting(true);
        try {
            const uploaded: Parameters<typeof BetaApi.createBuild>[0]["files"] = [];
            for (const row of rows) {
                let fileId = row.uploadedId;
                if (!fileId) {
                    try {
                        const result = await uploadBetaFile(programId, "package", row.file!, (fraction) =>
                            updateRow(row.key, { progress: fraction }),
                        );
                        fileId = result.id;
                        updateRow(row.key, { uploadedId: fileId, progress: 1, error: "" });
                    } catch (error) {
                        updateRow(row.key, { error: describeBetaError(error, "上传失败") });
                        throw error;
                    }
                }
                uploaded.push({
                    fileId,
                    devices: row.devices,
                    packageVersion: row.info?.version,
                    packageVersionCode: row.info?.versionCode ?? null,
                    packageId: row.info?.identity ?? null,
                });
            }
            const build = await BetaApi.createBuild({
                programId,
                version: version.trim(),
                versionCode,
                changelog: changelog.trim(),
                files: uploaded,
                notify,
            });
            toast.success(`版本 ${build.version} 已发布`, {
                description: notify ? "已通知所有测试者" : undefined,
            });
            onCreated(build);
            onOpenChange(false);
        } catch (error) {
            toast.error(`发布失败：${describeBetaError(error)}`);
        } finally {
            busyRef.current = false;
            setSubmitting(false);
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={handleOpenChange}>
            <Dialog.Content maxWidth="640px" aria-describedby={undefined}>
                <Dialog.Title>发布测试版本</Dialog.Title>

                <div className="mt-4 flex flex-col gap-4">
                    <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
                        <div className="flex flex-col gap-3">
                            <label className="flex flex-col gap-1.5">
                                <Text size="2" weight="medium">
                                    版本号
                                </Text>
                                <TextField.Root
                                    value={version}
                                    placeholder="如 1.2.0-beta.1"
                                    maxLength={40}
                                    disabled={submitting}
                                    onChange={(event) => {
                                        setVersion(event.target.value);
                                        setVersionEdited(true);
                                    }}
                                />
                            </label>
                            <label className="flex flex-col gap-1.5">
                                <Text size="2" weight="medium">
                                    versionCode
                                </Text>
                                <TextField.Root
                                    value={packageCodes.length > 0 ? packageCodes.join(" / ") : manualCode}
                                    inputMode="numeric"
                                    placeholder={`> ${topVersionCode}`}
                                    disabled={submitting || packageCodes.length > 0}
                                    onChange={(event) => setManualCode(event.target.value.replace(/\D/g, ""))}
                                />
                            </label>
                        </div>
                        <label className="flex flex-col gap-1.5">
                            <Text size="2" weight="medium">
                                测试说明
                            </Text>
                            <TextArea
                                value={changelog}
                                maxLength={4000}
                                rows={3}
                                disabled={submitting}
                                onChange={(event) => setChangelog(event.target.value)}
                            />
                        </label>
                    </div>

                    <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                            <Text size="2" weight="medium">
                                包体与设备
                            </Text>
                            <Button
                                size="1"
                                variant="soft"
                                color="gray"
                                disabled={submitting || rows.length >= 20}
                                onClick={() => setRows((current) => [...current, newRow()])}
                            >
                                <PlusIcon size={14} />
                                添加包体
                            </Button>
                        </div>
                        {rows.map((row, index) => (
                            <div
                                key={row.key}
                                className="flex flex-col gap-2 rounded-[12px] border border-white/10 bg-white/[0.03] p-2.5"
                            >
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        disabled={submitting}
                                        onClick={() => void pickFor(row.key)}
                                        className="flex min-w-0 flex-1 items-center gap-2 rounded-[9px] border border-dashed border-white/15 bg-black/20 px-3 py-2 text-left text-sm text-white/80 transition hover:border-white/30 disabled:opacity-60"
                                    >
                                        {row.uploadedId ? (
                                            <CheckCircleIcon size={18} weight="fill" className="shrink-0 text-emerald-300" />
                                        ) : (
                                            <FileArrowUpIcon size={18} className="shrink-0 text-white/60" />
                                        )}
                                        <span className="min-w-0 flex-1 truncate">
                                            {row.file ? row.file.name : `选择包体文件 ${index + 1}`}
                                        </span>
                                        {row.file && (
                                            <span className="shrink-0 text-xs text-white/45">{formatBytes(row.file.size)}</span>
                                        )}
                                    </button>
                                    {rows.length > 1 && (
                                        <Button
                                            size="2"
                                            variant="ghost"
                                            color="red"
                                            disabled={submitting}
                                            onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                                        >
                                            <TrashIcon size={16} />
                                        </Button>
                                    )}
                                </div>
                                {row.info && (
                                    <Text
                                        size="1"
                                        color={row.info.versionCode === undefined ? "amber" : "gray"}
                                        className="truncate px-0.5"
                                    >
                                        {row.info.versionCode !== undefined
                                            ? formatPackageVersion(row.info)
                                            : row.info.readable
                                              ? "包内没有 versionCode"
                                              : (row.info.reason ?? "无法读取版本")}
                                        {row.info.identity ? ` · ${row.info.identity}` : ""}
                                    </Text>
                                )}
                                <DeviceMultiSelect
                                    options={deviceOptions}
                                    value={row.devices}
                                    takenBy={takenFor(row.key)}
                                    disabled={submitting}
                                    onChange={(devices) => updateRow(row.key, { devices })}
                                />
                                {submitting && row.file && !row.uploadedId && (
                                    <Progress value={Math.round(row.progress * 100)} size="1" />
                                )}
                                {row.error && (
                                    <Text size="1" color="red" className="flex items-center gap-1">
                                        <WarningCircleIcon size={13} />
                                        {row.error}
                                    </Text>
                                )}
                            </div>
                        ))}
                    </div>

                    <label className="flex items-center gap-2">
                        <Checkbox checked={notify} disabled={submitting} onCheckedChange={(value) => setNotify(value === true)} />
                        <Text size="2">通知测试者</Text>
                    </label>
                </div>

                <div className="mt-5 flex items-center justify-between gap-3">
                    <Text size="1" color={problems.length > 0 ? "amber" : "gray"} className="min-w-0 truncate">
                        {problems[0] ?? "准备就绪"}
                    </Text>
                    <div className="flex shrink-0 gap-2">
                        <Button variant="soft" color="gray" disabled={submitting} onClick={() => handleOpenChange(false)}>
                            取消
                        </Button>
                        <Button loading={submitting} disabled={problems.length > 0} onClick={() => void submit()}>
                            上传并发布
                        </Button>
                    </div>
                </div>
            </Dialog.Content>
        </Dialog.Root>
    );
}
