import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { SDK, persistAstroboxAccount } from "~/logic/account/astrobox";
import { ASTROBOX_SERVER_CONFIG } from "~/config/abserver";
import { getSelfUserInfo } from "~/api/astrobox/auth";

type TokenResponse = {
    error?: string;
    token?: string;
};

export default function LoginCallback() {
    const [message, setMessage] = useState("Redirecting...");
    const [hasError, setHasError] = useState(false);
    const handledRef = useRef(false);
    const navigate = useNavigate();

    useEffect(() => {
        if (handledRef.current) {
            return;
        }
        handledRef.current = true;

        async function handleCallback() {
            try {
                setMessage("Requesting for token...");
                const tokenResponse = (await SDK.signin(
                    ASTROBOX_SERVER_CONFIG.serverUrl,
                )) as TokenResponse;

                console.log(tokenResponse);

                if (!tokenResponse?.token) {
                    const errMsg = tokenResponse?.error || "拿不到token。";
                    throw new Error(errMsg);
                }

                setMessage("Loading account information...");
                const profile: any = await getSelfUserInfo(tokenResponse.token);

                console.log(profile);
                persistAstroboxAccount(profile, tokenResponse.token);
                setMessage("Success!");
                window.location.replace("/");
            } catch (error) {
                console.error(error);
                const errMessage =
                    error instanceof Error ? error.message : "登录失败";
                setMessage(errMessage);
                setHasError(true);
            }
        }

        if (window.location.href.includes("code=")) {
            void handleCallback();
        } else {
            setMessage("你几把的为什么会缺少授权参数。");
            setHasError(true);
        }
    }, []);

    return (
        <div
            className="w-full h-screen flex flex-col justify-center items-center gap-3"
            style={{ height: "100dvh", minHeight: "100dvh" }}
        >
            <p className="text-size-large font-bold text-center">
                {hasError ? "登录失败" : "正在登录..."}
            </p>
            <p className="text-size-medium text-gray-500">{message}</p>
            {hasError && (
                <button
                    onClick={() => navigate("/")}
                    className="mt-2 px-4 py-2 rounded-xl corner-rounded border border-white/10 bg-nav-item text-sm font-medium text-white hover:bg-nav-item-hover transition"
                >
                    返回主页
                </button>
            )}
        </div>
    );
}
