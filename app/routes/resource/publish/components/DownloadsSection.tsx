import {
  UploadSimpleIcon,
  PlusIcon,
  MinusIcon,
  WarningDiamondIcon,
  ListChecksIcon,
  CopyIcon,
  ChecksIcon,
  NotebookIcon,
  TrashIcon,
  LockSimpleIcon,
  LockIcon,
  PencilSimpleLineIcon,
  DotsSixVerticalIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  DeviceMobileIcon,
  TagIcon,
  HashIcon,
  FileArrowUpIcon,
} from "@phosphor-icons/react";
import {
  Button,
  TextField,
  TextArea,
  Table,
  Select,
  Callout,
  Switch,
  Popover,
  Checkbox,
  Text,
  AlertDialog,
  Dialog,
} from "~/components/ScaleAwareThemes";
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ScrollArea } from "~/components/scroll-area";
import { pickFiles } from "~/logic/publish/file-picker";
import { createUploadItem } from "./uploadUtils";
import {
  type DeviceOption,
  type DownloadIdentityKind,
  type DownloadInput,
  type DownloadVersionSource,
  type ValidatedPackage,
} from "./types";
import type { PublishFieldKey } from "~/logic/publish/validation";
import {
  type FieldHelpItem,
  type UploadItem,
  FieldHelpButton,
  FieldHelpDialog,
  SectionCard,
} from "./shared";
import { EncryptConfigDialog } from "./EncryptConfigDialog";
import { VersionEditorDialog } from "./VersionEditorDialog";
import { toast } from "sonner";
import { log } from "~/logic/logging";
import { logFieldChange } from "~/logic/logging/publish-flow";
import type { UpdateLogEntry } from "./types";
import {
  createUpdateLogDraft,
  duplicateUpdateLogVersions,
  moveToSlot,
  nextUpdateLogVersion,
  reorderById,
  type UpdateLogDraft,
} from "~/logic/publish/update-log-draft";
import {
  computePackageHash,
  type PackageVersionInfo,
} from "~/logic/publish/package-version";
import { resolveImportedPackage } from "~/logic/publish/package-import";
import {
  canTogglePackageEncryption,
  rowsSharePackage,
} from "~/logic/publish/package-sharing";

const DOWNLOAD_FIELD_HELP: FieldHelpItem[] = [
  {
    group: "基础配置",
    label: "设备",
    icon: <DeviceMobileIcon size={16} weight="duotone" />,
    description: "选择该包体对应的设备型号，同一设备只能配置一个包体。",
  },
  {
    group: "基础配置",
    label: "版本号",
    icon: <TagIcon size={16} weight="duotone" />,
    description:
      "展示用版本名称，导入包体后自动读取并锁定。普通包体可点「修改版本」改写；已签名的 rpk 无法在控制台内改写，需在构建工具链改好 manifest.json 后重新打包导入。",
  },
  {
    group: "基础配置",
    label: "versionCode",
    icon: <HashIcon size={16} weight="duotone" />,
    description:
      "数字版本号，AstroBox 用它和用户已装包比较来判断是否有更新，发布新版本时必须大于旧版本；导入包体后自动读取并锁定，编辑已有资源时会从仓库包体自动补齐。只有本次导入/替换且读取失败的包体才需要手动填写。同样地，rpk 需要在构建工具链里改 manifest.json 的 versionCode 后重新打包导入。",
  },
  {
    group: "基础配置",
    label: "包体文件",
    icon: <FileArrowUpIcon size={16} weight="duotone" />,
    description:
      "上传该设备的资源包体（RPK、表盘 bin / mwz、CRPack 资源包、.canopus 模块包等），编辑已有资源时可沿用仓库中的旧包。",
  },
  {
    group: "附加选项",
    label: "加密上传",
    icon: <LockIcon size={16} weight="duotone" />,
    description:
      "开启后包体加密上传，用户需要激活才能使用。一键填充后多台设备共用同一份包体，加密状态也随之共用：任意一行切换开关，所有共用该包体的设备行都会一起切换。",
  },
  {
    group: "附加选项",
    label: "更新日志",
    icon: <NotebookIcon size={16} weight="duotone" />,
    description:
      "按版本记录本次更新内容，用户更新资源时会看到这些说明。同一包体里版本号不能重复；新添加的一条默认填入当前导入包的版本。可拖动或点上下箭头调整顺序，越靠上越先显示。",
  },
  {
    group: "附加选项",
    label: "批量选择设备 / 一键填充",
    icon: <ListChecksIcon size={16} weight="duotone" />,
    description:
      "多设备资源可批量添加设备行，或将第一行的配置快速复制到其他设备行。",
  },
];

/**
 * 加密开关被禁用时的解释文案：区分「还没导入包体」与「沿用仓库旧包」。
 * 只要共用包体的行里有一行本次会上传新包体，整组开关都可用，无需提示。
 */
function encryptionLockedTitle(
  item: DownloadInput,
  downloads: DownloadInput[],
): string | undefined {
  const sharedRows = downloads.filter((row) => rowsSharePackage(row, item));
  if (sharedRows.some((row) => canTogglePackageEncryption(row))) return undefined;
  if (sharedRows.some((row) => Boolean(row.file))) {
    return "该包体沿用仓库中的已有文件，本次发布不会重新上传，加密状态不可更改";
  }
  return "请先导入包体，再设置加密状态";
}

/** `1.2.3（65536）`：展示版本 + 由包体派生的 versionCode。 */
function formatVersionWithCode(version?: string, versionCode?: number): string {
  const label = version?.trim() || "-";
  return versionCode !== undefined ? `${label}（${versionCode}）` : label;
}

interface DownloadsSectionProps {
  title?: string;
  description?: string;
  /** 校验失败时滚动闪烁的锚点，取值见 PublishFieldKey。 */
  fieldKey?: PublishFieldKey;
  emptyMessage?: string;
  downloads: DownloadInput[];
  sortedDeviceOptions: DeviceOption[];
  /** 下拉里展示的全部设备（含当前资源类型不支持的厂商）；缺省等同 sortedDeviceOptions。 */
  allDeviceOptions?: DeviceOption[];
  isDeviceLoading: boolean;
  deviceError: string;
  isVip: boolean;
  resourceId?: string;
  /**
   * 只有已进入目录索引的资源才要求 versionCode 递增。首次提交、未合入的 PR
   * 没有已发布基线，不能拿 PR 分支上的 manifest 当基线把编辑拦死。
   */
  requireVersionIncrement?: boolean;
  allowEncryption?: boolean;
  /** 包体选择器接受的扩展名（逗号分隔）。仅作提示，真实识别靠包体格式。 */
  fileAccept?: string;
  /** 当前资源类型不支持某些厂商时，禁用项悬浮显示的系统气泡文案。 */
  disabledDeviceTitle?: string;
  validateFile?: (file: File) => Promise<ValidatedPackage>;
  /** 读取仓库中的已有包体；编辑模式下由上层用 GitHub API 提供。 */
  loadExistingPackage?: (item: DownloadInput) => Promise<File>;
  onAddRow: () => void;
  onRemoveRow: (uid: string) => void;
  onUpdateRow: (
    uid: string,
    updater: (row: DownloadInput) => DownloadInput,
  ) => void;
  onBatchSetDevices?: (selectedIds: string[]) => void;
  /** 转发下载行里付费平台映射弹窗的状态回报，供发布校验使用。 */
  onPaidMappingStateChange?: (hasMapping: boolean) => void;
  onFillAll?: (template: {
    version: string;
    file: UploadItem | null;
    encryptOnUpload?: boolean;
    versionCode?: number;
    updatelogs?: UpdateLogEntry[];
    versionLocked?: boolean;
    versionSource?: DownloadVersionSource;
    packageHash?: string;
    packageIdentity?: string;
    packageIdentityKind?: DownloadIdentityKind;
    packageWritable?: boolean;
    packageUnwritableReason?: string;
    packageSource?: DownloadInput["packageSource"];
    canopus?: DownloadInput["canopus"];
  }) => void;
}

export function DownloadsSection({
  title = "资源下载配置",
  description = "为不同设备提供不同的资源包体",
  fieldKey = "downloads",
  emptyMessage = "还未添加任何设备",
  downloads,
  sortedDeviceOptions,
  allDeviceOptions,
  isDeviceLoading,
  deviceError,
  isVip,
  resourceId,
  requireVersionIncrement = true,
  allowEncryption = true,
  fileAccept,
  disabledDeviceTitle,
  validateFile,
  loadExistingPackage,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  onBatchSetDevices,
  onFillAll,
  onPaidMappingStateChange,
}: DownloadsSectionProps) {
  const [batchSelectOpen, setBatchSelectOpen] = useState(false);
  const [fillAllOpen, setFillAllOpen] = useState(false);
  const [versionEditor, setVersionEditor] = useState<{
    uid: string;
    file: File;
    previousVersionCode?: number;
  } | null>(null);
  const [updateLogEditor, setUpdateLogEditor] = useState<{
    uid: string;
    packageVersion: string;
    entries: UpdateLogEntry[];
  } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [versionEditorLoadingUid, setVersionEditorLoadingUid] = useState<
    string | null
  >(null);

  const isNonIncrementRow = (item: DownloadInput) =>
    requireVersionIncrement &&
    item.versionSource === "package" &&
    item.versionCode !== undefined &&
    item.previousVersionCode !== undefined &&
    item.versionCode <= item.previousVersionCode;

  const selectedDeviceIds = useMemo(
    () => new Set(downloads.map((d) => d.platformId).filter(Boolean)),
    [downloads],
  );

  /** 当前资源类型允许选择的设备 id，用于区分下拉里需要置灰的选项。 */
  const supportedDeviceIds = useMemo(
    () => new Set(sortedDeviceOptions.map((option) => option.id)),
    [sortedDeviceOptions],
  );
  /**
   * 受限厂商的设备不从下拉里藏掉：选项凭空消失会让人以为设备库没同步，
   * 只能反复切资源类型去猜。保留选项、置灰，悬浮时用系统 title 气泡说明原因。
   */
  const selectDeviceOptions = allDeviceOptions ?? sortedDeviceOptions;

  const vendorGroups = useMemo(() => {
    const groups = new Map<string, DeviceOption[]>();
    for (const opt of sortedDeviceOptions) {
      const vendor = opt.vendor || "其他";
      if (!groups.has(vendor)) groups.set(vendor, []);
      groups.get(vendor)!.push(opt);
    }
    return groups;
  }, [sortedDeviceOptions]);

  const hasTemplate = useMemo(
    () =>
      downloads.some(
        (d) =>
          d.version.trim() !== "" ||
          d.file !== null ||
          (d.updatelogs?.length ?? 0) > 0,
      ),
    [downloads],
  );

  const handleBatchApply = (ids: string[]) => {
    onBatchSetDevices?.(ids);
    setBatchSelectOpen(false);
  };

  const handleFillAll = () => {
    const template = downloads.find(
      (d) =>
        d.version.trim() !== "" ||
        d.file !== null ||
        (d.updatelogs?.length ?? 0) > 0,
    );
    if (template) {
      onFillAll?.({
        version: template.version,
        file: template.file,
        encryptOnUpload: template.encryptOnUpload,
        versionCode: template.versionCode,
        updatelogs: template.updatelogs,
        versionLocked: template.versionLocked,
        versionSource: template.versionSource,
        packageHash: template.packageHash,
        packageIdentity: template.packageIdentity,
        packageIdentityKind: template.packageIdentityKind,
        packageWritable: template.packageWritable,
        packageUnwritableReason: template.packageUnwritableReason,
        packageSource: template.packageSource,
        canopus: template.canopus,
      });
    }
    setFillAllOpen(false);
  };

  const saveUpdateLogs = (entries: UpdateLogEntry[]) => {
    if (!updateLogEditor) return;
    const { uid } = updateLogEditor;
    const row = downloads.find((d) => d.uid === uid);
    const device = sortedDeviceOptions.find((opt) => opt.id === row?.platformId);
    log.info("download/row", "保存更新日志", {
      data: {
        deviceId: row?.platformId ?? null,
        deviceName: device?.name ?? null,
        count: entries.length,
      },
    });
    onUpdateRow(uid, (r) => ({
      ...r,
      updatelogs: entries.length > 0 ? entries : undefined,
    }));
    setUpdateLogEditor(null);
  };

  const pickDownloadFile = async (uid: string) => {
    const files = await pickFiles({ accept: fileAccept, title: "选择包体文件" });
    const file = files[0];
    if (!file) return;
    log.info("download/file", "选择包体文件", {
      data: { name: file.name, size: file.size },
    });
    try {
      // validateFile 可能就地改写过包内 ID，必须用它返回的那份，
      // 否则行里存的是改写前的包体，发布时又会被改一次。
      const {
        info,
        file: resolved,
      } = await resolveImportedPackage(file, validateFile);
      const uploadItem = createUploadItem(resolved);
      const packageHash = await computePackageHash(resolved);
      const readable = info.readable;
      onUpdateRow(uid, (row) => ({
        ...row,
        file: uploadItem,
        existingFileName: undefined,
        versionLocked: readable && info.versionCode !== undefined,
        versionSource: readable ? "package" : row.versionSource,
        ...(readable && info.version ? { version: info.version } : {}),
        ...(readable && info.versionCode !== undefined
          ? { versionCode: info.versionCode }
          : {}),
        // 记下被替换掉的本地包体版本，供发布前拦截「version 变了但
        // versionCode 没变」。不写进 previousVersion，避免误标成上次发布。
        ...(readable &&
        (row.file || row.existingFileName) &&
        row.version?.trim() &&
        row.versionCode !== undefined
          ? {
              replacedVersion: row.version.trim(),
              replacedVersionCode: row.versionCode,
            }
          : {}),
        packageHash,
        packageIdentity: info.identity,
        packageIdentityKind: info.identityKind,
        packageWritable: info.writable,
        packageUnwritableReason: info.reason,
        packageSource: info.source,
        canopus: info.canopus,
      }));
      log.info("download/file", "包体校验完成", {
        data: {
          name: file.name,
          size: file.size,
          source: info.source,
          version: info.version ?? null,
          versionCode: info.versionCode ?? null,
          identity: info.identity ?? null,
          readable,
        },
      });
      const current = downloads.find((d) => d.uid === uid);
      // 未进入索引的资源没有已发布基线，PR 分支 manifest 里的 versionCode
      // 不能拿来要求「必须递增」，否则首次提交也会被拦死。
      const previousVersionCode = requireVersionIncrement
        ? current?.previousVersionCode
        : undefined;
      const mismatch =
        info.identityKind === "package" &&
        Boolean(info.identity) &&
        Boolean(resourceId?.trim()) &&
        info.identity !== resourceId?.trim();
      if (mismatch) {
        // 身份不一致只在导入时用 toast 提醒；它不属于「包体配置」这一行的
        // 常驻状态，塞在行内会让创作者以为每次发布都要处理一次。
        toast.error(
          `${info.source === "canopus-manifest" ? "包内模块 ID" : "包体包名"}（${info.identity}）与资源 ID（${resourceId?.trim()}）不一致` +
            (info.source === "canopus-manifest"
              ? "。请把资源 ID 改成包内模块 ID，或用该资源 ID 重新构建 canopus 模块后导入。"
              : "，将无法自动检查更新，请先统一 ID。"),
          { duration: 8000 },
        );
      }

      // 替换包体时 version 变了、versionCode 却没动：只有已进入索引的资源
      // 才需要拦——未上架的资源还没有用户装过旧版本，首次发布前调整版本
      // 不会造成更新检测问题。否则首次提交/草稿恢复也会被要求反复提升。
      if (requireVersionIncrement) {
        const nextVersion = info.version?.trim();
        const previousLocalVersion = current?.version?.trim();
        const versionChanged =
          readable &&
          Boolean(current?.file || current?.existingFileName) &&
          Boolean(nextVersion) &&
          Boolean(previousLocalVersion) &&
          nextVersion !== previousLocalVersion;
        const versionCodeUnchanged =
          info.versionCode !== undefined &&
          current?.versionCode !== undefined &&
          info.versionCode === current.versionCode;
        if (versionChanged && versionCodeUnchanged) {
          toast.error(
            `包体 version 已从 ${previousLocalVersion} 变为 ${nextVersion}，但 versionCode 仍是 ${info.versionCode}。` +
              (info.writable
                ? "请同时提升 versionCode，否则用户检测不到更新。"
                : info.reason ??
                  "该包体无法在控制台内改版本，请回构建工具链提升 versionCode 后重新打包。"),
            { duration: 8000 },
          );
          if (info.writable) {
            // 包体 version 已变但 versionCode 没变，必须强制超过被替换包体
            // 的 versionCode；这里不能用「是否已进入索引」的基线，否则未上架
            // 的首次提交可以原样再点一次「应用」。
            setVersionEditor({
              uid,
              file,
              previousVersionCode: current?.versionCode,
            });
          }
          return;
        }
      }

      if (
        requireVersionIncrement &&
        readable &&
        info.versionCode !== undefined &&
        previousVersionCode !== undefined &&
        info.versionCode <= previousVersionCode &&
        !mismatch
      ) {
        // 包体读得出来、版本也确实没涨，但不可改写的包体只有一条出路——
        // 回各自的构建工具链改 versionCode 后重新打包。rpk 与 .canopus 的
        // 原因不同，一律套 rpk 文案会让 canopus 创作者去改不存在的东西。
        toast.warning(
          `包体版本未递增（versionCode ${info.versionCode} ≤ 上次 ${previousVersionCode}）。` +
            (info.writable
              ? "请修改版本后再提交。"
              : info.reason ??
                "该包体无法在控制台内改版本，请按构建工具链重新打包后再导入。"),
          // 比默认稍长，够读完三行指引；再长就变成噪音了。
          { duration: info.writable ? undefined : 8000 },
        );
        // 只有可改写的包体才弹编辑器。rpk 弹出来也提交不了（签名块逐文件
        // 校验），弹了只是让创作者对着一个必然失败的表单发呆。
        if (info.writable) {
          setVersionEditor({ uid, file, previousVersionCode });
        }
        return;
      }
      // 版本读取成功不提示：包内 ID 改写提示已由 validateFile 在导入时给出，
      // 而「已锁定」是静默状态，行内版本列已经能看到读到的值。
      if (!readable) {
        toast.warning(
          `无法从该包体解析版本${info.reason ? `：${info.reason}` : ""}，请手动填写。`,
        );
      }
    } catch (error) {
      log.error("download/file", `包体导入失败: ${file.name}`, {
        data: { name: file.name, error },
      });
      toast.error((error as Error).message);
    }
  };

  const applyVersionEdit = async (updated: File, info: PackageVersionInfo) => {
    const editor = versionEditor;
    if (!editor) return;
    const sourceId = downloads.find((d) => d.uid === editor.uid)?.file?.id;
    // 改写后的字节变了，指纹必须跟着变；否则两台设备分别导入同一份旧包后
    // 只有其中一台改写版本时，发布会把它们当成同一份包体共用路径。
    const packageHash = await computePackageHash(updated);
    for (const row of downloads) {
      if (!row.file) continue;
      if (row.uid !== editor.uid && (!sourceId || row.file.id !== sourceId)) {
        continue;
      }
      onUpdateRow(row.uid, (r) => ({
        ...r,
        // 改写后的包体是新的字节，必须真的上传；旧仓库文件走的是同一
        // pathOverride，所以上传会覆盖原文件而不是另起一份。
        file: r.file
          ? { ...r.file, file: updated, skipUpload: false, source: "upload" }
          : r.file,
        existingFileName: undefined,
        version: info.version ?? r.version,
        versionCode: info.versionCode ?? r.versionCode,
        versionLocked: true,
        versionSource: "package",
        packageHash,
        packageWritable: info.writable,
        packageUnwritableReason: info.reason,
        packageSource: info.source,
        canopus: info.canopus,
        packageIdentity: info.identity,
        packageIdentityKind: info.identityKind,
      }));
    }
    log.info("download/version", "包体版本已改写", {
      data: {
        sourceId: sourceId ?? null,
        version: info.version ?? null,
        versionCode: info.versionCode ?? null,
      },
    });
  };

  /**
   * 打开版本编辑器。编辑已有资源时包体只在仓库里，需要先取回原始字节；
   * 改写后会作为新文件上传，并沿用原 pathOverride 覆盖同一路径。
   */
  const openVersionEditor = async (item: DownloadInput) => {
    if (!item.file) return;
    const previousVersionCode = requireVersionIncrement
      ? item.previousVersionCode
      : undefined;
    if (!item.file.skipUpload) {
      setVersionEditor({
        uid: item.uid,
        file: item.file.file,
        previousVersionCode,
      });
      return;
    }
    if (!loadExistingPackage) {
      toast.error("当前模式无法读取仓库中的包体");
      return;
    }
    setVersionEditorLoadingUid(item.uid);
    try {
      setVersionEditor({
        uid: item.uid,
        file: await loadExistingPackage(item),
        previousVersionCode,
      });
    } catch (error) {
      toast.error(`无法读取仓库中的包体：${(error as Error).message}`);
    } finally {
      setVersionEditorLoadingUid(null);
    }
  };

  return (
    <SectionCard
      title={title}
      description={description}
      fieldKey={fieldKey}
      headerExtra={
        <FieldHelpButton
          onClick={() => setHelpOpen(true)}
          title="下载配置字段说明"
        />
      }
    >
      {deviceError && (
        <Callout.Root color="amber">
          <Callout.Icon>
            <WarningDiamondIcon size={18} weight="fill" />
          </Callout.Icon>
          <Callout.Text>{deviceError}</Callout.Text>
        </Callout.Root>
      )}
      {!deviceError && sortedDeviceOptions.length === 0 && (
        <Callout.Root color="red">
          <Callout.Icon>
            <WarningDiamondIcon size={18} weight="fill" />
          </Callout.Icon>
          <Callout.Text>设备列表不可用，请稍后重试</Callout.Text>
        </Callout.Root>
      )}
      <div className="flex flex-col gap-3 max-w-full">
        <div className="flex items-center gap-1.5 px-1">
          {onBatchSetDevices && (
            <Popover.Root
              open={batchSelectOpen}
              onOpenChange={setBatchSelectOpen}
            >
              <Popover.Trigger>
                <Button
                  size="1"
                  variant="soft"
                  color="gray"
                  radius="large"
                  className="text-xs!"
                  disabled={sortedDeviceOptions.length === 0 || isDeviceLoading}
                >
                  <ListChecksIcon size={14} />
                  批量选择设备
                </Button>
              </Popover.Trigger>
              <Popover.Content width="320px">
                <BatchDeviceSelector
                  vendorGroups={vendorGroups}
                  selectedIds={selectedDeviceIds}
                  onApply={handleBatchApply}
                  onCancel={() => setBatchSelectOpen(false)}
                />
              </Popover.Content>
            </Popover.Root>
          )}
          {onFillAll && (
            <AlertDialog.Root open={fillAllOpen} onOpenChange={setFillAllOpen}>
              <AlertDialog.Trigger>
                <Button
                  size="1"
                  variant="soft"
                  color="gray"
                  radius="large"
                  className="text-xs!"
                  disabled={!hasTemplate}
                >
                  <CopyIcon size={14} />
                  一键填充
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="420px">
                <AlertDialog.Title>一键填充配置</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  将第一行已填写的版本号、包体文件、加密上传设置和更新日志复制到所有其他设备行。所有行会共用同一份包体，加密状态也随之共用：之后任意一行切换开关，其他行会一起切换。此操作会覆盖已有配置，确定继续吗？
                </AlertDialog.Description>
                <div className="flex justify-end gap-3 mt-4">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">
                      取消
                    </Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <Button variant="solid" onClick={handleFillAll}>
                      确认填充
                    </Button>
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Root>
          )}
          <Button
            size="1"
            variant="soft"
            radius="large"
            className="text-xs! md:hidden"
            disabled={sortedDeviceOptions.length === 0 || isDeviceLoading}
            onClick={onAddRow}
          >
            <PlusIcon size={14} weight="bold" />
            添加设备
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          {downloads.length === 0 ? (
            <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-white/45">
              {emptyMessage}
            </p>
          ) : (
            downloads.map((item, index) => (
              <div
                key={item.uid || `download-${index}`}
                data-download-row-uid={item.uid}
                className={`flex flex-col gap-2.5 rounded-lg border bg-black/20 p-2.5 ${
                  isNonIncrementRow(item)
                    ? "border-red-400/60"
                    : "border-white/10"
                }`}
              >
                <div className="flex items-center gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2 md:max-w-md">
                    <span className="shrink-0 text-xs font-medium text-white/55">
                      设备 {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Select.Root
                        value={item.platformId || undefined}
                        onValueChange={(value) => {
                          const device = sortedDeviceOptions.find(
                            (opt) => opt.id === value,
                          );
                          log.info("download/row", "选择设备", {
                            data: {
                              deviceId: value,
                              deviceName: device?.name ?? null,
                            },
                          });
                          onUpdateRow(item.uid, (row) => ({
                            ...row,
                            platformId: value,
                          }));
                        }}
                      >
                        <Select.Trigger
                          radius="large"
                          placeholder="请选择设备"
                          className="w-full whitespace-normal"
                        />
                        <Select.Content position="popper">
                          {selectDeviceOptions.map((opt) => {
                            const usedElsewhere = downloads.some(
                              (row, idx) =>
                                idx !== index && row.platformId === opt.id,
                            );
                            // 没有禁用文案时不拦截，避免“灰着又不说为什么”。
                            const vendorRestricted =
                              Boolean(disabledDeviceTitle) &&
                              !supportedDeviceIds.has(opt.id);
                            return (
                              <Select.Item
                                key={opt.id}
                                value={opt.id}
                                disabled={usedElsewhere || vendorRestricted}
                                title={
                                  vendorRestricted
                                    ? disabledDeviceTitle
                                    : undefined
                                }
                                className={
                                  vendorRestricted
                                    ? "cursor-not-allowed!"
                                    : undefined
                                }
                              >
                                {opt.name}
                                {usedElsewhere ? "（已使用）" : ""}
                              </Select.Item>
                            );
                          })}
                        </Select.Content>
                      </Select.Root>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="删除该设备行"
                    title="删除"
                    className="ml-auto shrink-0 rounded-lg p-1 text-red-400 transition hover:bg-red-500/10 hover:text-red-300"
                    onClick={() => onRemoveRow(item.uid)}
                  >
                    <MinusIcon size={16} weight="bold" />
                  </button>
                </div>

                <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center md:gap-x-4 md:gap-y-2">
                  {(item.file || item.existingFileName) && (
                    <div className="min-w-0 md:grow md:shrink md:basis-[300px]">
                      {item.versionLocked ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-white/[0.06] px-2 py-1 text-sm text-white/85">
                            {item.version ? `版本 ${item.version}` : "版本未知"}
                            {item.versionCode !== undefined && (
                              <span className="text-xs text-white/45">
                                versionCode {item.versionCode}
                              </span>
                            )}
                            <span
                              title={
                                // 不能只凭 packageWritable 判断是不是 rpk：canopus
                                // 同样不可改写，但原因和处理方式完全不同。按包体
                                // 来源区分，来源未知时保持中性描述。
                                item.encryptOnUpload
                                  ? "该包体已加密上传，无法在控制台内读取并改写版本"
                                  : item.canopus
                                    ? "由包体自动读取；点击「修改版本」时会重新校验能否改写"
                                    : item.packageSource === "zip-manifest"
                                      ? "由包体自动读取；已签名的 rpk 无法在控制台内改写版本，需在构建工具链重新打包"
                                      : item.packageWritable === false
                                        ? item.packageUnwritableReason ??
                                          "由包体自动读取并锁定，无法在控制台内改写版本"
                                        : "由包体自动读取，可点击右侧「修改版本」调整"
                              }
                            >
                              <LockSimpleIcon
                                size={13}
                                weight="bold"
                                className="text-white/45"
                              />
                            </span>
                          </span>
                          {item.file &&
                            !item.encryptOnUpload &&
                            (item.packageWritable === true ||
                              Boolean(item.canopus)) && (
                              <Button
                                size="1"
                                variant="soft"
                                color="gray"
                                disabled={versionEditorLoadingUid === item.uid}
                                title="修改包体版本"
                                onClick={() => void openVersionEditor(item)}
                              >
                                <PencilSimpleLineIcon size={13} weight="bold" />
                                {versionEditorLoadingUid === item.uid
                                  ? "读取中…"
                                  : "修改版本"}
                              </Button>
                            )}
                          {/*
                            rpk 只读时给一条常驻说明。不能只藏掉「修改版本」按钮
                            ——那会让创作者以为版本被锁死是 Bug，或去别处找绕开的
                            办法。必须把「去工具链改 manifest.json 后重新打包再导入」
                            这条唯一出路直接写在这里。
                            这条例外说明只属于 rpk：canopus 也不可改写，但原因与
                            rpk 签名无关，套用 rpk 文案会让创作者去改不存在的东西。
                          */}
                          {item.file &&
                            !item.file.skipUpload &&
                            item.packageSource === "zip-manifest" && (
                              <span className="w-full basis-full text-xs leading-relaxed text-amber-200/80">
                                已签名的 rpk 无法在控制台内改版本：改动包内任一字节都会让手环验签失败、装不上。
                                请在 rpk 构建工具链里改好 <code>manifest.json</code> 的{" "}
                                <code>versionName</code> / <code>versionCode</code>，用{" "}
                                <code>aiot release</code> 重新打包，再回这里重新导入包体。
                              </span>
                            )}
                          {item.previousVersion !== undefined ||
                          item.previousVersionCode !== undefined ? (
                            <span className="text-xs text-white/40">
                              {item.versionSource === "package"
                                ? "版本更新："
                                : "上次发布 "}
                              {item.versionSource === "package" ? (
                                <>
                                  {formatVersionWithCode(
                                    item.previousVersion,
                                    item.previousVersionCode,
                                  )}
                                  {" → "}
                                  {formatVersionWithCode(
                                    item.version,
                                    item.versionCode,
                                  )}
                                </>
                              ) : (
                                formatVersionWithCode(
                                  item.previousVersion,
                                  item.previousVersionCode,
                                )
                              )}
                            </span>
                          ) : null}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1 md:w-36 md:flex-none">
                            <TextField.Root
                              placeholder="版本号"
                              value={item.version}
                              radius="large"
                              disabled={!item.file}
                              className="min-w-0 w-full"
                              onChange={(e) => {
                                const device = sortedDeviceOptions.find(
                                  (opt) => opt.id === item.platformId,
                                );
                                logFieldChange(
                                  `download-version-${item.uid}`,
                                  `版本号(${device?.name ?? (item.platformId || "未选设备")})`,
                                  e.target.value,
                                );
                                onUpdateRow(item.uid, (row) => ({
                                  ...row,
                                  version: e.target.value,
                                }));
                              }}
                            />
                          </div>
                          <div
                            className="min-w-0 flex-1 md:w-28 md:flex-none"
                            title="数字版本号（versionCode），客户端用它检测是否有更新"
                          >
                            <TextField.Root
                              placeholder="versionCode"
                              value={
                                item.versionCode !== undefined
                                  ? String(item.versionCode)
                                  : ""
                              }
                              radius="large"
                              disabled={!item.file}
                              className="min-w-0 w-full"
                              inputMode="numeric"
                              onChange={(e) => {
                                const device = sortedDeviceOptions.find(
                                  (opt) => opt.id === item.platformId,
                                );
                                const raw = e.target.value.trim();
                                const parsed = raw === "" ? NaN : Number(raw);
                                logFieldChange(
                                  `download-version-code-${item.uid}`,
                                  `versionCode(${device?.name ?? (item.platformId || "未选设备")})`,
                                  raw,
                                );
                                onUpdateRow(item.uid, (row) => ({
                                  ...row,
                                  versionCode:
                                    raw !== "" && Number.isFinite(parsed) && parsed >= 0
                                      ? Math.trunc(parsed)
                                      : undefined,
                                }));
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {(item.file || item.existingFileName) && (
                    <div className="flex min-w-0 items-center gap-2 md:grow md:shrink md:basis-[200px]">
                      {item.file ? (
                        <span className="min-w-0 truncate text-white/80">
                          {item.file.name}
                        </span>
                      ) : (
                        <span className="min-w-0 truncate text-emerald-100">
                          当前: {item.existingFileName}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {isNonIncrementRow(item) && (
                  <p className="text-xs text-red-300">
                    versionCode 未递增（{item.versionCode} ≤ 上次{" "}
                    {item.previousVersionCode}）
                    {/*
                      不可改写的行没有「修改版本」按钮（被 packageWritable
                      隐藏了），说「请点修改版本」是让人去找一个不存在的出口。
                      原因按包体来源取，rpk 与 canopus 各自回自己的工具链。
                    */}
                    {item.packageWritable === false
                      ? `，${item.packageUnwritableReason ?? "请按构建工具链重新打包导入。"}`
                      : "，请点「修改版本」。"}
                  </p>
                )}

                <div className="flex flex-wrap items-center justify-end gap-2">
                  {isVip && allowEncryption && (
                    <div className="flex shrink-0 items-center gap-2 max-lg:ml-auto">
                      <span className="text-xs text-white/65">加密上传</span>
                      {/*
                        加密是整份包体的属性：一键填充把同一个包体复制到所有行，
                        发布时也按同一路径上传、只登记一份密钥。因此开关必须按
                        「共用包体」分组联动——只切一行会让同一路径既加密又不加密，
                        服务端还会漏登记其余设备行的密钥。禁用状态同样按分组判定：
                        组内只要有一行是本次会上传的新包体，整组都可切换。
                      */}
                      <Switch
                        checked={Boolean(item.encryptOnUpload)}
                        disabled={
                          !downloads.some(
                            (row) =>
                              rowsSharePackage(row, item) &&
                              canTogglePackageEncryption(row),
                          )
                        }
                        title={encryptionLockedTitle(item, downloads)}
                        onCheckedChange={(checked) => {
                          const sharedRows = downloads.filter((row) =>
                            rowsSharePackage(row, item),
                          );
                          log.info("download/row", "切换加密上传", {
                            data: {
                              deviceId: item.platformId,
                              encryptOnUpload: checked,
                              sharedDeviceIds: sharedRows
                                .filter((row) => row.uid !== item.uid)
                                .map((row) => row.platformId),
                            },
                          });
                          // 共用同一包体的行必须同开同关。逐行更新走函数式
                          // setState，父组件会按顺序合并，不会互相覆盖。
                          for (const row of sharedRows) {
                            onUpdateRow(row.uid, (current) => ({
                              ...current,
                              encryptOnUpload: checked,
                            }));
                          }
                        }}
                      />
                      {/*
                        付费映射与自有网站授权的入口不再挂在「加密上传」开关之下。
                        付费与加密是两项独立功能：「付费但不加密」（走自有支付路径校验）
                        与「仅加密不售卖」都是合法配置，若继续以 encryptOnUpload 作为
                        渲染前提，这两种作者在发布页将无从配置。
                      */}
                      <EncryptConfigDialog
                        resourceId={resourceId || ""}
                        deviceId={item.platformId}
                        deviceName={
                          sortedDeviceOptions.find(
                            (opt) => opt.id === item.platformId,
                          )?.name || item.platformId
                        }
                        triggerDisabled={false}
                        onMappingStateChange={onPaidMappingStateChange}
                        allDeviceIds={downloads
                          .map((d) => d.platformId)
                          .filter(Boolean)}
                      />
                    </div>
                  )}
                  <div className="flex shrink-0 items-center gap-2 lg:ml-auto">
                    <Button
                      radius="large"
                      variant="soft"
                      color="gray"
                      onClick={() =>
                        setUpdateLogEditor({
                          uid: item.uid,
                          packageVersion: item.version ?? "",
                          entries: (item.updatelogs ?? []).map((log) => ({
                            version: log.version,
                            content: log.content,
                          })),
                        })
                      }
                    >
                      <NotebookIcon size={16} weight="bold" />
                      配置更新日志
                      {item.updatelogs && item.updatelogs.length > 0
                        ? `（${item.updatelogs.length} 条）`
                        : ""}
                    </Button>
                    <Button
                      radius="large"
                      variant={
                        item.file || item.existingFileName ? "outline" : "solid"
                      }
                      onClick={() => void pickDownloadFile(item.uid)}
                    >
                      <UploadSimpleIcon size={16} weight="bold" />
                      {item.previousVersion !== undefined ||
                      item.previousVersionCode !== undefined
                        ? "更新包体"
                        : item.file || item.existingFileName
                          ? "更换包体"
                          : "导入包体"}
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {versionEditor && (
        <VersionEditorDialog
          open={versionEditor !== null}
          onOpenChange={(open) => {
            if (!open) setVersionEditor(null);
          }}
          file={versionEditor.file}
          previousVersionCode={versionEditor.previousVersionCode}
          requireVersionIncrement={requireVersionIncrement}
          onApply={applyVersionEdit}
        />
      )}

      {updateLogEditor && (
        <UpdateLogEditorDialog
          packageVersion={updateLogEditor.packageVersion}
          initialEntries={updateLogEditor.entries}
          onClose={() => setUpdateLogEditor(null)}
          onSave={saveUpdateLogs}
        />
      )}

      <FieldHelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title={`${title}字段说明`}
        items={DOWNLOAD_FIELD_HELP}
      />
    </SectionCard>
  );
}

function UpdateLogCard({
  log,
  index,
  entryCount,
  duplicated,
  onDragHandlePointerDown,
  onMove,
  onRemove,
  onVersionChange,
  onContentChange,
}: {
  log: UpdateLogDraft;
  index: number;
  entryCount: number;
  duplicated: boolean;
  onDragHandlePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  onVersionChange: (version: string) => void;
  onContentChange: (content: string) => void;
}) {
  return (
    <div
      data-log-slot=""
      data-log-id={log.id}
      className={`rounded-lg border bg-white/[0.03] p-3 ${
        duplicated ? "border-red-400/45" : "border-white/10"
      }`}
    >
      <div className="mb-2 flex items-center gap-1">
        <div
          role="button"
          tabIndex={0}
          aria-label="拖动排序"
          className="cursor-grab touch-none rounded p-1.5 text-white/40 active:cursor-grabbing"
          onPointerDown={onDragHandlePointerDown}
        >
          <DotsSixVerticalIcon size={15} weight="bold" />
        </div>
        <span className="min-w-0 flex-1 text-xs font-medium text-white/55">
          第 {index + 1} 条
        </span>
        <button
          type="button"
          disabled={index === 0}
          className="rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-20"
          onClick={() => onMove(-1)}
          aria-label="上移"
        >
          <ArrowUpIcon size={14} />
        </button>
        <button
          type="button"
          disabled={index === entryCount - 1}
          className="rounded p-1 text-white/50 transition hover:bg-white/10 hover:text-white disabled:opacity-20"
          onClick={() => onMove(1)}
          aria-label="下移"
        >
          <ArrowDownIcon size={14} />
        </button>
        <Button size="1" variant="ghost" color="red" onClick={onRemove}>
          <TrashIcon size={14} />
          删除
        </Button>
      </div>
      <TextField.Root
        placeholder="版本号，如 1.2.0"
        value={log.version}
        radius="large"
        color={duplicated ? "red" : undefined}
        className="w-full"
        onChange={(event) => onVersionChange(event.target.value)}
      />
      {duplicated && (
        <p className="mt-1 text-xs text-red-300">版本号与其他日志重复</p>
      )}
      <TextArea
        placeholder="本次更新内容，每行一条"
        value={log.content}
        radius="large"
        className="mt-2 w-full"
        rows={3}
        onChange={(event) => onContentChange(event.target.value)}
      />
    </div>
  );
}

/** 高次幂的缓入缓出，两端很平、中间很陡。 */
function easeInOutPow(t: number, power: number) {
  const clamped = Math.min(1, Math.max(0, t));
  const scale = 2 ** (power - 1);
  if (clamped < 0.5) return scale * clamped ** power;
  return 1 - (-2 * clamped + 2) ** power / 2;
}

function easeInOutPowInverse(amount: number, power: number) {
  const clamped = Math.min(1, Math.max(0, amount));
  const scale = 2 ** (power - 1);
  if (clamped < 0.5) return (clamped / scale) ** (1 / power);
  return 1 - ((1 - clamped) / scale) ** (1 / power);
}

function UpdateLogEditorDialog({
  packageVersion,
  initialEntries,
  onClose,
  onSave,
}: {
  packageVersion: string;
  initialEntries: UpdateLogEntry[];
  onClose: () => void;
  onSave: (entries: UpdateLogEntry[]) => void;
}) {
  const [entries, setEntries] = useState<UpdateLogDraft[]>(() =>
    initialEntries.map((log) => createUpdateLogDraft(log.version, log.content)),
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const entriesRef = useRef(entries);
  const dragSessionRef = useRef<{
    pointerId: number;
    id: string;
    fromIndex: number;
    slot: number;
    scroll: number;
    visual: number;
    animFrom: number;
    animTo: number;
    animStart: number;
    cardCenterY: number;
    lastTick: number;
    ready: boolean;
    dropping: boolean;
  } | null>(null);
  const pointerListenersRef = useRef<{
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
  } | null>(null);
  const dropTimerRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [edgePad, setEdgePad] = useState(0);
  const [dropping, setDropping] = useState(false);
  const [lifted, setLifted] = useState<{
    id: string;
    version: string;
    content: string;
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  entriesRef.current = entries;
  const duplicates = useMemo(() => {
    const persisted = entries.filter(
      (entry) => entry.version.trim() || entry.content.trim(),
    );
    return duplicateUpdateLogVersions(persisted);
  }, [entries]);
  const detachPointerListeners = () => {
    const listeners = pointerListenersRef.current;
    if (!listeners) return;
    window.removeEventListener("pointermove", listeners.move);
    window.removeEventListener("pointerup", listeners.up);
    window.removeEventListener("pointercancel", listeners.up);
    pointerListenersRef.current = null;
  };

  /** 界面缩放后，把屏幕坐标换回布局像素，避免拖起的卡片被放大撑出横向滚动。 */
  const localScale = (node: HTMLElement) => {
    const layoutWidth = node.offsetWidth;
    if (layoutWidth <= 0) return 1;
    const scale = node.getBoundingClientRect().width / layoutWidth;
    return scale > 0.01 ? scale : 1;
  };

  const getScroller = () => {
    const list = listRef.current;
    if (!list) return null;
    return (
      list.closest<HTMLElement>("[data-overlayscrollbars-viewport]") ??
      list.parentElement
    );
  };

  const slotCards = () => {
    const list = listRef.current;
    if (!list) return [];
    return Array.from(list.querySelectorAll<HTMLElement>("[data-log-slot]"));
  };

  /** 每个缝对齐到固定线时，滚动容器应处的 scrollTop。 */
  const measureSlotScrollTops = (scroller: HTMLElement, cards: HTMLElement[]) => {
    const scrollerRect = scroller.getBoundingClientRect();
    const lineY = scrollerRect.top + scrollerRect.height / 2;
  const transform = getComputedStyle(scroller).transform;
  const scale =
    !transform || transform === "none" ? 1 : new DOMMatrix(transform).a || 1;
  const toScrollTop = (anchorY: number) =>
    scroller.scrollTop + (anchorY - lineY) / (scale > 0.01 ? scale : 1);
    if (cards.length === 0) return [scroller.scrollTop];
    const first = cards[0].getBoundingClientRect();
    const targets = [toScrollTop(first.top)];
    for (let index = 0; index < cards.length - 1; index++) {
      const above = cards[index].getBoundingClientRect();
      const below = cards[index + 1].getBoundingClientRect();
      targets.push(toScrollTop((above.bottom + below.top) / 2));
    }
    const last = cards[cards.length - 1].getBoundingClientRect();
    targets.push(toScrollTop(last.bottom));
    return targets;
  };

  const endDrag = () => {
    if (dropTimerRef.current != null) {
      window.clearTimeout(dropTimerRef.current);
      dropTimerRef.current = null;
    }
    if (scrollRafRef.current != null) {
      window.cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = null;
    }
    const scroller = getScroller();
    if (scroller) {
      scroller.style.height = "";
      scroller.style.maxHeight = "";
      scroller.style.transform = "";
      const node = scroller;
      window.setTimeout(() => {
        node.style.transition = "";
        node.style.transformOrigin = "";
      }, 170);
    }
    detachPointerListeners();
    dragSessionRef.current = null;
    setDraggingId(null);
    setLifted(null);
    setDropping(false);
    setEdgePad(0);
  };

  useEffect(() => {
    if (!draggingId) return;
    const scroller = getScroller();
    const session = dragSessionRef.current;
    if (!scroller || !session) return;
    scroller.style.transition = "transform 150ms ease";
    scroller.style.transformOrigin = "center center";
    scroller.style.transform = "scale(0.9)";
    const align = (markReady: boolean) => {
      const current = dragSessionRef.current;
      if (!current || current.dropping || current.ready) return;
      const targets = measureSlotScrollTops(scroller, slotCards());
      if (targets.length === 0) return;
      const slot = Math.min(current.fromIndex, targets.length - 1);
      scroller.scrollTop = Math.max(0, targets[slot]);
      current.slot = slot;
      current.scroll = scroller.scrollTop;
      current.visual = scroller.scrollTop;
      current.animFrom = scroller.scrollTop;
      current.animTo = scroller.scrollTop;
      current.animStart = 0;
      if (markReady) current.ready = true;
    };
    const frame = requestAnimationFrame(() => align(false));
    const timer = window.setTimeout(() => align(true), 160);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [draggingId, edgePad]);

  useEffect(() => {
    return () => {
      if (dropTimerRef.current != null) {
        window.clearTimeout(dropTimerRef.current);
      }
      if (scrollRafRef.current != null) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
      const listeners = pointerListenersRef.current;
      if (!listeners) return;
      window.removeEventListener("pointermove", listeners.move);
      window.removeEventListener("pointerup", listeners.up);
      window.removeEventListener("pointercancel", listeners.up);
    };
  }, []);

  const moveEntry = (fromId: string, toId: string) => {
    setEntries((current) => reorderById(current, fromId, toId));
  };

  const startHandleDrag = (
    event: ReactPointerEvent<HTMLDivElement>,
    id: string,
    index: number,
  ) => {
    if (entriesRef.current.length < 2 || dragSessionRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    const card = event.currentTarget.closest("[data-log-id]");
    const frame = viewportRef.current;
    const scroller = getScroller();
    if (!(card instanceof HTMLElement) || !frame || !scroller) return;
    const cardRect = card.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const uiScale = localScale(frame);
    const entry = entriesRef.current.find((item) => item.id === id);
    const lockedHeight = scroller.clientHeight;
    scroller.style.height = `${lockedHeight}px`;
    scroller.style.maxHeight = `${lockedHeight}px`;
    dragSessionRef.current = {
      pointerId: event.pointerId,
      id,
      fromIndex: index,
      slot: index,
      scroll: scroller.scrollTop,
      visual: scroller.scrollTop,
      animFrom: scroller.scrollTop,
      animTo: scroller.scrollTop,
      animStart: 0,
      cardCenterY: cardRect.top + cardRect.height / 2,
      lastTick: 0,
      ready: false,
      dropping: false,
    };
    setEdgePad(lockedHeight / 2);
    setDropping(false);
    setLifted({
      id,
      version: entry?.version ?? "",
      content: entry?.content ?? "",
      left: (cardRect.left - frameRect.left) / uiScale,
      top: (cardRect.top - frameRect.top) / uiScale,
      width: cardRect.width / uiScale,
      height: cardRect.height / uiScale,
    });
    setDraggingId(id);

    const move = (ev: PointerEvent) => {
      const session = dragSessionRef.current;
      const frameNode = viewportRef.current;
      if (!session || session.dropping || ev.pointerId !== session.pointerId) return;
      if (!frameNode) return;
      ev.preventDefault();
      const frameRectNow = frameNode.getBoundingClientRect();
      const uiScale = localScale(frameNode);
      session.cardCenterY =
        ev.clientY - (event.clientY - cardRect.top) + cardRect.height / 2;
      setLifted((current) =>
        current
          ? {
              ...current,
              top:
                (ev.clientY - frameRectNow.top - (event.clientY - cardRect.top)) /
                uiScale,
            }
          : current,
      );
    };
    const tick = (now: number) => {
      scrollRafRef.current = window.requestAnimationFrame(tick);
      const session = dragSessionRef.current;
      const scrollNode = getScroller();
      if (!session || !scrollNode || session.dropping || !session.ready) {
        if (session) session.lastTick = now;
        return;
      }
      const dt = session.lastTick
        ? Math.min(0.05, (now - session.lastTick) / 1000)
        : 0;
      session.lastTick = now;
      if (dt <= 0) return;
      const targets = measureSlotScrollTops(scrollNode, slotCards());
      if (targets.length === 0) return;
      const scrollRect = scrollNode.getBoundingClientRect();
      const lineY = scrollRect.top + scrollRect.height / 2;
      const offset = session.cardCenterY - lineY;
      const distance = Math.abs(offset) - 12;
      if (distance > 0) {
        const direction = offset > 0 ? 1 : -1;
        const speed = Math.min(distance / 120, 1) * 460;
        session.scroll += direction * speed * dt;
        const lo = Math.min(...targets);
        const hi = Math.max(...targets);
        session.scroll = Math.min(hi, Math.max(lo, session.scroll));
      }
      let nearest = 0;
      let best = Number.POSITIVE_INFINITY;
      for (let slot = 0; slot < targets.length; slot++) {
        const gap = Math.abs(session.scroll - targets[slot]);
        if (gap < best) {
          best = gap;
          nearest = slot;
        }
      }
      session.slot = nearest;
      const target = Math.max(0, targets[nearest]);
      const easePower = 6;
      const easeMs = 240;
      if (Math.abs(target - session.animTo) > 0.5) {
        const previousSpan = session.animTo - session.animFrom;
        const traveled =
          previousSpan === 0
            ? 0
            : (session.visual - session.animFrom) / previousSpan;
        const sameWay =
          Math.abs(previousSpan) > 0.5 &&
          Math.sign(target - session.visual) === Math.sign(previousSpan) &&
          traveled > 0 &&
          traveled < 1;
        if (sameWay) {
          const nextSpan = target - session.animFrom;
          const nextAmount =
            nextSpan === 0 ? 1 : (session.visual - session.animFrom) / nextSpan;
          const progress = easeInOutPowInverse(nextAmount, easePower);
          session.animTo = target;
          session.animStart = now - progress * easeMs;
        } else {
          session.animFrom = session.visual;
          session.animTo = target;
          session.animStart = now;
        }
      }
      const progress = Math.min(1, Math.max(0, (now - session.animStart) / easeMs));
      session.visual =
        session.animFrom +
        (session.animTo - session.animFrom) * easeInOutPow(progress, easePower);
      if (Math.abs(target - session.visual) < 0.4) {
        session.visual = target;
        session.animFrom = target;
        session.animTo = target;
      }
      scrollNode.scrollTop = Math.max(0, session.visual);
    };
    const up = (ev: PointerEvent) => {
      const session = dragSessionRef.current;
      const frameNode = viewportRef.current;
      const scrollNode = getScroller();
      if (!session || ev.pointerId !== session.pointerId || session.dropping) return;
      session.dropping = true;
      detachPointerListeners();
      if (!frameNode || !scrollNode) {
        endDrag();
        return;
      }
      setDropping(true);
      requestAnimationFrame(() => {
        const frameRectNow = frameNode.getBoundingClientRect();
        const scrollRect = scrollNode.getBoundingClientRect();
        const lineY = scrollRect.top + scrollRect.height / 2;
        const uiScale = localScale(frameNode);
        setLifted((current) =>
          current
            ? {
                ...current,
                top: (lineY - frameRectNow.top) / uiScale - current.height / 2,
              }
            : current,
        );
        dropTimerRef.current = window.setTimeout(() => {
          dropTimerRef.current = null;
          const latest = dragSessionRef.current;
          if (latest) {
            setEntries((current) =>
              moveToSlot(current, latest.fromIndex, latest.slot),
            );
          }
          endDrag();
        }, 160);
      });
    };
    detachPointerListeners();
    pointerListenersRef.current = { move, up };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    scrollRafRef.current = window.requestAnimationFrame(tick);
  };

  const addEntry = () => {
    const version = nextUpdateLogVersion(entries, packageVersion);
    setEntries((current) => [createUpdateLogDraft(version), ...current]);
  };

  const save = () => {
    const cleaned = entries
      .map((log) => ({
        version: log.version.trim(),
        content: log.content.trim(),
      }))
      .filter((log) => log.version || log.content);
    const duplicated = duplicateUpdateLogVersions(cleaned);
    if (duplicated.size > 0) {
      const label = [...duplicated]
        .map((version) => (version ? version : "（空版本号）"))
        .join("、");
      toast.error(`更新日志的版本号不能重复：${label}`);
      return;
    }
    onSave(cleaned);
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <Dialog.Content maxWidth="620px">
        <Dialog.Title>配置更新日志</Dialog.Title>
        <Dialog.Description size="2">
          越靠上的日志越先显示。新添加的一条默认使用当前导入包的版本号；该版本已有日志时版本号留空。拖动左侧手柄或点上下箭头可调整顺序。
        </Dialog.Description>
        <div ref={viewportRef} className="relative mt-3 overflow-x-clip">
        <ScrollArea
          className={`max-h-[var(--ui-viewport-height-52pct)] ${
            draggingId ? "log-drag-scroll" : ""
          }`}
        >
          <div
            ref={listRef}
            className={`flex flex-col gap-3 pr-1 ${draggingId ? "touch-none select-none" : ""}`}
            style={
              edgePad > 0
                ? { paddingTop: edgePad, paddingBottom: edgePad }
                : undefined
            }
          >
            {entries.map((log, index) => {
              if (log.id === draggingId) return null;
              const versionKey = log.version.trim();
              const duplicated =
                duplicates.has(versionKey) &&
                (versionKey !== "" || log.content.trim() !== "");
              return (
                <UpdateLogCard
                  key={log.id}
                  log={log}
                  index={index}
                  entryCount={entries.length}
                  duplicated={duplicated}
                  onDragHandlePointerDown={(event) =>
                    startHandleDrag(event, log.id, index)
                  }
                  onMove={(direction) => {
                    const target = entries[index + direction];
                    if (target) moveEntry(log.id, target.id);
                  }}
                  onRemove={() =>
                    setEntries((current) =>
                      current.filter((entry) => entry.id !== log.id),
                    )
                  }
                  onVersionChange={(version) =>
                    setEntries((current) =>
                      current.map((entry) =>
                        entry.id === log.id ? { ...entry, version } : entry,
                      ),
                    )
                  }
                  onContentChange={(content) =>
                    setEntries((current) =>
                      current.map((entry) =>
                        entry.id === log.id ? { ...entry, content } : entry,
                      ),
                    )
                  }
                />
              );
            })}
            {entries.length === 0 && (
              <p className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-white/45">
                还没有更新日志。可添加多条，按版本展示更新内容。
              </p>
            )}
          </div>
        </ScrollArea>
        {draggingId && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-3 top-1/2 z-10 h-0.5 -translate-y-1/2 rounded-full bg-blue-400"
          />
        )}
        {lifted && (
          <div
            className={`pointer-events-none absolute z-20 ${
              dropping ? "transition-[top,left] duration-150 ease-out" : ""
            }`}
            style={{
              left: lifted.left,
              top: lifted.top,
              width: lifted.width,
            }}
          >
            {entries
              .filter((entry) => entry.id === lifted.id)
              .map((entry) => {
                const liftedIndex = entries.findIndex((item) => item.id === entry.id);
                const versionKey = entry.version.trim();
                const duplicated =
                  duplicates.has(versionKey) &&
                  (versionKey !== "" || entry.content.trim() !== "");
                return (
                  <UpdateLogCard
                    key={entry.id}
                    log={entry}
                    index={liftedIndex}
                    entryCount={entries.length}
                    duplicated={duplicated}
                    onDragHandlePointerDown={() => {}}
                    onMove={() => {}}
                    onRemove={() => {}}
                    onVersionChange={() => {}}
                    onContentChange={() => {}}
                  />
                );
              })}
          </div>
        )}
        </div>
        {duplicates.size > 0 && (
          <p className="mt-2 text-xs text-red-300">
            存在重复的版本号，请修改后再保存。
          </p>
        )}
        <div className="mt-3 flex items-center justify-between gap-2">
          <Button size="1" variant="soft" color="gray" onClick={addEntry}>
            <PlusIcon size={14} weight="bold" />
            添加一条
          </Button>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="soft" color="gray" onClick={onClose}>
              取消
            </Button>
            <Button onClick={save}>
              <ChecksIcon size={14} weight="bold" />
              保存
            </Button>
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

function BatchDeviceSelector({
  vendorGroups,
  selectedIds,
  onApply,
  onCancel,
}: {
  vendorGroups: Map<string, DeviceOption[]>;
  selectedIds: Set<string>;
  onApply: (ids: string[]) => void;
  onCancel: () => void;
}) {
  const allIds = useMemo(
    () => Array.from(vendorGroups.values()).flat().map((d) => d.id),
    [vendorGroups],
  );
  const [pending, setPending] = useState<Set<string>>(
    () => new Set(selectedIds),
  );

  const toggle = (id: string) => {
    setPending((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setPending((prev) => {
      if (prev.size === allIds.length) return new Set();
      return new Set(allIds);
    });
  };

  const allSelected = pending.size === allIds.length && allIds.length > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <Text size="2" weight="medium">
          选择支持的设备
        </Text>
        <Button
          size="1"
          variant="ghost"
          color="gray"
          onClick={toggleAll}
          className="text-xs!"
        >
          {allSelected ? "取消全选" : "全选"}
        </Button>
      </div>
      <ScrollArea className="max-h-[280px]">
        <div className="flex flex-col gap-2.5">
          {Array.from(vendorGroups.entries()).map(([vendor, devices]) => (
            <div key={vendor} className="flex flex-col gap-1">
              <Text size="1" color="gray" weight="medium" className="px-0.5">
                {vendor}
              </Text>
              <div className="flex flex-col gap-0.5">
                {devices.map((device) => (
                  <label
                    key={device.id}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-white/5 cursor-pointer transition"
                  >
                    <Checkbox
                      checked={pending.has(device.id)}
                      onCheckedChange={() => toggle(device.id)}
                    />
                    <Text size="2" className="flex-1">
                      {device.name}
                    </Text>
                    <Text size="1" color="gray">
                      {device.id}
                    </Text>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
      <div className="flex justify-between items-center pt-1 border-t border-white/10">
        <Text size="1" color="gray">
          已选 {pending.size} / {allIds.length}
        </Text>
        <div className="flex gap-2">
          <Button size="1" variant="soft" color="gray" onClick={onCancel}>
            取消
          </Button>
          <Button
            size="1"
            variant="solid"
            onClick={() => onApply(Array.from(pending))}
          >
            <ChecksIcon size={14} />
            应用
          </Button>
        </div>
      </div>
    </div>
  );
}
