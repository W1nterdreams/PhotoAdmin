import { state } from "./state.js?v=20260927-captiontop43";
import { vkApi } from "./vk-api.js?v=20260927-captiontop43";
import { getOwnerId } from "./group-context.js?v=20260927-captiontop43";
import { getPhotoPreviewUrl, getErrorMessage } from "./helpers.js?v=20260927-captiontop43";
import { ensureAlbumIndex } from "./albums.js?v=20260927-captiontop43";
import { openPhotoViewer } from "./photo-viewer.js?v=20260927-captiontop43";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260927-captiontop43";
import { getPhotoIndexSnapshot } from "./photo-index-db.js?v=20260927-captiontop43";
import { synchronizePhotoIndex } from "./photo-index-sync.js?v=20260927-captiontop43";

const SEARCH_RESULTS_PAGE_SIZE = 100;
const FALLBACK_PAGE_SIZE = 200;
const FALLBACK_MAX_PAGES = 250;

let overlay = null;
let input = null;
let clearButton = null;
let status = null;
let results = null;
let refreshButton = null;
let query = "";
let allPhotos = [];
let totalPhotos = 0;
let loading = false;
let loadedAll = false;
let generation = 0;
let initialized = false;
let indexOwnerId = 0;
let indexHydrated = false;
let syncMode = "";
let currentMatches = [];
let renderedMatchCount = 0;
let renderedQuery = "";
let resultGridResizeObserver = null;

function create(tag, className = "", text = "") {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
}

function normalize(value = "") {
    return String(value)
        .toLocaleLowerCase("ru-RU")
        .replace(/ё/g, "е")
        .replace(/\s+/g, " ")
        .trim();
}

function installStyles() {
    if (document.getElementById("globalPhotoSearchStyles")) return;

    const style = document.createElement("style");
    style.id = "globalPhotoSearchStyles";
    style.textContent = `
        .global-photo-search-overlay {
            padding: 0;
            align-items: stretch;
            justify-content: stretch;
            background: #111315;
        }

        .global-photo-search-screen {
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

        .global-photo-search-topbar {
            flex: 0 0 auto;
            display: flex;
            align-items: center;
            min-height: 58px;
            padding: 0 7px;
            background: #39779b;
            box-shadow: 0 2px 8px rgba(0,0,0,.30);
        }

        .global-photo-search-title {
            flex: 1;
            min-width: 0;
            padding: 0 8px;
            color: #fff;
            font-size: 18px;
            font-weight: 600;
        }

        .global-photo-search-icon-button {
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
            font-size: 25px;
            cursor: pointer;
        }

        .global-photo-search-icon-button:active {
            background: rgba(255,255,255,.16);
        }

        .global-photo-search-controls {
            flex: 0 0 auto;
            padding: 10px;
            border-bottom: 1px solid #34383b;
            background: #1b1e20;
        }

        .global-photo-search-box {
            display: flex;
            align-items: center;
            gap: 7px;
            min-height: 42px;
            padding: 0 10px;
            border: 1px solid #3c4145;
            border-radius: 10px;
            background: #151719;
        }

        .global-photo-search-box input {
            flex: 1;
            min-width: 0;
            height: 40px;
            padding: 0;
            border: 0;
            outline: 0;
            background: transparent;
            color: #fff;
            font-size: 15px;
        }

        .global-photo-search-clear {
            width: 30px;
            height: 30px;
            padding: 0;
            border: 0;
            border-radius: 50%;
            background: transparent;
            color: #9ea4a9;
            font-size: 22px;
        }

        .global-photo-search-status {
            flex: 0 0 auto;
            min-height: 34px;
            padding: 8px 12px;
            color: #9fa5aa;
            font-size: 12px;
            line-height: 1.35;
            background: #17191b;
            border-bottom: 1px solid #2f3336;
        }

        .global-photo-search-results {
            flex: 1 1 auto;
            min-height: 0;
            overflow-y: auto;
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            grid-auto-rows: var(--global-photo-card-size, 180px);
            align-content: start;
            gap: 2px;
            padding: 2px;
            -webkit-overflow-scrolling: touch;
        }

        .global-photo-search-card {
            position: relative;
            width: 100%;
            height: 100%;
            min-height: 0;
            overflow: hidden;
            padding: 0;
            border: 0;
            background: #2b2f32;
            cursor: pointer;
        }

        .global-photo-search-card img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: cover;
        }

        .global-photo-search-album {
            position: absolute;
            z-index: 2;
            left: 5px;
            right: 5px;
            bottom: 5px;
            padding: 4px 6px;
            border-radius: 6px;
            overflow: hidden;
            background: rgba(0,0,0,.67);
            color: #fff;
            font-size: 10px;
            line-height: 1.25;
            white-space: nowrap;
            text-overflow: ellipsis;
            pointer-events: none;
        }

        .global-photo-search-date {
            position: absolute;
            z-index: 2;
            top: 5px;
            left: 5px;
            padding: 2px 5px;
            border-radius: 5px;
            background: rgba(0,0,0,.62);
            color: #fff;
            font-size: 10px;
            pointer-events: none;
        }

        .global-photo-search-empty {
            grid-column: 1 / -1;
            padding: 40px 16px;
            color: #aeb4b9;
            text-align: center;
            line-height: 1.45;
        }

        @media (min-width: 700px) {
            .global-photo-search-results {
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 4px;
                padding: 4px;
            }
        }
    `;
    document.head.appendChild(style);
}

function formatDate(timestamp) {
    const value = Number(timestamp || 0);
    if (!value) return "";
    const d = new Date(value * 1000);
    if (Number.isNaN(d.getTime())) return "";
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
}

function updateResultCardSize() {
    if (!results || results.clientWidth <= 0) return;

    const styles = window.getComputedStyle(results);
    const columns = String(styles.gridTemplateColumns || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .length || (window.innerWidth >= 700 ? 3 : 2);

    const gap = Number.parseFloat(styles.columnGap || styles.gap || "0") || 0;
    const paddingLeft = Number.parseFloat(styles.paddingLeft || "0") || 0;
    const paddingRight = Number.parseFloat(styles.paddingRight || "0") || 0;
    const innerWidth = Math.max(0, results.clientWidth - paddingLeft - paddingRight);
    const size = Math.max(120, Math.floor((innerWidth - gap * Math.max(0, columns - 1)) / columns));

    results.style.setProperty("--global-photo-card-size", `${size}px`);
}

function albumForPhoto(photo) {
    const albumId = Number(photo?.album_id || 0);
    return state.albumIndex.find(album => Number(album.id) === albumId)
        || state.albums.find(album => Number(album.id) === albumId)
        || null;
}

function albumTitle(photo) {
    const album = albumForPhoto(photo);
    if (album?.title) return album.title;

    const id = Number(photo?.album_id || 0);
    if (id === -6) return "Фотографии профиля";
    if (id === -7) return "Фотографии со стены";
    if (id === -15) return "Сохранённые фотографии";
    return id ? `Альбом ${id}` : "Альбом";
}

function filteredPhotos() {
    const q = normalize(query);
    if (!q) return [];
    const tokens = q.split(" ").filter(Boolean);

    return allPhotos
        .filter(photo => {
            const text = String(photo?.search_text || "") || normalize(photo?.text || "");
            return tokens.every(token => text.includes(token));
        })
        .sort((a, b) => {
            const dateDiff = Number(b?.date || 0) - Number(a?.date || 0);
            if (dateDiff) return dateDiff;
            return Number(b?.id || 0) - Number(a?.id || 0);
        });
}

function updateSearchStatus() {
    if (!status) return;

    const q = normalize(query);
    if (!q) return;

    const shown = Math.min(renderedMatchCount, currentMatches.length);

    if (loading && loadedAll) {
        status.textContent = `Найдено: ${currentMatches.length}. Показано: ${shown} · локальный индекс обновляется в фоне`;
    } else if (loading) {
        status.textContent = `Ищем во всех альбомах… проиндексировано ${allPhotos.length}${totalPhotos ? ` из ${totalPhotos}` : ""}. Найдено: ${currentMatches.length}. Показано: ${shown}`;
    } else if (currentMatches.length > shown) {
        status.textContent = `Найдено ${currentMatches.length}. Показаны последние ${shown}. Прокрутите вниз, чтобы показать ещё.`;
    } else {
        status.textContent = `Найдено: ${currentMatches.length}${currentMatches.length ? ` · показано: ${shown}` : ""}${loadedAll ? "" : " · индекс ещё строится"}`;
    }
}

function createResultCard(photo) {
    const card = create("button", "global-photo-search-card");
    card.type = "button";
    card.title = photo.text || albumTitle(photo);

    const url = getPhotoPreviewUrl(photo, 320);
    if (url) {
        const image = create("img");
        image.src = url;
        image.alt = photo.text || "Фотография";
        image.loading = "lazy";
        image.decoding = "async";
        card.appendChild(image);
    }

    const date = formatDate(photo.date);
    if (date) card.appendChild(create("span", "global-photo-search-date", date));
    card.appendChild(create("span", "global-photo-search-album", albumTitle(photo)));

    card.addEventListener("click", async () => {
        const album = albumForPhoto(photo) || {
            id: Number(photo.album_id),
            owner_id: Number(photo.owner_id || getOwnerId()),
            title: albumTitle(photo),
            size: 0,
            description: ""
        };

        // Фиксируем именно текущую выдачу поиска. Просмотрщик будет листать
        // стрелками только эти результаты, даже если они относятся к разным
        // альбомам. Сам альбом здесь специально не открываем.
        const searchSequence = currentMatches.slice();

        await closeGlobalPhotoSearch();
        try {
            await openPhotoViewer(photo, album, {
                sequence: searchSequence,
                viewerSource: "global-search"
            });
        } catch (error) {
            console.warn("Не удалось открыть найденную фотографию:", error);
        }
    });

    return card;
}

function appendNextSearchPage() {
    if (!results || !normalize(query)) return false;
    if (renderedMatchCount >= currentMatches.length) return false;

    const start = renderedMatchCount;
    const end = Math.min(start + SEARCH_RESULTS_PAGE_SIZE, currentMatches.length);
    const fragment = document.createDocumentFragment();

    for (let i = start; i < end; i += 1) {
        fragment.appendChild(createResultCard(currentMatches[i]));
    }

    results.appendChild(fragment);
    renderedMatchCount = end;
    updateSearchStatus();
    return true;
}

function render() {
    if (!results || !status) return;

    const q = normalize(query);
    clearButton?.classList.toggle("hidden", !q);

    if (!q) {
        results.innerHTML = "";
        currentMatches = [];
        renderedMatchCount = 0;
        renderedQuery = "";
        status.textContent = loadedAll
            ? (loading
                ? `Индекс готов: ${allPhotos.length} фото · проверяем изменения…`
                : `Индекс готов: ${allPhotos.length} фото. Введите текст описания.`)
            : (loading
                ? `Индексируем фотографии… ${allPhotos.length}${totalPhotos ? ` из ${totalPhotos}` : ""}`
                : "Введите текст из описания фотографии.");
        results.appendChild(create("div", "global-photo-search-empty", "Поиск выполняется по описаниям фотографий во всех альбомах."));
        return;
    }

    const matches = filteredPhotos();
    const queryChanged = renderedQuery !== q;
    const matchesChanged = matches.length !== currentMatches.length
        || matches.some((photo, index) => Number(photo?.id || 0) !== Number(currentMatches[index]?.id || 0)
            || Number(photo?.owner_id || 0) !== Number(currentMatches[index]?.owner_id || 0));

    if (queryChanged || matchesChanged) {
        const previousRenderedCount = queryChanged ? 0 : renderedMatchCount;
        const previousScrollTop = results.scrollTop;
        results.innerHTML = "";
        currentMatches = matches;
        renderedQuery = q;
        renderedMatchCount = 0;

        const targetCount = queryChanged
            ? Math.min(SEARCH_RESULTS_PAGE_SIZE, currentMatches.length)
            : Math.min(Math.max(previousRenderedCount, SEARCH_RESULTS_PAGE_SIZE), currentMatches.length);

        while (renderedMatchCount < targetCount) {
            const start = renderedMatchCount;
            const end = Math.min(start + SEARCH_RESULTS_PAGE_SIZE, targetCount);
            const fragment = document.createDocumentFragment();
            for (let i = start; i < end; i += 1) {
                fragment.appendChild(createResultCard(currentMatches[i]));
            }
            results.appendChild(fragment);
            renderedMatchCount = end;
        }

        results.scrollTop = queryChanged ? 0 : previousScrollTop;
    }

    if (!currentMatches.length) {
        results.innerHTML = "";
        results.appendChild(create(
            "div",
            "global-photo-search-empty",
            loading ? "Поиск продолжается…" : "Фотографии с таким описанием не найдены."
        ));
        renderedMatchCount = 0;
    }

    updateSearchStatus();
}

async function hydratePersistentIndex() {
    const ownerId = Number(getOwnerId());
    if (!ownerId) return;
    if (indexHydrated && indexOwnerId === ownerId) return;

    indexOwnerId = ownerId;
    indexHydrated = true;

    try {
        const snapshot = await getPhotoIndexSnapshot(ownerId);
        allPhotos = Array.isArray(snapshot.items) ? snapshot.items : [];
        totalPhotos = Math.max(Number(snapshot.meta?.total || 0), allPhotos.length);
        loadedAll = Boolean(snapshot.meta?.complete);
    } catch (error) {
        // IndexedDB может быть отключён старым WebView. В этом случае поиск
        // всё равно сможет построить временный индекс в RAM через synchronize.
        console.warn("Не удалось прочитать постоянный фотоиндекс:", error);
        allPhotos = [];
        totalPhotos = 0;
        loadedAll = false;
    }

    render();
}

async function loadMemoryFallbackFromVk(ownerId, currentGeneration) {
    let itemsAll = [];
    const seen = new Set();
    let offset = 0;
    let total = 0;
    let pages = 0;

    while (pages < FALLBACK_MAX_PAGES) {
        const response = await vkApi("photos.getAll", {
            owner_id: Number(ownerId),
            extended: 0,
            photo_sizes: 1,
            count: FALLBACK_PAGE_SIZE,
            offset
        });
        if (currentGeneration !== generation) return;

        const items = Array.isArray(response?.items) ? response.items : [];
        const count = Number(response?.count || 0);
        if (Number.isFinite(count) && count >= 0) total = Math.max(total, count);

        for (const photo of items) {
            const key = `${Number(photo?.owner_id || ownerId)}:${Number(photo?.id || 0)}`;
            if (!photo?.id || seen.has(key)) continue;
            seen.add(key);
            itemsAll.push(photo);
        }

        offset += items.length;
        pages += 1;
        allPhotos = itemsAll;
        totalPhotos = Math.max(total, allPhotos.length);
        render();

        if (!items.length || items.length < FALLBACK_PAGE_SIZE || (total > 0 && offset >= total)) {
            loadedAll = true;
            return;
        }
    }

    throw new Error("Временная индексация достигла защитного лимита страниц.");
}

async function loadAllPhotos({ force = false } = {}) {
    if (loading) return;

    await hydratePersistentIndex();

    const hadCompleteIndex = loadedAll;
    loading = true;
    syncMode = force ? "full" : "sync";
    const currentGeneration = ++generation;
    render();

    try {
        // Названия альбомов нужны только для подписей найденных карточек.
        // Фотоиндекс живёт отдельно в IndexedDB и не зависит от готовности
        // краткосрочного localStorage-кэша экранов.
        void ensureAlbumIndex().then(() => render()).catch(() => {});

        const ownerId = Number(getOwnerId());
        const snapshot = await synchronizePhotoIndex(ownerId, {
            forceFull: force,
            onProgress(progress) {
                if (currentGeneration !== generation) return;
                syncMode = progress?.mode || syncMode;
                if (!hadCompleteIndex && progress?.mode === "full" && Array.isArray(progress.photos)) {
                    // Только при САМОМ ПЕРВОМ построении показываем уже полученные
                    // страницы. При плановой полной сверке продолжаем искать по
                    // старому целому индексу до атомарной замены в конце.
                    allPhotos = progress.photos;
                    totalPhotos = Math.max(Number(progress.total || 0), allPhotos.length);
                    loadedAll = false;
                }
                render();
            }
        });

        if (currentGeneration !== generation) return;
        allPhotos = Array.isArray(snapshot?.items) ? snapshot.items : [];
        totalPhotos = Math.max(Number(snapshot?.meta?.total || 0), allPhotos.length);
        loadedAll = Boolean(snapshot?.meta?.complete);
    } catch (error) {
        if (currentGeneration !== generation) return;

        const message = getErrorMessage(error);
        if (/IndexedDB/i.test(message)) {
            try {
                await loadMemoryFallbackFromVk(getOwnerId(), currentGeneration);
                status.textContent = "Постоянный кэш недоступен; используется временный индекс до закрытия приложения.";
            } catch (fallbackError) {
                status.textContent = `Не удалось обновить глобальный индекс: ${getErrorMessage(fallbackError)}`;
                console.warn("Временный глобальный поиск фотографий:", fallbackError);
            }
        } else {
            status.textContent = `Не удалось обновить глобальный индекс: ${message}`;
            console.warn("Глобальный поиск фотографий:", error);
        }
    } finally {
        if (currentGeneration === generation) {
            loading = false;
            syncMode = "";
            render();
        }
    }
}

function ensureUi() {
    if (overlay) return;
    installStyles();

    overlay = create("div", "modal-overlay global-photo-search-overlay hidden");
    const screen = create("div", "modal global-photo-search-screen");

    const topbar = create("div", "global-photo-search-topbar");
    const title = create("div", "global-photo-search-title", "Поиск фотографий");
    refreshButton = create("button", "global-photo-search-icon-button", "↻");
    refreshButton.type = "button";
    refreshButton.title = "Полная синхронизация индекса";
    const close = create("button", "global-photo-search-icon-button", "×");
    close.type = "button";
    close.title = "Закрыть";
    topbar.append(title, refreshButton, close);

    const controls = create("div", "global-photo-search-controls");
    const box = create("div", "global-photo-search-box");
    box.appendChild(create("span", "", "🔎"));
    input = create("input");
    input.type = "search";
    input.placeholder = "Поиск по описанию во всех альбомах…";
    input.autocomplete = "off";
    input.spellcheck = false;
    clearButton = create("button", "global-photo-search-clear hidden", "×");
    clearButton.type = "button";
    clearButton.setAttribute("aria-label", "Очистить поиск");
    box.append(input, clearButton);
    controls.appendChild(box);

    status = create("div", "global-photo-search-status", "Введите текст из описания фотографии.");
    results = create("div", "global-photo-search-results");

    screen.append(topbar, controls, status, results);
    overlay.appendChild(screen);
    document.body.appendChild(overlay);

    if (typeof ResizeObserver === "function") {
        resultGridResizeObserver = new ResizeObserver(() => updateResultCardSize());
        resultGridResizeObserver.observe(results);
    } else {
        window.addEventListener("resize", updateResultCardSize, { passive: true });
    }

    input.addEventListener("input", () => {
        query = input.value;
        render();
        if (normalize(query) && !loadedAll && !loading) void loadAllPhotos();
    });

    clearButton.addEventListener("click", () => {
        input.value = "";
        query = "";
        render();
        input.focus();
    });

    results.addEventListener("scroll", () => {
        if (!normalize(query)) return;
        if (renderedMatchCount >= currentMatches.length) return;

        const remaining = results.scrollHeight - results.scrollTop - results.clientHeight;
        if (remaining <= 500) {
            appendNextSearchPage();
        }
    }, { passive: true });

    refreshButton.addEventListener("click", () => void loadAllPhotos({ force: true }));
    close.addEventListener("click", () => void closeGlobalPhotoSearch());

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && overlay && !overlay.classList.contains("hidden")) {
            void closeGlobalPhotoSearch();
        }
    });
}

function hideDirect() {
    if (!overlay) return;
    overlay.classList.add("hidden");
}

export async function openGlobalPhotoSearch({ restore = false } = {}) {
    ensureUi();
    overlay.classList.remove("hidden");
    openSwipeOverlay("global-photo-search", hideDirect);
    query = input.value || "";
    updateResultCardSize();
    render();
    requestAnimationFrame(updateResultCardSize);

    // Названия альбомов нужны для подписей результатов. Индекс строится
    // параллельно и не задерживает сам поиск по фотографиям.
    void ensureAlbumIndex().then(() => render()).catch(() => {});

    void hydratePersistentIndex().then(() => {
        if (!loading) void loadAllPhotos();
    });
    if (!restore) {
        requestAnimationFrame(() => input.focus());
    }
}

export function closeGlobalPhotoSearch() {
    if (!overlay || overlay.classList.contains("hidden")) return Promise.resolve(false);
    return closeSwipeOverlay("global-photo-search");
}

export function initGlobalPhotoSearch() {
    if (initialized) return;
    initialized = true;
    ensureUi();

    window.addEventListener("restore-global-photo-search", () => {
        void openGlobalPhotoSearch({ restore: true });
    });

    if (typeof window !== "undefined") {
        window.globalPhotoSearchDebug = {
            state: () => ({
                query,
                matches: currentMatches.length,
                rendered: renderedMatchCount,
                pageSize: SEARCH_RESULTS_PAGE_SIZE,
                cardSize: results ? getComputedStyle(results).getPropertyValue("--global-photo-card-size").trim() : "",
                loadedAll,
                loading
            }),
            loadMore: () => appendNextSearchPage()
        };
    }

    window.addEventListener("photo-index-updated", async event => {
        const ownerId = Number(event?.detail?.ownerId || 0);
        if (!ownerId || ownerId !== Number(getOwnerId())) return;
        try {
            const snapshot = await getPhotoIndexSnapshot(ownerId);
            allPhotos = Array.isArray(snapshot.items) ? snapshot.items : [];
            totalPhotos = Math.max(Number(snapshot.meta?.total || 0), allPhotos.length);
            loadedAll = Boolean(snapshot.meta?.complete);
            indexOwnerId = ownerId;
            indexHydrated = true;
            render();
        } catch (error) {
            console.warn("Не удалось перечитать обновлённый фотоиндекс:", error);
        }
    });
}
