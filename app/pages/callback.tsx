import { useEffect } from "react";
import { CASDOOR_CONFIG } from "~/config/casdoor";
import { ACCOUNT_INFO, SDK, type AccountInfo } from "~/logic/account/astrobox";

export default function LoginCallback() {
    useEffect(() => {
        if (window.location.href.indexOf("code") !== -1) {
            if (!ACCOUNT_INFO?.token) {
                SDK.signin(CASDOOR_CONFIG.serverUrl).then((res) => {
                    console.log(res);
                    let token = res.token;
                });
            }
        }
    });

    return <p>跳转中...</p>;
}
