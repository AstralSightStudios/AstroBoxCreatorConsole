import {
  AlertDialog,
  Button,
  Callout,
  Select,
  Switch,
  TextArea,
  TextField,
  SegmentedControl,
} from "~/components/ScaleAwareThemes";
import {
  CurrencyCircleDollarIcon,
  DiceFiveIcon,
  EyeSlashIcon,
  FingerprintIcon,
  SquaresFourIcon,
  TagIcon,
  TextAlignLeftIcon,
  TextTIcon,
  WarningDiamondIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Field,
  FieldHelpButton,
  FieldHelpDialog,
  type FieldHelpItem,
  SectionCard,
} from "./shared";
import { normalizeWatchfaceIdInput } from "~/logic/publish/watchface-id";
import { RES_PACK_THEME_ID_MAX_LENGTH } from "~/logic/publish/res-pack-id";
import {
  PUBLISH_TAGS_MIN,
  PUBLISH_TAGS_SUGGESTED_MAX,
} from "~/logic/publish/validation";
import { textContainsLink } from "~/logic/publish/description-links";
import type { ResourceType } from "~/logic/publish/resource-type";
import { NSFW_REASON_MAX } from "~/logic/publish/nsfw";
import type { IdMigrationNote } from "~/logic/publish/id-migration";

function describeItemId(resourceType: ResourceType): FieldHelpItem {
  if (resourceType === "quick_app") {
    return {
      label: "资源 ID（快应用）",
      description:
        "即快应用的包名，需与包体内的包名一致，否则资源无法自动检查更新。填法就是把你产品的域名反过来：官网是 www.yourname.com，就填 com.yourname.appname。未合入目录前可修改，修改后需用新包名重新打包再上传；合入目录后默认锁定，确需更换请点输入框下方的「修改资源 ID」。",
      links: [
        {
          label: "Oracle Java 语言规范 · 包命名",
          href: "https://docs.oracle.com/javase/specs/jls/se24/html/jls-6.html#jls-6.1",
        },
        {
          label: "Google Java Style Guide · 包命名",
          href: "https://google.github.io/styleguide/javaguide.html#s5.2.1-package-and-module-names",
        },
      ],
    };
  }
  if (resourceType === "watchface") {
    return {
      label: "资源 ID（表盘）",
      description:
        "表盘的唯一标识，12 位纯数字且以 9798 开头，可点「生成ID」自动生成。该 ID 会写入表盘文件；未合入前可修改，修改后重新上传包体会自动改写。合入目录后默认锁定，确需更换请点输入框下方的「修改资源 ID」。",
    };
  }
  if (resourceType === "res_pack") {
    return {
      label: "资源 ID（资源包）",
      description: `必须是小写字母、数字、下划线或连字符，长度 1–${RES_PACK_THEME_ID_MAX_LENGTH}。发布时会写入包内 corona.json 的 themeId，并提示改写结果。合入目录后尽量不要改动，否则设备上会出现两个主题目录；未合入前可修改，修改后重新上传包体会自动改写。确需更换请点输入框下方的「修改资源 ID」。`,
    };
  }
  return {
    label: "资源 ID（模块）",
    description:
      "模块的唯一标识，直接填写模块名称即可。须以小写字母开头，只含小写字母、数字和下划线，最长 16 个字符。未合入前可修改，修改后重新上传 manifest 即可。合入目录后默认锁定，确需更换请点输入框下方的「修改资源 ID」。",
  };
}

function buildFieldHelp(resourceType: ResourceType): FieldHelpItem[] {
  return [
    {
      group: "基本信息",
      label: "资源类型",
      icon: <SquaresFourIcon size={16} weight="duotone" />,
      description:
        "决定校验规则和资源 ID 格式：快应用校验包名、表盘校验 12 位数字 ID、模块仅支持字母数字下划线中划线、资源包要求小写标识并写入 themeId。资源包与模块目前仅支持小米设备。尚未合入目录的首次提交（含审核中的 PR），资源 ID 与类型都允许修改。已合入目录（发布上线）的资源也可以改类型，例如表盘改成模块；类型的 ID 格式不同时要连 ID 一起换。换 ID 的 PR 合入后，下载量、评分、评论、付费配置与购买记录会迁移到新 ID，AstroBox 会提示已安装旧 ID 的用户卸载旧资源并安装新资源。修改后需重新上传包体与 manifest 才能提交。",
    },
    {
      group: "基本信息",
      label: "资源名称",
      icon: <TextTIcon size={16} weight="duotone" />,
      description: "展示在资源列表和详情页的名称，建议简短直观。",
    },
    {
      group: "基本信息",
      icon: <FingerprintIcon size={16} weight="duotone" />,
      ...describeItemId(resourceType),
    },
    {
      group: "展示与分类",
      label: "资源简介",
      icon: <TextAlignLeftIcon size={16} weight="duotone" />,
      description:
        "必填。参与算法与推流，描述不准或内容单薄会让资源难以被目标用户看到，同时也是审核参考。请准确说明实际功能与适用场景。",
    },
    {
      group: "展示与分类",
      label: "标签",
      icon: <TagIcon size={16} weight="duotone" />,
      description: `必填，至少 ${PUBLISH_TAGS_MIN} 个。参与搜索与推流，是资源被用户找到的重要途径。请填写与资源功能贴合的标签，建议不超过 ${PUBLISH_TAGS_SUGGESTED_MAX} 个。`,
    },
    {
      group: "展示与分类",
      label: "敏感内容（NSFW）",
      icon: <EyeSlashIcon size={16} weight="duotone" />,
      description:
        "资源含血腥、恐怖等可能令人不适的内容时请打开，并写明原因。AstroBox 会默认模糊这类资源的封面（用户可在设置里选择直接显示），并在用户进入详情页前展示你填写的原因，确认后才继续。该声明不能让违规内容过审：色情、低俗等越过内容准则 1.1 的内容仍然不能上架；资源的名称、图标也仍须适合所有用户。",
      links: [
        {
          label: "资源内容规范 · 令人反感的内容",
          href: "https://abox.run/docs/creator-tools/resource-std/content#11-令人反感的内容",
        },
      ],
    },
    {
      group: "付费",
      label: "付费类型",
      icon: <CurrencyCircleDollarIcon size={16} weight="duotone" />,
      description:
        "免费：可直接使用。付费：可先体验部分功能，购买后解锁完整功能。强制付费：不购买则无法使用。",
      links: [
        {
          label: "资源标准 · 资源比例要求",
          href: "https://abox.run/docs/creator-tools/resource-std/rate",
        },
      ],
    },
  ];
}

interface BasicInfoSectionProps {
  itemId: string;
  itemName: string;
  description: string;
  tags: string[];
  tagInput: string;
  paidType: string;
  paidTypeDisabled?: boolean;
  resourceType: ResourceType;
  idError?: string;
  idGenerating?: boolean;
  idReadOnly?: boolean;
  /** 资源类型不可修改 */
  typeReadOnly?: boolean;
  /** 已上架资源、类型没变，ID 因此锁定（提示改类型后才能换 ID） */
  listedIdLocked?: boolean;
  /** 本次提交会把已上架资源换到新 ID */
  idMigration?: { fromId: string; toId: string } | null;
  /** 已上架资源、ID 锁定时的「修改资源 ID」入口；确认后果之后调用 */
  onRequestIdChange?: () => void;
  /** 创作者已主动放开 ID 修改（而不是因为改了类型） */
  idChangeUnlocked?: boolean;
  /** 放弃修改，恢复目录里的原 ID 并重新锁定 */
  onCancelIdChange?: () => void;
  /** 这个资源已有的换 ID 记录（登记中 / 已迁移 / 被拒绝） */
  idMigrationNotes?: IdMigrationNote[];
  /** 是否声明为敏感内容 */
  nsfwEnabled: boolean;
  /** 敏感内容原因，写入 manifest 的 ext.nsfw.reason */
  nsfwReason: string;
  onNsfwChange: (enabled: boolean) => void;
  onNsfwReasonChange: (reason: string) => void;
  onItemIdChange: (value: string) => void;
  /** ID 输入失焦时刷新一次目录占用数据，避免长时间停留导致缓存过期误报。 */
  onItemIdBlur?: () => void;
  onItemNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onAddTag: () => void;
  onRemoveTag: (index: number) => void;
  onTagInputChange: (value: string) => void;
  onPaidTypeChange: (value: string) => void;
  onResourceTypeChange: (value: ResourceType) => void;
  onGenerateId?: () => void;
}

export function BasicInfoSection({
  itemId,
  itemName,
  description,
  tags,
  tagInput,
  paidType,
  paidTypeDisabled,
  resourceType,
  idError,
  idGenerating,
  idReadOnly,
  typeReadOnly,
  listedIdLocked,
  idMigration,
  onRequestIdChange,
  idChangeUnlocked,
  onCancelIdChange,
  idMigrationNotes,
  nsfwEnabled,
  nsfwReason,
  onNsfwChange,
  onNsfwReasonChange,
  onItemIdChange,
  onItemIdBlur,
  onItemNameChange,
  onDescriptionChange,
  onAddTag,
  onRemoveTag,
  onTagInputChange,
  onPaidTypeChange,
  onResourceTypeChange,
  onGenerateId,
}: BasicInfoSectionProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [idChangeConfirmOpen, setIdChangeConfirmOpen] = useState(false);
  const fieldHelp = useMemo(() => buildFieldHelp(resourceType), [resourceType]);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
  const hasDescriptionLink = useMemo(
    () => textContainsLink(description),
    [description],
  );
  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [description]);
  return (
    <SectionCard
      title="基本信息"
      description="用于标识与展示的核心信息，务必认真填写。"
      headerExtra={
        <FieldHelpButton
          onClick={() => setHelpOpen(true)}
          title="基本信息字段说明"
        />
      }
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 px-1.5 pt-1.5">
          <p className="text-sm font-medium text-white">资源类型</p>
        </div>
        <SegmentedControl.Root
          value={resourceType}
          onValueChange={(val: ResourceType) => onResourceTypeChange(val)}
          size="2"
          radius="large"
          variant="surface"
          disabled={typeReadOnly}
        >
          <SegmentedControl.Item
            value="quick_app"
            className={`
              px-3 py-2 text-sm cursor-pointer
              ${resourceType === "quick_app" ? "bg-white/20 font-medium" : ""}
            `}
          >
            快应用
          </SegmentedControl.Item>

          <SegmentedControl.Item
            value="watchface"
            className={`
              px-3 py-2 text-sm cursor-pointer
              ${resourceType === "watchface" ? "bg-white/20 font-medium" : ""}
            `}
          >
            表盘
          </SegmentedControl.Item>

          <SegmentedControl.Item
            value="canopus"
            className={`
              px-3 py-2 text-sm cursor-pointer
              ${resourceType === "canopus" ? "bg-white/20 font-medium" : ""}
            `}
          >
            模块
          </SegmentedControl.Item>

          <SegmentedControl.Item
            value="res_pack"
            className={`
              px-3 py-2 text-sm cursor-pointer
              ${resourceType === "res_pack" ? "bg-white/20 font-medium" : ""}
            `}
          >
            资源包
          </SegmentedControl.Item>
        </SegmentedControl.Root>
        {/*<div className="flex flex-wrap gap-3">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-white/5 px-3 py-2 transition hover:bg-white/10">
            <Radio
              name="resourceType"
              value="quick_app"
              checked={resourceType === "quick_app"}
              onValueChange={() => onResourceTypeChange("quick_app")}
            />
            <span className="text-sm">快应用</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-white/5 px-3 py-2 transition hover:bg-white/10">
            <Radio
              name="resourceType"
              value="watchface"
              checked={resourceType === "watchface"}
              onValueChange={() => onResourceTypeChange("watchface")}
            />
            <span className="text-sm">表盘</span>
          </label>
        </div>*/}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label="资源名称" fieldKey="itemName">
          <TextField.Root
            placeholder="请输入资源名称"
            value={itemName}
            onChange={(e) => onItemNameChange(e.target.value)}
            radius="large"
          />
        </Field>
        <Field label="资源 ID" fieldKey="itemId">
          <div className="flex w-full gap-2 items-start">
            <div className="flex-1 min-w-0 w-full">
              <div className="flex w-full items-stretch">
                <TextField.Root
                  placeholder={
                    resourceType === "quick_app"
                      ? "快应用包名，如 com.example.quickapp"
                      : resourceType === "watchface"
                        ? "12 位纯数字，以 9798 开头，如 9798XXXXXXXX"
                        : resourceType === "res_pack"
                          ? "小写字母、数字、下划线或连字符，如 my-theme"
                          : "小写字母开头，只含小写字母、数字和下划线，最长 16 字符"
                  }
                  value={itemId}
                  onChange={(e) => {
                    if (resourceType === "watchface") {
                      onItemIdChange(normalizeWatchfaceIdInput(e.target.value));
                    } else {
                      onItemIdChange(e.target.value);
                    }
                  }}
                  inputMode={resourceType === "watchface" ? "numeric" : "text"}
                  onBlur={onItemIdBlur}
                  maxLength={
                    resourceType === "watchface" ? 12 : undefined
                  }
                  disabled={idReadOnly}
                  radius="large"
                  className={`w-full ${idError ? "!border-red-400/60" : ""}`}
                />
              </div>
              {idError && (
                <p className="text-xs text-red-400 mt-1">{idError}</p>
              )}
              {listedIdLocked && (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-white/45">
                  <span>已上架资源的 ID 默认锁定。</span>
                  {onRequestIdChange && (
                    <button
                      type="button"
                      className="text-sky-300 underline-offset-2 hover:text-sky-200 hover:underline"
                      onClick={() => setIdChangeConfirmOpen(true)}
                    >
                      修改资源 ID
                    </button>
                  )}
                </p>
              )}
              {idChangeUnlocked && onCancelIdChange && (
                <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-amber-200/90">
                  <span>正在修改已上架资源的 ID。</span>
                  <button
                    type="button"
                    className="text-sky-300 underline-offset-2 hover:text-sky-200 hover:underline"
                    onClick={onCancelIdChange}
                  >
                    放弃修改，恢复原 ID
                  </button>
                </p>
              )}
            </div>
            {resourceType === "watchface" && onGenerateId && !idReadOnly && (
              <Button
                type="button"
                variant="soft"
                color="gray"
                size="2"
                onClick={onGenerateId}
                disabled={idGenerating}
                className="mt-0.5 shrink-0"
              >
                <DiceFiveIcon size={14} weight="duotone" />
                {idGenerating ? "生成中" : "生成ID"}
              </Button>
            )}
          </div>
        </Field>
      </div>
      {idMigration && (
        <Callout.Root color="amber" size="1">
          <Callout.Icon>
            <WarningDiamondIcon size={16} weight="fill" />
          </Callout.Icon>
          <Callout.Text>
            资源 ID 将从「{idMigration.fromId}」换成「{idMigration.toId}」。PR
            合入后，旧 ID 上的下载量、评分、评论、合集、付费配置与购买记录会自动迁移到新
            ID；AstroBox 会提示已安装旧 ID 的用户卸载旧资源并安装新资源（需要用户确认，
            不会自动完成）。包体需要按新 ID 重新上传。提交前请勿修改第一作者，否则迁移会被拒绝。
          </Callout.Text>
        </Callout.Root>
      )}
      {idMigrationNotes && idMigrationNotes.length > 0 && (
        <div className="flex flex-col gap-1 px-1.5">
          <p className="text-xs font-medium text-white/60">资源 ID 变更记录</p>
          {idMigrationNotes.map((note) => (
            <p
              key={note.text}
              className={`text-xs ${
                note.tone === "rejected"
                  ? "text-red-300"
                  : note.tone === "pending"
                    ? "text-amber-200"
                    : "text-white/50"
              }`}
            >
              {note.text}
            </p>
          ))}
        </div>
      )}
      <Field label="资源简介" fieldKey="description" hint="参与算法与推流，必填">
        <TextArea
          ref={descriptionRef}
          rows={3}
          placeholder="用几句话介绍你的资源，方便审核与展示。支持 Markdown。"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          radius="large"
        />
        {hasDescriptionLink && (
          <span className="text-xs text-amber-200/80">
            简介中检测到疑似链接。审核自动检查会给出警告，请确认链接是否确有必要。
          </span>
        )}
      </Field>
      <Field
        label="标签"
        fieldKey="tags"
        hint={`参与搜索与推流，至少 ${PUBLISH_TAGS_MIN} 个（当前 ${tags.length} 个）`}
      >
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            {tags.map((tag, index) => (
              <span
                key={`${tag}-${index}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs text-white"
              >
                {tag}
                <button
                  type="button"
                  className="grid size-5 place-items-center rounded-full text-white/60 transition hover:bg-white/15 hover:text-white"
                  onClick={() => onRemoveTag(index)}
                  aria-label={`移除标签 ${tag}`}
                >
                  ×
                </button>
              </span>
            ))}
            {tags.length === 0 && (
              <span className="text-sm text-white/40">暂无标签</span>
            )}
          </div>
          <div className="flex gap-2 max-w-md">
            <TextField.Root
              placeholder="输入标签后回车或点击添加"
              value={tagInput}
              onChange={(e) => onTagInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAddTag();
                }
              }}
              radius="large"
              className="flex-1"
            />
            <Button
              type="button"
              variant="soft"
              onClick={onAddTag}
              className="shrink-0"
            >
              添加标签
            </Button>
          </div>
        </div>
      </Field>
      <div data-publish-field="nsfw" className="rounded-lg border border-white/10 bg-black/20 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-sm font-medium text-white">敏感内容（NSFW）</p>
            <p className="text-xs text-white/60">
              资源含血腥、恐怖等可能令人不适的内容时请打开。AstroBox
              会默认模糊它的封面，并在用户进入详情页前提示原因，确认后才继续。
            </p>
          </div>
          <Switch checked={nsfwEnabled} onCheckedChange={onNsfwChange} />
        </div>
        {nsfwEnabled && (
          <div className="mt-3 flex flex-col gap-1.5 border-t border-white/10 pt-3">
            <p className="text-xs text-white/60">
              原因（必填，会原样展示给用户）
              <span className="ml-2 text-white/40">
                {Array.from(nsfwReason).length}/{NSFW_REASON_MAX}
              </span>
            </p>
            <TextField.Root
              placeholder="例如：含血腥画面 / 恐怖元素 / 突然惊吓"
              value={nsfwReason}
              onChange={(e) =>
                onNsfwReasonChange(
                  Array.from(e.target.value).slice(0, NSFW_REASON_MAX).join(""),
                )
              }
              radius="large"
              className={!nsfwReason.trim() ? "!border-red-400/60" : ""}
            />
            <p className="text-xs text-amber-200/90">
              这项声明不能让违规内容过审：色情、低俗等越过内容准则 1.1
              的内容仍然不能上架，资源名称与图标也仍须适合所有用户。
            </p>
          </div>
        )}
      </div>
      <AlertDialog.Root open={idChangeConfirmOpen} onOpenChange={setIdChangeConfirmOpen}>
        <AlertDialog.Content className="max-w-[520px]">
          <AlertDialog.Title>修改已上架资源的 ID</AlertDialog.Title>
          <AlertDialog.Description size="2">
            资源 ID 是检查更新、覆盖安装和统计数据共用的标识，换 ID 之前请确认：
          </AlertDialog.Description>
          <div className="mt-2 text-sm text-white/75">
              <ul className="list-disc space-y-1.5 pl-5">
                <li>
                  PR 合入后，旧 ID 上的下载量、评分、评论、合集、付费配置与购买记录会自动迁移到新
                  ID，通常在十分钟内完成。
                </li>
                <li>
                  已经安装旧 ID 的用户不会无感升级：AstroBox
                  会提示「资源 ID 已变更」，由用户确认后卸载旧资源、安装新资源。
                </li>
                <li>
                  包体要按新 ID 重新上传：快应用需要用新包名重新打包，表盘与资源包重新上传后会自动改写。
                </li>
                <li>提交前不要更换第一作者，否则迁移会被拒绝，数据留在旧 ID 上。</li>
                <li>旧 ID 让出后可能被别的资源使用，想改回去需要再走一次同样的流程。</li>
              </ul>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                取消
              </Button>
            </AlertDialog.Cancel>
            <Button
              color="amber"
              onClick={() => {
                setIdChangeConfirmOpen(false);
                onRequestIdChange?.();
              }}
            >
              我已了解，修改 ID
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Root>
      <div className="grid gap-3 lg:grid-cols-1">
        <Field label="付费类型">
          <Select.Root
            value={paidType || undefined}
            onValueChange={onPaidTypeChange}
            disabled={paidTypeDisabled}
          >
            <Select.Trigger placeholder="免费" radius="large" />

            <Select.Content position="popper">
              <Select.Item value="free">免费</Select.Item>
              <Select.Item value="paid">付费</Select.Item>
              <Select.Item value="force_paid">强制付费</Select.Item>
            </Select.Content>
          </Select.Root>
        </Field>
      </div>
      <FieldHelpDialog
        open={helpOpen}
        onOpenChange={setHelpOpen}
        title="基本信息字段说明"
        items={fieldHelp}
      />
    </SectionCard>
  );
}
