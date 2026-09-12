import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwiseIcon,
  WarningDiamondIcon,
} from "@phosphor-icons/react";
import { Button, Callout, Dialog, Text, TextField } from "~/components/ScaleAwareThemes";
import { ScrubbableNumberField } from "~/components/wallpaper-editor/ScrubbableNumberField";
import { toast } from "sonner";
import {
  formatPackageVersion,
  readPackageVersion,
  writePackageVersion,
  type PackageVersionInfo,
} from "~/logic/publish/package-version";

interface VersionEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  file: File;
  previousVersionCode?: number;
  /** 快应用包名与资源 ID 不一致时禁止改写。 */
  identityMismatch?: boolean;
  onApply: (updated: File, info: PackageVersionInfo) => void;
}

interface Triple {
  major: number;
  minor: number;
  patch: number;
}

function codeOf(triple: Triple): number {
  return (triple.major << 16) | (triple.minor << 8) | triple.patch;
}

function tripleFromCode(code: number): Triple {
  return {
    major: (code >>> 16) & 0xff,
    minor: (code >>> 8) & 0xff,
    patch: code & 0xff,
  };
}

function tripleFromInfo(info: PackageVersionInfo | null): Triple {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(info?.version?.trim() ?? "");
  if (match) {
    return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
  }
  if (info?.versionCode !== undefined) return tripleFromCode(info.versionCode);
  return { major: 0, minor: 0, patch: 0 };
}

export function VersionEditorDialog({
  open,
  onOpenChange,
  file,
  previousVersionCode,
  identityMismatch,
  onApply,
}: VersionEditorDialogProps) {
  const [info, setInfo] = useState<PackageVersionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [triple, setTriple] = useState<Triple>({ major: 0, minor: 0, patch: 0 });
  const [versionName, setVersionName] = useState("");
  const [versionCodeInput, setVersionCodeInput] = useState("");

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    void readPackageVersion(file)
      .then((result) => {
        if (!active) return;
        setInfo(result);
        setTriple(tripleFromInfo(result));
        setVersionName(result.version ?? "");
        setVersionCodeInput(
          result.versionCode !== undefined ? String(result.versionCode) : "",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, file]);

  const isZipManifest = info?.source === "zip-manifest";
  const isWatchfaceBin = info?.source === "xiaomi-bin" || info?.source === "xiaomi-mwz";

  const nextCode = isZipManifest
    ? Number(versionCodeInput.trim())
    : codeOf(triple);

  const atMax = triple.major >= 255 && triple.minor >= 255 && triple.patch >= 255;

  const validationError = useMemo(() => {
    if (!info) return null;
    if (identityMismatch) return "包体包名与资源 ID 不一致，请先统一 ID 再修改版本。";
    if (isZipManifest) {
      if (!versionName.trim()) return "请填写 versionName。";
      if (!versionCodeInput.trim() || !Number.isFinite(nextCode) || nextCode < 0) {
        return "请填写合法的 versionCode。";
      }
      if (nextCode > 2147483647) {
        return "versionCode 不能超过 2147483647（客户端按 32 位整数解析）。";
      }
      if (previousVersionCode !== undefined && nextCode <= previousVersionCode) {
        return `versionCode 必须大于上次发布的 ${previousVersionCode}。`;
      }
      return null;
    }
    if (isWatchfaceBin) {
      if (previousVersionCode !== undefined && nextCode <= previousVersionCode) {
        return `versionCode 必须大于上次发布的 ${previousVersionCode}。`;
      }
      return null;
    }
    return "该包体暂不支持内置改写版本。";
  }, [
    info,
    identityMismatch,
    isZipManifest,
    isWatchfaceBin,
    versionName,
    versionCodeInput,
    nextCode,
    previousVersionCode,
  ]);

  const handleApply = async () => {
    if (!info || validationError) return;
    setApplying(true);
    try {
      const target = isZipManifest
        ? { version: versionName.trim(), versionCode: Math.trunc(nextCode) }
        : {
            version: `${triple.major}.${triple.minor}.${triple.patch}`,
            versionCode: codeOf(triple),
          };
      const updated = await writePackageVersion(file, target);
      const verified = await readPackageVersion(updated);
      if (!verified.readable) {
        throw new Error(verified.reason || "版本写入后校验失败");
      }
      onApply(updated, verified);
      toast.success(`版本已更新为 ${formatPackageVersion(verified)}`);
      onOpenChange(false);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setApplying(false);
    }
  };

  const currentLabel = info
    ? `${info.version?.trim() || "-"}${
        info.versionCode !== undefined ? `（${info.versionCode}）` : ""
      }`
    : "读取中…";
  const nextLabel = isZipManifest
    ? `${versionName.trim() || "-"}${
        Number.isFinite(nextCode) ? `（${Math.trunc(nextCode)}）` : ""
      }`
    : `${triple.major}.${triple.minor}.${triple.patch}（${codeOf(triple)}）`;
  const previewText = `${currentLabel} → ${nextLabel}`;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>修改包体版本</Dialog.Title>
        <Dialog.Description size="2">
          版本以包体自身为准，修改后会更新包体。
        </Dialog.Description>

        <div className="mt-3 flex max-h-[var(--ui-viewport-height-60pct)] flex-col gap-3 overflow-y-auto pr-1">
          {loading && <Text size="2" color="gray">正在读取包体版本…</Text>}

          {!loading && info && !info.writable && (
            <Callout.Root color="amber">
              <Callout.Icon>
                <WarningDiamondIcon size={18} weight="fill" />
              </Callout.Icon>
              <Callout.Text>{info.reason || "该包体暂不支持内置改写版本。"}</Callout.Text>
            </Callout.Root>
          )}

          {!loading && isWatchfaceBin && (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <Text size="1" color="gray">更新程度</Text>
              <div className="mt-2 flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs text-white/45">主版本</span>
                  <ScrubbableNumberField
                    value={triple.major}
                    min={0}
                    max={255}
                    ariaLabel="主版本"
                    onChange={(value) => {
                      const next = Math.max(0, Math.min(255, Math.trunc(value)));
                      setTriple((prev) =>
                        next > prev.major
                          ? { major: next, minor: 0, patch: 0 }
                          : { ...prev, major: next },
                      );
                    }}
                  />
                </label>
                <span className="pb-2 text-white/50">.</span>
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs text-white/45">次版本</span>
                  <ScrubbableNumberField
                    value={triple.minor}
                    min={0}
                    max={255}
                    ariaLabel="次版本"
                    onChange={(value) => {
                      const next = Math.max(0, Math.min(255, Math.trunc(value)));
                      setTriple((prev) =>
                        next > prev.minor
                          ? { ...prev, minor: next, patch: 0 }
                          : { ...prev, minor: next },
                      );
                    }}
                  />
                </label>
                <span className="pb-2 text-white/50">.</span>
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-xs text-white/45">修订</span>
                  <ScrubbableNumberField
                    value={triple.patch}
                    min={0}
                    max={255}
                    ariaLabel="修订"
                    onChange={(value) =>
                      setTriple((prev) => ({
                        ...prev,
                        patch: Math.max(0, Math.min(255, Math.trunc(value))),
                      }))
                    }
                  />
                </label>
              </div>
              {atMax && (
                <Text size="1" color="red">已达版本上限 255.255.255</Text>
              )}
              <div className="mt-3 border-t border-white/10 pt-3 text-xs leading-relaxed text-white/50">
                <p className="mb-1 text-white/65">更新程度怎么选</p>
                <p>• 修订：修点小问题、细节调整（1.2.3 → 1.2.4）</p>
                <p>• 次版本：有新的内容或功能（1.2.3 → 1.3.0）</p>
                <p>• 主版本：整体大改版（1.2.3 → 2.0.0）</p>
                <p className="mt-1">
                  每次发布新包体都要让版本比上一版大，否则用户收不到更新。
                </p>
              </div>
            </div>
          )}

          {!loading && isZipManifest && (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
              <Text size="1" color="gray">包内版本</Text>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <TextField.Root
                  placeholder="versionName，如 2.5.0"
                  className="min-w-[160px] flex-1"
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                />
                <TextField.Root
                  placeholder="versionCode"
                  className="w-32"
                  inputMode="numeric"
                  value={versionCodeInput}
                  onChange={(e) => setVersionCodeInput(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <Text size="1" color="gray">预览</Text>
            <div className="mt-1 break-all text-sm text-white/85">{previewText}</div>
          </div>

          {validationError && !loading && (
            <Callout.Root color="red">
              <Callout.Icon>
                <WarningDiamondIcon size={18} weight="fill" />
              </Callout.Icon>
              <Callout.Text>{validationError}</Callout.Text>
            </Callout.Root>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <Dialog.Close>
            <Button variant="soft" color="gray">取消</Button>
          </Dialog.Close>
          <Button
            variant="solid"
            disabled={loading || applying || Boolean(validationError)}
            onClick={() => void handleApply()}
          >
            <ArrowClockwiseIcon size={14} weight="bold" />
            {applying ? "写入中…" : "应用"}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
