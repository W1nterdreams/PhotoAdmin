import { state } from "./state.js?v=20260927-captiontop43";
import { vkApi } from "./vk-api.js?v=20260927-captiontop43";
import { getPhotoPreviewUrl, getErrorMessage } from "./helpers.js?v=20260927-captiontop43";
import { getOwnerId } from "./group-context.js?v=20260927-captiontop43";
import {
    cacheSet,
    albumPhotosKey,
    invalidateAlbumPhotosCache
} from "./cache.js?v=20260927-captiontop43";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260927-captiontop43";

const PAGE_SIZE = 1000;

let overlay = null;
let grid = null;
let title = null;
let subtitle = null;
let errorBox = null;
let hint = null;
let activePhoto = null;
let activeAlbum = null;
let albumPhotos = [];
let busy = false;
let loadGeneration = 0;
let persistentMode = false;
let persistentDirty = false;

function create(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function formatPhotoDate(timestamp) {
    const seconds = Number(timestamp || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return "";

    const date = new Date(seconds * 1000);
    if (Number.isNaN(date.getTime())) return "";

    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
}

function installStyles() {
    if (document.getElementById("photoReorderStyles")) return;

    const style = document.createElement("style");
    style.id = "photoReorderStyles";
    style.textContent = `
        .photo-reorder-overlay {
            padding: 0;
            align-items: stretch;
            justify-content: stretch;
            background: #111315;
        }

        .photo-reorder-screen {
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

        .photo-reorder-topbar {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            min-height: 58px;
            padding: 0 8px;
            background: #39779b;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.30);
        }

        .photo-reorder-heading {
            flex: 1;
            min-width: 0;
            padding: 6px 8px;
        }

        .photo-reorder-title {
            color: #fff;
            font-size: 18px;
            font-weight: 600;
            line-height: 1.15;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .photo-reorder-subtitle {
            margin-top: 2px;
            color: rgba(255,255,255,0.78);
            font-size: 12px;
            line-height: 1.2;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .photo-reorder-close {
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

        .photo-reorder-close:active {
            background: rgba(255,255,255,0.16);
        }

        .photo-reorder-hint {
            flex: 0 0 auto;
            padding: 10px 12px;
            border-bottom: 1px solid #34383b;
            background: #1b1e20;
            color: #c4c8cb;
            font-size: 13px;
            line-height: 1.35;
        }

        .photo-reorder-body {
            position: relative;
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            overscroll-behavior: contain;
            -webkit-overflow-scrolling: touch;
        }

        .photo-reorder-grid {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 2px;
            width: 100%;
            padding: 2px;
        }

        .photo-reorder-card {
            position: relative;
            width: 100%;
            aspect-ratio: 1 / 1;
            overflow: hidden;
            padding: 0;
            border: 0;
            outline: 0;
            background: #2c3033;
            color: #fff;
            cursor: pointer;
            user-select: none;
            transform: translateZ(0);
        }

        .photo-reorder-card:active:not(:disabled) {
            transform: scale(0.97);
            opacity: 0.88;
        }

        .photo-reorder-card img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .photo-reorder-card-selected {
            box-shadow: inset 0 0 0 4px #62a8d5;
        }

        .photo-reorder-card-selected::after {
            content: "Выбрано";
            position: absolute;
            z-index: 5;
            left: 6px;
            bottom: 6px;
            padding: 3px 6px;
            border-radius: 6px;
            background: rgba(57,119,155,0.94);
            color: #fff;
            font-size: 11px;
            font-weight: 600;
            pointer-events: none;
        }

        .photo-reorder-date {
            position: absolute;
            z-index: 3;
            top: 5px;
            left: 5px;
            padding: 2px 5px;
            border-radius: 5px;
            background: rgba(0,0,0,0.60);
            color: #fff;
            font-size: 10px;
            line-height: 1.2;
            pointer-events: none;
        }

        .photo-reorder-stats {
            position: absolute;
            z-index: 3;
            right: 5px;
            bottom: 5px;
            display: flex;
            gap: 4px;
            pointer-events: none;
        }

        .photo-reorder-stat {
            padding: 2px 4px;
            border-radius: 5px;
            background: rgba(0,0,0,0.60);
            color: #fff;
            font-size: 10px;
            line-height: 1.2;
        }

        .photo-reorder-status {
            grid-column: 1 / -1;
            padding: 32px 12px;
            color: #aeb4b9;
            text-align: center;
            line-height: 1.45;
        }

        .photo-reorder-error {
            margin: 10px;
        }

        .photo-reorder-busy {
            position: fixed;
            z-index: 100003;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            background: rgba(0,0,0,0.52);
            color: #fff;
            font-size: 16px;
            font-weight: 600;
            text-align: center;
            pointer-events: all;
        }

        @media (min-width: 700px) {
            .photo-reorder-grid {
                grid-template-columns: repeat(4, minmax(0, 1fr));
                gap: 4px;
                padding: 4px;
            }
        }

        @media (min-width: 1100px) {
            .photo-reorder-grid {
                grid-template-columns: repeat(5, minmax(0, 1fr));
            }
        }
    `;
    document.head.appendChild(style);
}

function ensureModal() {
    if (overlay) return;
    installStyles();

    overlay = create("div", "modal-overlay photo-reorder-overlay hidden");
    const screen = create("div", "modal photo-reorder-screen");

    const header = create("div", "photo-reorder-topbar");
    const heading = create("div", "photo-reorder-heading");
    title = create("div", "photo-reorder-title", "Переместить внутри альбома");
    subtitle = create("div", "photo-reorder-subtitle", "");
    heading.append(title, subtitle);

    const close = create("button", "photo-reorder-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "Закрыть");
    close.addEventListener("click", () => void closeModal());
    header.append(heading, close);

    hint = create(
        "div",
        "photo-reorder-hint",
        "Нажмите на фотографию, место которой должна занять выбранная фотография."
    );

    const body = create("div", "photo-reorder-body");
    grid = create("div", "photo-reorder-grid");
    errorBox = create("div", "form-error photo-reorder-error hidden");
    body.append(grid, errorBox);

    screen.append(header, hint, body);
    overlay.appendChild(screen);
    document.body.appendChild(overlay);
}

function showError(message = "") {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.classList.toggle("hidden", !message);
}

function hideModalDirect() {
    if (!overlay) return;

    const albumToRefresh = persistentMode && persistentDirty ? activeAlbum : null;

    loadGeneration += 1;
    overlay.classList.add("hidden");
    activePhoto = null;
    activeAlbum = null;
    albumPhotos = [];
    busy = false;
    persistentMode = false;
    persistentDirty = false;
    showError("");

    if (albumToRefresh && state.currentAlbum && Number(state.currentAlbum.id) === Number(albumToRefresh.id)) {
        window.setTimeout(async () => {
            try {
                if (!state.currentAlbum || Number(state.currentAlbum.id) !== Number(albumToRefresh.id)) return;
                const { loadPhotos } = await import("./photos.js?v=20260927-captiontop43");
                await loadPhotos(albumToRefresh, { force: true });
            } catch (error) {
                console.warn("Не удалось обновить альбом после режима порядка:", error);
            }
        }, 0);
    }
}

function closeModal() {
    if (!overlay || busy) return Promise.resolve(false);
    return closeSwipeOverlay("photo-reorder");
}

function mergePhotos(current, incoming) {
    const map = new Map(current.map(photo => [String(photo.id), photo]));
    incoming.forEach(photo => map.set(String(photo.id), photo));
    return [...map.values()];
}

async function fetchAllPhotosFor(ownerId, albumId, generation = null) {
    const numericOwnerId = Number(ownerId || getOwnerId());
    const numericAlbumId = Number(albumId || 0);

    if (!numericAlbumId || numericAlbumId <= 0) {
        throw new Error("Изменение порядка доступно только для обычных фотоальбомов.");
    }

    let offset = 0;
    let resultPhotos = [];
    let pages = 0;
    const maxPages = 100;

    while (pages < maxPages) {
        const result = await vkApi("photos.get", {
            owner_id: numericOwnerId,
            album_id: numericAlbumId,
            extended: 1,
            photo_sizes: 1,
            count: PAGE_SIZE,
            offset
        });

        if (generation !== null && (generation !== loadGeneration || !activeAlbum)) return [];

        const items = Array.isArray(result?.items) ? result.items : [];
        if (!items.length) break;

        const before = resultPhotos.length;
        resultPhotos = mergePhotos(resultPhotos, items);
        const added = resultPhotos.length - before;

        offset += items.length;
        pages += 1;

        // Для photos.get страница в 1000 элементов обычно закрывает весь
        // альбом. Если пришло меньше — следующего запроса не требуется.
        if (items.length < PAGE_SIZE || added === 0) break;
    }

    return resultPhotos;
}

async function fetchAllPhotos(generation) {
    const ownerId = Number(activePhoto?.owner_id || activeAlbum?.owner_id || getOwnerId());
    const albumId = Number(activePhoto?.album_id || activeAlbum?.id || 0);
    return fetchAllPhotosFor(ownerId, albumId, generation);
}

function renderPhotoCard(photo) {
    const button = create("button", "photo-reorder-card");
    button.type = "button";

    const selected = Number(photo.id) === Number(activePhoto?.id);
    button.classList.toggle("photo-reorder-card-selected", selected);
    button.setAttribute(
        "aria-label",
        persistentMode
            ? (selected ? "Снять выбор фотографии" : (activePhoto ? "Переместить выбранную фотографию сюда" : "Выбрать фотографию для перемещения"))
            : (selected ? "Выбранная фотография" : "Переместить выбранную фотографию на это место")
    );

    const url = getPhotoPreviewUrl(photo, 200);
    if (url) {
        const image = create("img");
        image.src = url;
        image.alt = photo.text || "Фотография";
        image.loading = "lazy";
        button.appendChild(image);
    }

    const dateText = formatPhotoDate(photo?.date);
    if (dateText) {
        button.appendChild(create("span", "photo-reorder-date", dateText));
    }

    const stats = create("div", "photo-reorder-stats");
    stats.append(
        create("span", "photo-reorder-stat", `♥ ${Number(photo?.likes?.count || 0)}`),
        create("span", "photo-reorder-stat", `💬 ${Number(photo?.comments?.count || 0)}`)
    );
    button.appendChild(stats);

    if (selected && !persistentMode) {
        button.disabled = true;
    } else {
        button.addEventListener("pointerdown", event => {
            event.stopPropagation();
        });
        button.addEventListener("pointerup", event => {
            event.stopPropagation();
        });
        button.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            state.suppressPhotoOpenUntil = Date.now() + 900;

            if (persistentMode) {
                if (!activePhoto) {
                    activePhoto = photo;
                    subtitle.textContent = `${activeAlbum?.title || "Альбом"} · выбрана фотография`;
                    if (hint) hint.textContent = "Теперь нажмите на фотографию, место которой должна занять выбранная.";
                    renderPhotos();
                    return;
                }

                if (selected) {
                    activePhoto = null;
                    subtitle.textContent = activeAlbum?.title || "Альбом";
                    if (hint) hint.textContent = "Нажмите фотографию для выбора, затем нажмите место, куда её переместить.";
                    renderPhotos();
                    return;
                }
            }

            void chooseTarget(photo);
        });
    }

    return button;
}

function renderPhotos() {
    if (!grid) return;
    grid.innerHTML = "";

    if (!albumPhotos.length) {
        grid.appendChild(create("div", "photo-reorder-status", "В альбоме нет фотографий."));
        return;
    }

    albumPhotos.forEach(photo => grid.appendChild(renderPhotoCard(photo)));
}

function localReorder(items, sourceIndex, targetIndex) {
    const result = [...items];
    const [moved] = result.splice(sourceIndex, 1);
    const safeTarget = Math.max(0, Math.min(Number(targetIndex), result.length));
    result.splice(safeTarget, 0, moved);
    return result;
}

function buildReorderParamsFromCurrent(items, sourceIndex, targetIndex, ownerId, photoId) {
    const params = {
        owner_id: Number(ownerId),
        photo_id: Number(photoId)
    };

    if (!Array.isArray(items) || sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
        return params;
    }

    // ВАЖНО: якорь берём из ТЕКУЩЕГО серверного порядка, а направление
    // определяем по текущему положению самой фотографии.
    //
    // Движение к началу: ставим выбранное фото ПЕРЕД карточкой нужной позиции.
    // Движение к концу: ставим выбранное фото ПОСЛЕ карточки нужной позиции.
    //
    // Такой вариант не зависит от сдвига индексов после удаления исходного
    // элемента и одинаково корректно работает в обе стороны.
    const anchor = items[targetIndex];
    if (!anchor?.id || Number(anchor.id) === Number(photoId)) {
        return params;
    }

    if (targetIndex < sourceIndex) {
        params.before = Number(anchor.id);
    } else {
        params.after = Number(anchor.id);
    }

    return params;
}
function photoIndex(items, photoId) {
    return items.findIndex(item => Number(item.id) === Number(photoId));
}

function sleep(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
}

function saveReorderedState(items, context = {}) {
    const albumId = Number(
        context.albumId ?? activeAlbum?.id ?? activePhoto?.album_id ?? 0
    );
    const ownerId = Number(
        context.ownerId ?? activePhoto?.owner_id ?? activeAlbum?.owner_id ?? getOwnerId()
    );
    const photoId = Number(context.photoId ?? activePhoto?.id ?? 0);

    if (activePhoto && Number(activePhoto?.album_id || activeAlbum?.id || 0) === albumId) {
        albumPhotos = items;
    }

    if (state.currentAlbum && Number(state.currentAlbum.id) === albumId) {
        state.photos = items;
        state.photosTotal = items.length;
        state.photosOffset = items.length;
        state.photosHasMore = false;
        state.photosLoadingMore = false;
        state.photoSortMode = "vk";

        const current = items.find(item => Number(item.id) === photoId);
        if (current && state.currentPhoto && Number(state.currentPhoto.id) === photoId) {
            state.currentPhoto = { ...state.currentPhoto, ...current };
        }

        cacheSet(albumPhotosKey(ownerId, albumId), {
            items,
            total: items.length
        });
    } else {
        invalidateAlbumPhotosCache(ownerId, albumId);
    }
}

function addBusyLayer() {
    const layer = create("div", "photo-reorder-busy", "Перемещаем фотографию...");
    layer.id = "photoReorderBusyLayer";
    overlay.appendChild(layer);
    return layer;
}

async function redrawCurrentAlbum(albumId) {
    if (!state.currentAlbum || Number(state.currentAlbum.id) !== Number(albumId)) return;

    try {
        const { setPhotoDateSort } = await import("./photos.js?v=20260927-captiontop43");
        setPhotoDateSort("vk");
    } catch (error) {
        console.warn("Не удалось перерисовать альбом после перестановки:", error);
    }
}

async function reconcileReorderInBackground({ ownerId, albumId, photoId, targetIndex }) {
    try {
        // Даём VK короткое время применить reorderPhotos, затем один раз
        // перечитываем реальный порядок. Это уже не блокирует интерфейс.
        await sleep(260);
        let serverOrder = await fetchAllPhotosFor(ownerId, albumId);
        let serverIndex = photoIndex(serverOrder, photoId);

        if (serverIndex >= 0 && serverIndex !== targetIndex) {
            // На случай задержки реплики делаем ещё одну короткую проверку до
            // корректирующего запроса, чтобы не переставлять фото по старым данным.
            await sleep(320);
            serverOrder = await fetchAllPhotosFor(ownerId, albumId);
            serverIndex = photoIndex(serverOrder, photoId);
        }

        if (serverIndex >= 0 && serverIndex !== targetIndex) {
            const params = buildReorderParamsFromCurrent(
                serverOrder,
                serverIndex,
                targetIndex,
                ownerId,
                photoId
            );

            if (params.before || params.after) {
                const response = await vkApi("photos.reorderPhotos", params);
                if (response === 1 || response === true) {
                    await sleep(260);
                    serverOrder = await fetchAllPhotosFor(ownerId, albumId);
                    serverIndex = photoIndex(serverOrder, photoId);
                }
            }
        }

        if (serverOrder.length) {
            saveReorderedState(serverOrder, { ownerId, albumId, photoId });
            await redrawCurrentAlbum(albumId);
        }

        if (serverIndex >= 0 && serverIndex !== targetIndex) {
            console.warn("VK сохранил фотографию не на выбранной позиции", {
                photoId,
                targetIndex,
                serverIndex
            });
        }
    } catch (error) {
        // Пользователь уже видит оптимистически обновлённый порядок. Если
        // фоновая сверка не удалась, не блокируем интерфейс — следующий ↻
        // или открытие альбома всё равно перечитает данные с VK.
        console.warn("Фоновая сверка порядка фотографий не удалась:", error);
    }
}

async function chooseTarget(targetPhoto) {
    if (busy || !activePhoto || !targetPhoto) return;

    const sourceIndex = photoIndex(albumPhotos, activePhoto.id);
    const targetIndex = photoIndex(albumPhotos, targetPhoto.id);

    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return;

    busy = true;
    showError("");
    const busyLayer = addBusyLayer();

    const ownerId = Number(activePhoto.owner_id || activeAlbum?.owner_id || getOwnerId());
    const photoId = Number(activePhoto.id);
    const albumId = Number(activeAlbum?.id || activePhoto?.album_id || 0);
    const desiredOrder = localReorder(albumPhotos, sourceIndex, targetIndex);

    try {
        const params = buildReorderParamsFromCurrent(
            albumPhotos,
            sourceIndex,
            targetIndex,
            ownerId,
            photoId
        );

        if (!params.before && !params.after) {
            throw new Error("Не удалось определить позицию для перемещения фотографии.");
        }

        const response = await vkApi("photos.reorderPhotos", params);
        if (response !== 1 && response !== true) {
            throw new Error("VK не подтвердил изменение порядка фотографий.");
        }

        // Сразу применяем ожидаемый порядок локально.
        saveReorderedState(desiredOrder, { ownerId, albumId, photoId });
        albumPhotos = desiredOrder;
        state.suppressPhotoOpenUntil = Date.now() + 1000;
        await redrawCurrentAlbum(albumId);

        busy = false;
        busyLayer.remove();

        if (persistentMode) {
            // В режиме управления порядком остаёмся внутри окна и даём сразу
            // выбрать следующую фотографию. Серверный порядок перечитаем при
            // выходе из режима — это заметно быстрее нескольких полных циклов.
            persistentDirty = true;
            activePhoto = null;
            subtitle.textContent = activeAlbum?.title || "Альбом";
            if (hint) hint.textContent = "Готово. Выберите следующую фотографию, затем её новое место.";
            renderPhotos();
            return;
        }

        await closeSwipeOverlay("photo-reorder");

        void reconcileReorderInBackground({
            ownerId,
            albumId,
            photoId,
            targetIndex
        });
    } catch (error) {
        busy = false;
        busyLayer.remove();
        showError(getErrorMessage(error));
    }
}

export async function openPhotoReorder(photo) {
    if (!photo?.id) return;
    ensureModal();

    persistentMode = false;
    persistentDirty = false;
    activePhoto = photo;
    activeAlbum = state.currentAlbum || state.albums.find(
        album => Number(album.id) === Number(photo.album_id)
    ) || null;
    albumPhotos = [];
    busy = false;
    showError("");

    const albumName = activeAlbum?.title || "Альбом";
    title.textContent = "Переместить внутри альбома";
    subtitle.textContent = albumName;
    if (hint) hint.textContent = "Нажмите на фотографию, место которой должна занять выбранная фотография.";
    grid.innerHTML = "";
    grid.appendChild(create("div", "photo-reorder-status", "Загружаем фотографии..."));

    overlay.classList.remove("hidden");
    openSwipeOverlay("photo-reorder", hideModalDirect);

    const generation = ++loadGeneration;

    try {
        const sameAlbumOpen = Boolean(
            state.currentAlbum &&
            Number(state.currentAlbum.id) === Number(activePhoto.album_id || activeAlbum?.id)
        );
        const stateHasWholeAlbum = Boolean(
            sameAlbumOpen &&
            Array.isArray(state.photos) &&
            state.photos.length > 0 &&
            !state.photosHasMore &&
            state.photos.length >= Number(state.photosTotal || state.photos.length)
        );

        albumPhotos = stateHasWholeAlbum
            ? [...state.photos]
            : await fetchAllPhotos(generation);

        if (generation !== loadGeneration || !activePhoto) return;

        if (!albumPhotos.some(item => Number(item.id) === Number(activePhoto.id))) {
            throw new Error("Выбранная фотография не найдена в этом альбоме.");
        }

        renderPhotos();
    } catch (error) {
        if (generation !== loadGeneration) return;
        grid.innerHTML = "";
        grid.appendChild(create("div", "photo-reorder-status", "Не удалось загрузить фотографии."));
        showError(getErrorMessage(error));
    }
}

export async function openAlbumReorderMode(album) {
    if (!album?.id) return;
    if (Number(album.id) <= 0) {
        alert("Изменение порядка доступно только для обычных фотоальбомов.");
        return;
    }

    ensureModal();
    persistentMode = true;
    persistentDirty = false;
    activePhoto = null;
    activeAlbum = album;
    albumPhotos = [];
    busy = false;
    showError("");

    title.textContent = "Изменить порядок";
    subtitle.textContent = album.title || "Альбом";
    if (hint) hint.textContent = "Нажмите фотографию для выбора, затем нажмите место, куда её переместить.";
    grid.innerHTML = "";
    grid.appendChild(create("div", "photo-reorder-status", "Загружаем текущий порядок фотографий..."));

    overlay.classList.remove("hidden");
    openSwipeOverlay("photo-reorder", hideModalDirect);

    const generation = ++loadGeneration;

    try {
        const sameAlbumOpen = Boolean(
            state.currentAlbum && Number(state.currentAlbum.id) === Number(album.id)
        );
        const stateHasWholeAlbum = Boolean(
            sameAlbumOpen &&
            Array.isArray(state.photos) &&
            state.photos.length > 0 &&
            !state.photosHasMore &&
            state.photos.length >= Number(state.photosTotal || state.photos.length)
        );

        albumPhotos = stateHasWholeAlbum
            ? [...state.photos]
            : await fetchAllPhotosFor(Number(album.owner_id || getOwnerId()), Number(album.id), generation);

        if (generation !== loadGeneration || !activeAlbum || !persistentMode) return;
        renderPhotos();
    } catch (error) {
        if (generation !== loadGeneration) return;
        grid.innerHTML = "";
        grid.appendChild(create("div", "photo-reorder-status", "Не удалось загрузить фотографии."));
        showError(getErrorMessage(error));
    }
}

export function initPhotoReorder() {
    ensureModal();

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && overlay && !overlay.classList.contains("hidden")) {
            void closeModal();
        }
    });
}
