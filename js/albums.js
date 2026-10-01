import { state } from "./state.js?v=20260927-captiontop43";
import { dom } from "./dom.js?v=20260927-captiontop43";
import { vkApi } from "./vk-api.js?v=20260927-captiontop43";
import { getAlbumCover, escapeHtml, getErrorMessage } from "./helpers.js?v=20260927-captiontop43";
import { openAlbum, loadPhotos } from "./photos.js?v=20260927-captiontop43";
import { CACHE_TTL } from "./config.js?v=20260927-captiontop43";
import {
    cacheGet,
    cacheGetStale,
    cacheSet,
    invalidateAlbumCaches,
    albumsKey,
    albumIndexKey
} from "./cache.js?v=20260927-captiontop43";
import { getOwnerId } from "./group-context.js?v=20260927-captiontop43";
import { bindAlbumLongPress } from "./album-menu.js?v=20260927-captiontop43";
import { observeAlbumFingerprints, reconcileAlbumFingerprints } from "./album-fingerprint.js?v=20260927-captiontop43";

const PAGE_SIZE = 1000;
const INDEX_PAGE_SIZE = 1000;
const INDEX_CACHE_SCHEMA = 3;

let loadMoreObserver = null;
let indexBuildPromise = null;
let indexBuildGeneration = 0;
let albumScrollTicking = false;

function normalizeTitle(value) {
    return String(value || "").trim().toLocaleLowerCase("ru");
}

function toIndexItem(album) {
    // Индекс используется не только для поиска, но и как готовый список
    // назначения при копировании/перемещении. Сохраняем обложку тоже — это
    // позволяет повторно не запрашивать тот же альбом только ради карточки.
    return {
        ...album,
        id: album.id,
        owner_id: album.owner_id,
        title: album.title || "",
        description: album.description || "",
        size: Number(album.size || 0),
        can_upload: album.can_upload,
        comments_disabled: album.comments_disabled,
        upload_by_admins_only: album.upload_by_admins_only,
        created: album.created,
        updated: album.updated
    };
}

function mergeAlbums(current, incoming) {
    const map = new Map(current.map(album => [String(album.id), album]));
    incoming.forEach(album => map.set(String(album.id), album));
    return [...map.values()];
}

function mergeIndex(current, incoming) {
    const map = new Map(current.map(album => [String(album.id), album]));
    incoming.forEach(album => map.set(String(album.id), toIndexItem(album)));
    return [...map.values()];
}

function decodeIndexCache(value) {
    if (!value) return null;

    if (
        value?.schema === INDEX_CACHE_SCHEMA &&
        value?.complete === true &&
        Array.isArray(value?.items)
    ) {
        return {
            items: value.items,
            total: Math.max(Number(value.total || 0), value.items.length),
            complete: true
        };
    }

    // Старый формат мог содержать всего первые 20 альбомов. Использовать его
    // как полный индекс нельзя. Он годится только как временный источник данных.
    if (Array.isArray(value)) {
        return {
            items: value,
            total: value.length,
            complete: false
        };
    }

    return null;
}

function persistCompleteIndex(items, total = items.length) {
    const ownerId = getOwnerId();
    cacheSet(albumIndexKey(ownerId), {
        schema: INDEX_CACHE_SCHEMA,
        complete: true,
        total: Math.max(Number(total || 0), items.length),
        items
    });
}

async function fetchAlbumPage(offset, count = PAGE_SIZE) {
    const ownerId = getOwnerId();
    const result = await vkApi("photos.getAlbums", {
        owner_id: ownerId,
        need_system: 1,
        need_covers: 1,
        photo_sizes: 1,
        count,
        offset
    });

    // Этот ответ всё равно нужен экрану альбомов. Заодно бесплатно сравниваем
    // size / updated / thumb_id с прошлым запуском и только ставим dirty.
    // Никаких дополнительных запросов из-за отпечатков здесь не выполняется.
    observeAlbumFingerprints(ownerId, result?.items);
    return result;
}

async function fetchFirstPageFromVK() {
    const ownerId = getOwnerId();
    const result = await fetchAlbumPage(0, PAGE_SIZE);
    const items = Array.isArray(result?.items) ? result.items : [];
    const apiTotal = Number(result?.count);

    state.albums = items;
    state.albumsTotal = Math.max(
        Number.isFinite(apiTotal) && apiTotal >= 0 ? apiTotal : 0,
        state.albumIndexReady ? state.albumIndex.length : 0,
        items.length
    );
    state.albumsOffset = items.length;

    // На холодном запуске поисковый индекс продолжит пагинацию от этого же
    // offset. Пока он не увидел следующую страницу, не запускаем параллельно
    // ещё одну такую же загрузку от scroll-sentinel. Это убирает дубликаты.
    state.albumsHasMore = Boolean(
        state.albumIndexReady && state.albums.length < state.albumIndex.length
    );

    cacheSet(albumsKey(ownerId), {
        items: state.albums,
        total: state.albumsTotal
    });

    // Пока полный индекс строится, первые карточки уже доступны поиску.
    if (!state.albumIndexReady) {
        state.albumIndex = mergeIndex(state.albumIndex, state.albums);
    }

    renderAlbums();
    setTimeout(handleAlbumScroll, 0);
    return result;
}

function restoreAlbumsCache(cached) {
    const items = Array.isArray(cached) ? cached : (cached?.items || []);
    const savedTotal = Array.isArray(cached) ? 0 : Number(cached?.total || 0);

    state.albums = items;
    state.albumsTotal = Math.max(
        savedTotal,
        state.albumIndexReady ? state.albumIndex.length : 0,
        items.length
    );
    state.albumsOffset = items.length;

    // Старый кэш мог сохранить некорректный total. Поэтому при наличии
    // хотя бы одного альбома разрешаем проверить следующую страницу.
    // В худшем случае будет один пустой запрос, зато список не "застынет".
    state.albumsHasMore = items.length > 0;
    if (state.albumIndexReady && state.albums.length >= state.albumIndex.length) {
        state.albumsHasMore = false;
    }
}

async function revalidateVisibleAlbums() {
    try {
        await fetchFirstPageFromVK();
    } catch (error) {
        console.warn("Фоновое обновление списка альбомов:", error);
    }
}

export async function loadAlbums({ force = false } = {}) {
    const ownerId = getOwnerId();
    const key = albumsKey(ownerId);

    if (force) {
        invalidateAlbumCaches(ownerId);
        state.albumIndex = [];
        state.albumIndexReady = false;
        state.albumIndexBuilding = false;
        indexBuildGeneration += 1; // логически отменяем старую индексацию
        indexBuildPromise = null;

        dom.albums.innerHTML = '<div class="status-message">Обновляем альбомы сообщества...</div>';
        await fetchFirstPageFromVK();
        void ensureAlbumIndex({
            force: true,
            seedItems: state.albums,
            seedOffset: state.albumsOffset
        });
        return;
    }

    const cached = cacheGet(key, CACHE_TTL.albums);
    if (cached) {
        restoreAlbumsCache(cached);
        renderAlbums();
        // Полный индекс поднимаем из своего кэша или обновляем в фоне.
        void ensureAlbumIndex();
        // Кэш показываем сразу, но текущий список всегда тихо сверяем с VK.
        void revalidateVisibleAlbums();
        return;
    }

    const stale = cacheGetStale(key);
    if (stale) {
        restoreAlbumsCache(stale);
        renderAlbums();
        void ensureAlbumIndex();
        void revalidateVisibleAlbums();
        return;
    }

    // Холодный запуск: сначала получаем большой пакет для самого экрана, затем
    // продолжаем поисковый индекс С ЭТОГО offset, а не повторяем страницу 0.
    dom.albums.innerHTML = '<div class="status-message">Загружаем альбомы сообщества...</div>';
    await fetchFirstPageFromVK();
    void ensureAlbumIndex({
        seedItems: state.albums,
        seedOffset: state.albumsOffset
    });
}

export async function loadMoreAlbums() {
    if (state.albumSearchText.trim()) return;
    if (state.albumsLoadingMore || !state.albumsHasMore) return;

    state.albumsLoadingMore = true;
    renderAlbums();

    try {
        // Если фоновый поисковый индекс уже получил следующие альбомы,
        // обычная лента использует их прямо из памяти и не повторяет тот же
        // photos.getAlbums с тем же offset.
        if (state.albumIndex.length > state.albums.length) {
            const localItems = state.albumIndex.slice(
                state.albums.length,
                state.albums.length + PAGE_SIZE
            );

            state.albums = mergeAlbums(state.albums, localItems);
            state.albumsOffset = state.albums.length;
            state.albumsTotal = Math.max(
                state.albumsTotal || 0,
                state.albumIndex.length,
                state.albums.length
            );
            state.albumsHasMore = state.albumIndexReady
                ? state.albums.length < state.albumIndex.length
                : state.albumIndex.length > state.albums.length;

            const ownerId = getOwnerId();
            cacheSet(albumsKey(ownerId), {
                items: state.albums,
                total: state.albumsTotal
            });
            return;
        }

        // Если индекс уже подтверждён как полный, сервер больше спрашивать не
        // нужно — локальный список действительно закончился.
        if (state.albumIndexReady) {
            state.albumsHasMore = false;
            return;
        }

        const result = await fetchAlbumPage(state.albumsOffset, PAGE_SIZE);
        const items = Array.isArray(result?.items) ? result.items : [];

        const beforeCount = state.albums.length;
        state.albums = mergeAlbums(state.albums, items);
        const addedCount = state.albums.length - beforeCount;

        const apiTotal = Number(result?.count);
        state.albumsTotal = Math.max(
            Number.isFinite(apiTotal) && apiTotal >= 0 ? apiTotal : 0,
            state.albumIndexReady ? state.albumIndex.length : 0,
            state.albumsTotal || 0,
            state.albums.length
        );

        state.albumsOffset += items.length;

        // Не останавливаем ленивую загрузку по result.count или по короткой
        // странице. Надёжный конец — пустая страница. Если сервер повторил
        // уже полученные album_id, тоже останавливаемся, чтобы не зациклиться.
        state.albumsHasMore = items.length > 0 && addedCount > 0;

        if (state.albumIndexReady && state.albums.length >= state.albumIndex.length) {
            state.albumsHasMore = false;
        }

        // В память можно добавить данные сразу. Полный индекс на диске записывает
        // только buildAlbumIndex(), когда точно получены ВСЕ страницы.
        if (!state.albumIndexReady) {
            state.albumIndex = mergeIndex(state.albumIndex, items);
        }

        const ownerId = getOwnerId();
        cacheSet(albumsKey(ownerId), {
            items: state.albums,
            total: state.albumsTotal
        });
    } catch (error) {
        console.warn("Не удалось догрузить альбомы:", error);
    } finally {
        state.albumsLoadingMore = false;
        renderAlbums();
        setTimeout(handleAlbumScroll, 0);
    }
}

async function buildAlbumIndex(generation, { seedItems = [], seedOffset = 0 } = {}) {
    const ownerId = getOwnerId();

    // Первый большой пакет, уже полученный экраном альбомов, можно использовать
    // как начало поискового индекса. Так холодный запуск не запрашивает одну и
    // ту же первую страницу дважды. Конец всё равно подтверждаем штатной
    // пагинацией ниже, поэтому полнота поиска не страдает.

    // Строим индекс НЕ по result.count, а до первой реально пустой страницы.
    // На больших сообществах photos.getAlbums может вернуть count, который
    // нельзя безопасно использовать как условие остановки. Из-за этого старый
    // вариант иногда останавливался после первых ~100 альбомов.
    let index = mergeIndex([], Array.isArray(seedItems) ? seedItems : []);
    let offset = Math.max(0, Number(seedOffset || 0));
    let pages = 0;
    let reportedTotal = index.length;
    let reachedEnd = false;
    const MAX_INDEX_PAGES = 200;

    state.albumIndexBuilding = true;
    state.albumIndexReady = false;

    try {
        while (pages < MAX_INDEX_PAGES) {
            if (generation !== indexBuildGeneration) return state.albumIndex;

            const result = await fetchAlbumPage(offset, INDEX_PAGE_SIZE);
            const items = Array.isArray(result?.items) ? result.items : [];
            const apiTotal = Number(result?.count);

            if (Number.isFinite(apiTotal) && apiTotal >= 0) {
                reportedTotal = Math.max(reportedTotal, apiTotal);
            }

            // Только пустая страница означает, что сервер действительно
            // больше ничего не отдал. Короткая страница сама по себе не конец.
            if (!items.length) {
                reachedEnd = true;
                break;
            }

            const before = index.length;
            index = mergeIndex(index, items);
            const added = index.length - before;

            if (generation !== indexBuildGeneration) return state.albumIndex;
            state.albumIndex = index;

            // Как только индекс увидел альбомы за пределами уже показанных,
            // не ждём завершения всей индексации: разрешаем обычной ленте
            // продолжать ленивую догрузку.
            if (index.length > state.albums.length) {
                state.albumsTotal = Math.max(state.albumsTotal || 0, index.length);
                state.albumsHasMore = true;
            }

            // Результаты поиска появляются уже во время фоновой индексации.
            if (state.albumSearchText.trim()) renderAlbums();

            offset += items.length;
            pages += 1;

            // Защита от сервера, который вдруг игнорирует offset и возвращает
            // одну и ту же страницу: бесконечно такой запрос не повторяем.
            if (added === 0) {
                console.warn("Индексация альбомов остановлена: VK вернул страницу без новых album_id", {
                    offset,
                    pageItems: items.length,
                    index: index.length
                });
                break;
            }
        }

        if (generation !== indexBuildGeneration) return state.albumIndex;

        if (pages >= MAX_INDEX_PAGES) {
            console.warn("Индексация альбомов достигла защитного лимита страниц", {
                pages,
                offset,
                index: index.length
            });
        }

        const finalTotal = Math.max(reportedTotal, index.length);
        state.albumIndex = index;
        state.albumIndexReady = true;
        state.albumsTotal = Math.max(finalTotal, state.albums.length);
        state.albumsHasMore = state.albums.length < state.albumsTotal;
        persistCompleteIndex(index, state.albumsTotal);

        // Удалённый целиком альбом уже не попадёт ни в одну страницу. Поэтому
        // сравнивать отсутствие безопасно только после подтверждённого конца
        // полного списка (пустая страница), а не после ошибки/зацикливания API.
        if (reachedEnd) {
            reconcileAlbumFingerprints(ownerId, index.map(album => album.id));
        }

        renderAlbums();
        setTimeout(handleAlbumScroll, 0);

        console.log("Album index ready:", {
            visible: state.albums.length,
            reportedTotal,
            total: state.albumsTotal,
            index: index.length,
            pages,
            hasMore: state.albumsHasMore
        });

        return index;
    } catch (error) {
        console.warn("Не удалось обновить поисковый индекс альбомов:", error);
        return state.albumIndex;
    } finally {
        if (generation === indexBuildGeneration) {
            state.albumIndexBuilding = false;
            if (state.albumSearchText.trim()) renderAlbums();
        }
    }
}

export async function ensureAlbumIndex({ force = false, seedItems = [], seedOffset = 0 } = {}) {
    const ownerId = getOwnerId();

    if (!force) {
        const fresh = decodeIndexCache(cacheGet(albumIndexKey(ownerId), CACHE_TTL.albumIndex));
        if (fresh?.complete) {
            state.albumIndex = fresh.items;
            state.albumIndexReady = true;
            state.albumsTotal = Math.max(state.albumsTotal || 0, fresh.total, fresh.items.length);
            state.albumsHasMore = state.albums.length < state.albumsTotal;
            if (state.albumSearchText.trim()) renderAlbums();
            return fresh.items;
        }

        // Даже просроченный ПОЛНЫЙ индекс можно мгновенно показать, но он не
        // считается готовым: ниже сразу запускается его пересборка с сервера.
        const stale = decodeIndexCache(cacheGetStale(albumIndexKey(ownerId)));
        if (stale?.complete) {
            state.albumIndex = stale.items;
            state.albumIndexReady = false;
            state.albumsTotal = Math.max(state.albumsTotal || 0, stale.total, stale.items.length);
            if (state.albumSearchText.trim()) renderAlbums();
        }

        if (indexBuildPromise) return indexBuildPromise;
    } else {
        indexBuildGeneration += 1;
        indexBuildPromise = null;
        state.albumIndexReady = false;
    }

    const generation = ++indexBuildGeneration;
    indexBuildPromise = buildAlbumIndex(generation, { seedItems, seedOffset }).finally(() => {
        if (generation === indexBuildGeneration) indexBuildPromise = null;
    });

    return indexBuildPromise;
}

function filtered() {
    const q = normalizeTitle(state.albumSearchText);
    if (!q) return state.albums;

    const source = state.albumIndex.length ? state.albumIndex : state.albums;
    return source.filter(album => normalizeTitle(album.title).includes(q));
}

function createAlbumCard(album) {
    const card = document.createElement("div");
    card.className = "album-card";

    const fullAlbum = state.albums.find(item => String(item.id) === String(album.id));
    const displayAlbum = fullAlbum || album;
    const cover = getAlbumCover(displayAlbum);

    if (cover) {
        const img = document.createElement("img");
        img.className = "album-cover";
        img.src = cover;

        img.alt = displayAlbum.title || "";
        img.loading = "lazy";
        img.decoding = "async";
        card.appendChild(img);
    } else {
        const placeholder = document.createElement("div");
        placeholder.className = "album-placeholder";
        placeholder.textContent = "▣";
        card.appendChild(placeholder);
    }

    const info = document.createElement("div");
    info.className = "album-info";

    const name = document.createElement("div");
    name.className = "album-name";
    name.textContent = displayAlbum.title || "Без названия";

    const count = document.createElement("div");
    count.className = "album-count";
    count.textContent = String(displayAlbum.size || 0);

    info.append(name, count);
    card.appendChild(info);

    bindAlbumLongPress(card, displayAlbum);
    card.addEventListener("click", () => openAlbum(displayAlbum));

    return card;
}

function installLoadMoreSentinel() {
    if (loadMoreObserver) {
        loadMoreObserver.disconnect();
        loadMoreObserver = null;
    }

    if (state.albumSearchText.trim() || !state.albumsHasMore) return;

    const sentinel = document.createElement("div");
    sentinel.className = "albums-load-more-sentinel";
    sentinel.style.height = "2px";
    sentinel.style.width = "100%";
    sentinel.style.gridColumn = "1 / -1";
    sentinel.setAttribute("aria-hidden", "true");
    dom.albums.appendChild(sentinel);

    loadMoreObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
            void loadMoreAlbums();
        }
    }, {
        root: null,
        rootMargin: "700px 0px",
        threshold: 0
    });

    loadMoreObserver.observe(sentinel);
}

export function renderAlbums() {
    dom.albums.innerHTML = "";
    const list = filtered();
    const searching = Boolean(state.albumSearchText.trim());

    if (!list.length) {
        if (searching && state.albumIndexBuilding) {
            dom.albums.innerHTML = '<div class="status-message">Ищем по всем альбомам...</div>';
        } else {
            dom.albums.innerHTML = `<div class="status-message">${
                searching ? "Альбомы не найдены" : "Альбомов нет"
            }</div>`;
        }
        return;
    }

    list.forEach(album => dom.albums.appendChild(createAlbumCard(album)));

    if (state.albumsLoadingMore && !searching) {
        const loading = document.createElement("div");
        loading.className = "status-message";
        loading.textContent = "Загружаем ещё альбомы...";
        dom.albums.appendChild(loading);
    }

    if (searching && state.albumIndexBuilding) {
        const loading = document.createElement("div");
        loading.className = "status-message album-search-indexing";
        loading.textContent = "Поиск продолжается по остальным альбомам...";
        dom.albums.appendChild(loading);
    }

    installLoadMoreSentinel();

    if (!searching && state.albumsHasMore && !state.albumsLoadingMore) {
        requestAnimationFrame(() => {
            if (state.currentScreen === "albums" && isNearPageBottom()) {
                void loadMoreAlbums();
            }
        });
    }
}

function isNearPageBottom(distance = 900) {
    const scrolling = document.scrollingElement || document.documentElement || document.body;
    const viewportHeight = Math.max(
        Number(window.visualViewport?.height || 0),
        Number(window.innerHeight || 0),
        Number(document.documentElement?.clientHeight || 0)
    );
    const scrollTop = Math.max(
        Number(window.scrollY || 0),
        Number(window.pageYOffset || 0),
        Number(scrolling?.scrollTop || 0),
        Number(document.documentElement?.scrollTop || 0),
        Number(document.body?.scrollTop || 0)
    );
    const scrollHeight = Math.max(
        Number(scrolling?.scrollHeight || 0),
        Number(document.documentElement?.scrollHeight || 0),
        Number(document.body?.scrollHeight || 0)
    );

    return viewportHeight + scrollTop >= scrollHeight - distance;
}

function handleAlbumScroll() {
    if (albumScrollTicking) return;
    albumScrollTicking = true;

    requestAnimationFrame(() => {
        albumScrollTicking = false;
        if (
            state.currentScreen === "albums" &&
            !state.albumSearchText.trim() &&
            state.albumsHasMore &&
            !state.albumsLoadingMore &&
            isNearPageBottom()
        ) {
            void loadMoreAlbums();
        }
    });
}

export function initAlbums() {
    // В VK WebView событие прокрутки может приходить не только на window.
    // Фотографии уже использовали такой набор обработчиков; для альбомов
    // делаем то же самое, плюс следим за visualViewport на мобильных.
    window.addEventListener("scroll", handleAlbumScroll, { passive: true });
    document.addEventListener("scroll", handleAlbumScroll, { passive: true, capture: true });
    window.addEventListener("resize", handleAlbumScroll, { passive: true });
    window.visualViewport?.addEventListener("scroll", handleAlbumScroll, { passive: true });
    window.visualViewport?.addEventListener("resize", handleAlbumScroll, { passive: true });

    dom.albumSearch.addEventListener("input", event => {
        state.albumSearchText = event.target.value;
        dom.clearSearch.classList.toggle("hidden", !state.albumSearchText);
        renderAlbums();

        if (state.albumSearchText.trim() && !state.albumIndexReady) {
            void ensureAlbumIndex();
        }
    });

    dom.clearSearch.addEventListener("click", () => {
        dom.albumSearch.value = "";
        state.albumSearchText = "";
        dom.clearSearch.classList.add("hidden");
        renderAlbums();
        dom.albumSearch.focus();
    });

    dom.refreshAlbums.addEventListener("click", async () => {
        dom.refreshAlbums.disabled = true;
        try {
            if (state.currentScreen === "photos" && state.currentAlbum) {
                await loadPhotos(state.currentAlbum, { force: true });
            } else {
                await loadAlbums({ force: true });
            }
        } catch (error) {
            const target = state.currentScreen === "photos" ? dom.photos : dom.albums;
            target.innerHTML =
                `<div class="error">Не удалось обновить данные.<br><br>${escapeHtml(getErrorMessage(error))}</div>`;
        } finally {
            dom.refreshAlbums.disabled = false;
        }
    });
}
