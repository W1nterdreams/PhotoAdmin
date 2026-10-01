import { state } from "./state.js?v=20261001-scrollfix46";
import { dom } from "./dom.js?v=20261001-scrollfix46";
import { vkApi } from "./vk-api.js?v=20261001-scrollfix46";
import { getErrorMessage } from "./helpers.js?v=20261001-scrollfix46";
import { getOwnerId, isGroupMode } from "./group-context.js?v=20261001-scrollfix46";
import { cacheSet, cacheRemove, albumsKey, albumIndexKey } from "./cache.js?v=20261001-scrollfix46";
import { renderAlbums } from "./albums.js?v=20261001-scrollfix46";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20261001-scrollfix46";

let activeAlbum = null;
let opening = false;
let saving = false;

function asFlag(value) {
    return value === true || value === 1 || value === "1";
}

function showError(message = "") {
    dom.editAlbumError.textContent = message;
    dom.editAlbumError.classList.toggle("hidden", !message);
}

function syncGroupOnlyFields() {
    const groupMode = isGroupMode();
    const row = dom.editAlbumAllowUploads?.closest(".form-checkbox-row");
    const hint = row?.nextElementSibling;

    row?.classList.toggle("hidden", !groupMode);
    if (hint?.classList.contains("form-checkbox-hint")) {
        hint.classList.toggle("hidden", !groupMode);
    }
}

function fillForm(album) {
    dom.editAlbumTitle.value = album?.title || "";
    dom.editAlbumDescription.value = album?.description || "";

    // В VK эти параметры обратные по смыслу нашим галочкам.
    dom.editAlbumAllowComments.checked = !asFlag(album?.comments_disabled);
    dom.editAlbumAllowUploads.checked = !asFlag(album?.upload_by_admins_only);
    syncGroupOnlyFields();
}

function readFormSnapshot() {
    return JSON.stringify({
        title: dom.editAlbumTitle.value,
        description: dom.editAlbumDescription.value,
        allowComments: Boolean(dom.editAlbumAllowComments.checked),
        allowUploads: Boolean(dom.editAlbumAllowUploads.checked)
    });
}

async function fetchFreshAlbum(album) {
    const ownerId = Number(album?.owner_id) || getOwnerId();
    const targetId = String(album.id);

    try {
        const result = await vkApi("photos.getAlbums", {
            owner_id: ownerId,
            album_ids: [Number(album.id)],
            need_system: 1,
            need_covers: 1,
            photo_sizes: 1
        });

        // VK может вернуть не только один элемент, поэтому выбираем
        // именно тот альбом, по которому открыли меню.
        const items = Array.isArray(result?.items) ? result.items : [];
        const fresh = items.find(item => String(item.id) === targetId);
        if (!fresh) return album;

        return {
            ...album,
            ...fresh
        };
    } catch (error) {
        console.warn("Не удалось обновить данные альбома перед редактированием:", error);
        return album;
    }
}

async function openModal(album) {
    if (!album || opening) return;

    opening = true;
    activeAlbum = album;
    showError("");
    dom.saveEditAlbum.disabled = true;
    dom.editAlbumModal.classList.remove("hidden");
    openSwipeOverlay("edit-album", hideModalDirect);
    fillForm(album);

    // Фокус ставим сразу, в том же пользовательском действии. Раньше поле
    // получало focus только после photos.getAlbums, поэтому клавиатура могла
    // появляться с заметной задержкой.
    try {
        dom.editAlbumTitle.focus({ preventScroll: true });
    } catch {
        dom.editAlbumTitle.focus();
    }

    const initialForm = readFormSnapshot();

    try {
        const fresh = await fetchFreshAlbum(album);
        activeAlbum = fresh;

        // Не перезаписываем уже введённый пользователем текст, если ответ VK
        // пришёл после того, как редактирование началось.
        if (readFormSnapshot() === initialForm) {
            fillForm(fresh);
        }
    } finally {
        opening = false;
        dom.saveEditAlbum.disabled = false;
    }
}

function hideModalDirect() {
    dom.editAlbumModal.classList.add("hidden");
    activeAlbum = null;
    showError("");
}

function closeModal() {
    if (saving) return Promise.resolve(false);
    return closeSwipeOverlay("edit-album");
}

function replaceAlbumInState(updated) {
    state.albums = state.albums.map(album =>
        String(album.id) === String(updated.id)
            ? { ...album, ...updated }
            : album
    );

    state.albumIndex = state.albumIndex.map(album =>
        String(album.id) === String(updated.id)
            ? { ...album, ...updated }
            : album
    );

    if (state.currentAlbum && String(state.currentAlbum.id) === String(updated.id)) {
        state.currentAlbum = { ...state.currentAlbum, ...updated };

        if (state.currentScreen === "photos") {
            dom.albumTitle.textContent = updated.title || "Альбом";
            dom.albumDescription.textContent = updated.description || "";
        }
    }
}

function persistAlbumState() {
    const ownerId = getOwnerId();

    cacheSet(albumsKey(ownerId), {
        items: state.albums,
        total: state.albumsTotal
    });

    // Если полный индекс уже готов, редактирование одного альбома не делает
    // его неполным: сохраняем обновлённую локальную копию без повторного
    // обхода photos.getAlbums. Если индекс ещё строится, диск не трогаем.
    if (state.albumIndexReady) {
        cacheSet(albumIndexKey(ownerId), {
            schema: 3,
            complete: true,
            total: Math.max(Number(state.albumsTotal || 0), state.albumIndex.length),
            items: state.albumIndex
        });
    } else {
        cacheRemove(albumIndexKey(ownerId));
    }
}

async function saveAlbum(event) {
    event?.preventDefault?.();
    if (!activeAlbum || saving) return;

    const title = dom.editAlbumTitle.value.trim();
    const description = dom.editAlbumDescription.value.trim();
    const allowComments = dom.editAlbumAllowComments.checked;
    const allowUploads = dom.editAlbumAllowUploads.checked;

    if (!title) {
        showError("Введите название альбома.");
        dom.editAlbumTitle.focus();
        return;
    }

    saving = true;
    dom.saveEditAlbum.disabled = true;
    dom.cancelEditAlbum.disabled = true;
    dom.closeEditAlbum.disabled = true;
    showError("");

    const ownerId = Number(activeAlbum.owner_id) || getOwnerId();

    try {
        const params = {
            album_id: Number(activeAlbum.id),
            owner_id: ownerId,
            title,
            description,
            comments_disabled: allowComments ? 0 : 1
        };

        // Настройка upload_by_admins_only относится к альбомам сообщества.
        // Для личного альбома не отправляем групповой параметр.
        if (isGroupMode()) {
            params.upload_by_admins_only = allowUploads ? 0 : 1;
        }

        await vkApi("photos.editAlbum", params);

        const updated = {
            ...activeAlbum,
            title,
            description,
            comments_disabled: allowComments ? 0 : 1,
            ...(isGroupMode()
                ? { upload_by_admins_only: allowUploads ? 0 : 1 }
                : {})
        };

        replaceAlbumInState(updated);
        persistAlbumState();
        renderAlbums();

        // VK уже подтвердил photos.editAlbum, а локальные state.albums и
        // state.albumIndex обновлены выше. Дополнительный полный обход списка
        // альбомов здесь только расходовал API и не повышал достоверность.
        await closeSwipeOverlay("edit-album");
    } catch (error) {
        showError(getErrorMessage(error));
    } finally {
        saving = false;
        dom.saveEditAlbum.disabled = false;
        dom.cancelEditAlbum.disabled = false;
        dom.closeEditAlbum.disabled = false;
    }
}

export function initAlbumEdit() {
    window.addEventListener("album-menu-action", event => {
        if (event?.detail?.action !== "edit") return;
        void openModal(event.detail.album);
    });

    dom.editAlbumForm.addEventListener("submit", saveAlbum);
    dom.closeEditAlbum.addEventListener("click", () => void closeModal());
    dom.cancelEditAlbum.addEventListener("click", () => void closeModal());

    dom.editAlbumModal.addEventListener("click", event => {
        if (event.target === dom.editAlbumModal) void closeModal();
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !dom.editAlbumModal.classList.contains("hidden")) {
            void closeModal();
        }
    });
}
