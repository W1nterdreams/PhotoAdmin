import { state } from "./state.js?v=20261001-comments-light47";
import { dom } from "./dom.js?v=20261001-comments-light47";
import { vkApi } from "./vk-api.js?v=20261001-comments-light47";
import { getErrorMessage } from "./helpers.js?v=20261001-comments-light47";
import { loadAlbums } from "./albums.js?v=20261001-comments-light47";
import { closeMenu } from "./main-menu.js?v=20261001-comments-light47";
import { getGroupId, getOwnerId, isGroupMode } from "./group-context.js?v=20261001-comments-light47";
import { invalidateAlbumCaches } from "./cache.js?v=20261001-comments-light47";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20261001-comments-light47";

async function openModal() {
    await closeMenu();
    dom.newAlbumTitle.value = "";
    dom.newAlbumDescription.value = "";
    dom.createAlbumError.textContent = "";
    dom.createAlbumModal.classList.remove("hidden");
    openSwipeOverlay("create-album", hideModalDirect);
    dom.newAlbumTitle.focus();
}

function hideModalDirect() {
    dom.createAlbumModal.classList.add("hidden");
    dom.createAlbumError.textContent = "";
}

function closeModal() {
    return closeSwipeOverlay("create-album");
}

async function createAlbum() {
    const title = dom.newAlbumTitle.value.trim();
    const description = dom.newAlbumDescription.value.trim();

    if (!title) {
        dom.createAlbumError.textContent = "Введите название альбома.";
        return;
    }

    dom.submitCreateAlbum.disabled = true;
    dom.createAlbumError.textContent = "";

    try {
        const params = {
            title,
            description,
            comments_disabled: 0
        };

        // group_id нужен только при создании альбома сообщества.
        // В личном режиме его намеренно не передаём — VK создаёт альбом пользователя.
        if (isGroupMode()) {
            params.group_id = getGroupId();
        }

        await vkApi("photos.createAlbum", params);

        invalidateAlbumCaches(getOwnerId());
        state.albumIndex = [];
        state.albumIndexReady = false;
        await closeModal();
        await loadAlbums({ force: true });
    } catch (error) {
        dom.createAlbumError.textContent = getErrorMessage(error);
    } finally {
        dom.submitCreateAlbum.disabled = false;
    }
}

export function initAlbumCreate() {
    dom.createAlbumMenuButton.addEventListener("click", () => void openModal());
    dom.closeCreateAlbum.addEventListener("click", () => void closeModal());
    dom.cancelCreateAlbum.addEventListener("click", () => void closeModal());
    dom.submitCreateAlbum.addEventListener("click", createAlbum);

    dom.newAlbumTitle.addEventListener("keydown", event => {
        if (event.key === "Enter") createAlbum();
    });
}
