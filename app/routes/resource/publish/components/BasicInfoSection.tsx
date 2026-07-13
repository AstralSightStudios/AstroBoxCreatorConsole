import {
  Button,
  Select,
  TextArea,
  TextField,
  SegmentedControl,
} from "@radix-ui/themes";
import { DiceFiveIcon } from "@phosphor-icons/react";
import { Field, SectionCard } from "./shared";
import { normalizeWatchfaceIdInput } from "~/logic/publish/watchface-id";

type ResourceType = "quick_app" | "watchface";

interface BasicInfoSectionProps {
  itemId: string;
  itemName: string;
  description: string;
  tagsInput: string;
  paidType: string;
  paidTypeDisabled?: boolean;
  resourceType: ResourceType;
  idError?: string;
  idGenerating?: boolean;
  onItemIdChange: (value: string) => void;
  onItemNameChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onTagsChange: (value: string) => void;
  onPaidTypeChange: (value: string) => void;
  onResourceTypeChange: (value: ResourceType) => void;
  onGenerateId?: () => void;
}

export function BasicInfoSection({
  itemId,
  itemName,
  description,
  tagsInput,
  paidType,
  paidTypeDisabled,
  resourceType,
  idError,
  idGenerating,
  onItemIdChange,
  onItemNameChange,
  onDescriptionChange,
  onTagsChange,
  onPaidTypeChange,
  onResourceTypeChange,
  onGenerateId,
}: BasicInfoSectionProps) {
  return (
    <SectionCard
      title="基本信息"
      description="用于标识与展示的核心信息，务必认真填写。"
      className="border-x-0! border-t-0! bg-transparent! rounded-none! shadow-none!"
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
        <Field label="资源名称">
          <TextField.Root
            placeholder="请输入资源名称"
            value={itemName}
            onChange={(e) => onItemNameChange(e.target.value)}
            radius="large"
          />
        </Field>
        <Field
          label="资源 ID"
          hint={
            resourceType === "quick_app"
              ? "填写快应用包名"
              : "12位纯数字，以9798开头"
          }
        >
          <div className="flex gap-2 items-start">
            <div className="flex-1 min-w-0">
              <TextField.Root
                placeholder={
                  resourceType === "quick_app"
                    ? "com.example.quickapp"
                    : "9798XXXXXXXX"
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
                radius="large"
                className={idError ? "!border-red-400/60" : ""}
              />
              {idError && (
                <p className="text-xs text-red-400 mt-1">{idError}</p>
              )}
            </div>
            {resourceType === "watchface" && onGenerateId && (
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
      <Field label="资源简介">
        <TextArea
          rows={3}
          placeholder="用几句话介绍你的资源，方便审核与展示"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          radius="large"
        />
      </Field>
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label="标签" hint="使用分号分隔，例如 客户端;视频;社区">
          <TextField.Root
            placeholder="客户端;视频;社区"
            value={tagsInput}
            onChange={(e) => onTagsChange(e.target.value)}
            radius="large"
          />
        </Field>
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
    </SectionCard>
  );
}
