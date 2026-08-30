import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Callout,
  Dialog,
  Spinner,
  Tabs,
  TextField,
} from "@radix-ui/themes";
import {
  ArrowClockwiseIcon,
  EyeIcon,
  EyeSlashIcon,
  KeyIcon,
  PhoneIcon,
  ShieldCheckIcon,
  SignOutIcon,
  UserCircleIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AFDIAN_INCOME_QUERY_KEY,
  AFDIAN_SESSION_QUERY_KEY,
  getAfdianErrorMessage,
  getAfdianSessionStatus,
  isAfdianNativeAvailable,
  loginAfdianWithPassword,
  loginAfdianWithQuickCode,
  logoutAfdian,
  refreshAfdianCaptcha,
  sendAfdianQuickLoginCode,
} from "~/api/afdian-account";
import { SectionCard } from "~/routes/resource/publish/components/shared";

function normalizeCaptchaSource(source: string) {
  if (/^(data:|https?:\/\/)/.test(source)) return source;
  return `data:image/png;base64,${source}`;
}

function AfdianLoginDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [mode, setMode] = useState("password");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [phone, setPhone] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [captchaCode, setCaptchaCode] = useState("");
  const [captchaImage, setCaptchaImage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sendingCode, setSendingCode] = useState(false);

  const finishLogin = () => {
    setPassword("");
    setSmsCode("");
    setCaptchaCode("");
    setCaptchaImage("");
    onSuccess();
    onOpenChange(false);
    toast.success("爱发电登录成功");
  };

  const handlePasswordLogin = async () => {
    if (!account.trim() || !password) {
      toast.error("请输入爱发电账号和密码");
      return;
    }
    setSubmitting(true);
    try {
      await loginAfdianWithPassword(account, password);
      finishLogin();
    } catch (error) {
      toast.error(getAfdianErrorMessage(error, "爱发电登录失败"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRefreshCaptcha = async () => {
    if (!phone.trim()) {
      toast.error("请输入手机号");
      return;
    }
    try {
      const image = await refreshAfdianCaptcha(phone);
      setCaptchaImage(image);
      setCaptchaCode("");
    } catch (error) {
      toast.error(getAfdianErrorMessage(error, "图形验证码刷新失败"));
    }
  };

  const handleSendCode = async () => {
    if (!phone.trim()) {
      toast.error("请输入手机号");
      return;
    }
    setSendingCode(true);
    try {
      const result = await sendAfdianQuickLoginCode(phone, captchaCode);
      if (result.status === "sent") {
        setCaptchaImage("");
        setCaptchaCode("");
        toast.success(result.message || "短信验证码已发送");
      } else if (result.status === "captchaRequired") {
        setCaptchaImage(result.captchaImage || "");
        toast.info("请输入图形验证码后重新发送");
      } else {
        toast.error(result.message || "图形验证码无效");
        await handleRefreshCaptcha();
      }
    } catch (error) {
      toast.error(getAfdianErrorMessage(error, "短信验证码发送失败"));
    } finally {
      setSendingCode(false);
    }
  };

  const handleQuickLogin = async () => {
    if (!phone.trim() || !smsCode.trim()) {
      toast.error("请输入手机号和短信验证码");
      return;
    }
    setSubmitting(true);
    try {
      await loginAfdianWithQuickCode(phone, smsCode);
      finishLogin();
    } catch (error) {
      toast.error(getAfdianErrorMessage(error, "爱发电登录失败"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content maxWidth="460px">
        <Dialog.Title>登录爱发电</Dialog.Title>
        <Dialog.Description size="2" className="mb-4 text-white/60">
          登录凭据保存在系统安全存储中，密码不会保存。
        </Dialog.Description>

        <Tabs.Root value={mode} onValueChange={setMode}>
          <Tabs.List>
            <Tabs.Trigger value="password">账号密码</Tabs.Trigger>
            <Tabs.Trigger value="sms">短信验证码</Tabs.Trigger>
          </Tabs.List>

          <div className="pt-4">
            {mode === "password" ? (
              <div className="flex flex-col gap-3">
                <TextField.Root
                  placeholder="邮箱或手机号"
                  value={account}
                  autoComplete="username"
                  onChange={(event) => setAccount(event.target.value)}
                >
                  <TextField.Slot>
                    <UserCircleIcon size={16} />
                  </TextField.Slot>
                </TextField.Root>
                <TextField.Root
                  placeholder="密码"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void handlePasswordLogin();
                  }}
                >
                  <TextField.Slot>
                    <KeyIcon size={16} />
                  </TextField.Slot>
                  <TextField.Slot side="right">
                    <button
                      type="button"
                      className="text-white/60 hover:text-white"
                      aria-label="显示或隐藏密码"
                      onClick={() => setShowPassword((value) => !value)}
                    >
                      {showPassword ? (
                        <EyeSlashIcon size={16} />
                      ) : (
                        <EyeIcon size={16} />
                      )}
                    </button>
                  </TextField.Slot>
                </TextField.Root>
                <Button disabled={submitting} onClick={() => void handlePasswordLogin()}>
                  {submitting ? <Spinner size="1" /> : "登录"}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <TextField.Root
                  placeholder="手机号"
                  value={phone}
                  inputMode="tel"
                  autoComplete="tel"
                  onChange={(event) => {
                    setPhone(event.target.value);
                    setCaptchaImage("");
                    setCaptchaCode("");
                  }}
                >
                  <TextField.Slot>
                    <PhoneIcon size={16} />
                  </TextField.Slot>
                </TextField.Root>

                {captchaImage && (
                  <div className="flex items-center gap-2">
                    <img
                      src={normalizeCaptchaSource(captchaImage)}
                      alt="爱发电图形验证码"
                      className="h-10 max-w-36 rounded-md object-contain"
                    />
                    <TextField.Root
                      className="flex-1"
                      placeholder="图形验证码"
                      value={captchaCode}
                      onChange={(event) => setCaptchaCode(event.target.value)}
                    />
                    <Button
                      variant="soft"
                      type="button"
                      onClick={() => void handleRefreshCaptcha()}
                    >
                      刷新
                    </Button>
                  </div>
                )}

                <div className="flex gap-2">
                  <TextField.Root
                    className="flex-1"
                    placeholder="短信验证码"
                    value={smsCode}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    onChange={(event) => setSmsCode(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void handleQuickLogin();
                    }}
                  />
                  <Button
                    variant="soft"
                    disabled={sendingCode}
                    onClick={() => void handleSendCode()}
                  >
                    {sendingCode ? <Spinner size="1" /> : "发送验证码"}
                  </Button>
                </div>
                <Button disabled={submitting} onClick={() => void handleQuickLogin()}>
                  {submitting ? <Spinner size="1" /> : "登录"}
                </Button>
              </div>
            )}
          </div>
        </Tabs.Root>

        <div className="mt-4 flex justify-end">
          <Button variant="soft" color="gray" onClick={() => onOpenChange(false)}>
            取消
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export default function AfdianAccountSection() {
  const queryClient = useQueryClient();
  const nativeAvailable = isAfdianNativeAvailable();
  const [loginOpen, setLoginOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const sessionQuery = useQuery({
    queryKey: AFDIAN_SESSION_QUERY_KEY,
    queryFn: getAfdianSessionStatus,
    enabled: nativeAvailable,
    staleTime: 30_000,
    retry: false,
  });

  const syncQueries = async () => {
    await queryClient.invalidateQueries({ queryKey: AFDIAN_SESSION_QUERY_KEY });
    await queryClient.invalidateQueries({ queryKey: AFDIAN_INCOME_QUERY_KEY });
  };

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logoutAfdian();
      queryClient.setQueryData(AFDIAN_SESSION_QUERY_KEY, {
        connected: false,
        displayName: null,
      });
      queryClient.removeQueries({ queryKey: AFDIAN_INCOME_QUERY_KEY });
      toast.success("已退出爱发电账户");
    } catch (error) {
      toast.error(getAfdianErrorMessage(error, "退出爱发电账户失败"));
    } finally {
      setLoggingOut(false);
    }
  };

  return (
    <>
      <SectionCard
        title="爱发电账户"
        description="登录后可在概览页查看收入数据"
      >
        {!nativeAvailable ? (
          <Callout.Root color="amber">
            <Callout.Icon>
              <WarningIcon size={16} />
            </Callout.Icon>
            <Callout.Text>爱发电登录仅支持客户端。</Callout.Text>
          </Callout.Root>
        ) : sessionQuery.isLoading ? (
          <div className="flex items-center gap-2 px-2 py-3 text-sm text-white/55">
            <Spinner size="1" />
            正在读取登录状态
          </div>
        ) : sessionQuery.isError ? (
          <Callout.Root color="red">
            <Callout.Icon>
              <WarningIcon size={16} />
            </Callout.Icon>
            <Callout.Text>
              <div className="flex items-center justify-between gap-3">
                <span>
                  {getAfdianErrorMessage(
                    sessionQuery.error,
                    "无法读取爱发电登录状态",
                  )}
                </span>
                <Button variant="soft" onClick={() => void sessionQuery.refetch()}>
                  <ArrowClockwiseIcon size={14} />
                  重试
                </Button>
              </div>
            </Callout.Text>
          </Callout.Root>
        ) : sessionQuery.data?.connected ? (
          <div className="flex items-center gap-3 px-2 py-3">
            <div className="flex size-9 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300">
              <ShieldCheckIcon size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {sessionQuery.data.displayName || "爱发电用户"}
              </p>
              <p className="text-xs text-white/45">已连接爱发电</p>
            </div>
            <Button
              color="red"
              variant="soft"
              disabled={loggingOut}
              onClick={() => void handleLogout()}
            >
              {loggingOut ? <Spinner size="1" /> : <SignOutIcon size={15} />}
              退出登录
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 px-2 py-3">
            <div>
              <p className="text-sm font-medium text-white">尚未连接</p>
              <p className="text-xs text-white/45">
                支持账号密码或短信验证码登录
              </p>
            </div>
            <Button onClick={() => setLoginOpen(true)}>登录爱发电</Button>
          </div>
        )}
      </SectionCard>

      <AfdianLoginDialog
        open={loginOpen}
        onOpenChange={setLoginOpen}
        onSuccess={() => void syncQueries()}
      />
    </>
  );
}
