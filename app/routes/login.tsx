import { useQuery } from "@tanstack/react-query";
import { ArrowSquareOutIcon, EyeIcon, EyeSlashIcon, KeyIcon, UserCircleIcon } from "@phosphor-icons/react";
import { Checkbox, Spinner } from "@radix-ui/themes";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import { openUrl } from "@tauri-apps/plugin-opener";

import { getNativeAuthConfig } from "~/api/astrobox/auth";
import { buildAccountSourceUrl } from "~/config/nativeAuth";
import { startAstroboxLogin } from "~/logic/account/astrobox";
import {
    loadSavedCredentials,
    loadSavePasswordSetting,
    nativeLoginWithPassword,
    savePasswordSetting,
} from "~/logic/account/nativeAuth";

const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function openExternalForAuth(url: string) {
    if (isTauri) {
        try {
            await openUrl(url);
            return;
        } catch {
            // 回退到新窗口。
        }
    }
    window.open(url, "_blank", "noopener");
}

export default function LoginPage() {
    const navigate = useNavigate();
    const [initialCredentials] = useState(loadSavedCredentials);
    const [username, setUsername] = useState(initialCredentials?.u ?? "");
    const [password, setPassword] = useState(initialCredentials?.p ?? "");
    const [showPassword, setShowPassword] = useState(false);
    const [busy, setBusy] = useState(false);
    const [externalBusy, setExternalBusy] = useState(false);
    const [savePassword, setSavePassword] = useState(loadSavePasswordSetting);

    const { data: config } = useQuery({
        queryKey: ["astrobox-native-config"],
        queryFn: () => getNativeAuthConfig(),
        staleTime: 60_000,
    });

    const handlePasswordLogin = useCallback(async () => {
        if (busy || externalBusy) return;
        if (!username.trim() || !password) {
            toast.error("请输入用户名和密码");
            return;
        }
        setBusy(true);
        try {
            await nativeLoginWithPassword(username, password, savePassword);
            setBusy(false);
            toast.success("登录成功");
            navigate(-1);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(message || "登录失败");
            setBusy(false);
        }
    }, [busy, externalBusy, username, password, savePassword, navigate]);

    const handleExternalLogin = useCallback(async () => {
        if (busy || externalBusy) return;
        setExternalBusy(true);
        try {
            // 「外部登录」走内置网页:系统浏览器回不到 astroboxcc://。
            await startAstroboxLogin();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toast.error(`登录失败: ${message}`);
            setExternalBusy(false);
        }
    }, [busy, externalBusy]);

    const openAccountCenter = useCallback(() => {
        void openExternalForAuth(buildAccountSourceUrl("/account"));
    }, []);

    const openRegister = useCallback(() => {
        void openExternalForAuth(buildAccountSourceUrl("/signup/astrobox"));
    }, []);

    const inputShell =
        "flex h-[44px] w-full max-w-[392px] items-center rounded-full bg-white/[0.06] px-[16px]";
    const inputClass =
        "min-w-0 flex-1 bg-transparent px-[8px] text-[16px] leading-[24px] text-white outline-none placeholder:text-white/40";
    const toggleClass =
        "shrink-0 text-white/70 transition-colors hover:text-white";

    return (
        <div className="flex min-h-full flex-col justify-center">
            <div className="mx-auto flex w-full max-w-[424px] flex-col items-stretch gap-[20px] px-4 py-[39px]">
                <div className="flex flex-col items-center gap-[8px] text-center">
                    <p className="text-[24px] font-[380] tracking-[0.4px] text-white">
                        登录至 AstroBox 账户
                    </p>
                    <p className="text-[13px] font-[450] text-white/75">
                        登录账户以享受爱发电付费资源快速验证、赞助计划等特性
                    </p>
                </div>

                <div className="flex flex-col gap-[33px]">
                    <div className="flex flex-col items-center gap-[18px]">
                        <div className="flex w-full flex-col items-center gap-[8px]">
                            <div className={inputShell}>
                                <UserCircleIcon size={18} className="shrink-0 text-white" />
                                <input
                                    className={inputClass}
                                    placeholder="用户名或邮箱"
                                    value={username}
                                    autoComplete="username"
                                    onChange={(event) => setUsername(event.target.value)}
                                />
                            </div>
                            <div className={inputShell}>
                                <KeyIcon size={18} className="shrink-0 text-white" />
                                <input
                                    className={inputClass}
                                    placeholder="密码"
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    autoComplete="current-password"
                                    onChange={(event) => setPassword(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") void handlePasswordLogin();
                                    }}
                                />
                                <button
                                    type="button"
                                    className={toggleClass}
                                    onClick={() => setShowPassword((value) => !value)}
                                    aria-label="显示或隐藏密码"
                                >
                                    {showPassword ? (
                                        <EyeSlashIcon size={18} />
                                    ) : (
                                        <EyeIcon size={18} />
                                    )}
                                </button>
                            </div>
                            <button
                                type="button"
                                disabled={
                                    busy || externalBusy || config?.passwordLogin === false
                                }
                                className="flex h-[44px] w-full max-w-[392px] items-center justify-center rounded-full bg-[#3e63dd]/15 text-[14px] leading-[24px] text-[#3e63dd] transition-colors hover:bg-[#3e63dd]/25 disabled:opacity-50"
                                onClick={() => void handlePasswordLogin()}
                            >
                                {busy ? <Spinner size="1" /> : "登录"}
                            </button>
                        </div>
                        <div className="flex w-full items-start gap-[18px]">
                            <label className="flex flex-1 cursor-pointer items-center gap-[8px]">
                                <Checkbox
                                    checked={savePassword}
                                    onCheckedChange={(checked) => {
                                        const value = checked === true;
                                        setSavePassword(value);
                                        savePasswordSetting(value);
                                    }}
                                    // 深色主题下未勾选边框太淡,显式提亮。
                                    style={{ borderColor: "rgba(255, 255, 255, 0.65)" }}
                                />
                                <span className="text-[14px] leading-[20px] text-white">
                                    保存密码
                                </span>
                            </label>
                            <button
                                type="button"
                                className="text-[14px] leading-[20px] text-white transition-opacity hover:opacity-70"
                                onClick={openAccountCenter}
                            >
                                忘记密码?
                            </button>
                            <button
                                type="button"
                                className="text-[14px] leading-[20px] text-white transition-opacity hover:opacity-70"
                                onClick={openRegister}
                            >
                                注册账户
                            </button>
                        </div>
                    </div>

                    <div className="flex flex-col items-center gap-[18px]">
                        <div className="flex w-full items-center gap-[10px]">
                            <div className="h-px flex-1 bg-white/20" />
                            <span className="text-[14px] leading-[20px] whitespace-nowrap text-white/40">
                                或者
                            </span>
                            <div className="h-px flex-1 bg-white/20" />
                        </div>
                    </div>

                    <button
                        type="button"
                        disabled={busy || externalBusy}
                        aria-busy={externalBusy}
                        className="flex h-[44px] w-full max-w-[392px] items-center self-center rounded-full border border-white/15 px-[8px] text-white transition-colors hover:bg-white/10 disabled:opacity-50"
                        onClick={() => void handleExternalLogin()}
                    >
                        <span className="flex w-[26px] items-center justify-end">
                            {externalBusy ? (
                                <Spinner size="1" />
                            ) : (
                                <ArrowSquareOutIcon size={20} aria-hidden />
                            )}
                        </span>
                        <span className="min-w-0 flex-1 px-[8px] text-center text-[14px] leading-[24px]">
                            外部登录
                        </span>
                        <span className="w-[26px]" />
                    </button>
                </div>
            </div>
        </div>
    );
}
