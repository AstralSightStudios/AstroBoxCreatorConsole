import Sdk from "casdoor-js-sdk";
import { CASDOOR_CONFIG } from "~/config/casdoor";

export const SDK = new Sdk(CASDOOR_CONFIG);

export interface AccountInfo {
    avatar: string;
    name: string;
    plan: string;
    email: string;
    token: string;
}

const STORAGE_KEY = "ACCOUNT_INFO";

export function loadAccount(): AccountInfo | undefined {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return undefined;

        const parsed = JSON.parse(raw);

        return {
            avatar: parsed.avatar ?? "",
            name: parsed.name ?? "",
            plan: parsed.plan ?? "",
            email: parsed.email ?? "",
            token: parsed.token ?? "",
        };
    } catch {
        return undefined;
    }
}

export function saveAccount(info: AccountInfo) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(info));
}

export function clearAccount() {
    localStorage.removeItem(STORAGE_KEY);
}

export const ACCOUNT_INFO = loadAccount();

export function login() {
    window.location.href = SDK.getSigninUrl();
}
