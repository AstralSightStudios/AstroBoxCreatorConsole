// Casdoor OAuth config for AstroBox account.
//
// In Tauri (desktop app), redirect goes back to a custom scheme so the OS hands
// the OAuth response back to the app. In a regular browser build the old
// in-page /callback route is used instead.
const isTauri =
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const ASTROBOX_DEEP_LINK_SCHEME = "astroboxcc";
export const ASTROBOX_DEEP_LINK_HOST = "auth";
export const ASTROBOX_DEEP_LINK_PATH = "/callback";
export const ASTROBOX_DEEP_LINK_REDIRECT = `${ASTROBOX_DEEP_LINK_SCHEME}://${ASTROBOX_DEEP_LINK_HOST}${ASTROBOX_DEEP_LINK_PATH}`;

export const CASDOOR_CONFIG = {
    serverUrl: "https://cas.astralsight.space",
    clientId: "9b1f42dd40c5c08b5fa9",
    organizationName: "astrobox_test",
    appName: "astrobox_test",
    redirectPath: isTauri ? ASTROBOX_DEEP_LINK_REDIRECT : "/callback",
    signinPath: "/auth/login",
};
