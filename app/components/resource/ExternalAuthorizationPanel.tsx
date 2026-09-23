import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircleIcon,
  CopyIcon,
  GlobeHemisphereEastIcon,
  WarningOctagonIcon,
} from "@phosphor-icons/react";
import {
  AlertDialog,
  Badge,
  Button,
  Callout,
  Spinner,
  Switch,
  TextArea,
  TextField,
} from "~/components/ScaleAwareThemes";
import {
  EXTERNAL_AUTHORIZATION_PROOF_REQUIRED,
  disableExternalAuthorization,
  listExternalAuthorizations,
  upsertExternalAuthorization,
  type ExternalAuthorizationConfig,
} from "~/api/astrobox/order";
import {
  clearExternalAuthorizationDraft,
  getExternalAuthorizationDraft,
  setExternalAuthorizationDraft,
  subscribeExternalAuthorizationDrafts,
} from "~/logic/publish/external-authorization-drafts";

interface ExternalAuthorizationPanelProps {
  resourceId: string;
  deviceId: string;
}

interface FormState {
  displayName: string;
  authorizationUrl: string;
  buyUrl: string;
  issuer: string;
  publicKey: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  displayName: "",
  authorizationUrl: "",
  buyUrl: "",
  issuer: "",
  publicKey: "",
  enabled: true,
};

function formFromConfig(config: ExternalAuthorizationConfig): FormState {
  return {
    displayName: config.displayName,
    authorizationUrl: config.authorizationUrl,
    buyUrl: config.buyUrl,
    issuer: config.issuer,
    publicKey: config.publicKey.trim(),
    enabled: config.enabled,
  };
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function copyText(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`已复制${label}`);
  } catch {
    toast.error("复制失败，请手动选择复制");
  }
}

export const externalAuthorizationQueryKey = (resourceId: string) => [
  "externalAuthorizations",
  resourceId,
];

// 创作者自有网站授权：作者在自己的网站售卖并核单，AstroBox 验证作者签名的授权凭证后才发放解密密钥。
export function ExternalAuthorizationPanel({
  resourceId,
  deviceId,
}: ExternalAuthorizationPanelProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const draft = useSyncExternalStore(
    subscribeExternalAuthorizationDrafts,
    () => getExternalAuthorizationDraft(resourceId, deviceId),
  );

  const { data, isLoading, error } = useQuery({
    queryKey: externalAuthorizationQueryKey(resourceId),
    queryFn: () => listExternalAuthorizations({ resourceId }),
    enabled: Boolean(resourceId),
  });

  const config = useMemo(
    () => data?.configs.find((item) => item.deviceId === deviceId) ?? null,
    [data, deviceId],
  );

  useEffect(() => {
    if (draft) {
      setForm({
        displayName: draft.displayName ?? "",
        authorizationUrl: draft.authorizationUrl,
        buyUrl: draft.buyUrl ?? "",
        issuer: draft.issuer,
        publicKey: draft.publicKey,
        enabled: draft.enabled ?? true,
      });
      return;
    }
    setForm(config ? formFromConfig(config) : EMPTY_FORM);
    // 只在切换资源/设备或服务端配置版本变化时重置表单，后台重新拉取不覆盖正在编辑的内容
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.id, config?.revision, resourceId, deviceId, draft]);

  const saveMutation = useMutation({
    mutationFn: () =>
      upsertExternalAuthorization({
        resourceId,
        deviceId,
        enabled: form.enabled,
        displayName: form.displayName.trim(),
        authorizationUrl: form.authorizationUrl.trim(),
        buyUrl: form.buyUrl.trim(),
        issuer: form.issuer.trim(),
        publicKey: form.publicKey.trim(),
      }),
    onSuccess: () => {
      clearExternalAuthorizationDraft(resourceId, deviceId);
      toast.success("自有网站授权已保存并生效");
      queryClient.invalidateQueries({
        queryKey: externalAuthorizationQueryKey(resourceId),
      });
    },
    onError: (err) => {
      const message = (err as Error)?.message || "保存失败";
      if (message === EXTERNAL_AUTHORIZATION_PROOF_REQUIRED) {
        setExternalAuthorizationDraft({
          resourceId,
          deviceId,
          enabled: form.enabled,
          displayName: form.displayName.trim(),
          authorizationUrl: form.authorizationUrl.trim(),
          buyUrl: form.buyUrl.trim(),
          issuer: form.issuer.trim(),
          publicKey: form.publicKey.trim(),
        });
        toast.info("资源尚未上架，配置将在发布提交加密密钥后自动登记");
        return;
      }
      toast.error(`保存失败：${message}`);
    },
  });

  const disableMutation = useMutation({
    mutationFn: () => disableExternalAuthorization({ resourceId, deviceId }),
    onSuccess: () => {
      toast.success("已停用自有网站授权，该设备仍保持受保护");
      queryClient.invalidateQueries({
        queryKey: externalAuthorizationQueryKey(resourceId),
      });
    },
    onError: (err) => toast.error(`停用失败：${(err as Error)?.message || ""}`),
  });

  const validationError = (() => {
    if (!isHttpsUrl(form.authorizationUrl.trim())) return "授权 API 必须是 HTTPS 地址";
    if (form.buyUrl.trim() && !isHttpsUrl(form.buyUrl.trim())) return "购买页必须是 HTTPS 地址";
    if (!form.issuer.trim()) return "请填写签发者（issuer）";
    if (/PRIVATE KEY/i.test(form.publicKey)) return "这里只能填写公钥，切勿粘贴私钥";
    if (!/BEGIN (RSA )?PUBLIC KEY/.test(form.publicKey)) return "请粘贴 PEM 格式的 RSA 公钥";
    return "";
  })();

  const update = (patch: Partial<FormState>) =>
    setForm((previous) => ({ ...previous, ...patch }));

  if (!resourceId) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 px-4 py-4 text-sm text-white/55">
        请先填写资源 ID
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-relaxed text-white/55">
        用户在你的网站购买后，AstroBox 会把一份平台签名的一次性凭证发送到你的授权 API；
        你的服务器核对该 AstroBox 用户的订单后，用自己的私钥签发授权，AstroBox 验证通过才会解密安装。
        私钥只保存在你的服务器上，这里只登记公钥。
      </p>

      {data?.platform && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-white/60">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>
              平台 issuer：<code className="text-white/80">{data.platform.issuer}</code>
            </span>
            <span className="break-all">
              平台 kid：<code className="text-white/80">{data.platform.kid}</code>
            </span>
            <Button
              size="1"
              variant="ghost"
              onClick={() => copyText(data.platform.publicKey, "平台公钥")}
            >
              <CopyIcon size={13} />
              复制平台公钥
            </Button>
          </div>
        </div>
      )}

      {isLoading && (
        <div className="flex items-center gap-2 text-white/60">
          <Spinner size="2" />
          <span className="text-sm">正在加载...</span>
        </div>
      )}

      {error && (
        <Callout.Root color="red" variant="soft" className="bg-transparent! p-3!">
          <Callout.Icon>
            <WarningOctagonIcon size={16} weight="fill" />
          </Callout.Icon>
          <Callout.Text>加载失败：{(error as Error).message}</Callout.Text>
        </Callout.Root>
      )}

      {config && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
          <Badge color={config.enabled ? "green" : "gray"} variant="soft">
            {config.enabled ? "已启用" : "已停用"}
          </Badge>
          <span>版本 {config.revision}</span>
          <span className="break-all">
            公钥 kid：<code className="text-white/80">{config.kid}</code>
          </span>
          <Button size="1" variant="ghost" onClick={() => copyText(config.kid, "kid")}>
            <CopyIcon size={13} />
          </Button>
        </div>
      )}

      {draft && (
        <Callout.Root color="amber" variant="soft" className="bg-transparent! p-3!">
          <Callout.Icon>
            <GlobeHemisphereEastIcon size={16} />
          </Callout.Icon>
          <Callout.Text>
            资源尚未上架：该配置尚未生效，将在本次发布提交加密密钥后自动登记。发布结果会提示登记成功或失败。
          </Callout.Text>
        </Callout.Root>
      )}

      {!isLoading && (
        <div className="grid gap-2 sm:grid-cols-2">
          <TextField.Root
            size="2"
            placeholder="网站名称（显示给用户，可选）"
            value={form.displayName}
            onChange={(event) => update({ displayName: event.target.value })}
            radius="large"
          />
          <TextField.Root
            size="2"
            placeholder="签发者 issuer，例如 https://shop.example.com"
            value={form.issuer}
            onChange={(event) => update({ issuer: event.target.value })}
            radius="large"
          />
          <TextField.Root
            size="2"
            placeholder="授权 API（HTTPS，不带查询参数）"
            value={form.authorizationUrl}
            onChange={(event) => update({ authorizationUrl: event.target.value })}
            radius="large"
          />
          <TextField.Root
            size="2"
            placeholder="购买页链接（HTTPS，可选）"
            value={form.buyUrl}
            onChange={(event) => update({ buyUrl: event.target.value })}
            radius="large"
          />
          <TextArea
            className="sm:col-span-2 font-mono"
            rows={6}
            placeholder={"-----BEGIN PUBLIC KEY-----\n（RSA 2048–4096 位公钥）\n-----END PUBLIC KEY-----"}
            value={form.publicKey}
            onChange={(event) => update({ publicKey: event.target.value })}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm text-white/80">
          <Switch
            checked={form.enabled}
            onCheckedChange={(checked) => update({ enabled: checked })}
          />
          启用
        </label>
        <div className="flex items-center gap-2">
          {config?.enabled && (
            <AlertDialog.Root>
              <AlertDialog.Trigger>
                <Button size="2" variant="soft" color="red" disabled={disableMutation.isPending}>
                  停用
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="440px">
                <AlertDialog.Title>停用自有网站授权？</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  停用后该设备的加密资源仍然受保护，不会变成免费；没有其他购买渠道权益的用户将暂时无法解密。
                </AlertDialog.Description>
                <div className="mt-4 flex justify-end gap-2">
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">取消</Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <Button color="red" onClick={() => disableMutation.mutate()}>
                      停用
                    </Button>
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Root>
          )}
          <Button
            size="2"
            variant="soft"
            color="green"
            disabled={saveMutation.isPending || Boolean(validationError)}
            title={validationError || undefined}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? (
              <Spinner size="2" />
            ) : (
              <>
                <CheckCircleIcon size={15} />
                {config ? "保存（会使进行中的验证失效）" : "保存并启用保护"}
              </>
            )}
          </Button>
        </div>
      </div>
      {validationError && (form.authorizationUrl || form.publicKey) && (
        <p className="text-xs text-amber-300">{validationError}</p>
      )}
    </div>
  );
}
