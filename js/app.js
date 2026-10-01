import { dom } from "./dom.js?v=20260927-captiontop43";
import { vkInit, loadUser, getAccessToken } from "./vk-api.js?v=20260927-captiontop43";
import {
    GroupAccessDeniedError,
    precheckLaunchGroupAccess,
    initGroupContext
} from "./group-context.js?v=20260927-captiontop43";
import { initAlbums, loadAlbums } from "./albums.js?v=20260927-captiontop43";
import { openAlbum } from "./photos.js?v=20260927-captiontop43";
import { initMainMenu } from "./main-menu.js?v=20260927-captiontop43";
import { initAlbumCreate } from "./album-create.js?v=20260927-captiontop43";
import { initAlbumEdit } from "./album-edit.js?v=20260927-captiontop43";
import { initAlbumDelete } from "./album-delete.js?v=20260927-captiontop43";
import { initAlbumReorder } from "./album-reorder.js?v=20260927-captiontop43";
import { initComments } from "./comments.js?v=20260927-captiontop43";
import { initAlbumComments } from "./album-comments.js?v=20260927-captiontop43";
import { initPhotoViewer, openPhotoViewer } from "./photo-viewer.js?v=20260927-captiontop43";
import { initPhotoUpload } from "./photo-upload.js?v=20260927-captiontop43";
import { initPhotoMenu } from "./photo-menu.js?v=20260927-captiontop43";
import { initPhotoTransfer } from "./photo-transfer.js?v=20260927-captiontop43";
import { initPhotoReorder } from "./photo-reorder.js?v=20260927-captiontop43";
import { initNavigation, showAlbumsScreen } from "./navigation.js?v=20260927-captiontop43";
import { escapeHtml, getErrorMessage, logError } from "./helpers.js?v=20260927-captiontop43";
import { cleanupLegacyCache } from "./cache.js?v=20260927-captiontop43";
import { initGlobalPhotoSearch } from "./global-photo-search.js?v=20260927-captiontop43";
import { initPhotoIndexSync } from "./photo-index-sync.js?v=20260927-captiontop43";

function setAppInteractive(enabled) {
    const app = document.getElementById("app");
    if (app) {
        app.inert = !enabled;
    }
}

function hideWorkingControls() {
    dom.menuContainer?.classList.add("hidden");
    dom.backButton?.classList.add("hidden");
    dom.albumSortControls?.classList.add("hidden");
    dom.refreshAlbums?.classList.add("hidden");

    const searchContainer = dom.albumSearch?.closest(".search-container");
    searchContainer?.classList.add("hidden");

    dom.photosScreen?.classList.add("hidden");
    dom.commentsScreen?.classList.add("hidden");
    dom.photoViewerScreen?.classList.add("hidden");
    dom.albumsScreen?.classList.remove("hidden");
}

function showAccessBlocked(error) {
    setAppInteractive(false);
    hideWorkingControls();

    if (dom.pageTitle) {
        dom.pageTitle.textContent =
            error?.code === "GROUP_ACCESS_CHECK_FAILED"
                ? "Проверка доступа"
                : "Доступ закрыт";
    }

    if (dom.user) {
        dom.user.textContent = "";
    }

    const message = escapeHtml(getErrorMessage(error));

    dom.albums.innerHTML = `
        <div class="error">
            <b>${error?.code === "GROUP_ACCESS_CHECK_FAILED"
                ? "Не удалось подтвердить права"
                : "Недостаточно прав"}</b>
            <br><br>
            ${message}
        </div>
    `;
}

function initWorkingUi() {
    initMainMenu();
    initNavigation({
        onOpenAlbumFromHistory: openAlbum,
        onOpenPhotoFromHistory: openPhotoViewer
    });
    initAlbums();
    initAlbumCreate();
    initAlbumEdit();
    initAlbumDelete();
    initAlbumReorder();
    initComments();
    initAlbumComments();
    initPhotoViewer();
    initPhotoUpload();
    initPhotoTransfer();
    initPhotoReorder();
    initPhotoMenu();
    initPhotoIndexSync();
    initGlobalPhotoSearch();
}

async function startApp() {
    console.log("Starting VK Photo Manager in COMMUNITY MANAGEMENT mode...");

    // Пока права не подтверждены, интерфейс полностью неактивен.
    setAppInteractive(false);

    // Удаляем старые частичные индексы и устаревшие данные прошлых сборок.
    cleanupLegacyCache();

    try {
        await vkInit();

        // Проверяем доступ по штатной launch-role текущего сообщества.
        // admin / editor / moder разрешены; member / none блокируются.
        // Никаких запросов списка групп или community-token для этого нет.
        precheckLaunchGroupAccess();

        await loadUser();

        // Для рабочей части приложения нужен только доступ к фотографиям.
        await getAccessToken();

        // Формируем контекст текущего сообщества без дополнительных API-запросов.
        initGroupContext();

        // Рабочие обработчики вообще не подключаем до подтверждения доступа.
        initWorkingUi();

        await loadAlbums();
        showAlbumsScreen();
        setAppInteractive(true);

        // Глобальный фотоиндекс обслуживается лениво.
        console.log("VK Photo Manager started with community management access.");
    } catch (error) {
        logError("Application startup error:", error);

        if (error instanceof GroupAccessDeniedError) {
            showAccessBlocked(error);
            return;
        }

        setAppInteractive(false);
        hideWorkingControls();

        if (dom.pageTitle) {
            dom.pageTitle.textContent = "Ошибка запуска";
        }

        dom.albums.innerHTML = `
            <div class="error">
                <b>Ошибка запуска приложения</b>
                <br><br>
                ${escapeHtml(getErrorMessage(error))}
            </div>
        `;
    }
}

startApp();
