import { VK_APP_ID, VK_API_VERSION } from "./config.js?v=20260927-captiontop43";
import { state } from "./state.js?v=20260927-captiontop43";
import { dom } from "./dom.js?v=20260927-captiontop43";
import { logError } from "./helpers.js?v=20260927-captiontop43";

let apiStats = createEmptyStats();

function createEmptyStats() {
    return {
        startedAt: Date.now(),
        total: 0,
        methods: {}
    };
}

function recordApiCall(method) {
    const name = String(method || "unknown");
    apiStats.total += 1;
    apiStats.methods[name] = Number(apiStats.methods[name] || 0) + 1;
}

export function getVkApiStats() {
    return JSON.parse(JSON.stringify(apiStats));
}

export function resetVkApiStats() {
    apiStats = createEmptyStats();
    return getVkApiStats();
}

export async function vkInit() {
    await vkBridge.send("VKWebAppInit");
}

export async function loadUser() {
    const result = await vkBridge.send("VKWebAppGetUserInfo");
    state.currentUser = result;
    dom.user.textContent = `${result.first_name || ""} ${result.last_name || ""}`.trim() || "Пользователь";
}

export async function getAccessToken() {
    const result = await vkBridge.send("VKWebAppGetAuthToken", {
        app_id: VK_APP_ID,
        scope: "photos"
    });

    state.accessToken = result.access_token;
    state.accessScope = Array.isArray(result.scope)
        ? result.scope.join(",")
        : String(result.scope || "photos");

    if (!state.accessToken) throw new Error("VK не вернул access token.");
}

export async function vkApi(method, params = {}) {
    if (!state.accessToken) throw new Error("Нет access token.");
    recordApiCall(method);

    try {
        const result = await vkBridge.send("VKWebAppCallAPIMethod", {
            method,
            params: {
                ...params,
                access_token: state.accessToken,
                v: VK_API_VERSION
            }
        });

        if (result?.error) throw result.error;
        if (!result || typeof result.response === "undefined") {
            throw new Error("VK API не вернул response.");
        }
        return result.response;
    } catch (error) {
        logError(`VK API ${method}:`, error);
        throw error;
    }
}

if (typeof window !== "undefined") {
    window.vkApiDebug = {
        stats: getVkApiStats,
        reset: resetVkApiStats
    };
}
