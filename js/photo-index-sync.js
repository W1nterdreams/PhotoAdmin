import { vkApi } from "./vk-api.js?v=20260927-captiontop43";
import { getOwnerId } from "./group-context.js?v=20260927-captiontop43";
import {
    compactPhotoForIndex,
    getPhotoIndexMeta,
    getPhotoIndexSnapshot,
    replacePhotoIndex,
    replaceIndexedAlbum,
    upsertIndexedPhotos,
    deleteIndexedPhoto,
    updatePhotoIndexMeta,
    getDirtyPhotoIndexAlbums,
    clearPhotoIndexAlbumDirty,
    clearPhotoIndexDirtyThrough,
    getPhotoIndexDiagnostics
} from "./photo-index-db.js?v=20260927-captiontop43";
import { getPhotoIndexSyncPlan } from "./photo-index-policy.js?v=20260927-captiontop43";
import { getAlbumFingerprintDiagnostics } from "./album-fingerprint.js?v=20260927-captiontop43";

const GLOBAL_PAGE_SIZE = 200;
const ALBUM_PAGE_SIZE = 1000;
const MAX_GLOBAL_PAGES = 250;
const MAX_ALBUM_PAGES = 500;
const MAX_QUICK_PAGES = 25;

let syncPromise = null;
let syncOwnerId = 0;
let initialized = false;
let dirtySyncPromise = null;
let dirtySyncOwnerId = 0;
const albumSyncPromises = new Map();
let mutationSeq = 0;
let mutationJournal = [];

function dispatchIndexEvent(type, detail = {}) {
    window.dispatchEvent(new CustomEvent(type, { detail }));
}

function journalMutation(action) {
    const entry = { seq: ++mutationSeq, ...action };
    mutationJournal.push(entry);
    if (mutationJournal.length > 500) mutationJournal = mutationJournal.slice(-500);
    return entry.seq;
}

async function replayMutationsSince(sequence) {
    const replay = mutationJournal.filter(item => item.seq > sequence);
    if (!replay.length) {
        mutationJournal = mutationJournal.filter(item => item.seq > sequence);
        return;
    }

    const maxSeq = Math.max(...replay.map(item => item.seq));
    for (const item of replay) {
        if (item.type === "upsert") {
            await upsertIndexedPhotos(item.photos, item.ownerId);
        } else if (item.type === "delete") {
            await deleteIndexedPhoto(item.ownerId, item.photoId);
        }
    }
    mutationJournal = mutationJournal.filter(item => item.seq > maxSeq);
}

async function fetchGlobalPage(ownerId, offset) {
    return vkApi("photos.getAll", {
        owner_id: Number(ownerId),
        extended: 0,
        photo_sizes: 1,
        count: GLOBAL_PAGE_SIZE,
        offset
    });
}

async function fetchAlbumPage(ownerId, albumId, offset) {
    return vkApi("photos.get", {
        owner_id: Number(ownerId),
        album_id: Number(albumId),
        extended: 0,
        photo_sizes: 1,
        count: ALBUM_PAGE_SIZE,
        offset
    });
}

async function albumExists(ownerId, albumId) {
    try {
        const result = await vkApi("photos.getAlbums", {
            owner_id: Number(ownerId),
            album_ids: [Number(albumId)],
            need_system: 1,
            count: 1
        });
        return Array.isArray(result?.items) && result.items.some(item => Number(item.id) === Number(albumId));
    } catch (error) {
        console.warn("Не удалось проверить существование альбома:", error);
        return null;
    }
}

export async function applyLocalPhotoUpdate(photo) {
    const ownerId = Number(photo?.owner_id || getOwnerId());
    if (!photo?.id || !ownerId) return;
    journalMutation({ type: "upsert", ownerId, photos: [{ ...photo, owner_id: ownerId }] });
    try {
        await upsertIndexedPhotos([{ ...photo, owner_id: ownerId }], ownerId);
        dispatchIndexEvent("photo-index-updated", { ownerId, reason: "local-update" });
    } catch (error) {
        console.warn("Не удалось обновить фото в локальном индексе:", error);
    }
}

export async function applyLocalPhotoMove(photos, targetAlbumId) {
    const list = (Array.isArray(photos) ? photos : [photos]).filter(photo => photo?.id);
    if (!list.length) return;

    const ownerId = Number(list[0]?.owner_id || getOwnerId());
    const updated = list.map(photo => ({
        ...photo,
        owner_id: Number(photo?.owner_id || ownerId),
        album_id: Number(targetAlbumId)
    }));

    journalMutation({ type: "upsert", ownerId, photos: updated });
    try {
        await upsertIndexedPhotos(updated, ownerId);
        dispatchIndexEvent("photo-index-updated", { ownerId, reason: "local-move" });
    } catch (error) {
        console.warn("Не удалось обновить перемещение в локальном фотоиндексе:", error);
    }
}

export async function applyLocalPhotoDelete(ownerId, photoId) {
    const numericOwnerId = Number(ownerId || getOwnerId());
    if (!numericOwnerId || !photoId) return;
    journalMutation({ type: "delete", ownerId: numericOwnerId, photoId: Number(photoId) });
    try {
        await deleteIndexedPhoto(numericOwnerId, Number(photoId));
        dispatchIndexEvent("photo-index-updated", { ownerId: numericOwnerId, reason: "local-delete" });
    } catch (error) {
        console.warn("Не удалось удалить фото из локального фотоиндекса:", error);
    }
}

export async function fullSyncPhotoIndex(ownerId, { onProgress = null } = {}) {
    const numericOwnerId = Number(ownerId);
    const startedMutationSeq = mutationSeq;
    let photos = [];
    const seen = new Set();
    let offset = 0;
    let total = 0;
    let pages = 0;
    let reachedEnd = false;

    while (pages < MAX_GLOBAL_PAGES) {
        const response = await fetchGlobalPage(numericOwnerId, offset);
        const items = Array.isArray(response?.items) ? response.items : [];
        const reportedTotal = Number(response?.count || 0);
        if (Number.isFinite(reportedTotal) && reportedTotal >= 0) total = Math.max(total, reportedTotal);

        for (const raw of items) {
            const photo = compactPhotoForIndex(raw, numericOwnerId);
            if (!photo || seen.has(photo.key)) continue;
            seen.add(photo.key);
            photos.push(photo);
        }

        offset += items.length;
        pages += 1;
        onProgress?.({ mode: "full", loaded: photos.length, total, pages, photos });

        const terminalByCount = total > 0 && offset >= total;
        const terminalByShortPage = items.length < GLOBAL_PAGE_SIZE;
        if (!items.length || terminalByCount || terminalByShortPage) {
            reachedEnd = true;
            break;
        }

        if (items.length > 0 && photos.length < offset) {
            throw new Error("VK вернул повторяющуюся страницу photos.getAll; индекс не заменён.");
        }
    }

    if (!reachedEnd) {
        throw new Error("Полная синхронизация достигла защитного лимита страниц; индекс не заменён.");
    }

    const now = Date.now();
    await replacePhotoIndex(numericOwnerId, photos, {
        complete: true,
        total: photos.length,
        reportedTotal: total,
        lastFullSync: now,
        lastQuickSync: now
    });

    // Если пользователь изменил фото через Mini App, пока шла долгая полная
    // синхронизация, серверная страница могла быть считана раньше изменения.
    // Повторяем локальные подтверждённые мутации поверх нового снимка.
    await replayMutationsSince(startedMutationSeq);

    dispatchIndexEvent("photo-index-updated", {
        ownerId: numericOwnerId,
        reason: "full-sync",
        count: photos.length
    });

    return getPhotoIndexSnapshot(numericOwnerId);
}

export async function quickSyncPhotoIndex(ownerId, { force = false, onProgress = null } = {}) {
    const numericOwnerId = Number(ownerId);
    const snapshot = await getPhotoIndexSnapshot(numericOwnerId);
    const meta = snapshot.meta;
    if (!meta.complete) return { ...snapshot, needsFullSync: true };

    if (!force) {
        const plan = getPhotoIndexSyncPlan(meta);
        if (plan.mode !== "quick") {
            return { ...snapshot, skipped: true, needsFullSync: false, plan };
        }
    }

    const knownIds = new Set(snapshot.items.map(photo => String(photo.id)));
    let offset = 0;
    let pages = 0;
    let reportedTotal = Number(meta.total || snapshot.items.length);
    let newPhotos = 0;

    while (pages < MAX_QUICK_PAGES) {
        const response = await fetchGlobalPage(numericOwnerId, offset);
        const items = Array.isArray(response?.items) ? response.items : [];
        const count = Number(response?.count || 0);
        if (Number.isFinite(count) && count >= 0) reportedTotal = count;

        const unknownOnPage = items.filter(photo => !knownIds.has(String(photo.id))).length;
        newPhotos += unknownOnPage;
        await upsertIndexedPhotos(items, numericOwnerId);
        items.forEach(photo => knownIds.add(String(photo.id)));

        offset += items.length;
        pages += 1;
        onProgress?.({ mode: "quick", loaded: offset, total: reportedTotal, pages, newPhotos });

        if (!items.length || items.length < GLOBAL_PAGE_SIZE || (reportedTotal > 0 && offset >= reportedTotal)) break;
        if (unknownOnPage === 0) break;
    }

    const after = await getPhotoIndexSnapshot(numericOwnerId);
    const countMismatch = Number(reportedTotal) !== after.items.length;

    await updatePhotoIndexMeta(numericOwnerId, {
        lastQuickSync: Date.now(),
        reportedTotal,
        total: after.items.length
    });

    return {
        ...(await getPhotoIndexSnapshot(numericOwnerId)),
        needsFullSync: countMismatch,
        newPhotos,
        pages
    };
}

async function syncAlbumPhotoIndex(ownerId, dirtyEntry) {
    const numericOwnerId = Number(ownerId);
    const albumId = Number(dirtyEntry?.albumId || 0);
    if (!albumId) return false;

    const reasons = new Set(Array.isArray(dirtyEntry?.reasons) ? dirtyEntry.reasons : []);
    if (reasons.has("album-native-delete") || reasons.has("album-fingerprint-removed")) {
        const exists = await albumExists(numericOwnerId, albumId);
        if (exists === false) {
            await replaceIndexedAlbum(numericOwnerId, albumId, []);
            clearPhotoIndexAlbumDirty(numericOwnerId, albumId);
            return true;
        }
        if (exists === null) return false;
    }

    const startedMutationSeq = mutationSeq;
    let all = [];
    const seen = new Set();
    let offset = 0;
    let pages = 0;
    let total = -1;
    let reachedEnd = false;

    while (pages < MAX_ALBUM_PAGES) {
        const response = await fetchAlbumPage(numericOwnerId, albumId, offset);
        const items = Array.isArray(response?.items) ? response.items : [];
        const reportedTotal = Number(response?.count || 0);
        if (Number.isFinite(reportedTotal) && reportedTotal >= 0) total = reportedTotal;

        for (const item of items) {
            const compact = compactPhotoForIndex(item, numericOwnerId);
            if (!compact || seen.has(compact.key)) continue;
            seen.add(compact.key);
            all.push(compact);
        }

        offset += items.length;
        pages += 1;

        if (!items.length || items.length < ALBUM_PAGE_SIZE || (total >= 0 && offset >= total)) {
            reachedEnd = true;
            break;
        }

        if (items.length > 0 && all.length < offset) {
            throw new Error(`VK вернул повторяющуюся страницу альбома ${albumId}.`);
        }
    }

    if (!reachedEnd) throw new Error(`Синхронизация альбома ${albumId} достигла защитного лимита.`);

    await replaceIndexedAlbum(numericOwnerId, albumId, all);
    await replayMutationsSince(startedMutationSeq);
    clearPhotoIndexAlbumDirty(numericOwnerId, albumId);
    dispatchIndexEvent("photo-index-updated", {
        ownerId: numericOwnerId,
        albumId,
        reason: "album-sync"
    });
    return true;
}

export async function syncPhotoIndexAlbumIfDirty(ownerId, albumId) {
    const numericOwnerId = Number(ownerId);
    const numericAlbumId = Number(albumId);
    if (!numericOwnerId || !numericAlbumId) return { synced: false, skipped: true };

    const syncKey = `${numericOwnerId}:${numericAlbumId}`;
    if (albumSyncPromises.has(syncKey)) return albumSyncPromises.get(syncKey);

    const promise = (async () => {
        // Не пишем один и тот же IndexedDB параллельно с полной/dirty-сверкой.
        if (syncPromise && syncOwnerId === numericOwnerId) {
            try { await syncPromise; } catch {}
        }
        if (dirtySyncPromise && dirtySyncOwnerId === numericOwnerId) {
            try { await dirtySyncPromise; } catch {}
        }

        const dirtyEntry = getDirtyPhotoIndexAlbums(numericOwnerId)
            .find(entry => Number(entry?.albumId) === numericAlbumId);
        if (!dirtyEntry) return { synced: false, skipped: true, reason: "clean" };

        // Пока полного глобального индекса нет, синхронизировать отдельный альбом
        // в IndexedDB бессмысленно: первая полная индексация всё равно возьмёт
        // актуальные данные целиком. Dirty остаётся до этой полной сверки.
        const meta = await getPhotoIndexMeta(numericOwnerId);
        if (!meta.complete) return { synced: false, skipped: true, reason: "index-incomplete" };

        try {
            const synced = await syncAlbumPhotoIndex(numericOwnerId, dirtyEntry);
            return { synced: Boolean(synced), skipped: false };
        } catch (error) {
            console.warn("Не удалось синхронизировать открытый dirty-альбом:", dirtyEntry, error);
            return { synced: false, skipped: false, error };
        }
    })().finally(() => {
        albumSyncPromises.delete(syncKey);
    });

    albumSyncPromises.set(syncKey, promise);
    return promise;
}

export async function syncDirtyPhotoIndex(ownerId) {
    const numericOwnerId = Number(ownerId);
    if (dirtySyncPromise && dirtySyncOwnerId === numericOwnerId) return dirtySyncPromise;

    dirtySyncOwnerId = numericOwnerId;
    dirtySyncPromise = (async () => {
        const meta = await getPhotoIndexMeta(numericOwnerId);
        if (!meta.complete) return { synced: 0, skipped: true };

        const dirty = getDirtyPhotoIndexAlbums(numericOwnerId);
        let synced = 0;

        for (const entry of dirty) {
            try {
                if (await syncAlbumPhotoIndex(numericOwnerId, entry)) synced += 1;
            } catch (error) {
                // Dirty-метка намеренно остаётся: повторим при следующем открытии глобального поиска.
                console.warn("Не удалось синхронизировать изменённый альбом фотоиндекса:", entry, error);
            }
        }

        return { synced, dirty: getDirtyPhotoIndexAlbums(numericOwnerId) };
    })().finally(() => {
        dirtySyncPromise = null;
        dirtySyncOwnerId = 0;
    });

    return dirtySyncPromise;
}

export async function synchronizePhotoIndex(ownerId, {
    forceFull = false,
    forceQuick = false,
    onProgress = null
} = {}) {
    const numericOwnerId = Number(ownerId);
    if (!numericOwnerId) throw new Error("Не определён owner_id для фотоиндекса.");

    if (syncPromise && syncOwnerId === numericOwnerId) return syncPromise;

    syncOwnerId = numericOwnerId;
    syncPromise = (async () => {
        // ВАЖНО: эта функция вызывается глобальным поиском или вручную из
        // диагностики. На старте приложения и после нативных переходов она
        // больше не запускается автоматически.
        const initialMeta = await getPhotoIndexMeta(numericOwnerId);
        const plan = getPhotoIndexSyncPlan(initialMeta, { forceFull, forceQuick });

        if (plan.mode === "full") {
            // Старые dirty-метки уже покрываются новым полным снимком. Сохраняем
            // только те, что появились ПОСЛЕ старта синхронизации: они могли
            // случиться после чтения соответствующей страницы photos.getAll.
            const fullStartedAt = Date.now();
            await fullSyncPhotoIndex(numericOwnerId, { onProgress });
            clearPhotoIndexDirtyThrough(numericOwnerId, fullStartedAt);
            await syncDirtyPhotoIndex(numericOwnerId);
            return getPhotoIndexSnapshot(numericOwnerId);
        }

        // Если полный индекс ещё достаточно свежий, точечно приводим в порядок
        // только альбомы, которые были изменены через нативный VK.
        await syncDirtyPhotoIndex(numericOwnerId);

        if (plan.mode === "dirty-only") {
            return getPhotoIndexSnapshot(numericOwnerId);
        }

        const quick = await quickSyncPhotoIndex(numericOwnerId, {
            force: forceQuick,
            onProgress
        });

        // Быстрая проверка умеет хорошо находить новые фотографии. Если общий
        // count VK разошёлся с локальным индексом, безопаснее один раз выполнить
        // полную сверку, чем оставлять заведомо неполный индекс.
        if (quick.needsFullSync) {
            const fullStartedAt = Date.now();
            const result = await fullSyncPhotoIndex(numericOwnerId, { onProgress });
            clearPhotoIndexDirtyThrough(numericOwnerId, fullStartedAt);
            await syncDirtyPhotoIndex(numericOwnerId);
            return result;
        }

        return getPhotoIndexSnapshot(numericOwnerId);
    })().finally(() => {
        syncPromise = null;
        syncOwnerId = 0;
    });

    return syncPromise;
}

export function initPhotoIndexSync() {
    if (initialized) return;
    initialized = true;

    window.addEventListener("photo-data-updated", event => {
        const photo = event?.detail?.photo;
        if (photo?.id) void applyLocalPhotoUpdate(photo);
    });

    // Нативный VK здесь намеренно НЕ запускает синхронизацию фотоиндекса.
    // Загрузка/копирование/удаление заранее оставляют persistent dirty-метки.
    // Они будут обработаны только при следующем открытии глобального поиска.

    // Диагностика для последующей проверки без отдельного UI.
    window.vkPhotoIndexDebug = {
        status: () => getPhotoIndexDiagnostics(getOwnerId()),
        fingerprints: () => getAlbumFingerprintDiagnostics(getOwnerId()),
        plan: async () => getPhotoIndexSyncPlan(await getPhotoIndexMeta(getOwnerId())),
        sync: () => synchronizePhotoIndex(getOwnerId(), { forceQuick: true }),
        fullSync: () => synchronizePhotoIndex(getOwnerId(), { forceFull: true }),
        syncDirty: () => syncDirtyPhotoIndex(getOwnerId())
    };
}
