// AstroBox 原生(应用内)登录配置。
//
// 与 AstroBox-NG 的 native 登录(loginNative)完全一致:密码表单直接调用
// /auth/native/* 接口,不跳浏览器;第三方 OAuth 由系统浏览器授权后经
// returnUri 的 handoff 页回到应用。

// 服务端 native 认证接口路径(与 AstroBox-NG privaccount/native.rs 一致)。
export const NATIVE_AUTH_PATHS = {
    config: "/auth/native/config",
    passwordLogin: "/auth/native/password/login",
    oauthStart: "/auth/native/oauth/start",
    oauthComplete: "/auth/native/oauth/complete",
} as const;

// 第三方 OAuth 完成后的跳转目标,由服务端 handoff 页处理并带回应用。
// 与 AstroBox-NG 保持一致。
export const NATIVE_RETURN_URI = "https://abox.run/open";

// 这三类第三方登录/绑定暂不上线:即使服务端在 providers 里下发,
// 登录页也统一不展示(与 AstroBox-NG 一致)。
export const HIDDEN_NATIVE_PROVIDER_TYPES = new Set([
    "Google",
    "Discord",
    "Steam",
]);

// 登录页第三方按钮的展示顺序(与 AstroBox-NG 一致)。
export const NATIVE_PROVIDER_TYPE_ORDER = [
    "Custom2",
    "Apple",
    "GitHub",
    "Custom",
];

// 账号源(注册/忘记密码网页)基址。与 AstroBox-NG 默认账号源 casAstralsight 一致。
export const ACCOUNT_SOURCE_BASE_URL = "https://cas.astralsight.space";

export function buildAccountSourceUrl(path: string = "/account"): string {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    return `${ACCOUNT_SOURCE_BASE_URL}${normalized}`;
}

// OAuth 登录进行中的本地持久化 key 与 TTL(与 AstroBox-NG loginNative 一致)。
export const NATIVE_PENDING_OAUTH_KEY = "native_login_pending_oauth";
export const NATIVE_LOGIN_IN_FLIGHT_TTL = 5 * 60 * 1000;

// 保存密码(自动填充)的本地存储 key(与 AstroBox-NG 一致)。
export const NATIVE_SAVE_PASSWORD_KEY = "native_login_save_password";
export const NATIVE_SAVED_CREDENTIALS_KEY = "native_login_saved_credentials";
