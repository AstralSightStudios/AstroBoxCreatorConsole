import Sdk from "casdoor-js-sdk";
import { CASDOOR_CONFIG } from "~/config/casdoor";
import {
    logoutAccount,
    setAstroboxAccount,
    type AstroboxAccount,
} from "./store";

export const SDK = new Sdk(CASDOOR_CONFIG);

export function startAstroboxLogin() {
    location.href = SDK.getSigninUrl();
}

export function persistAstroboxAccount(profile: any, token: string) {
    const account: AstroboxAccount = {
        avatar: profile?.avatar ?? "",
        name:
            profile?.displayName ||
            profile?.preferred_username ||
            profile?.name ||
            "",
        plan: profile?.tag ?? "",
        email: profile?.email ?? "",
        token,
    };

    setAstroboxAccount(account);
}

export function clearAstroboxAccount() {
    logoutAccount("astrobox");
}
