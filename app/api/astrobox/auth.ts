import { NATIVE_AUTH_PATHS, NATIVE_RETURN_URI } from "~/config/nativeAuth";
import { ApiError, sendApiRequest } from "./request";

export function getSelfUserInfo(token?: string): Promise<any> {
    return sendApiRequest("/auth/api/getUserInfo", "GET", token);
}

export interface SelfAccountContext {
    userId: string;
    username: string;
    displayName: string;
    email: string;
    avatar: string;
    vip: string;
    vipExpireMap: Record<string, string>;
    roles: string[];
    activeSocialBan: {
        id: string;
        reason: string;
        expiresAt: string | null;
    } | null;
}

export function getSelfAccountContext(token?: string): Promise<SelfAccountContext> {
    return sendApiRequest("/auth/api/me", "GET", token);
}

// ---- 原生(应用内)登录 /auth/native/* ----

export interface NativeProviderInfo {
    id: string;
    name: string;
    displayName: string;
    providerType: string;
    canSignUp: boolean;
    canUnlink: boolean;
}

export interface NativeCaptchaConfig {
    type: string;
    siteKey: string;
}

export interface NativeAuthConfig {
    passwordLogin: boolean;
    signup: boolean;
    providers: NativeProviderInfo[];
    captcha: NativeCaptchaConfig | null;
}

export interface NativeTokenPair {
    token: string;
    refreshToken: string;
}

interface NativeTokenResponse {
    errorCode: string;
    error: string;
    token: string;
    refreshToken: string;
}

interface NativeOAuthStartResponse {
    authorizationUrl: string;
    state: string;
    expiresAt: string;
}

// 服务端 /auth/native/config 里 provider 的原始形状,字段名是 type(非 providerType)。
interface RawNativeProvider {
    id: string;
    name: string;
    displayName: string;
    type: string;
    canSignUp: boolean;
    canUnlink: boolean;
}

// 服务端对登录/注册/第三方 complete 统一返回 errorCode(空串 = 成功),
// 这里把 errorCode 翻译成 ApiError,并校验 token 非空。
function parseNativeToken(data: NativeTokenResponse, action: string): NativeTokenPair {
    if (data?.errorCode) {
        const message = data.error?.trim() || `${action}失败 (${data.errorCode})`;
        throw new ApiError(message, { status: 200 });
    }
    if (!data?.token?.trim()) {
        throw new ApiError(`后端未返回访问令牌(${action}失败)`, { status: 200 });
    }
    return {
        token: data.token,
        refreshToken: data.refreshToken ?? "",
    };
}

/** 应用内登录页能力发现(密码登录开关、注册开关、第三方 provider 列表、验证码)。 */
export async function getNativeAuthConfig(): Promise<NativeAuthConfig> {
    const data = await sendApiRequest<{
        passwordLogin?: boolean;
        signup?: boolean;
        providers?: RawNativeProvider[];
        captcha?: NativeCaptchaConfig | null;
    }>(NATIVE_AUTH_PATHS.config, "GET");
    // 服务端字段名为 type,映射到 providerType —— 图标选择与隐藏逻辑依赖它。
    const providers = Array.isArray(data?.providers)
        ? data.providers.map((provider) => ({
              id: provider.id,
              name: provider.name,
              displayName: provider.displayName,
              providerType: provider.type ?? "",
              canSignUp: Boolean(provider.canSignUp),
              canUnlink: Boolean(provider.canUnlink),
          }))
        : [];
    return {
        passwordLogin: Boolean(data?.passwordLogin),
        signup: Boolean(data?.signup),
        providers,
        captcha: data?.captcha ?? null,
    };
}

/** 用户名密码登录(POST /auth/native/password/login)。 */
export async function nativePasswordLogin(
    username: string,
    password: string,
): Promise<NativeTokenPair> {
    const data = await sendApiRequest<NativeTokenResponse>(
        NATIVE_AUTH_PATHS.passwordLogin,
        "POST",
        undefined,
        { username, password },
    );
    return parseNativeToken(data, "登录");
}

/** 创建第三方 OAuth transaction,客户端用系统浏览器打开返回的 authorizationUrl。 */
export async function nativeOAuthStart(
    provider: string,
    authMode?: "native" | "casdoor",
): Promise<NativeOAuthStartResponse> {
    const body: Record<string, string> = {
        provider,
        returnUri: NATIVE_RETURN_URI,
    };
    if (authMode) body.authMode = authMode;
    return sendApiRequest<NativeOAuthStartResponse>(
        NATIVE_AUTH_PATHS.oauthStart,
        "POST",
        undefined,
        body,
    );
}

/** deep link 带回 state + code 后完成第三方登录(POST /auth/native/oauth/complete)。 */
export async function nativeOAuthComplete(
    state: string,
    code: string,
): Promise<NativeTokenPair> {
    const data = await sendApiRequest<NativeTokenResponse>(
        NATIVE_AUTH_PATHS.oauthComplete,
        "POST",
        undefined,
        { state, code },
    );
    return parseNativeToken(data, "第三方登录");
}
