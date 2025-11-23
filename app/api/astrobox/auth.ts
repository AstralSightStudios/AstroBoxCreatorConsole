import { sendApiRequest } from "./request";

export function getSelfUserInfo(token: string): Promise<any> {
    return sendApiRequest("/auth/api/getUserInfo", "GET", token);
}
