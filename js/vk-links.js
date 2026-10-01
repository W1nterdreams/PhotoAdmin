function isMobileDevice() {
    const ua = String(navigator.userAgent || "");
    return /Android|iPhone|iPad|iPod/i.test(ua);
}

function isNativeVkClient() {
    return Boolean(
        isMobileDevice() ||
        window.AndroidBridge ||
        window.webkit?.messageHandlers?.VKWebAppClose ||
        window.ReactNativeWebView
    );
}

let pendingNativeContext = null;
let pendingWasHidden = false;
let returnTimer = null;

function armNativeReturn(context) {
    if (!context) return;
    pendingNativeContext = {
        ...context,
        openedAt: Date.now()
    };
    pendingWasHidden = false;
}

function emitNativeReturn() {
    if (!pendingNativeContext || !pendingWasHidden) return;

    const detail = pendingNativeContext;
    pendingNativeContext = null;
    pendingWasHidden = false;

    window.dispatchEvent(new CustomEvent("vk-native-return", { detail }));
}

function scheduleNativeReturnCheck() {
    if (returnTimer) clearTimeout(returnTimer);
    returnTimer = setTimeout(() => {
        returnTimer = null;
        emitNativeReturn();
    }, 250);
}

if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
        if (!pendingNativeContext) return;

        if (document.hidden) {
            pendingWasHidden = true;
            return;
        }

        scheduleNativeReturnCheck();
    });

    window.addEventListener("focus", () => {
        if (!pendingNativeContext || !pendingWasHidden) return;
        scheduleNativeReturnCheck();
    });
}

function targetToUrls(target) {
    const raw = String(target || "").trim();

    if (/^id\d+$/i.test(raw)) {
        return {
            web: `https://vk.com/${raw}`,
            native: `vk://vk.com/${raw}`
        };
    }

    if (/^(club|public)\d+$/i.test(raw)) {
        return {
            web: `https://vk.com/${raw}`,
            native: `vk://vk.com/${raw}`
        };
    }

    if (/^photo-?\d+_\d+$/i.test(raw)) {
        return {
            web: `https://vk.com/${raw}`,
            native: `vk://vk.com/${raw}`
        };
    }

    if (/^https?:\/\/vk\.(com|ru)\//i.test(raw)) {
        const path = raw.replace(/^https?:\/\/vk\.(com|ru)\//i, "");
        return {
            web: raw,
            native: `vk://vk.com/${path}`
        };
    }

    return {
        web: `https://vk.com/${raw}`,
        native: `vk://vk.com/${raw}`
    };
}

export function profileTargetFromId(id) {
    const n = Number(id || 0);
    if (n > 0) return `id${n}`;
    if (n < 0) return `club${Math.abs(n)}`;
    return "";
}

export function photoTarget(photo, fallbackOwnerId = 0) {
    const photoId = Number(photo?.id || 0);
    const ownerId = Number(photo?.owner_id || fallbackOwnerId || 0);
    if (!photoId || !ownerId) return "";
    return `photo${ownerId}_${photoId}`;
}

export function openVkTarget(target, nativeContext = null) {
    const { web, native } = targetToUrls(target);

    if (!isNativeVkClient()) {
        window.open(web, "_blank", "noopener,noreferrer");
        return;
    }

    armNativeReturn(nativeContext);

    let fallbackTimer = null;

    const clearFallback = () => {
        if (fallbackTimer) clearTimeout(fallbackTimer);
        fallbackTimer = null;
        document.removeEventListener("visibilitychange", onVisibilityChange);
    };

    const onVisibilityChange = () => {
        if (document.hidden) clearFallback();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    try {
        window.location.href = native;

        fallbackTimer = setTimeout(() => {
            clearFallback();
            try {
                window.location.href = web;
            } catch (_) {
                window.open(web, "_blank", "noopener,noreferrer");
            }
        }, 1000);
    } catch (_) {
        clearFallback();
        window.location.href = web;
    }
}

export function openVkProfile(id) {
    const target = profileTargetFromId(id);
    if (!target) return;
    openVkTarget(target);
}

export function openVkPhoto(photo, fallbackOwnerId = 0, nativeContext = null) {
    const target = photoTarget(photo, fallbackOwnerId);
    if (!target) return false;

    const photoId = Number(photo?.id || 0);
    const ownerId = Number(photo?.owner_id || fallbackOwnerId || 0);
    const albumId = Number(photo?.album_id || 0);

    openVkTarget(target, {
        type: "photo",
        photoId,
        ownerId,
        albumId,
        ...(nativeContext || {})
    });
    return true;
}
