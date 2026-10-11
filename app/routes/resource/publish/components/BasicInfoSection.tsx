import {
  Button,
  Select,
  TextArea,
  TextField,
  SegmentedControl,
} from "~/components/ScaleAwareThemes";
import { DiceFiveIcon } from "@phosphor-icons/react";
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
import type { ResourceType } from "~/logic/publish/resource-type";

function describeItemId(resourceType: ResourceType): FieldHelpItem {
  if (resourceType === "quick_app") {
    return {
      label: "资源 ID（快应用）",
      description:
        "即快应用的包名，需与包体内的包名一致，否则资源无法自动检查更新。填法就是把你产品的域名反过来：官网是 www.yourname.com，就填 com.yourname.appname。",
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
        "表盘的唯一标识，12 位纯数字且以 9798 开头，可点「生成ID」自动生成。该 ID 会写入表盘文件，已发布后不要改动。",
    };
  }
  if (resourceType === "res_pack") {
    return {
      label: "资源 ID（资源包）",
      description: `必须是小写字母、数字、下划线或连字符，长度 1–${RES_PACK_THEME_ID_MAX_LENGTH}。发布时会写入包内 corona.json 的 themeId，并提示改写结果。已发布后不要改动，否则设备上会出现两个主题目录。`,
    };
  }
  return {
    label: "资源 ID（模块）",
    description:
      "模块的唯一标识，直接填写模块名称即可。仅支持字母、数字、下划线和中划线，且以字母或数字开头，已发布后不要改动。",
  };
}

function buildFieldHelp(resourceType: ResourceType): FieldHelpItem[] {
  return [
    {
      label: "资源类型",
      description:
        "决定校验规则和资源 ID 格式：快应用校验包名、表盘校验 12 位数字 ID、模块仅支持字母数字下划线中划线、资源包要求小写标识并写入 themeId。已发布的资源不可修改。",
    },
    {
      label: "资源名称",
      description: "展示在资源列表和详情页的名称，建议简短直观。",
    },
    describeItemId(resourceType),
    {
      label: "资源简介",
      description:
        "必填。参与算法与推流，描述不准或内容单薄会让资源难以被目标用户看到，同时也是审核参考。请准确说明实际功能与适用场景。",
    },
    {
      label: "标签",
      description: `必填，至少 ${PUBLISH_TAGS_MIN} 个。参与搜索与推流，是资源被用户找到的重要途径。请填写与资源功能贴合的标签，建议不超过 ${PUBLISH_TAGS_SUGGESTED_MAX} 个。`,
    },
    {
      label: "付费类型",
      description:
        "免费：可直接使用。付费：可先体验部分功能，购买后解锁完整功能。强制付费：不购买则无法使用。",
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
  onItemIdChange: (value: string) => void;
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
  onItemIdChange,
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
  const fieldHelp = useMemo(() => buildFieldHelp(resourceType), [resourceType]);
  const descriptionRef = useRef<HTMLTextAreaElement | null>(null);
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
          disabled={idReadOnly}
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
        <Field
          label="资源 ID"
          fieldKey="itemId"
          hint={
            resourceType === "quick_app"
              ? "填写快应用包名"
              : resourceType === "watchface"
                ? "12位纯数字，以9798开头"
                : resourceType === "res_pack"
                  ? "小写字母、数字、下划线或连字符，将写入 themeId"
                  : "仅支持字母、数字、下划线和中划线"
          }
        >
          <div className="flex w-full gap-2 items-start">
            <div className="flex-1 min-w-0 w-full">
              <div className="flex w-full items-stretch">
                <TextField.Root
                  placeholder={
                    resourceType === "quick_app"
                      ? "com.example.quickapp"
                      : resourceType === "watchface"
                        ? "9798XXXXXXXX"
                        : resourceType === "res_pack"
                          ? "my-theme"
                          : "模块名称"
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
      <Field label="资源简介" fieldKey="description" hint="参与算法与推流，必填">
        <TextArea
          ref={descriptionRef}
          rows={3}
          placeholder="用几句话介绍你的资源，方便审核与展示。支持 Markdown。"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          radius="large"
        />
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
