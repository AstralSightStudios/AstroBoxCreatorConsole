import axios from "axios";
import { ASTROBOX_SERVER_CONFIG } from "~/config/abserver";
import { getAstroboxToken } from "~/logic/account/store";

export async function sendApiRequest<T>(
    url: string,
    method: string,
    token?: string,
    data?: any,
): Promise<T> {
    const authToken = token || getAstroboxToken();
    const headers: Record<string, string> = {};

    if (authToken) {
        headers["X-ASTROBOX-TOKEN"] = authToken;
    }

    const response = await axios.request<T>({
        url: `${ASTROBOX_SERVER_CONFIG.serverUrl}${url}`,
        method,
        data,
        headers,
    });

    return response.data;
}
