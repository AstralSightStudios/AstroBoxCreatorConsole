import axios from "axios";
import Sdk from "casdoor-js-sdk";
import { CASDOOR_CONFIG } from "~/config/casdoor";
import { getSelfUserInfo } from "~/api/astrobox/auth";
import {
    getAstroboxToken,
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
        plan: profile?.vip || profile?.tag || "",
        email: profile?.email ?? "",
        token,
    };

    setAstroboxAccount(account);
}

export function clearAstroboxAccount() {
    logoutAccount("astrobox");
}

export async function refreshAstroboxAccount() {
    const token = getAstroboxToken();
    if (!token) return false;

    try {
        const profile = await getSelfUserInfo(token);
        persistAstroboxAccount(profile, token);
        return true;
    } catch (error) {
        const status = axios.isAxiosError(error)
            ? error.response?.status
            : undefined;

        if (status === 401 || status === 403) {
            clearAstroboxAccount();
        }

        console.warn("Failed to refresh AstroBox account data", error);
        return false;
    }
}
