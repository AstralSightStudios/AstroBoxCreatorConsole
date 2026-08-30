import { useEffect } from "react";

/**
 * GitHub OAuth web 回调页。
 *
 * Web 登录时 GitHub 授权后跳回此页,页面把 code/state 通过 postMessage
 * 回传给打开它的应用窗口(popup),然后自动关闭。打开它的父窗口会校验
 * event.origin 是否同源,因此这里用 "*" 作为 targetOrigin 是安全的。
 */
export default function OauthCallbackPage() {
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const code = params.get("code") || "";
        const state = params.get("state") || "";
        const error = params.get("error") || undefined;

        if (window.opener) {
            window.opener.postMessage(
                { type: "github-oauth-callback", code, state, error },
                "*",
            );
            window.close();
        }
    }, []);

    return (
        <div
            className="w-full h-screen flex flex-col justify-center items-center gap-3"
            style={{ height: "100dvh", minHeight: "100dvh" }}
        >
            <p className="text-size-large font-bold text-center">正在完成登录...</p>
            <p className="text-size-medium text-gray-500">
                请返回应用窗口查看结果,此页面将自动关闭。
            </p>
        </div>
    );
}
