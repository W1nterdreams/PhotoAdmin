import { dom } from "./dom.js?v=20261001-owner-red44";
import { vkInit, loadUser, getAccessToken } from "./vk-api.js?v=20261001-owner-red44";
import {
    AppAccessDeniedError,
    precheckLaunchAccess,
    initOwnerContext
} from "./group-context.js?v=20261001-owner-red44";
import { initAlbums, loadAlbums } from "./albums.js?v=20261001-owner-red44";
import { openAlbum } from "./photos.js?v=20261001-owner-red44";
import { initMainMenu } from "./main-menu.js?v=20261001-owner-red44";
import { initAlbumCreate } from "./album-create.js?v=20261001-owner-red44";
import { initAlbumEdit } from "./album-edit.js?v=20261001-owner-red44";
import { initAlbumDelete } from "./album-delete.js?v=20261001-owner-red44";
import { initAlbumReorder } from "./album-reorder.js?v=20261001-owner-red44";
import { initComments } from "./comments.js?v=20261001-owner-red44";
import { initAlbumComments } from "./album-comments.js?v=20261001-owner-red44";
import { initPhotoViewer, openPhotoViewer } from "./photo-viewer.js?v=20261001-owner-red44";
import { initPhotoUpload } from "./photo-upload.js?v=20261001-owner-red44";
import { initPhotoMenu } from "./photo-menu.js?v=20261001-owner-red44";
import { initPhotoTransfer } from "./photo-transfer.js?v=20261001-owner-red44";
import { initPhotoReorder } from "./photo-reorder.js?v=20261001-owner-red44";
import { initNavigation, showAlbumsScreen } from "./navigation.js?v=20261001-owner-red44";
import { escapeHtml, getErrorMessage, logError } from "./helpers.js?v=20261001-owner-red44";
import { cleanupLegacyCache } from "./cache.js?v=20261001-owner-red44";
import { initGlobalPhotoSearch } from "./global-photo-search.js?v=20261001-owner-red44";
import { initPhotoIndexSync } from "./photo-index-sync.js?v=20261001-owner-red44";

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

    const code = String(error?.code || "");
    const accessTitle = code === "GROUP_ACCESS_CHECK_FAILED"
        ? "Проверка доступа"
        : code === "GROUP_NOT_ALLOWED"
            ? "Сообщество не подключено"
            : code === "USER_ACCESS_DISABLED"
                ? "Личный режим отключён"
                : "Доступ закрыт";

    const errorTitle = code === "GROUP_ACCESS_CHECK_FAILED"
        ? "Не удалось подтвердить права"
        : code === "GROUP_NOT_ALLOWED"
            ? "Эта группа не входит в список разрешённых"
            : code === "USER_ACCESS_DISABLED"
                ? "Работа с личными альбомами отключена"
                : "Недостаточно прав";

    if (dom.pageTitle) {
        dom.pageTitle.textContent = accessTitle;
    }

    if (dom.user) {
        dom.user.textContent = "";
    }

    const message = escapeHtml(getErrorMessage(error));

    dom.albums.innerHTML = `
        <div class="error">
            <b>${errorTitle}</b>
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
    console.log("Starting VK Photo Manager...");

    // Пока права не подтверждены, интерфейс полностью неактивен.
    setAppInteractive(false);

    // Удаляем старые частичные индексы и устаревшие данные прошлых сборок.
    cleanupLegacyCache();

    try {
        await vkInit();

        // Определяем режим запуска:
        // - из разрешённой группы -> управление альбомами сообщества;
        // - напрямую -> личные альбомы пользователя, если ALLOW_USERS=true.
        const launchContext = precheckLaunchAccess();

        await loadUser();

        // Для рабочей части приложения нужен только доступ к фотографиям.
        await getAccessToken();

        // Формируем единый owner_id: отрицательный для группы, положительный для пользователя.
        const ownerContext = initOwnerContext(launchContext);

        if (dom.pageTitle) {
            dom.pageTitle.textContent = ownerContext.mode === "user"
                ? "Мои фотоальбомы"
                : "Фотоальбомы сообщества";
        }

        // Рабочие обработчики вообще не подключаем до подтверждения доступа.
        initWorkingUi();

        await loadAlbums();
        showAlbumsScreen();
        setAppInteractive(true);

        // Глобальный фотоиндекс обслуживается лениво.
        console.log(`VK Photo Manager started in ${ownerContext.mode} mode.`);
    } catch (error) {
        logError("Application startup error:", error);

        if (error instanceof AppAccessDeniedError) {
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
