import {
  AlertDialog,
  Badge,
  Button,
  Callout,
  Spinner,
  TextField,
} from "~/components/ScaleAwareThemes";
import { ClockClockwiseIcon, TrashIcon, WarningOctagonIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getAfdianAutoReissueStatus,
  removeAfdianAutoReissue,
  saveAfdianAutoReissue,
} from "~/api/astrobox/order";
import {
  describeAutoReissueState,
  formatAutoReissueStats,
  formatAutoReissueTime,
  validateAutoReissueInput,
} from "~/logic/afdian-auto-reissue";
import { SectionCard } from "~/routes/resource/publish/components/shared";

const STATUS_KEY = ["afdianAutoReissueStatus"];

/** 爱发电自动补单：把 user_id 与 API token 交给服务端保管，服务端每 15 分钟替你核对并补发漏单。 */
export function AfdianAutoReissueCard() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [afdianUserId, setAfdianUserId] = useState("");
  const [token, setToken] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);

  const { data: status, isLoading, error: loadError } = useQuery({
    queryKey: STATUS_KEY,
    queryFn: getAfdianAutoReissueStatus,
  });

  const save = useMutation({
    mutationFn: () => saveAfdianAutoReissue({ afdianUserId: afdianUserId.trim(), token: token.trim() }),
    onSuccess: (next) => {
      queryClient.setQueryData(STATUS_KEY, next);
      setEditing(false);
      toast.success("已开启自动补单，服务端会每 15 分钟补一次");
    },
    onError: (err) => toast.error((err as Error)?.message || "保存失败"),
    // 无论成败都不在界面里留着 token
    onSettled: () => setToken(""),
  });

  const remove = useMutation({
    mutationFn: removeAfdianAutoReissue,
    onSuccess: () => {
      setConfirmRemove(false);
      setEditing(false);
      setAfdianUserId("");
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
      toast.success("已关闭自动补单，服务端已删除保存的凭据");
    },
    onError: (err) => toast.error((err as Error)?.message || "删除失败"),
  });

  const handleSave = () => {
    const problem = validateAutoReissueInput(afdianUserId, token);
    if (problem) {
      toast.error(problem);
      return;
    }
    save.mutate();
  };

  const view = status ? describeAutoReissueState(status) : null;
  const active = Boolean(status?.configured && status.enabled);
  const showForm = !active || editing;
  const statsLine = status ? formatAutoReissueStats(status.lastStats, status.lastStatus) : "";

  return (
    <SectionCard
      title="自动补单"
      description="把爱发电凭据交给服务端保管，服务端每 15 分钟自动核对并补发漏单"
      headerExtra={
        view ? (
          <Badge color={view.tone} variant="soft">
            {view.label}
          </Badge>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4">
        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-white/60">
            <Spinner size="2" /> 正在读取状态...
          </div>
        )}
        {loadError && (
          <Callout.Root color="red" variant="soft" className="bg-transparent! p-3!">
            <Callout.Icon><WarningOctagonIcon size={16} weight="fill" /></Callout.Icon>
            <Callout.Text className="font-semibold">
              {(loadError as Error).message || "读取自动补单状态失败"}
            </Callout.Text>
          </Callout.Root>
        )}

        {status && active && view && (
          <div className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3.5 sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-white/55">爱发电 user_id</span>
              <span className="font-mono-sarasa text-sm text-white/85 break-all">{status.afdianUserId}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-white/55">上次同步</span>
              <span className="text-sm text-white/85">{formatAutoReissueTime(status.lastRunAt)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-white/55">下次同步</span>
              <span className="text-sm text-white/85">{formatAutoReissueTime(status.nextRunAt)}</span>
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs text-white/55">状态</span>
              <span className="text-sm text-white/85">
                {view.label}
                {view.detail ? `，${view.detail}` : ""}
              </span>
            </div>
            {statsLine && (
              <div className="flex flex-col gap-0.5 sm:col-span-2">
                <span className="text-xs text-white/55">最近一轮</span>
                <span className="text-sm text-white/85">{statsLine}</span>
              </div>
            )}
          </div>
        )}

        {status && !status.enabled && status.configured && view && (
          <Callout.Root color="red" variant="soft" className="bg-transparent! p-3!">
            <Callout.Icon><WarningOctagonIcon size={16} weight="fill" /></Callout.Icon>
            <Callout.Text className="font-semibold">{view.detail}</Callout.Text>
          </Callout.Root>
        )}

        {status && showForm && (
          <div className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/55">爱发电 user_id</span>
              <TextField.Root
                size="2"
                value={afdianUserId}
                onChange={(event) => setAfdianUserId(event.target.value)}
                placeholder="开发者后台的 user_id"
                radius="large"
                autoComplete="off"
                spellCheck={false}
                disabled={save.isPending}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-white/55">API token</span>
              <TextField.Root
                size="2"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="保存后加密存放，不会再显示"
                radius="large"
                autoComplete="off"
                spellCheck={false}
                disabled={save.isPending}
              />
            </label>
            <div className="flex items-center gap-2">
              <Button size="2" onClick={handleSave} disabled={save.isPending}>
                {save.isPending ? <Spinner size="2" /> : <ClockClockwiseIcon size={16} />}
                {save.isPending ? "正在验证..." : active ? "更新凭据" : "开启自动补单"}
              </Button>
              {active && (
                <Button
                  size="2"
                  variant="soft"
                  color="gray"
                  onClick={() => {
                    setEditing(false);
                    setToken("");
                  }}
                  disabled={save.isPending}
                >
                  取消
                </Button>
              )}
            </div>
          </div>
        )}

        {status && active && !editing && (
          <div className="flex flex-wrap items-center gap-2">
            <Button size="2" variant="soft" onClick={() => setEditing(true)}>
              更换凭据
            </Button>
            <Button size="2" variant="soft" color="red" onClick={() => setConfirmRemove(true)}>
              <TrashIcon size={16} />
              关闭并删除凭据
            </Button>
          </div>
        )}
        {status && !active && status.configured && (
          <div>
            <Button size="2" variant="soft" color="red" onClick={() => setConfirmRemove(true)}>
              <TrashIcon size={16} />
              删除保存的凭据
            </Button>
          </div>
        )}
      </div>

      <AlertDialog.Root open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialog.Content maxWidth="440px">
          <AlertDialog.Title>关闭自动补单</AlertDialog.Title>
          <AlertDialog.Description size="2">
            服务端会删除保存的 user_id 与 API token，之后不再自动补单；已补发的权益不受影响。
          </AlertDialog.Description>
          <div className="mt-4 flex justify-end gap-2">
            <AlertDialog.Cancel>
              <Button variant="soft" color="gray">
                取消
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action>
              <Button color="red" onClick={() => remove.mutate()} disabled={remove.isPending}>
                确认删除
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Root>
    </SectionCard>
  );
}
