import { state } from "./state.js?v=20260927-captiontop43";
import { dom } from "./dom.js?v=20260927-captiontop43";
import { vkApi } from "./vk-api.js?v=20260927-captiontop43";
import { getBestPhotoUrl, getErrorMessage } from "./helpers.js?v=20260927-captiontop43";
import { getOwnerId } from "./group-context.js?v=20260927-captiontop43";
import {
    invalidateAlbumPhotosCache,
    invalidateAlbumCaches,
    invalidatePhotoActivityCaches
} from "./cache.js?v=20260927-captiontop43";
import { closeMenu } from "./main-menu.js?v=20260927-captiontop43";
import { openPhotoTransfer } from "./photo-transfer.js?v=20260927-captiontop43";
import { openPhotoReorder } from "./photo-reorder.js?v=20260927-captiontop43";
import { openVkPhoto } from "./vk-links.js?v=20260927-captiontop43";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260927-captiontop43";
import { markPhotoIndexAlbumDirty, clearPhotoIndexAlbumDirty } from "./photo-index-db.js?v=20260927-captiontop43";
import { applyLocalPhotoUpdate, applyLocalPhotoDelete } from "./photo-index-sync.js?v=20260927-captiontop43";

let editOverlay = null;
let editInput = null;
let editError = null;
let editSave = null;
let editing = false;
let editTargetPhoto = null;
function currentPhoto() {
    return state.currentScreen === "photo" ? state.currentPhoto : null;
}

function fileNameForPhoto(photo) {
    return `vk-photo-${Number(photo?.id || Date.now())}.jpg`;
}

function photoLink(photo) {
    const photoId = Number(photo?.id || 0);
    const ownerId = Number(photo?.owner_id || getOwnerId() || 0);
    if (!photoId || !ownerId) return "";
    return `https://vk.com/photo${ownerId}_${photoId}`;
}

async function copyText(value) {
    const text = String(value || "");
    if (!text) return false;

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }

    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    area.style.pointerEvents = "none";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
}

export async function copyPhotoLink(photo) {
    const link = photoLink(photo);
    if (!link) throw new Error("Не удалось сформировать ссылку на фотографию.");
    await copyText(link);
    return link;
}

export async function downloadPhotoFile(photo, { quiet = false } = {}) {
    const url = getBestPhotoUrl(photo);
    if (!url) throw new Error("У фотографии нет ссылки на оригинал.");

    try {
        if (window.vkBridge?.send) {
            const result = await window.vkBridge.send("VKWebAppDownloadFile", {
                url,
                filename: fileNameForPhoto(photo)
            });
            if (result?.result === true || result === true) return true;
        }
    } catch (error) {
        console.warn("VKWebAppDownloadFile недоступен, используем браузер:", error);
    }

    try {
        const link = document.createElement("a");
        link.href = url;
        link.download = fileNameForPhoto(photo);
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        document.body.appendChild(link);
        link.click();
        link.remove();
        return true;
    } catch (error) {
        if (!quiet) throw error;
        return false;
    }
}

function ensureEditModal() {
    if (editOverlay) return;

    editOverlay = document.createElement("div");
    editOverlay.className = "modal-overlay hidden";
    editOverlay.id = "editPhotoDescriptionModal";

    const modal = document.createElement("div");
    modal.className = "modal photo-description-edit-modal-window";

    const header = document.createElement("div");
    header.className = "modal-header";

    const title = document.createElement("div");
    title.className = "modal-title";
    title.textContent = "Описание фотографии";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "modal-close";
    close.textContent = "×";
    close.addEventListener("click", () => void closeEditModal());
    header.append(title, close);

    const label = document.createElement("label");
    label.className = "form-label";
    label.textContent = "Описание";

    editInput = document.createElement("textarea");
    editInput.className = "form-textarea photo-description-edit-textarea";
    // Не задаём maxlength: существующие подписи VK могут быть длиннее
    // прежнего локального ограничения 1000 символов. Если value уже было
    // длиннее maxlength, Android WebView позволял удалять текст, но блокировал
    // новый ввод — курсор двигался, а символы фактически не добавлялись.
    editInput.rows = 12;
    editInput.setAttribute("spellcheck", "true");

    editError = document.createElement("div");
    editError.className = "form-error hidden";

    const actions = document.createElement("div");
    actions.className = "modal-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary-button";
    cancel.textContent = "Отмена";
    cancel.addEventListener("click", () => void closeEditModal());

    editSave = document.createElement("button");
    editSave.type = "button";
    editSave.className = "primary-button";
    editSave.textContent = "Сохранить";
    editSave.addEventListener("click", () => void saveDescription());

    actions.append(cancel, editSave);
    modal.append(header, label, editInput, editError, actions);
    editOverlay.appendChild(modal);
    document.body.appendChild(editOverlay);

    editOverlay.addEventListener("click", event => {
        if (event.target === editOverlay) void closeEditModal();
    });
}

function showEditError(message = "") {
    if (!editError) return;
    editError.textContent = message;
    editError.classList.toggle("hidden", !message);
}

export function openPhotoDescriptionEditor(photo) {
    if (!photo?.id) return;

    editTargetPhoto = photo;
    ensureEditModal();
    showEditError("");
    editInput.value = String(photo.text || "");
    editOverlay.classList.remove("hidden");
    openSwipeOverlay("edit-photo-description", hideEditModalDirect);

    // При открытии существующего длинного описания Android WebView обычно
    // ставит каретку в конец текста и прокручивает textarea вниз. Для рабочего
    // сценария редактирования остатков удобнее всегда начинать с начала.
    requestAnimationFrame(() => {
        try {
            editInput.focus({ preventScroll: true });
        } catch {
            editInput.focus();
        }

        editInput.setSelectionRange(0, 0);
        editInput.scrollTop = 0;
        editInput.scrollLeft = 0;

        // Некоторые WebView повторно прокручивают поле к каретке уже после
        // появления клавиатуры. Повторяем позиционирование на следующем кадре.
        requestAnimationFrame(() => {
            editInput.setSelectionRange(0, 0);
            editInput.scrollTop = 0;
            editInput.scrollLeft = 0;
        });
    });
}

function hideEditModalDirect() {
    if (!editOverlay) return;
    editOverlay.classList.add("hidden");
    showEditError("");
    editTargetPhoto = null;
}

function closeEditModal() {
    if (!editOverlay || editing) return Promise.resolve(false);
    return closeSwipeOverlay("edit-photo-description");
}

function updatePhotoEverywhere(updated) {
    state.photos = state.photos.map(photo =>
        Number(photo.id) === Number(updated.id) ? { ...photo, ...updated } : photo
    );

    if (state.currentPhoto && Number(state.currentPhoto.id) === Number(updated.id)) {
        state.currentPhoto = { ...state.currentPhoto, ...updated };

        const text = String(updated.text || "");
        dom.photoViewerDescription.textContent = text;
        dom.photoViewerDescription.classList.toggle("hidden", !text.trim());
    }

    window.dispatchEvent(new CustomEvent("photo-data-updated", {
        detail: { photo: updated }
    }));
}

async function saveDescription() {
    const photo = editTargetPhoto || currentPhoto();
    if (!photo || editing) return;

    editing = true;
    editSave.disabled = true;
    editSave.textContent = "Сохраняем...";
    showEditError("");

    const caption = editInput.value.trim();
    const ownerId = Number(photo.owner_id || getOwnerId());
    const albumId = Number(photo.album_id || state.currentAlbum?.id || 0);

    try {
        const response = await vkApi("photos.edit", {
            owner_id: ownerId,
            photo_id: Number(photo.id),
            caption
        });

        if (response !== 1 && response !== true) {
            throw new Error("VK не подтвердил изменение описания.");
        }

        const updated = { ...photo, text: caption };
        updatePhotoEverywhere(updated);
        invalidateAlbumPhotosCache(ownerId, albumId);
        await closeSwipeOverlay("edit-photo-description");
    } catch (error) {
        showEditError(getErrorMessage(error));
    } finally {
        editing = false;
        editSave.disabled = false;
        editSave.textContent = "Сохранить";
    }
}

async function onDownload() {
    const photo = currentPhoto();
    if (!photo) return;
    await closeMenu();

    try {
        await downloadPhotoFile(photo);
    } catch (error) {
        alert(`Не удалось скачать фотографию.\n\n${getErrorMessage(error)}`);
    }
}

async function onEdit() {
    const photo = currentPhoto();
    if (!photo) return;
    await closeMenu();
    openPhotoDescriptionEditor(photo);
}

async function onCopy() {
    const photo = currentPhoto();
    if (!photo) return;
    await closeMenu();
    void openPhotoTransfer(photo, "copy");
}

async function onMove() {
    const photo = currentPhoto();
    if (!photo) return;
    await closeMenu();
    void openPhotoTransfer(photo, "move");
}

async function onReorder() {
    const photo = currentPhoto();
    if (!photo) return;
    await closeMenu();
    void openPhotoReorder(photo);
}

function showActionToast(message) {
    let toast = document.getElementById("photoActionToast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "photoActionToast";
        toast.style.cssText = [
            "position:fixed", "left:50%", "bottom:24px", "transform:translateX(-50%)",
            "z-index:2147483647", "max-width:calc(100% - 32px)", "padding:10px 14px",
            "border-radius:10px", "background:rgba(36,39,42,.96)", "color:#fff",
            "font-size:14px", "box-shadow:0 6px 24px rgba(0,0,0,.45)",
            "text-align:center", "pointer-events:none"
        ].join(";");
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.remove("hidden");
    window.clearTimeout(showActionToast.timer);
    showActionToast.timer = window.setTimeout(() => toast.classList.add("hidden"), 1800);
}

export async function makePhotoAlbumCover(photo) {
    if (!photo?.id) return false;

    const ownerId = Number(photo.owner_id || getOwnerId());
    const albumId = Number(photo.album_id || state.currentAlbum?.id || 0);
    if (!albumId || albumId <= 0) {
        throw new Error("Для этого альбома нельзя изменить обложку.");
    }

    const response = await vkApi("photos.makeCover", {
        owner_id: ownerId,
        photo_id: Number(photo.id),
        album_id: albumId
    });

    if (response !== 1 && response !== true) {
        throw new Error("VK не подтвердил изменение обложки альбома.");
    }

    const preview = getBestPhotoUrl(photo);
    const patch = {
        thumb_id: Number(photo.id),
        ...(preview ? { thumb_src: preview } : {}),
        ...(Array.isArray(photo.sizes) ? { sizes: photo.sizes } : {})
    };

    state.albums = state.albums.map(album =>
        Number(album.id) === albumId ? { ...album, ...patch } : album
    );
    state.albumIndex = state.albumIndex.map(album =>
        Number(album.id) === albumId ? { ...album, ...patch } : album
    );
    if (state.currentAlbum && Number(state.currentAlbum.id) === albumId) {
        state.currentAlbum = { ...state.currentAlbum, ...patch };
    }

    invalidateAlbumCaches(ownerId);
    try {
        await window.vkBridge?.send?.("VKWebAppTapticNotification", { type: "success" });
    } catch {}
    showActionToast("Обложка альбома изменена");
    return true;
}

async function onMakeCover() {
    const photo = currentPhoto();
    if (!photo) return;
    await closeMenu();
    try {
        await makePhotoAlbumCover(photo);
    } catch (error) {
        alert(`Не удалось сделать фотографию обложкой.

${getErrorMessage(error)}`);
    }
}



async function refreshAfterNativeDelete(detail) {
    if (detail?.type !== "photo-native-delete") return;

    const ownerId = Number(detail.ownerId || getOwnerId());
    const albumId = Number(detail.albumId || 0);
    const photoId = Number(detail.photoId || 0);

    invalidateAlbumPhotosCache(ownerId, albumId);
    invalidateAlbumCaches(ownerId);

    let photoStillExists = true;
    let freshPhoto = null;
    if (photoId) {
        try {
            const result = await vkApi("photos.getById", {
                photos: `${ownerId}_${photoId}`,
                extended: 1,
                photo_sizes: 1
            });
            photoStillExists = Array.isArray(result) && result.length > 0;
            freshPhoto = photoStillExists ? result[0] : null;

            // Для удаления не нужно перечитывать весь альбом ради глобального
            // индекса: точная проверка photo_id уже говорит, что делать.
            if (photoStillExists && freshPhoto) {
                await applyLocalPhotoUpdate(freshPhoto);
            } else {
                await applyLocalPhotoDelete(ownerId, photoId);
            }
            clearPhotoIndexAlbumDirty(ownerId, albumId);
        } catch (error) {
            // Ошибка чтения не означает, что фотография точно удалена.
            // Dirty-метку НЕ снимаем — позже будет полная сверка альбома.
            console.warn("Не удалось проверить фотографию после возврата из VK:", error);
        }
    }

    const album = (
        state.currentAlbum && Number(state.currentAlbum.id) === albumId
            ? state.currentAlbum
            : state.albums.find(item => Number(item.id) === albumId)
    );

    if (album) {
        try {
            const { loadPhotos } = await import("./photos.js?v=20260927-captiontop43");
            await loadPhotos(album, { force: true });
        } catch (error) {
            console.warn("Не удалось обновить альбом после возврата из VK:", error);
        }
    }

    if (
        detail.returnFromViewer &&
        !photoStillExists &&
        state.currentScreen === "photo" &&
        Number(state.currentPhoto?.id || 0) === photoId
    ) {
        history.back();
    }
}

export async function deletePhoto(photo, { returnFromViewer = false } = {}) {
    if (!photo?.id) return false;

    const ownerId = Number(photo.owner_id || getOwnerId());
    const albumId = Number(photo.album_id || state.currentAlbum?.id || 0);

    // Помечаем альбом устаревшим ДО ухода в нативный VK. Метка хранится
    // синхронно и переживёт даже выгрузку WebView во время удаления.
    markPhotoIndexAlbumDirty(ownerId, albumId, "photo-native-delete");
    invalidatePhotoActivityCaches(ownerId, albumId, Number(photo.id));
    invalidateAlbumCaches(ownerId);

    // Прямой photos.delete у Mini App может быть ограничен токеном/правами.
    // Поэтому открываем оригинальную фотографию в штатном интерфейсе VK,
    // где удаление выполняется средствами самого приложения VK.
    return openVkPhoto(photo, ownerId, {
        type: "photo-native-delete",
        ownerId,
        albumId,
        photoId: Number(photo.id),
        returnFromViewer: Boolean(returnFromViewer)
    });
}

async function onCopyLink() {
    const photo = currentPhoto();
    if (!photo) return;
    await closeMenu();

    try {
        await copyPhotoLink(photo);
    } catch (error) {
        alert(`Не удалось скопировать ссылку.\n\n${getErrorMessage(error)}`);
    }
}

async function onDelete() {
    const photo = currentPhoto();
    if (!photo) return;
    await closeMenu();
    await deletePhoto(photo, { returnFromViewer: true });
}

export function initPhotoMenu() {
    ensureEditModal();
    dom.downloadPhotoMenuButton?.addEventListener("click", () => void onDownload());
    dom.copyPhotoLinkMenuButton?.addEventListener("click", () => void onCopyLink());
    dom.editPhotoDescriptionMenuButton?.addEventListener("click", () => void onEdit());
    dom.copyPhotoMenuButton?.addEventListener("click", () => void onCopy());
    dom.movePhotoMenuButton?.addEventListener("click", () => void onMove());
    dom.reorderPhotoMenuButton?.addEventListener("click", () => void onReorder());
    dom.makeCoverPhotoMenuButton?.addEventListener("click", () => void onMakeCover());
    dom.deletePhotoMenuButton?.addEventListener("click", () => void onDelete());

    window.addEventListener("vk-native-return", event => {
        void refreshAfterNativeDelete(event?.detail);
    });

    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;

        if (editOverlay && !editOverlay.classList.contains("hidden")) {
            void closeEditModal();
        }
    });
}
