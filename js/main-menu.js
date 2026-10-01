import { dom } from "./dom.js?v=20260927-captiontop43";
import { state } from "./state.js?v=20260927-captiontop43";
import { getOwnerId } from "./group-context.js?v=20260927-captiontop43";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260927-captiontop43";
import { openAlbumReorderMode } from "./photo-reorder.js?v=20260927-captiontop43";

function visible(element) {
    return Boolean(element && !element.classList.contains("hidden"));
}

function currentMenuContext() {
    if (visible(dom.photoViewerScreen)) return "photo";
    if (visible(dom.photosScreen)) return "album";
    return "main";
}

function setMenuItemVisible(element, isVisible) {
    if (!element) return;

    element.classList.toggle("hidden", !isVisible);
    element.hidden = !isVisible;

    if (isVisible) {
        element.removeAttribute("hidden");
        element.style.setProperty("display", "flex", "important");
    } else {
        element.style.setProperty("display", "none", "important");
    }
}

function albumLink(album) {
    if (!album?.id) return "";
    const ownerId = Number(album.owner_id) || getOwnerId();
    return `https://vk.com/album${ownerId}_${album.id}`;
}

async function copyText(text) {
    if (!text) return;

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

function emitAlbumAction(action) {
    const album = state.currentAlbum;
    if (!album) return;

    window.dispatchEvent(new CustomEvent("album-menu-action", {
        detail: { action, album }
    }));
}

export function syncMainMenu() {
    const context = currentMenuContext();
    const onMain = context === "main";
    const inAlbum = context === "album";
    const onPhoto = context === "photo";

    // Главный экран / экран общих комментариев.
    setMenuItemVisible(dom.createAlbumMenuButton, onMain);
    setMenuItemVisible(dom.commentsMenuButton, onMain);
    setMenuItemVisible(dom.globalPhotoSearchMenuButton, onMain);

    // Открытый альбом.
    setMenuItemVisible(dom.uploadPhotoMenuButton, inAlbum);
    setMenuItemVisible(dom.reorderAlbumPhotosMenuButton, inAlbum);
    setMenuItemVisible(dom.copyAlbumLinkMenuButton, inAlbum);
    setMenuItemVisible(dom.editAlbumMenuButton, inAlbum);

    // Открытая фотография.
    setMenuItemVisible(dom.downloadPhotoMenuButton, onPhoto);
    setMenuItemVisible(dom.copyPhotoLinkMenuButton, onPhoto);
    setMenuItemVisible(dom.editPhotoDescriptionMenuButton, onPhoto);
    setMenuItemVisible(dom.copyPhotoMenuButton, onPhoto);
    setMenuItemVisible(dom.movePhotoMenuButton, onPhoto);
    setMenuItemVisible(dom.reorderPhotoMenuButton, onPhoto);
    setMenuItemVisible(dom.makeCoverPhotoMenuButton, onPhoto);
    setMenuItemVisible(dom.deletePhotoMenuButton, onPhoto);
}

function hideMenuDirect() {
    if (!dom.mainMenu) return;
    dom.mainMenu.classList.add("hidden");
    dom.mainMenu.hidden = true;
    dom.mainMenu.style.removeProperty("display");
}

export function openMenu() {
    if (!dom.mainMenu) return;

    syncMainMenu();

    dom.mainMenu.classList.remove("hidden");
    dom.mainMenu.hidden = false;
    dom.mainMenu.removeAttribute("hidden");

    Object.assign(dom.mainMenu.style, {
        display: "block",
        position: "fixed",
        top: "62px",
        left: "8px",
        width: "250px",
        zIndex: "2147483647",
        visibility: "visible",
        opacity: "1",
        transform: "none",
        background: "#24272a",
        color: "#fff"
    });

    openSwipeOverlay("main-menu", hideMenuDirect);
}

export function closeMenu() {
    if (!dom.mainMenu || dom.mainMenu.classList.contains("hidden")) {
        return Promise.resolve(false);
    }
    return closeSwipeOverlay("main-menu");
}

export function initMainMenu() {
    if (dom.mainMenu && dom.mainMenu.parentElement !== document.body) {
        document.body.appendChild(dom.mainMenu);
    }

    dom.menuButton?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();

        const closed =
            dom.mainMenu.classList.contains("hidden") ||
            dom.mainMenu.hidden ||
            getComputedStyle(dom.mainMenu).display === "none";

        if (closed) openMenu();
        else void closeMenu();
    });

    dom.globalPhotoSearchMenuButton?.addEventListener("click", async () => {
        await closeMenu();
        const { openGlobalPhotoSearch } = await import("./global-photo-search.js?v=20260927-captiontop43");
        void openGlobalPhotoSearch();
    });

    dom.reorderAlbumPhotosMenuButton?.addEventListener("click", async () => {
        const album = state.currentAlbum;
        await closeMenu();
        if (!album) return;
        void openAlbumReorderMode(album);
    });

    dom.copyAlbumLinkMenuButton?.addEventListener("click", async () => {
        const album = state.currentAlbum;
        await closeMenu();
        if (!album) return;

        try {
            await copyText(albumLink(album));
        } catch (error) {
            console.warn("Не удалось скопировать ссылку на альбом:", error);
        }
    });

    dom.editAlbumMenuButton?.addEventListener("click", async () => {
        await closeMenu();
        emitAlbumAction("edit");
    });

    dom.mainMenu?.addEventListener("click", event => event.stopPropagation());

    document.addEventListener("click", event => {
        if (dom.menuButton?.contains(event.target) || dom.mainMenu?.contains(event.target)) return;
        void closeMenu();
    });

}
