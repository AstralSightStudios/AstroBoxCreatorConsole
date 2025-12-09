import { useEffect, useRef, useState } from "react";
import { SDK, persistAstroboxAccount } from "~/logic/account/astrobox";
import { ASTROBOX_SERVER_CONFIG } from "~/config/abserver";
import { getSelfUserInfo } from "~/api/astrobox/auth";

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
            }
        }

        if (window.location.href.includes("code=")) {
            void handleCallback();
        } else {
            setMessage("你几把的为什么会缺少授权参数。");
        }
    }, []);

    return (
        <div
            className="w-full h-screen flex flex-col justify-center items-center"
            style={{ height: "100dvh", minHeight: "100dvh" }}
        >
            <p className="text-size-large font-bold text-center">正在登录...</p>
            <p className="text-size-medium text-gray-500">{message}</p>
        </div>
    );
}
