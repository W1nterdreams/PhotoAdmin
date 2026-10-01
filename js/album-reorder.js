import { state } from "./state.js?v=20260927-captiontop43";
import { vkApi } from "./vk-api.js?v=20260927-captiontop43";
import { getErrorMessage } from "./helpers.js?v=20260927-captiontop43";
import { getOwnerId } from "./group-context.js?v=20260927-captiontop43";
import { cacheRemove, albumsKey, albumIndexKey } from "./cache.js?v=20260927-captiontop43";
import { loadAlbums } from "./albums.js?v=20260927-captiontop43";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260927-captiontop43";

let overlay = null;
let activeAlbum = null;
let albums = [];
let selectedSlot = null;
let loading = false;
let saving = false;

function createElement(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function ensureModal() {
    if (overlay) return;

    overlay = createElement("div", "modal-overlay hidden");
    overlay.id = "reorderAlbumModal";

    const modal = createElement("div", "modal album-reorder-modal");

    const header = createElement("div", "modal-header");
    const title = createElement("div", "modal-title", "Переместить альбом");
    title.id = "reorderAlbumModalTitle";

    const close = createElement("button", "modal-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Закрыть");
    close.addEventListener("click", () => void closeModal());

    header.append(title, close);

    const hint = createElement(
        "div",
        "album-reorder-hint",
        "Выберите промежуток, куда нужно поставить альбом."
    );

    const current = createElement("div", "album-reorder-current");
    current.id = "albumReorderCurrent";

    const list = createElement("div", "album-reorder-list");
    list.id = "albumReorderList";

    const error = createElement("div", "form-error hidden");
    error.id = "albumReorderError";

    const actions = createElement("div", "modal-actions");

    const cancel = createElement("button", "secondary-button", "Отмена");
    cancel.type = "button";
    cancel.addEventListener("click", () => void closeModal());

    const save = createElement("button", "primary-button", "Переместить");
    save.type = "button";
    save.id = "saveAlbumReorder";
    save.disabled = true;
    save.addEventListener("click", () => void saveMove());

    actions.append(cancel, save);
    modal.append(header, hint, current, list, error, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", event => {
        if (event.target === overlay) void closeModal();
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !overlay.classList.contains("hidden")) {
            void closeModal();
        }
    });

    installStyles();
}

function installStyles() {
    if (document.getElementById("albumReorderStyles")) return;

    const style = document.createElement("style");
    style.id = "albumReorderStyles";
    style.textContent = `
        .album-reorder-modal {
            width: min(520px, 100%);
        }

        .album-reorder-hint {
            margin: -4px 0 12px;
            color: #aeb4b9;
            font-size: 13px;
            line-height: 1.4;
        }

        .album-reorder-current {
            margin-bottom: 14px;
            padding: 10px 12px;
            border: 1px solid #3d444a;
            border-radius: 10px;
            background: #171a1d;
            color: #ffffff;
            font-weight: 600;
            word-break: break-word;
        }

        .album-reorder-list {
            max-height: min(56vh, 560px);
            overflow-y: auto;
            padding: 2px 2px 8px;
            overscroll-behavior: contain;
        }

        .album-reorder-row {
            min-height: 46px;
            padding: 10px 12px;
            border: 1px solid #353b40;
            border-radius: 10px;
            background: #202428;
            color: #e8eaed;
            font-size: 14px;
            line-height: 1.35;
            word-break: break-word;
        }

        .album-reorder-gap {
            position: relative;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 100%;
            min-height: 34px;
            margin: 3px 0;
            padding: 0 8px;
            border: 0;
            background: transparent;
            color: #8f979e;
            cursor: pointer;
        }

        .album-reorder-gap::before,
        .album-reorder-gap::after {
            content: "";
            flex: 1;
            height: 1px;
            background: #42484d;
        }

        .album-reorder-gap span {
            flex: 0 0 auto;
            margin: 0 9px;
            font-size: 12px;
        }

        .album-reorder-gap:hover,
        .album-reorder-gap:active {
            color: #c8dff0;
        }

        .album-reorder-gap.selected {
            min-height: 40px;
            border: 1px solid #4f92bd;
            border-radius: 9px;
            background: #233846;
            color: #ffffff;
        }

        .album-reorder-gap.selected::before,
        .album-reorder-gap.selected::after {
            background: #6ca7cb;
        }

        .album-reorder-loading {
            padding: 24px 10px;
            color: #aeb4b9;
            text-align: center;
        }
    `;
    document.head.appendChild(style);
}

function showError(message = "") {
    const error = document.getElementById("albumReorderError");
    if (!error) return;
    error.textContent = message;
    error.classList.toggle("hidden", !message);
}

function setSaveEnabled() {
    const save = document.getElementById("saveAlbumReorder");
    if (!save) return;
    save.disabled = loading || saving || selectedSlot === null;
}

function setBusy(value) {
    saving = value;
    const save = document.getElementById("saveAlbumReorder");
    if (save) save.textContent = value ? "Перемещаем..." : "Переместить";
    setSaveEnabled();
}

async function fetchAllAlbums() {
    const ownerId = getOwnerId();
    const result = await vkApi("photos.getAlbums", {
        owner_id: ownerId,
        need_system: 0,
        need_covers: 0,
        photo_sizes: 0,
        count: 1000,
        offset: 0
    });

    return Array.isArray(result?.items) ? result.items : [];
}

function currentOrderWithoutActive() {
    const activeId = String(activeAlbum?.id ?? "");
    return albums.filter(album => String(album.id) !== activeId);
}

function originalSlotIndex() {
    if (!activeAlbum) return -1;
    const activeId = String(activeAlbum.id);
    const index = albums.findIndex(album => String(album.id) === activeId);
    return index < 0 ? -1 : index;
}

function slotLabel(index, others) {
    if (index === 0) return "В начало";
    if (index === others.length) return "В конец";
    return "Вставить сюда";
}

function selectSlot(index) {
    selectedSlot = index;

    document.querySelectorAll(".album-reorder-gap").forEach(button => {
        button.classList.toggle("selected", Number(button.dataset.slot) === index);
    });

    setSaveEnabled();
}

function renderList() {
    const list = document.getElementById("albumReorderList");
    if (!list) return;

    list.innerHTML = "";

    const others = currentOrderWithoutActive();

    if (!others.length) {
        list.innerHTML = '<div class="album-reorder-loading">Других альбомов нет.</div>';
        selectedSlot = null;
        setSaveEnabled();
        return;
    }

    for (let slot = 0; slot <= others.length; slot++) {
        const gap = createElement("button", "album-reorder-gap");
        gap.type = "button";
        gap.dataset.slot = String(slot);

        const label = createElement("span", "", slotLabel(slot, others));
        gap.appendChild(label);
        gap.addEventListener("click", () => selectSlot(slot));
        list.appendChild(gap);

        if (slot < others.length) {
            const row = createElement(
                "div",
                "album-reorder-row",
                others[slot].title || "Без названия"
            );
            list.appendChild(row);
        }
    }

    // Показываем текущее положение альбома как выбранное по умолчанию.
    const currentSlot = originalSlotIndex();
    if (currentSlot >= 0) selectSlot(currentSlot);
}

async function openModal(album) {
    ensureModal();

    if (!album) return;

    const albumId = Number(album.id);
    if (!Number.isFinite(albumId) || albumId <= 0) {
        window.alert("Системный альбом перемещать нельзя.");
        return;
    }

    activeAlbum = album;
    albums = [];
    selectedSlot = null;
    loading = true;
    saving = false;
    showError("");

    const current = document.getElementById("albumReorderCurrent");
    if (current) current.textContent = `Перемещаем: ${album.title || "Без названия"}`;

    const list = document.getElementById("albumReorderList");
    if (list) list.innerHTML = '<div class="album-reorder-loading">Загружаем порядок альбомов...</div>';

    overlay.classList.remove("hidden");
    document.body.classList.add("album-menu-open");
    openSwipeOverlay("album-reorder", hideModalDirect);
    setSaveEnabled();

    try {
        albums = await fetchAllAlbums();

        const found = albums.some(item => String(item.id) === String(album.id));
        if (!found) {
            throw new Error("Не удалось найти этот альбом в актуальном списке VK.");
        }

        renderList();
    } catch (error) {
        showError(getErrorMessage(error));
        if (list) list.innerHTML = "";
    } finally {
        loading = false;
        setSaveEnabled();
    }
}

function hideModalDirect() {
    if (!overlay) return;
    overlay.classList.add("hidden");
    document.body.classList.remove("album-menu-open");
    activeAlbum = null;
    albums = [];
    selectedSlot = null;
    loading = false;
    showError("");
}

function closeModal() {
    if (!overlay || saving) return Promise.resolve(false);
    return closeSwipeOverlay("album-reorder");
}

function buildMoveParams() {
    const others = currentOrderWithoutActive();
    const params = {
        owner_id: Number(activeAlbum?.owner_id) || getOwnerId(),
        album_id: Number(activeAlbum.id)
    };

    if (selectedSlot <= 0) {
        params.before = Number(others[0].id);
    } else if (selectedSlot >= others.length) {
        params.after = Number(others[others.length - 1].id);
    } else {
        params.before = Number(others[selectedSlot].id);
    }

    return params;
}

function orderAfterMove() {
    const others = currentOrderWithoutActive();
    const target = Math.max(0, Math.min(Number(selectedSlot), others.length));
    const next = [...others];
    next.splice(target, 0, activeAlbum);
    return next;
}

function sameOrder(a, b) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => String(item.id) === String(b[index]?.id));
}

async function refreshAlbumsFromVk() {
    const ownerId = getOwnerId();

    cacheRemove(albumsKey(ownerId));
    cacheRemove(albumIndexKey(ownerId));
    state.albumIndex = [];
    state.albumIndexReady = false;

    await loadAlbums({ force: true });
}

async function saveMove() {
    if (!activeAlbum || selectedSlot === null || loading || saving) return;

    const desiredOrder = orderAfterMove();
    if (sameOrder(albums, desiredOrder)) {
        await closeModal();
        return;
    }

    showError("");
    setBusy(true);

    try {
        const response = await vkApi("photos.reorderAlbums", buildMoveParams());

        // Исторически метод возвращает 1 при успехе. Некоторые оболочки VK
        // могут возвращать true, поэтому считаем оба варианта успешными.
        if (response !== 1 && response !== true) {
            throw new Error("VK не подтвердил изменение порядка альбомов.");
        }

        saving = false;
        await closeSwipeOverlay("album-reorder");
        await refreshAlbumsFromVk();
    } catch (error) {
        showError(getErrorMessage(error));
    } finally {
        setBusy(false);
    }
}

export function initAlbumReorder() {
    ensureModal();

    window.addEventListener("album-menu-action", event => {
        if (event?.detail?.action !== "move") return;
        void openModal(event.detail.album);
    });
}
