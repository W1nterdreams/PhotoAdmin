import { state } from "./state.js?v=20261007-description-links49";
import { vkApi } from "./vk-api.js?v=20261007-description-links49";
import { getOwnerId } from "./group-context.js?v=20261007-description-links49";
import { openVkTarget } from "./vk-links.js?v=20261007-description-links49";
import {
    armLongPressReleaseGuard,
    consumeLongPressSyntheticClick
} from "./long-press-guard.js?v=20261007-description-links49";

const LINK_LONG_PRESS_MS = 900;
const MOVE_CANCEL_PX = 14;
const URL_RE = /(?:https?:\/\/|www\.|(?:m\.)?vk\.(?:com|ru)\/)[^\s<>"']+/gi;

function normalizeDetectedUrl(rawUrl) {
    const value = String(rawUrl || "").trim();
    if (/^https?:\/\//i.test(value)) return value;
    return `https://${value}`;
}

function splitTrailingPunctuation(rawUrl) {
    let url = String(rawUrl || "");
    let trailing = "";

    // В описаниях ссылка часто заканчивается точкой/запятой/скобкой.
    // Эти знаки оставляем обычным текстом, чтобы URL открывался корректно.
    while (url && /[.,!?;:\]\}]/.test(url.at(-1))) {
        trailing = url.at(-1) + trailing;
        url = url.slice(0, -1);
    }

    if (url.endsWith(")")) {
        const opens = (url.match(/\(/g) || []).length;
        const closes = (url.match(/\)/g) || []).length;
        if (closes > opens) {
            trailing = ")" + trailing;
            url = url.slice(0, -1);
        }
    }

    return { url, trailing };
}

function parseVkResource(rawUrl) {
    let parsed;
    try {
        parsed = new URL(rawUrl, window.location.href);
    } catch (_) {
        return null;
    }

    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== "vk.com" && host !== "vk.ru" && host !== "m.vk.com" && host !== "m.vk.ru") {
        return null;
    }

    const candidates = [
        decodeURIComponent(parsed.pathname || ""),
        decodeURIComponent(parsed.searchParams.get("z") || ""),
        decodeURIComponent(parsed.searchParams.get("w") || "")
    ];

    for (const candidate of candidates) {
        const photo = String(candidate).match(/(?:^|[/#?=&])photo(-?\d+)_(\d+)/i);
        if (photo) {
            return {
                kind: "photo",
                ownerId: Number(photo[1]),
                photoId: Number(photo[2])
            };
        }

        const album = String(candidate).match(/(?:^|[/#?=&])album(-?\d+)_(\d+)/i);
        if (album) {
            return {
                kind: "album",
                ownerId: Number(album[1]),
                albumId: Number(album[2])
            };
        }
    }

    return { kind: "vk", url: parsed.href };
}

function findAlbum(albumId, ownerId) {
    const id = Number(albumId || 0);
    const owner = Number(ownerId || getOwnerId() || 0);
    const source = [
        ...(Array.isArray(state.albums) ? state.albums : []),
        ...(Array.isArray(state.albumIndex) ? state.albumIndex : [])
    ];

    const existing = source.find(album =>
        Number(album?.id || 0) === id &&
        Number(album?.owner_id || owner) === owner
    );

    return existing || {
        id,
        owner_id: owner,
        title: "Альбом",
        description: "",
        size: 0
    };
}

async function openVkResourceInsidePhotoAdmin(resource) {
    if (!resource || (resource.kind !== "photo" && resource.kind !== "album")) return false;

    const currentOwnerId = Number(getOwnerId() || 0);
    if (!currentOwnerId || Number(resource.ownerId) !== currentOwnerId) return false;

    if (resource.kind === "album") {
        const album = findAlbum(resource.albumId, resource.ownerId);
        const { openAlbum } = await import("./photos.js?v=20261007-description-links49");
        await openAlbum(album);
        return true;
    }

    const result = await vkApi("photos.getById", {
        photos: `${resource.ownerId}_${resource.photoId}`,
        extended: 1,
        photo_sizes: 1
    });
    const photo = Array.isArray(result) ? result[0] : null;
    if (!photo?.id) return false;

    const album = findAlbum(photo.album_id, resource.ownerId);
    const { openPhotoViewer } = await import("./photo-viewer.js?v=20261007-description-links49");
    await openPhotoViewer(photo, album, {
        photoDataFresh: true,
        viewerSource: "description-link",
        sequence: [photo]
    });
    return true;
}

async function openLinkNormally(url) {
    const resource = parseVkResource(url);

    try {
        if (await openVkResourceInsidePhotoAdmin(resource)) return;
    } catch (error) {
        console.warn("Не удалось открыть ссылку внутри ФотоАдмина:", error);
    }

    // Для ссылок, которые ФотоАдмин не умеет отобразить своим экраном,
    // оставляем обычное открытие из WebView миниаппа.
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
    }
}

function openLinkInVk(url) {
    const resource = parseVkResource(url);
    if (resource) {
        openVkTarget(url, { type: "description-link", url });
        return;
    }

    window.open(url, "_blank", "noopener,noreferrer");
}

function showOpenInVkConfirmation(url) {
    const existing = document.getElementById("descriptionLinkConfirmOverlay");
    existing?.remove();

    const overlay = document.createElement("div");
    overlay.id = "descriptionLinkConfirmOverlay";
    overlay.className = "modal-overlay";

    const modal = document.createElement("div");
    modal.className = "modal description-link-confirm-modal";

    const title = document.createElement("div");
    title.className = "modal-title";
    title.textContent = "Открыть ссылку в VK?";

    const urlBox = document.createElement("div");
    urlBox.className = "description-link-confirm-url";
    urlBox.textContent = url;

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary-button";
    cancel.textContent = "Отмена";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "primary-button";
    open.textContent = "Открыть в VK";

    const close = () => overlay.remove();

    // После long press WebView иногда генерирует синтетический click уже по
    // появившейся модалке. Глобальный guard нужен, чтобы такой click не
    // нажал кнопку сам. Но реальный новый tap по кнопке должен срабатывать
    // мгновенно, даже если guard ещё активен. Отличаем его по новому
    // pointerdown, который произошёл уже на самой кнопке/overlay.
    const bindImmediateAction = (element, action) => {
        let freshPointerDown = false;

        element.addEventListener("pointerdown", event => {
            if (event.pointerType === "mouse" && event.button !== 0) return;
            freshPointerDown = true;
            event.stopPropagation();
        }, true);

        element.addEventListener("pointercancel", () => {
            freshPointerDown = false;
        }, true);

        element.addEventListener("click", event => {
            const intentionalClick = freshPointerDown || event.detail === 0;
            freshPointerDown = false;

            if (!intentionalClick && consumeLongPressSyntheticClick(event)) return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            action();
        }, true);
    };

    bindImmediateAction(cancel, close);
    bindImmediateAction(open, () => {
        close();
        openLinkInVk(url);
    });

    let overlayFreshPointerDown = false;
    overlay.addEventListener("pointerdown", event => {
        if (event.target !== overlay) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        overlayFreshPointerDown = true;
    }, true);

    overlay.addEventListener("pointercancel", () => {
        overlayFreshPointerDown = false;
    }, true);

    overlay.addEventListener("click", event => {
        if (event.target !== overlay) return;

        const intentionalClick = overlayFreshPointerDown || event.detail === 0;
        overlayFreshPointerDown = false;
        if (!intentionalClick && consumeLongPressSyntheticClick(event)) return;

        event.preventDefault();
        event.stopPropagation();
        close();
    }, true);

    modal.addEventListener("click", event => event.stopPropagation());
    actions.append(cancel, open);
    modal.append(title, urlBox, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
}

function bindDescriptionLink(link, url) {
    let timer = null;
    let startX = 0;
    let startY = 0;
    let longPressTriggered = false;
    let activePointerId = null;

    const clearTimer = () => {
        if (timer !== null) {
            window.clearTimeout(timer);
            timer = null;
        }
    };

    link.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;

        clearTimer();
        longPressTriggered = false;
        activePointerId = event.pointerId;
        startX = event.clientX;
        startY = event.clientY;

        timer = window.setTimeout(() => {
            timer = null;
            longPressTriggered = true;
            armLongPressReleaseGuard(activePointerId);
            try { navigator.vibrate?.(18); } catch (_) {}
            showOpenInVkConfirmation(url);
        }, LINK_LONG_PRESS_MS);
    });

    link.addEventListener("pointermove", event => {
        if (timer === null) return;
        if (Math.hypot(event.clientX - startX, event.clientY - startY) > MOVE_CANCEL_PX) {
            clearTimer();
        }
    });

    link.addEventListener("pointerup", clearTimer);
    link.addEventListener("pointercancel", clearTimer);
    link.addEventListener("pointerleave", event => {
        if (event.pointerType === "mouse") clearTimer();
    });

    link.addEventListener("contextmenu", event => {
        event.preventDefault();
        event.stopPropagation();
        clearTimer();
        if (longPressTriggered) return;
        longPressTriggered = true;
        armLongPressReleaseGuard(activePointerId);
        showOpenInVkConfirmation(url);
    });

    link.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        if (longPressTriggered || consumeLongPressSyntheticClick(event)) {
            longPressTriggered = false;
            return;
        }

        void openLinkNormally(url);
    }, true);
}

export function renderPhotoDescription(container, rawText) {
    if (!container) return;

    const text = String(rawText || "");
    container.replaceChildren();
    container.classList.toggle("hidden", !text.trim());
    if (!text) return;

    let lastIndex = 0;
    URL_RE.lastIndex = 0;
    let match;

    while ((match = URL_RE.exec(text)) !== null) {
        if (match.index > lastIndex) {
            container.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
        }

        const { url: detectedUrl, trailing } = splitTrailingPunctuation(match[0]);
        const url = normalizeDetectedUrl(detectedUrl);
        if (detectedUrl) {
            const link = document.createElement("a");
            link.className = "photo-description-link";
            link.href = url;
            link.textContent = url;
            link.setAttribute("role", "link");
            link.setAttribute("aria-label", `${url}. Удерживайте для открытия в VK`);
            bindDescriptionLink(link, url);
            container.appendChild(link);
        }

        if (trailing) container.appendChild(document.createTextNode(trailing));
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < text.length) {
        container.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
}
