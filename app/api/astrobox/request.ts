import axios from "axios";
import { ASTROBOX_SERVER_CONFIG } from "~/config/abserver";
import { ACCOUNT_INFO } from "~/logic/account/astrobox";

export async function sendApiRequest<T>(
    url: string,
    method: string,
    token?: string,
    data?: any,
): Promise<T> {
    const response = await axios.request<T>({
        url: `${ASTROBOX_SERVER_CONFIG.serverUrl}${url}`,
        method,
        data,
        headers: {
            "X-ASTROBOX-TOKEN": ACCOUNT_INFO?.token || token,
        },
    });

    return response.data;
}
