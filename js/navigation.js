import { state } from "./state.js?v=20260927-captiontop43";
import { dom } from "./dom.js?v=20260927-captiontop43";
import { cancelPhotoMultiSelect } from "./photo-multiselect.js?v=20260927-captiontop43";
import { handleOverlayPopState } from "./overlay-history.js?v=20260927-captiontop43";

let openAlbumFromHistory = null;
let openPhotoFromHistory = null;
let navigationInitialized = false;

function hideScreens() {
    dom.albumsScreen.classList.add("hidden");
    dom.photosScreen.classList.add("hidden");
    dom.commentsScreen.classList.add("hidden");
    dom.photoViewerScreen.classList.add("hidden");
}

function setScrollLater(y = 0) {
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            window.scrollTo(0, Number(y) || 0);
        });
    });
}

export function showAlbumsScreen({ restoreScroll = 0 } = {}) {
    cancelPhotoMultiSelect({ silent: true });
    hideScreens();
    dom.albumsScreen.classList.remove("hidden");

    state.currentScreen = "albums";
    state.currentAlbum = null;
    state.currentPhoto = null;

    dom.pageTitle.textContent = "Фотоальбомы";
    dom.pageTitle.classList.remove("hidden");
    dom.albumSortControls?.classList.add("hidden");
    dom.backButton.classList.add("hidden");
    dom.refreshAlbums.classList.remove("hidden");

    setVkSwipeHistory(false);
    setScrollLater(restoreScroll);
}

export function showPhotosScreen({ restoreScroll = 0 } = {}) {
    hideScreens();
    dom.photosScreen.classList.remove("hidden");

    state.currentScreen = "photos";
    state.currentPhoto = null;

    dom.pageTitle.textContent = "";
    dom.pageTitle.classList.add("hidden");
    dom.albumSortControls?.classList.remove("hidden");
    dom.backButton.classList.remove("hidden");
    dom.refreshAlbums.classList.remove("hidden");

    setVkSwipeHistory(true);
    setScrollLater(restoreScroll);
}

export function showCommentsScreen({ restoreScroll = 0 } = {}) {
    cancelPhotoMultiSelect({ silent: true });
    hideScreens();
    dom.commentsScreen.classList.remove("hidden");

    state.currentScreen = "comments";

    dom.pageTitle.textContent = "Комментарии";
    dom.pageTitle.classList.remove("hidden");
    dom.albumSortControls?.classList.add("hidden");
    dom.backButton.classList.remove("hidden");
    dom.refreshAlbums.classList.add("hidden");

    setVkSwipeHistory(true);
    setScrollLater(restoreScroll);
}

export function showPhotoViewerScreen({ restoreScroll = 0 } = {}) {
    cancelPhotoMultiSelect({ silent: true });
    hideScreens();
    dom.photoViewerScreen.classList.remove("hidden");

    state.currentScreen = "photo";

    dom.pageTitle.textContent = "Фотография";
    dom.pageTitle.classList.remove("hidden");
    dom.albumSortControls?.classList.add("hidden");
    dom.backButton.classList.remove("hidden");
    dom.refreshAlbums.classList.add("hidden");

    setVkSwipeHistory(true);
    setScrollLater(restoreScroll);
}

function saveCurrentScrollToHistory() {
    const current = history.state || {};

    if (state.currentScreen === "albums") {
        history.replaceState(
            { ...current, screen: "albums", scrollY: window.scrollY },
            "",
            window.location.href
        );
        return;
    }

    if (state.currentScreen === "photos" && state.currentAlbum) {
        history.replaceState(
            {
                ...current,
                screen: "photos",
                albumId: String(state.currentAlbum.id),
                scrollY: window.scrollY
            },
            "",
            window.location.href
        );
        return;
    }

    if (state.currentScreen === "comments") {
        history.replaceState(
            {
                ...current,
                screen: "comments",
                scrollY: window.scrollY
            },
            "",
            window.location.href
        );
    }
}

export function pushAlbumHistory(album) {
    saveCurrentScrollToHistory();

    history.pushState(
        {
            screen: "photos",
            albumId: String(album.id),
            scrollY: 0
        },
        "",
        `#album-${album.id}`
    );
}

export function pushCommentsHistory() {
    saveCurrentScrollToHistory();

    history.pushState(
        {
            screen: "comments",
            scrollY: 0
        },
        "",
        "#comments"
    );
}

export function pushPhotoHistory(photo, album, { fromComments = false, viewerSource = "" } = {}) {
    const albumId = String(album?.id ?? photo?.album_id ?? "");
    const photoId = String(photo?.id || "");
    if (!albumId || !photoId) return;

    // Всегда сохраняем экран-источник как отдельную запись истории.
    // Поэтому:
    //   Альбом -> Общее фото -> Назад = Альбом
    //   Комментарии -> Общее фото -> Назад = Комментарии
    saveCurrentScrollToHistory();

    history.pushState(
        {
            screen: "photo",
            albumId,
            photoId,
            fromComments: Boolean(fromComments),
            viewerSource: String(viewerSource || ""),
            scrollY: 0
        },
        "",
        `#photo-${photoId}`
    );
}

export function replacePhotoHistory(photo, album, { fromComments = false, viewerSource = "" } = {}) {
    const albumId = String(album?.id ?? photo?.album_id ?? "");
    const photoId = String(photo?.id || "");
    if (!albumId || !photoId) return;

    const current = history.state || {};

    // Перелистывание стрелками не должно добавлять десятки записей в history.
    // Меняем только текущую запись просмотрщика, а предыдущая запись альбома
    // (с её scrollY) остаётся нетронутой. Поэтому «Назад» всегда возвращает
    // пользователя ровно туда, откуда он открыл просмотрщик.
    history.replaceState(
        {
            ...current,
            screen: "photo",
            albumId,
            photoId,
            fromComments: Boolean(current.fromComments || fromComments),
            viewerSource: String(viewerSource || current.viewerSource || ""),
            scrollY: 0
        },
        "",
        `#photo-${photoId}`
    );
}

function findAlbum(albumId) {
    const id = String(albumId || "");
    return state.albums.find(item => String(item.id) === id) ||
        state.albumIndex.find(item => String(item.id) === id) ||
        (state.currentAlbum && String(state.currentAlbum.id) === id ? state.currentAlbum : null);
}

function scheduleGlobalSearchRestore(shouldRestore) {
    if (!shouldRestore) return;
    window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("restore-global-photo-search"));
    }, 0);
}

async function handlePopState(event) {
    // Если поверх экрана открыто наше меню/модальное окно, системный
    // свайп «Назад» сначала закрывает его и не меняет экран Mini App.
    if (handleOverlayPopState()) return;

    // При выходе из фото, открытого из глобального поиска, сначала
    // восстанавливаем обычный экран под оверлеем, а затем снова показываем
    // сам поисковик. Его DOM не уничтожается, поэтому запрос и scrollTop
    // остаются ровно такими, какими были до открытия фотографии.
    const restoreGlobalSearch =
        state.currentScreen === "photo" &&
        state.photoViewerSource === "global-search";
    if (restoreGlobalSearch) state.photoViewerSource = "";

    const navState = event.state;

    if (!navState || navState.screen === "albums") {
        showAlbumsScreen({ restoreScroll: navState?.scrollY || 0 });
        scheduleGlobalSearchRestore(restoreGlobalSearch);
        return;
    }

    if (navState.screen === "photos") {
        const album = findAlbum(navState.albumId);

        if (album && typeof openAlbumFromHistory === "function") {
            await openAlbumFromHistory(album, {
                fromHistory: true,
                restoreScroll: navState.scrollY || 0
            });
            scheduleGlobalSearchRestore(restoreGlobalSearch);
            return;
        }

        showAlbumsScreen();
        scheduleGlobalSearchRestore(restoreGlobalSearch);
        return;
    }

    if (navState.screen === "photo") {
        const album = findAlbum(navState.albumId);
        if (album && typeof openPhotoFromHistory === "function") {
            const photoId = Number(navState.photoId || 0);
            const photo = state.photos.find(item => Number(item.id) === photoId) ||
                (state.currentPhoto && Number(state.currentPhoto.id) === photoId
                    ? state.currentPhoto
                    : { id: photoId, album_id: Number(album.id) });

            await openPhotoFromHistory(photo, album, {
                fromHistory: true,
                viewerSource: String(navState.viewerSource || "")
            });
            scheduleGlobalSearchRestore(restoreGlobalSearch);
            return;
        }

        showAlbumsScreen();
        scheduleGlobalSearchRestore(restoreGlobalSearch);
        return;
    }

    if (navState.screen === "comments") {
        showCommentsScreen({ restoreScroll: navState.scrollY || 0 });
        scheduleGlobalSearchRestore(restoreGlobalSearch);
        return;
    }

    showAlbumsScreen();
    scheduleGlobalSearchRestore(restoreGlobalSearch);
}

export function initNavigation({
    onOpenAlbumFromHistory,
    onOpenPhotoFromHistory
} = {}) {
    if (navigationInitialized) return;
    navigationInitialized = true;

    openAlbumFromHistory = onOpenAlbumFromHistory || null;
    openPhotoFromHistory = onOpenPhotoFromHistory || null;

    history.replaceState(
        {
            screen: "albums",
            scrollY: window.scrollY || 0
        },
        "",
        window.location.href
    );

    window.addEventListener("popstate", event => {
        void handlePopState(event);
    });

    dom.backButton.addEventListener("click", () => {
        if (state.currentScreen === "albums") return;
        history.back();
    });
}

function setVkSwipeHistory(enabled) {
    try {
        if (!window.vkBridge?.send) return;

        Promise.resolve(
            window.vkBridge.send("VKWebAppSetSwipeSettings", {
                history: Boolean(enabled)
            })
        ).catch(error => {
            console.debug("VK swipe settings are unavailable:", error);
        });
    } catch (error) {
        console.debug("VK swipe settings are unavailable:", error);
    }
}
