import { state } from "./state.js?v=20260927-captiontop43";
import { vkApi } from "./vk-api.js?v=20260927-captiontop43";
import { getAlbumCover, getBestPhotoUrl, getErrorMessage } from "./helpers.js?v=20260927-captiontop43";
import { getOwnerId } from "./group-context.js?v=20260927-captiontop43";
import {
    invalidateAlbumCaches,
    invalidateAlbumPhotosCache,
    invalidateCommentCaches
} from "./cache.js?v=20260927-captiontop43";
import { openVkTarget, openVkPhoto } from "./vk-links.js?v=20260927-captiontop43";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260927-captiontop43";
import { markPhotoIndexAlbumDirty } from "./photo-index-db.js?v=20260927-captiontop43";
import { applyLocalPhotoMove } from "./photo-index-sync.js?v=20260927-captiontop43";

const ALBUM_PAGE_SIZE = 100;
const MAX_ALBUM_PAGES = 200;
const COPY_DOWNLOAD_TIMEOUT_MS = 20000;

let overlay = null;
let grid = null;
let search = null;
let clearSearch = null;
let title = null;
let errorBox = null;
let loadingBox = null;
let activePhoto = null;
let activePhotos = [];
let onTransferComplete = null;
let mode = "move";
let originScreen = "albums";
let busy = false;
let allAlbums = [];
let loadGeneration = 0;
let transferAlbumsLoading = false;
let cancelActiveCopyWait = null;

function create(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function installStyles() {
    if (document.getElementById("photoTransferStyles")) return;

    const style = document.createElement("style");
    style.id = "photoTransferStyles";
    style.textContent = `
        .photo-transfer-overlay {
            padding: 0;
            align-items: stretch;
            justify-content: stretch;
            background: #111315;
        }

        .photo-transfer-screen {
            display: flex;
            flex-direction: column;
            width: 100%;
            height: 100%;
            max-height: none;
            padding: 0;
            border: 0;
            border-radius: 0;
            overflow: hidden;
            background: #111315;
            box-shadow: none;
        }

        .photo-transfer-topbar {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            min-height: 58px;
            padding: 0 8px;
            background: #39779b;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.30);
        }

        .photo-transfer-title {
            flex: 1;
            min-width: 0;
            padding: 0 8px;
            color: #fff;
            font-size: 19px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .photo-transfer-close {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 42px;
            height: 42px;
            padding: 0;
            border: 0;
            border-radius: 50%;
            background: transparent;
            color: #fff;
            font-size: 28px;
            line-height: 1;
            cursor: pointer;
        }

        .photo-transfer-close:active { background: rgba(255, 255, 255, 0.16); }

        .photo-transfer-search-wrap {
            flex: 0 0 auto;
            padding: 10px;
            background: #111315;
        }

        .photo-transfer-search-box {
            display: flex;
            align-items: center;
            width: 100%;
            height: 44px;
            padding: 0 10px;
            border: 1px solid #42464a;
            border-radius: 10px;
            background: #202326;
        }

        .photo-transfer-search-box:focus-within {
            border-color: #518fbb;
            background: #25282b;
        }

        .photo-transfer-search-icon {
            flex: 0 0 auto;
            margin-right: 8px;
            font-size: 17px;
            opacity: 0.7;
        }

        .photo-transfer-search {
            flex: 1;
            min-width: 0;
            height: 100%;
            padding: 0;
            border: 0;
            outline: 0;
            background: transparent;
            color: #fff;
            font-size: 17px;
        }

        .photo-transfer-search::placeholder { color: #96999d; }
        .photo-transfer-search::-webkit-search-cancel-button { display: none; }

        .photo-transfer-clear {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 28px;
            height: 28px;
            margin-left: 7px;
            padding: 0;
            border: 0;
            border-radius: 50%;
            background: #55595d;
            color: #fff;
            font-size: 20px;
            line-height: 1;
            cursor: pointer;
        }

        .photo-transfer-body {
            position: relative;
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            overscroll-behavior: contain;
            -webkit-overflow-scrolling: touch;
        }

        .photo-transfer-grid {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 3px;
            width: 100%;
            padding: 0 3px 3px;
        }

        .photo-transfer-card {
            position: relative;
            width: 100%;
            aspect-ratio: 1.45 / 1;
            overflow: hidden;
            padding: 0;
            border: 0;
            border-radius: 4px;
            background: #303438;
            color: #fff;
            cursor: pointer;
            user-select: none;
            transform: translateZ(0);
        }

        .photo-transfer-card:active { transform: scale(0.985); opacity: 0.9; }
        .photo-transfer-card:disabled { opacity: 0.65; cursor: default; }

        .photo-transfer-cover {
            position: absolute;
            inset: 0;
            display: block;
            width: 100%;
            height: 100%;
            object-fit: cover;
            background: #303438;
        }

        .photo-transfer-placeholder {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(145deg, #8998a3, #424a50);
            color: rgba(255,255,255,0.7);
            font-size: 48px;
        }

        .photo-transfer-card::after {
            content: "";
            position: absolute;
            z-index: 1;
            left: 0;
            right: 0;
            bottom: 0;
            height: 62%;
            background: linear-gradient(to bottom, rgba(0,0,0,0), rgba(0,0,0,0.86));
            pointer-events: none;
        }

        .photo-transfer-info {
            position: absolute;
            z-index: 2;
            left: 8px;
            right: 8px;
            bottom: 7px;
            display: flex;
            align-items: flex-end;
            gap: 8px;
            pointer-events: none;
        }

        .photo-transfer-name {
            flex: 1;
            min-width: 0;
            color: #fff;
            font-size: 14px;
            font-weight: 500;
            line-height: 1.15;
            white-space: normal;
            overflow-wrap: anywhere;
            word-break: break-word;
            text-align: left;
            text-shadow: 0 1px 4px rgba(0,0,0,0.95);
        }

        .photo-transfer-count {
            flex: 0 0 auto;
            color: #fff;
            font-size: 15px;
            text-shadow: 0 1px 4px rgba(0,0,0,0.95);
        }

        .photo-transfer-status {
            grid-column: 1 / -1;
            padding: 30px 12px;
            color: #aeb4b9;
            text-align: center;
            line-height: 1.45;
        }

        .photo-transfer-error {
            margin: 10px;
        }

        .photo-transfer-busy-label {
            position: absolute;
            z-index: 3;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 10px;
            background: rgba(0,0,0,0.68);
            color: #fff;
            font-size: 14px;
            font-weight: 600;
            text-align: center;
        }

        .photo-transfer-copy-wait {
            flex-direction: column;
            gap: 8px;
        }

        .photo-transfer-copy-wait-text {
            line-height: 1.3;
        }

        .photo-transfer-copy-countdown {
            font-size: 13px;
            font-weight: 500;
            color: #d7dade;
        }

        .photo-transfer-copy-cancel {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 34px;
            padding: 0 14px;
            border: 1px solid rgba(255,255,255,0.34);
            border-radius: 8px;
            background: rgba(255,255,255,0.10);
            color: #fff;
            font: inherit;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
            user-select: none;
            -webkit-user-select: none;
        }

        .photo-transfer-copy-cancel:active {
            background: rgba(255,255,255,0.20);
        }

        @media (min-width: 700px) {
            .photo-transfer-grid {
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 5px;
                padding: 0 5px 5px;
            }
        }

        @media (min-width: 1100px) {
            .photo-transfer-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        }

        @media (max-width: 420px) {
            .photo-transfer-title { font-size: 18px; }
            .photo-transfer-name { font-size: 13px; }
            .photo-transfer-count { font-size: 14px; }
        }
    `;
    document.head.appendChild(style);
}

function ensureModal() {
    if (overlay) return;
    installStyles();

    overlay = create("div", "modal-overlay photo-transfer-overlay hidden");
    const screen = create("div", "modal photo-transfer-screen");

    const header = create("div", "photo-transfer-topbar");
    title = create("div", "photo-transfer-title", "Переместить фото");
    const close = create("button", "photo-transfer-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Закрыть");
    close.addEventListener("click", () => void closeModal());
    header.append(title, close);

    const searchWrap = create("div", "photo-transfer-search-wrap");
    const searchBox = create("div", "photo-transfer-search-box");
    const searchIcon = create("span", "photo-transfer-search-icon", "🔎");
    search = create("input", "photo-transfer-search");
    search.type = "search";
    search.placeholder = "Найти альбом...";
    search.autocomplete = "off";
    search.spellcheck = false;
    clearSearch = create("button", "photo-transfer-clear hidden", "×");
    clearSearch.type = "button";
    clearSearch.setAttribute("aria-label", "Очистить поиск");
    searchBox.append(searchIcon, search, clearSearch);
    searchWrap.appendChild(searchBox);

    const body = create("div", "photo-transfer-body");
    grid = create("div", "photo-transfer-grid");
    loadingBox = create("div", "photo-transfer-status", "Загружаем альбомы...");
    grid.appendChild(loadingBox);
    errorBox = create("div", "form-error photo-transfer-error hidden");
    body.append(grid, errorBox);

    screen.append(header, searchWrap, body);
    overlay.appendChild(screen);
    document.body.appendChild(overlay);

    search.addEventListener("input", () => {
        clearSearch.classList.toggle("hidden", !search.value);
        renderAlbums();
    });

    clearSearch.addEventListener("click", () => {
        search.value = "";
        clearSearch.classList.add("hidden");
        renderAlbums();
        search.focus();
    });
}

function showError(message = "") {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.toggle("hidden", !message);
}

function normalize(value) {
    return String(value || "").trim().toLocaleLowerCase("ru");
}

function transferPhotos() {
    return activePhotos.length ? activePhotos : (activePhoto ? [activePhoto] : []);
}

function candidateAlbums() {
    const firstPhoto = transferPhotos()[0];
    const sourceId = String(firstPhoto?.album_id || state.currentAlbum?.id || "");
    const q = normalize(search?.value);

    return allAlbums.filter(album => {
        if (String(album.id) === sourceId) return false;
        if (Number(album.id) <= 0) return false;
        return !q || normalize(album.title).includes(q);
    });
}

function renderAlbumCard(album) {
    const button = create("button", "photo-transfer-card");
    button.type = "button";
    button.setAttribute("aria-label", `${album.title || "Без названия"}, ${Number(album.size || 0)} фото`);

    const cover = getAlbumCover(album);
    if (cover) {
        const image = create("img", "photo-transfer-cover");
        image.src = cover;
        image.alt = album.title || "";
        image.loading = "lazy";
        button.appendChild(image);
    } else {
        button.appendChild(create("div", "photo-transfer-placeholder", "▣"));
    }

    const info = create("div", "photo-transfer-info");
    const name = create("div", "photo-transfer-name", album.title || "Без названия");
    const count = create("div", "photo-transfer-count", String(Number(album.size || 0)));
    info.append(name, count);
    button.appendChild(info);

    button.addEventListener("click", () => void chooseAlbum(album, button));
    return button;
}

function renderAlbums() {
    if (!grid) return;
    grid.innerHTML = "";

    const albums = candidateAlbums();
    if (!albums.length) {
        const message = transferAlbumsLoading
            ? (search?.value ? "Ищем среди всех альбомов..." : "Загружаем альбомы...")
            : (search?.value ? "Альбомы не найдены" : "Нет доступных альбомов");
        grid.appendChild(create("div", "photo-transfer-status", message));
        return;
    }

    albums.forEach(album => grid.appendChild(renderAlbumCard(album)));

    if (transferAlbumsLoading) {
        const status = create(
            "div",
            "photo-transfer-status",
            `Загружаем остальные альбомы… Уже доступно: ${allAlbums.length}`
        );
        grid.appendChild(status);
    }
}

function hideModalDirect() {
    if (!overlay) return;
    loadGeneration += 1;
    cancelActiveCopyWait?.("closed");
    cancelActiveCopyWait = null;
    overlay.classList.add("hidden");
    activePhoto = null;
    activePhotos = [];
    onTransferComplete = null;
    allAlbums = [];
    transferAlbumsLoading = false;
    busy = false;
    if (search) search.value = "";
    if (clearSearch) clearSearch.classList.add("hidden");
    showError("");
}

function closeModal() {
    if (!overlay || busy) return Promise.resolve(false);
    return closeSwipeOverlay("photo-transfer");
}

function mergeAlbums(current, incoming) {
    const map = new Map(current.map(album => [String(album.id), album]));
    incoming.forEach(album => map.set(String(album.id), album));
    return [...map.values()];
}

async function fetchTransferAlbums(generation) {
    const ownerId = getOwnerId();

    // Сразу показываем всё, что уже известно приложению. Полный поисковый
    // индекс может содержать альбомы, которые ещё не попадали в ленивую ленту.
    // Карточки из state.albums при этом дополняют индекс обложками.
    allAlbums = mergeAlbums(
        Array.isArray(state.albumIndex) ? state.albumIndex : [],
        Array.isArray(state.albums) ? state.albums : []
    );

    const reportedTotal = Math.max(0, Number(state.albumsTotal || 0));
    const knownComplete = Boolean(
        state.albumIndexReady ||
        (reportedTotal > 0 && allAlbums.length >= reportedTotal)
    );

    // Поиск альбомов уже строит полный локальный индекс. Если он готов,
    // повторно перебирать photos.getAlbums при каждом копировании/перемещении
    // не нужно: один и тот же список используется прямо из памяти.
    if (knownComplete && allAlbums.length) {
        transferAlbumsLoading = false;
        renderAlbums();
        return allAlbums;
    }

    transferAlbumsLoading = true;
    renderAlbums();

    let offset = 0;
    let pages = 0;
    const fetchedIds = new Set();

    while (pages < MAX_ALBUM_PAGES) {
        const result = await vkApi("photos.getAlbums", {
            owner_id: ownerId,
            need_system: 1,
            need_covers: 1,
            photo_sizes: 1,
            count: ALBUM_PAGE_SIZE,
            offset
        });

        if (generation !== loadGeneration || !transferPhotos().length) return [];

        const items = Array.isArray(result?.items) ? result.items : [];

        // Здесь намеренно НЕ используем result.count как условие завершения.
        // На больших списках он может не отражать пригодное для пагинации
        // общее количество. Надёжный конец — пустая страница или отсутствие
        // новых album_id.
        if (!items.length) break;

        let fetchedNew = 0;
        for (const album of items) {
            const id = String(album?.id ?? "");
            if (!id || fetchedIds.has(id)) continue;
            fetchedIds.add(id);
            fetchedNew += 1;
        }

        allAlbums = mergeAlbums(allAlbums, items);
        renderAlbums();

        offset += items.length;
        pages += 1;

        // Сравниваем только со страницами, полученными в ЭТОМ запросе.
        // Альбом мог уже находиться в state.albumIndex, и это не должно
        // ошибочно останавливать серверную пагинацию на первой странице.
        if (fetchedNew === 0) {
            console.warn("Загрузка списка альбомов остановлена: VK повторил уже полученную страницу", {
                offset,
                pageItems: items.length,
                albums: allAlbums.length
            });
            break;
        }
    }

    if (pages >= MAX_ALBUM_PAGES) {
        console.warn("Загрузка списка альбомов достигла защитного лимита страниц", {
            pages,
            offset,
            albums: allAlbums.length
        });
    }

    transferAlbumsLoading = false;
    renderAlbums();
    return allAlbums;
}

function updateAlbumSizes(sourceAlbumId, targetAlbumId, count = 1) {
    const delta = Math.max(0, Number(count || 0));
    const update = album => {
        const id = Number(album.id);
        if (id === Number(sourceAlbumId)) {
            return { ...album, size: Math.max(0, Number(album.size || 0) - delta) };
        }
        if (id === Number(targetAlbumId)) {
            return { ...album, size: Number(album.size || 0) + delta };
        }
        return album;
    };

    state.albums = state.albums.map(update);
    state.albumIndex = state.albumIndex.map(update);

    if (state.currentAlbum && Number(state.currentAlbum.id) === Number(sourceAlbumId)) {
        state.currentAlbum = update(state.currentAlbum);
    }
}

async function movePhoto(album) {
    const photo = activePhoto;
    const ownerId = Number(photo?.owner_id || getOwnerId());
    const sourceAlbumId = Number(photo?.album_id || state.currentAlbum?.id || 0);
    const sourceAlbum = (
        state.currentAlbum && Number(state.currentAlbum.id) === sourceAlbumId
            ? state.currentAlbum
            : state.albums.find(item => Number(item.id) === sourceAlbumId)
    );
    const startedFromViewer = originScreen === "photo";

    const response = await vkApi("photos.move", {
        owner_id: ownerId,
        target_album_id: Number(album.id),
        photo_id: Number(photo.id)
    });

    if (response !== 1 && response !== true) {
        throw new Error("VK не подтвердил перемещение фотографии.");
    }

    invalidateAlbumPhotosCache(ownerId, sourceAlbumId);
    invalidateAlbumPhotosCache(ownerId, Number(album.id));
    invalidateAlbumCaches(ownerId);
    invalidateCommentCaches(ownerId, { photoId: Number(photo.id) });
    updateAlbumSizes(sourceAlbumId, Number(album.id));
    await applyLocalPhotoMove(photo, Number(album.id));

    state.photos = state.photos.filter(item => Number(item.id) !== Number(photo.id));
    state.photosTotal = Math.max(0, Number(state.photosTotal || 0) - 1);

    const callback = onTransferComplete;
    busy = false;
    await closeSwipeOverlay("photo-transfer");

    // VK уже подтвердил photos.move. Карточка и счётчики обновлены локально
    // выше, поэтому повторное чтение всего исходного альбома здесь не нужно.
    // Если внешний источник изменил альбом параллельно, это поймает обычное
    // открытие альбома или ручная кнопка «Обновить».

    // Из общего просмотра фотографии возвращаемся в исходный альбом.
    // При перемещении через long press уже на экране альбома остаёмся там.
    if (startedFromViewer) {
        history.back();
    }

    callback?.({ moved: 1, failed: 0 });
}

async function moveManyPhotos(album, busyLabel, sourceButton) {
    const photos = transferPhotos();
    if (photos.length < 2) {
        await movePhoto(album);
        return;
    }

    const firstPhoto = photos[0];
    const ownerId = Number(firstPhoto?.owner_id || getOwnerId());
    const sourceAlbumId = Number(firstPhoto?.album_id || state.currentAlbum?.id || 0);
    const targetAlbumId = Number(album.id);
    const sourceAlbum = (
        state.currentAlbum && Number(state.currentAlbum.id) === sourceAlbumId
            ? state.currentAlbum
            : state.albums.find(item => Number(item.id) === sourceAlbumId)
    );

    const moved = [];
    const failed = [];

    for (let i = 0; i < photos.length; i += 1) {
        const photo = photos[i];
        busyLabel.textContent = `Перемещаем ${i + 1} из ${photos.length}...`;

        try {
            const response = await vkApi("photos.move", {
                owner_id: Number(photo?.owner_id || ownerId),
                target_album_id: targetAlbumId,
                photo_id: Number(photo.id)
            });

            if (response !== 1 && response !== true) {
                throw new Error("VK не подтвердил перемещение фотографии.");
            }

            moved.push(photo);
        } catch (error) {
            failed.push({ photo, error });
        }
    }

    if (moved.length) {
        invalidateAlbumPhotosCache(ownerId, sourceAlbumId);
        invalidateAlbumPhotosCache(ownerId, targetAlbumId);
        invalidateAlbumCaches(ownerId);
        moved.forEach(photo => invalidateCommentCaches(ownerId, { photoId: Number(photo.id) }));
        updateAlbumSizes(sourceAlbumId, targetAlbumId, moved.length);
        await applyLocalPhotoMove(moved, targetAlbumId);

        const movedIds = new Set(moved.map(photo => String(photo.id)));
        state.photos = state.photos.filter(photo => !movedIds.has(String(photo.id)));
        state.photosTotal = Math.max(0, Number(state.photosTotal || 0) - moved.length);
    }

    const callback = onTransferComplete;

    if (!failed.length) {
        busy = false;
        await closeSwipeOverlay("photo-transfer");
        callback?.({ moved: moved.length, failed: 0 });
        return;
    }

    // Успешные уже перенесены. Оставляем в окне только неудавшиеся — их можно
    // повторно отправить в тот же или другой альбом без повторного выбора.
    activePhotos = failed.map(item => item.photo);
    activePhoto = activePhotos[0] || null;
    busy = false;
    sourceButton.disabled = false;
    busyLabel.remove();

    const firstError = getErrorMessage(failed[0]?.error);
    title.textContent = `Не перемещено: ${failed.length}`;
    showError(
        `Перемещено: ${moved.length}. Не удалось: ${failed.length}.` +
        (firstError ? `\n${firstError}` : "")
    );

    callback?.({ moved: moved.length, failed: failed.length, partial: true });
}

function makeCopyWaitError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

async function downloadForNativeCopy(photo, { onTick = null } = {}) {
    const url = getBestPhotoUrl(photo);
    if (!url) throw new Error("У фотографии нет ссылки на оригинал.");
    if (!window.vkBridge?.send) {
        throw new Error("Нативное скачивание файла недоступно на этом устройстве.");
    }

    const timeoutMs = COPY_DOWNLOAD_TIMEOUT_MS;
    const startedAt = Date.now();
    let settled = false;
    let intervalId = null;
    let timeoutId = null;
    let rejectManual = null;

    const cleanup = () => {
        if (intervalId !== null) window.clearInterval(intervalId);
        if (timeoutId !== null) window.clearTimeout(timeoutId);
        intervalId = null;
        timeoutId = null;
        if (cancelActiveCopyWait === cancel) cancelActiveCopyWait = null;
    };

    const tick = () => {
        const elapsed = Date.now() - startedAt;
        const remainingMs = Math.max(0, timeoutMs - elapsed);
        const remainingSeconds = Math.ceil(remainingMs / 1000);
        onTick?.(remainingSeconds);
    };

    const cancel = reason => {
        if (settled) return;
        settled = true;
        cleanup();
        const manual = reason === "manual";
        rejectManual?.(makeCopyWaitError(
            manual ? "Копирование отменено пользователем." : "Копирование было прервано.",
            manual ? "COPY_CANCELLED" : "COPY_INTERRUPTED"
        ));
    };

    cancelActiveCopyWait = cancel;
    tick();
    intervalId = window.setInterval(tick, 250);

    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(makeCopyWaitError(
                "VK не ответил на подготовку фотографии за 20 секунд. Попробуйте ещё раз.",
                "COPY_TIMEOUT"
            ));
        }, timeoutMs);
    });

    const manualCancelPromise = new Promise((_, reject) => {
        rejectManual = reject;
    });

    const bridgePromise = Promise.resolve(window.vkBridge.send("VKWebAppDownloadFile", {
        url,
        filename: `vk-photo-${Number(photo.id)}.jpg`
    })).then(result => {
        if (settled) return { ignored: true };
        settled = true;
        cleanup();
        return result;
    }, error => {
        if (settled) return { ignored: true };
        settled = true;
        cleanup();
        throw error;
    });

    const result = await Promise.race([
        bridgePromise,
        timeoutPromise,
        manualCancelPromise
    ]);

    if (result?.ignored) {
        throw makeCopyWaitError("Копирование было прервано.", "COPY_INTERRUPTED");
    }
    if (result?.result === true || result === true) return true;

    throw new Error("VK не подтвердил подготовку фотографии для копирования.");
}

function setCopyWaitBusy(button) {
    const busyLabel = create("div", "photo-transfer-busy-label photo-transfer-copy-wait");
    const text = create("div", "photo-transfer-copy-wait-text", "Подготавливаем копию...");
    const countdown = create("div", "photo-transfer-copy-countdown", "Ожидание ответа VK: до 20 с");
    const cancel = create("div", "photo-transfer-copy-cancel", "Отменить");
    cancel.setAttribute("role", "button");
    cancel.setAttribute("tabindex", "0");

    const cancelAction = event => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        cancelActiveCopyWait?.("manual");
    };

    cancel.addEventListener("click", cancelAction);
    cancel.addEventListener("pointerdown", event => event.stopPropagation());
    cancel.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") cancelAction(event);
    });

    busyLabel.append(text, countdown, cancel);
    busyLabel.addEventListener("click", event => event.stopPropagation());
    button.classList.add("is-busy");
    button.appendChild(busyLabel);

    return {
        element: busyLabel,
        update(seconds) {
            countdown.textContent = seconds > 0
                ? `Ожидание ответа VK: ${seconds} с`
                : "Время ожидания истекло";
        },
        remove() {
            button.classList.remove("is-busy");
            busyLabel.remove();
        }
    };
}

async function copyPhotoNative(album, onTick = null) {
    const photo = activePhoto;
    const ownerId = Number(photo?.owner_id || getOwnerId());

    await downloadForNativeCopy(photo, { onTick });

    invalidateAlbumPhotosCache(ownerId, Number(album.id));
    invalidateAlbumCaches(ownerId);
    markPhotoIndexAlbumDirty(ownerId, Number(album.id), "photo-copy-target");

    busy = false;
    await closeSwipeOverlay("photo-transfer");

    const url = `https://vk.com/album${ownerId}_${Number(album.id)}?act=add`;
    openVkTarget(url, {
        type: "photo-copy-target",
        ownerId,
        albumId: Number(album.id),
        photoId: Number(photo.id)
    });
}

function setCardBusy(button, label) {
    const busyLabel = create("div", "photo-transfer-busy-label", label);
    button.disabled = true;
    button.appendChild(busyLabel);
    return busyLabel;
}

async function chooseAlbum(album, button) {
    if (busy || !activePhoto) return;

    busy = true;
    showError("");
    const busyIndicator = mode === "move"
        ? setCardBusy(button, "Перемещаем...")
        : setCopyWaitBusy(button);
    const busyLabel = busyIndicator?.element || busyIndicator;

    try {
        if (mode === "move") {
            if (transferPhotos().length > 1) {
                await moveManyPhotos(album, busyLabel, button);
            } else {
                await movePhoto(album);
            }
        } else {
            await copyPhotoNative(album, seconds => busyIndicator.update(seconds));
        }
    } catch (error) {
        busy = false;
        cancelActiveCopyWait = null;
        button.disabled = false;
        if (typeof busyIndicator?.remove === "function") busyIndicator.remove();
        else busyLabel?.remove?.();

        if (error?.code === "COPY_CANCELLED") {
            showError("Копирование отменено.");
            return;
        }

        showError(getErrorMessage(error));

        if (mode === "move") {
            const msg = getErrorMessage(error);
            if (/denied|permission|unknown method|недоступ|запрещ/i.test(msg)) {
                const goNative = confirm(`${msg}\n\nОткрыть фотографию в VK и выполнить действие штатно?`);
                if (goNative) openVkPhoto(activePhoto, Number(activePhoto?.owner_id || getOwnerId()));
            }
        }
    }
}

export async function openPhotoTransfer(photo, requestedMode = "move") {
    if (!photo?.id) return;
    ensureModal();

    activePhoto = photo;
    activePhotos = [photo];
    onTransferComplete = null;
    mode = requestedMode === "copy" ? "copy" : "move";
    originScreen = state.currentScreen;
    busy = false;
    allAlbums = [];
    search.value = "";
    clearSearch.classList.add("hidden");
    showError("");

    title.textContent = mode === "move" ? "Переместить фото" : "Копировать фото";
    grid.innerHTML = "";
    loadingBox = create("div", "photo-transfer-status", "Загружаем альбомы...");
    grid.appendChild(loadingBox);

    overlay.classList.remove("hidden");
    openSwipeOverlay("photo-transfer", hideModalDirect);

    const generation = ++loadGeneration;

    try {
        allAlbums = await fetchTransferAlbums(generation);
        if (generation !== loadGeneration || !transferPhotos().length) return;
        renderAlbums();
    } catch (error) {
        if (generation !== loadGeneration) return;
        transferAlbumsLoading = false;
        showError(getErrorMessage(error));
        grid.innerHTML = "";
        grid.appendChild(create("div", "photo-transfer-status", "Не удалось загрузить альбомы."));
    }
}

export async function openPhotoTransferMany(photos, { onComplete = null } = {}) {
    const unique = [];
    const seen = new Set();

    for (const photo of Array.isArray(photos) ? photos : []) {
        const id = String(photo?.id ?? "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        unique.push(photo);
    }

    if (!unique.length) return;

    const sourceAlbumId = String(unique[0]?.album_id || state.currentAlbum?.id || "");
    const sameAlbum = unique.every(photo =>
        String(photo?.album_id || state.currentAlbum?.id || "") === sourceAlbumId
    );
    if (!sameAlbum) {
        throw new Error("Для группового перемещения выберите фотографии из одного альбома.");
    }

    ensureModal();

    activePhotos = unique;
    activePhoto = unique[0];
    onTransferComplete = typeof onComplete === "function" ? onComplete : null;
    mode = "move";
    originScreen = state.currentScreen;
    busy = false;
    allAlbums = [];
    search.value = "";
    clearSearch.classList.add("hidden");
    showError("");

    title.textContent = unique.length === 1 ? "Переместить фото" : `Переместить ${unique.length} фото`;
    grid.innerHTML = "";
    loadingBox = create("div", "photo-transfer-status", "Загружаем альбомы...");
    grid.appendChild(loadingBox);

    overlay.classList.remove("hidden");
    openSwipeOverlay("photo-transfer", hideModalDirect);

    const generation = ++loadGeneration;

    try {
        allAlbums = await fetchTransferAlbums(generation);
        if (generation !== loadGeneration || !transferPhotos().length) return;
        renderAlbums();
    } catch (error) {
        if (generation !== loadGeneration) return;
        transferAlbumsLoading = false;
        showError(getErrorMessage(error));
        grid.innerHTML = "";
        grid.appendChild(create("div", "photo-transfer-status", "Не удалось загрузить альбомы."));
    }
}

export function initPhotoTransfer() {
    ensureModal();

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && overlay && !overlay.classList.contains("hidden")) {
            void closeModal();
        }
    });

    window.addEventListener("vk-native-return", event => {
        const detail = event?.detail;
        if (detail?.type !== "photo-copy-target") return;
        invalidateAlbumPhotosCache(Number(detail.ownerId || getOwnerId()), Number(detail.albumId || 0));
        invalidateAlbumCaches(Number(detail.ownerId || getOwnerId()));
    });
}
