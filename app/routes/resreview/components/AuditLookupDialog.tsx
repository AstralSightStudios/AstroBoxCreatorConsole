import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Button,
  Dialog,
  Spinner,
  TextField,
} from "~/components/ScaleAwareThemes";
import { MagnifyingGlass, WarningCircle } from "@phosphor-icons/react";
import { parseAuditLookupInput } from "~/logic/publish/pr-audit-input";
import { lookupResourceSubmissionPr } from "~/logic/publish/resource-pr-lookup";
import { getErrorMessage } from "../utils";

interface AuditLookupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenPull: (number: number, resourceId?: string) => void;
}

/**
 * 提交回查只做一个精准输入框：
 * - PR 链接 / 序号直接进入；
 * - 资源 ID 先按目录行定向反查对应提交 PR，再进入。
 */
export function AuditLookupDialog({
  open,
  onOpenChange,
  onOpenPull,
}: AuditLookupDialogProps) {
  const [input, setInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const requestIdRef = useRef(0);

  useEffect(() => {
    // 每次打开/关闭都让旧请求失效，避免关闭弹窗后仍然跳转。
    requestIdRef.current += 1;
    if (!open) return;
    setInput("");
    setError("");
    setSubmitting(false);
  }, [open]);

  const handleOpenChange = (next: boolean) => {
    if (!next) requestIdRef.current += 1;
    onOpenChange(next);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setError("");

    let parsed: ReturnType<typeof parseAuditLookupInput>;
    try {
      parsed = parseAuditLookupInput(input);
    } catch (err) {
      setError(getErrorMessage(err));
      return;
    }

    if (parsed.kind === "pr") {
      onOpenPull(parsed.number);
      return;
    }

    const requestId = ++requestIdRef.current;
    setSubmitting(true);
    try {
      const result = await lookupResourceSubmissionPr(parsed.resourceId);
      if (requestId !== requestIdRef.current) return;
      onOpenPull(result.prNumber, result.resourceId);
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(getErrorMessage(err));
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setSubmitting(false);
      }
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Content className="w-[calc(100vw-2rem)] max-w-[460px]">
        <Dialog.Title>提交回查</Dialog.Title>
        <Dialog.Description size="2" className="text-white/60">
          输入 PR 链接、以 # 开头的 PR 序号，或以 id: 开头的资源 ID，直接定位到
          对应提交。
        </Dialog.Description>

        <form className="mt-4 flex flex-col gap-3" onSubmit={handleSubmit}>
          <TextField.Root
            size="3"
            autoFocus
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              if (error) setError("");
            }}
            placeholder="#1654 或 id:979821130209"
            aria-label="PR 链接、#序号或资源 ID"
            enterKeyHint="go"
            disabled={submitting}
          />

          <p className="text-xs leading-relaxed text-white/45">
            PR 序号请以{" "}
            <code className="rounded bg-white/10 px-1 py-0.5 text-white/70">
              #
            </code>{" "}
            开头；资源 ID 请以{" "}
            <code className="rounded bg-white/10 px-1 py-0.5 text-white/70">
              id:
            </code>{" "}
            开头。也可以直接粘贴 GitHub PR 链接。
          </p>

          {error && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100"
            >
              <WarningCircle size={16} weight="duotone" className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
          )}

          <div className="mt-1 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              size="3"
              variant="soft"
              color="gray"
              onClick={() => handleOpenChange(false)}
            >
              取消
            </Button>
            <Button
              type="submit"
              size="3"
              disabled={submitting || !input.trim()}
            >
              {submitting ? (
                <>
                  <Spinner size="1" />
                  正在反查...
                </>
              ) : (
                <>
                  <MagnifyingGlass size={15} weight="bold" />
                  直接进入
                </>
              )}
            </Button>
          </div>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
