import { sendApiRequest } from "./request";

export interface SubmitResourceCryptoInfoBody {
  id: string;
  deviceId: string;
  hash: string;
  key: string;
}

export function submitResourceCryptoInfo(body: SubmitResourceCryptoInfoBody) {
  return sendApiRequest<string>(
    "/resource/submit_crypto_info",
    "POST",
    undefined,
    body,
  );
}
