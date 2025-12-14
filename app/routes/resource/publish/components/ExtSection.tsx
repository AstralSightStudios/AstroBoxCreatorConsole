import { TextArea } from "@radix-ui/themes";
import { SectionCard } from "./shared";

interface ExtSectionProps {
  extRaw: string;
  extError: string;
  onChange: (value: string) => void;
}

export function ExtSection({ extRaw, extError, onChange }: ExtSectionProps) {
  return (
    <SectionCard
      title="扩展字段 (ext)"
      description="如需附加额外信息，可在此填写合法 JSON。默认输出空对象。"
      className="border-0! bg-transparent! rounded-none! shadow-none!"
      headerBg
    >
      <TextArea
        rows={4}
        placeholder='例如 {"theme":"dark"}'
        value={extRaw}
        onChange={(e) => onChange(e.target.value)}
      />
      {extError && <p className="text-sm text-amber-400">{extError}</p>}
      {!extError && (
        <div className="flex flex-col px-1.5 py-1 w-full">
          <p className="text-xs text-white/60">
            提交时会自动组装 JSON，上传后将位于 manifest_v2.json。
          </p>
        </div>
      )}
    </SectionCard>
  );
}
