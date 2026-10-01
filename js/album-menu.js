import { getOwnerId } from "./group-context.js?v=20260927-captiontop43";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260927-captiontop43";
import {
    armLongPressReleaseGuard,
    consumeLongPressSyntheticClick
} from "./long-press-guard.js?v=20260927-captiontop43";

const LONG_PRESS_MS = 900;
const MOVE_CANCEL_PX = 15;

let overlay = null;
let menu = null;
let currentAlbum = null;

function albumLink(album) {
    const ownerId = Number(album?.owner_id) || getOwnerId();
    return `https://vk.com/album${ownerId}_${album.id}`;
}

async function copyText(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
}

function emitAction(action, album) {
    if (!album) return;

    window.dispatchEvent(new CustomEvent("album-menu-action", {
        detail: {
            action,
            album
        }
    }));
}

function createItem(label, action, extraClass = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `album-context-item ${extraClass}`.trim();
    button.textContent = label;

    button.addEventListener("click", async () => {
        const album = currentAlbum;
        await closeAlbumMenu();
        if (!album) return;

        if (action === "copy-link") {
            try {
                await copyText(albumLink(album));
            } catch (error) {
                console.warn("Не удалось скопировать ссылку на альбом:", error);
            }
            return;
        }

        emitAction(action, album);
    });

    return button;
}

function ensureMenu() {
    if (overlay) return;

    overlay = document.createElement("div");
    overlay.className = "album-context-overlay hidden";

    menu = document.createElement("div");
    menu.className = "album-context-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "Действия с альбомом");

    menu.append(
        createItem("Скопировать ссылку", "copy-link"),
        createItem("Комментарии к альбому", "comments"),
        createItem("Редактировать", "edit"),
        createItem("Удалить", "delete", "danger"),
        createItem("Переместить", "move")
    );

    overlay.appendChild(menu);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", event => {
        if (consumeLongPressSyntheticClick(event)) return;
        if (event.target === overlay) void closeAlbumMenu();
    }, true);

    menu.addEventListener("click", event => event.stopPropagation());

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !overlay.classList.contains("hidden")) {
            void closeAlbumMenu();
        }
    });
}

function hideAlbumMenuDirect() {
    if (!overlay) return;
    overlay.classList.add("hidden");
    document.body.classList.remove("album-menu-open");
    currentAlbum = null;
}

export function openAlbumMenu(album) {
    ensureMenu();
    currentAlbum = album;
    overlay.classList.remove("hidden");
    document.body.classList.add("album-menu-open");
    openSwipeOverlay("album-context-menu", hideAlbumMenuDirect);
}

export function closeAlbumMenu() {
    if (!overlay || overlay.classList.contains("hidden")) {
        return Promise.resolve(false);
    }
    return closeSwipeOverlay("album-context-menu");
}

export function bindAlbumLongPress(element, album) {
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

    element.addEventListener("pointerdown", event => {
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
            openAlbumMenu(album);

            // Небольшой отклик на телефоне, если браузер его поддерживает.
            try { navigator.vibrate?.(18); } catch {}
        }, LONG_PRESS_MS);
    });

    element.addEventListener("pointermove", event => {
        if (timer === null) return;

        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) clearTimer();
    });

    element.addEventListener("pointerup", clearTimer);
    element.addEventListener("pointercancel", clearTimer);
    element.addEventListener("pointerleave", event => {
        if (event.pointerType === "mouse") clearTimer();
    });

    // Не даём браузеру показать своё меню по долгому нажатию/правому клику.
    element.addEventListener("contextmenu", event => {
        event.preventDefault();
        clearTimer();
        if (longPressTriggered) return;
        longPressTriggered = true;
        armLongPressReleaseGuard(activePointerId);
        openAlbumMenu(album);
    });

    // После долгого нажатия браузер обычно генерирует click. Перехватываем его,
    // чтобы одновременно с меню не открылся сам альбом.
    element.addEventListener("click", event => {
        if (!longPressTriggered) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        longPressTriggered = false;
    }, true);
}
