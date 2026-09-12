import { useEffect, useMemo, useState } from "react";
import {
  ArrowClockwiseIcon,
  LockSimpleIcon,
  WarningDiamondIcon,
} from "@phosphor-icons/react";
import { Button, Callout, Dialog, Text, TextField } from "~/components/ScaleAwareThemes";
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
  previousVersion?: string;
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
  previousVersion,
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

  const bump = (kind: "patch" | "minor" | "major") => {
    setTriple((prev) => {
      if (kind === "patch") {
        if (prev.patch >= 255) return prev;
        return { ...prev, patch: prev.patch + 1 };
      }
      if (kind === "minor") {
        if (prev.minor >= 255) return prev;
        return { ...prev, minor: prev.minor + 1, patch: 0 };
      }
      if (prev.major >= 255) return prev;
      return { major: prev.major + 1, minor: 0, patch: 0 };
    });
  };

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

  const currentText = info ? formatPackageVersion(info) : "读取中…";
  const previousText =
    previousVersion || previousVersionCode !== undefined
      ? `${previousVersion || "-"}${
          previousVersionCode !== undefined ? `（versionCode ${previousVersionCode}）` : ""
        }`
      : null;
  const previewText = isZipManifest
    ? `${versionName.trim() || "-"}${
        Number.isFinite(nextCode) ? `（versionCode ${Math.trunc(nextCode)}）` : ""
      }`
    : `${triple.major}.${triple.minor}.${triple.patch}（versionCode ${codeOf(triple)}）`;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="520px">
        <Dialog.Title>修改包体版本</Dialog.Title>
        <Dialog.Description size="2">
          版本以包体内部为准，修改后会写回包体并统一包内所有版本字段。
        </Dialog.Description>

        <div className="mt-3 flex max-h-[var(--ui-viewport-height-60pct)] flex-col gap-3 overflow-y-auto pr-1">
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center gap-2 text-sm text-white/80">
              <LockSimpleIcon size={14} weight="bold" />
              当前包体版本：{currentText}
            </div>
            {info?.identity && (
              <div className="mt-1 text-xs text-white/55">
                包体标识：{info.identity}
                {info.identityKind === "dial-id" ? "（表盘 ID）" : ""}
              </div>
            )}
            {previousText && (
              <div className="mt-1 text-xs text-white/55">
                上次发布版本：{previousText}
              </div>
            )}
          </div>

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
            <>
              <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                <Text size="1" color="gray">更新程度</Text>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="1"
                    variant="soft"
                    disabled={triple.patch >= 255}
                    onClick={() => bump("patch")}
                  >
                    修订 patch
                  </Button>
                  <Button
                    size="1"
                    variant="soft"
                    disabled={triple.minor >= 255}
                    onClick={() => bump("minor")}
                  >
                    次版本 minor
                  </Button>
                  <Button
                    size="1"
                    variant="soft"
                    disabled={triple.major >= 255}
                    onClick={() => bump("major")}
                  >
                    主版本 major
                  </Button>
                  {atMax && <Text size="1" color="red">已达版本上限 255.255.255</Text>}
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <TextField.Root
                    className="w-20"
                    inputMode="numeric"
                    value={String(triple.major)}
                    onChange={(e) =>
                      setTriple((prev) => ({
                        ...prev,
                        major: Math.max(0, Math.min(255, Number(e.target.value) || 0)),
                      }))
                    }
                  />
                  <span className="text-white/50">.</span>
                  <TextField.Root
                    className="w-20"
                    inputMode="numeric"
                    value={String(triple.minor)}
                    onChange={(e) =>
                      setTriple((prev) => ({
                        ...prev,
                        minor: Math.max(0, Math.min(255, Number(e.target.value) || 0)),
                      }))
                    }
                  />
                  <span className="text-white/50">.</span>
                  <TextField.Root
                    className="w-20"
                    inputMode="numeric"
                    value={String(triple.patch)}
                    onChange={(e) =>
                      setTriple((prev) => ({
                        ...prev,
                        patch: Math.max(0, Math.min(255, Number(e.target.value) || 0)),
                      }))
                    }
                  />
                </div>
              </div>
            </>
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
            <div className="mt-1 text-sm text-white/85">{previewText}</div>
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
