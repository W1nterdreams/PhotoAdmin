import { state } from "./state.js?v=20260927-captiontop43";
import { dom } from "./dom.js?v=20260927-captiontop43";
import { vkApi } from "./vk-api.js?v=20260927-captiontop43";
import { getErrorMessage } from "./helpers.js?v=20260927-captiontop43";
import { loadAlbums } from "./albums.js?v=20260927-captiontop43";
import { closeMenu } from "./main-menu.js?v=20260927-captiontop43";
import { getGroupId, getOwnerId } from "./group-context.js?v=20260927-captiontop43";
import { invalidateAlbumCaches } from "./cache.js?v=20260927-captiontop43";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260927-captiontop43";

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
        await vkApi("photos.createAlbum", {
            title,
            description,
            group_id: getGroupId(),
            comments_disabled: 0
        });

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
