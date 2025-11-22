import { useEffect, useRef, useState } from "react";
import type ITokenResponse from "js-pkce/dist/ITokenResponse";
import { SDK, saveAccount, type AccountInfo } from "~/logic/account/astrobox";

interface CasdoorUserProfile {
    avatar?: string;
    displayName?: string;
    preferred_username?: string;
    name?: string;
    tag?: string;
    email?: string;
}

type TokenResponse = {
    error?: string;
    token?: string;
};

export default function LoginCallback() {
    const [message, setMessage] = useState("Redirecting...");
    const handledRef = useRef(false);

    useEffect(() => {
        if (handledRef.current) {
            return;
        }
        handledRef.current = true;

        async function handleCallback() {
            try {
                setMessage("拿token...");
                const tokenResponse = (await SDK.signin(
                    "http://localhost:3000",
                )) as TokenResponse;

                console.log(tokenResponse);

                if (!tokenResponse?.token) {
                    const errMsg =
                        tokenResponse?.error || "拿不到token。";
                    throw new Error(errMsg);
                }

                setMessage("加载账号信息...");
                const profile: any = null;

                const account: AccountInfo = {
                    avatar: profile?.avatar ?? "",
                    name:
                        profile?.displayName ||
                        profile?.preferred_username ||
                        profile?.name ||
                        "",
                    plan: profile?.tag ?? "",
                    email: profile?.email ?? "",
                    token: tokenResponse.token,
                };

                saveAccount(account);
                setMessage("完成！");
                window.location.replace("/");
            } catch (error) {
                console.error(error);
                const errMessage =
                    error instanceof Error ? error.message : "登录失败";
                setMessage(errMessage);
            }
        }

        if (window.location.href.includes("code=")) {
            void handleCallback();
        } else {
            setMessage("你几把的为什么会缺少授权参数。");
        }
    }, []);

    return <p>{message}</p>;
}
