const DB_NAME = "vk-photo-manager-photo-index";
const DB_VERSION = 1;
const PHOTO_STORE = "photos";
const META_STORE = "meta";
const DIRTY_PREFIX = "vk-photo-manager:photo-index-dirty:v1:";
const INDEX_SCHEMA = 1;

let dbPromise = null;

function photoKey(ownerId, photoId) {
    return `${Number(ownerId)}:${Number(photoId)}`;
}

function albumKey(ownerId, albumId) {
    return `${Number(ownerId)}:${Number(albumId)}`;
}

function metaKey(ownerId) {
    return `owner:${Number(ownerId)}`;
}

function normalizeSearchText(value = "") {
    return String(value)
        .toLocaleLowerCase("ru-RU")
        .replace(/ё/g, "е")
        .replace(/\s+/g, " ")
        .trim();
}

function pickPreviewSize(sizes, targetSize = 320) {
    if (!Array.isArray(sizes)) return null;

    const list = sizes
        .filter(item => item?.url)
        .map(item => ({
            type: item.type || "",
            url: item.url,
            width: Number(item.width || 0),
            height: Number(item.height || 0)
        }))
        .sort((a, b) => Math.max(a.width, a.height) - Math.max(b.width, b.height));

    if (!list.length) return null;
    return list.find(item => Math.max(item.width, item.height) >= targetSize) || list[list.length - 1];
}

export function compactPhotoForIndex(photo, fallbackOwnerId = 0) {
    const id = Number(photo?.id || 0);
    const ownerId = Number(photo?.owner_id || fallbackOwnerId || 0);
    const albumId = Number(photo?.album_id || 0);

    if (!id || !ownerId) return null;

    const preview = pickPreviewSize(photo?.sizes);
    const text = String(photo?.text || "");

    return {
        key: photoKey(ownerId, id),
        id,
        owner_id: ownerId,
        album_id: albumId,
        owner_album_key: albumKey(ownerId, albumId),
        date: Number(photo?.date || 0),
        text,
        search_text: normalizeSearchText(text),
        sizes: preview ? [preview] : [],
        cached_at: Date.now()
    };
}

function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
            reject(new Error("IndexedDB недоступен в этом WebView."));
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;

            if (!db.objectStoreNames.contains(PHOTO_STORE)) {
                const photos = db.createObjectStore(PHOTO_STORE, { keyPath: "key" });
                photos.createIndex("owner_id", "owner_id", { unique: false });
                photos.createIndex("owner_album_key", "owner_album_key", { unique: false });
            }

            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE, { keyPath: "key" });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Не удалось открыть IndexedDB."));
        request.onblocked = () => console.warn("Открытие photo index IndexedDB заблокировано другой вкладкой.");
    }).catch(error => {
        dbPromise = null;
        throw error;
    });

    return dbPromise;
}

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Ошибка IndexedDB."));
    });
}

function transactionDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("Ошибка транзакции IndexedDB."));
        tx.onabort = () => reject(tx.error || new Error("Транзакция IndexedDB отменена."));
    });
}

async function ownerPhotoKeys(ownerId) {
    const db = await openDb();
    const tx = db.transaction(PHOTO_STORE, "readonly");
    const index = tx.objectStore(PHOTO_STORE).index("owner_id");
    return requestResult(index.getAllKeys(IDBKeyRange.only(Number(ownerId))));
}

async function albumPhotoKeys(ownerId, albumId) {
    const db = await openDb();
    const tx = db.transaction(PHOTO_STORE, "readonly");
    const index = tx.objectStore(PHOTO_STORE).index("owner_album_key");
    return requestResult(index.getAllKeys(IDBKeyRange.only(albumKey(ownerId, albumId))));
}

export async function getPhotoIndexMeta(ownerId) {
    const db = await openDb();
    const tx = db.transaction(META_STORE, "readonly");
    const value = await requestResult(tx.objectStore(META_STORE).get(metaKey(ownerId)));
    return value || {
        key: metaKey(ownerId),
        owner_id: Number(ownerId),
        schema: INDEX_SCHEMA,
        complete: false,
        total: 0,
        lastFullSync: 0,
        lastQuickSync: 0,
        lastPartialSync: 0,
        updatedAt: 0
    };
}

export async function getAllIndexedPhotos(ownerId) {
    const db = await openDb();
    const tx = db.transaction(PHOTO_STORE, "readonly");
    const index = tx.objectStore(PHOTO_STORE).index("owner_id");
    const items = await requestResult(index.getAll(IDBKeyRange.only(Number(ownerId))));
    return Array.isArray(items) ? items : [];
}

export async function getPhotoIndexSnapshot(ownerId) {
    const [items, meta] = await Promise.all([
        getAllIndexedPhotos(ownerId),
        getPhotoIndexMeta(ownerId)
    ]);
    return { items, meta };
}

export async function replacePhotoIndex(ownerId, photos, metaPatch = {}) {
    const numericOwnerId = Number(ownerId);
    const compact = (Array.isArray(photos) ? photos : [])
        .map(photo => photo?.key ? photo : compactPhotoForIndex(photo, numericOwnerId))
        .filter(Boolean)
        .map(photo => ({
            ...photo,
            owner_id: numericOwnerId,
            key: photoKey(numericOwnerId, photo.id),
            owner_album_key: albumKey(numericOwnerId, photo.album_id)
        }));

    const [db, keys, previousMeta] = await Promise.all([
        openDb(),
        ownerPhotoKeys(numericOwnerId),
        getPhotoIndexMeta(numericOwnerId)
    ]);

    const tx = db.transaction([PHOTO_STORE, META_STORE], "readwrite");
    const photoStore = tx.objectStore(PHOTO_STORE);
    const metaStore = tx.objectStore(META_STORE);

    keys.forEach(key => photoStore.delete(key));
    compact.forEach(photo => photoStore.put(photo));

    metaStore.put({
        ...previousMeta,
        ...metaPatch,
        key: metaKey(numericOwnerId),
        owner_id: numericOwnerId,
        schema: INDEX_SCHEMA,
        total: Math.max(0, Number(metaPatch.total ?? compact.length)),
        updatedAt: Date.now()
    });

    await transactionDone(tx);
    return compact;
}

export async function upsertIndexedPhotos(photos, fallbackOwnerId = 0) {
    const compact = (Array.isArray(photos) ? photos : [photos])
        .map(photo => compactPhotoForIndex(photo, fallbackOwnerId))
        .filter(Boolean);

    if (!compact.length) return [];

    const db = await openDb();
    const tx = db.transaction(PHOTO_STORE, "readwrite");
    const store = tx.objectStore(PHOTO_STORE);
    compact.forEach(photo => store.put(photo));
    await transactionDone(tx);
    return compact;
}

export async function deleteIndexedPhoto(ownerId, photoId) {
    const numericOwnerId = Number(ownerId);
    const key = photoKey(numericOwnerId, photoId);
    const [db, previousMeta] = await Promise.all([
        openDb(),
        getPhotoIndexMeta(numericOwnerId)
    ]);

    const tx = db.transaction([PHOTO_STORE, META_STORE], "readwrite");
    const photoStore = tx.objectStore(PHOTO_STORE);
    const metaStore = tx.objectStore(META_STORE);
    const existingRequest = photoStore.get(key);

    existingRequest.onsuccess = () => {
        const existed = Boolean(existingRequest.result);
        photoStore.delete(key);

        if (existed && previousMeta.complete) {
            metaStore.put({
                ...previousMeta,
                key: metaKey(numericOwnerId),
                owner_id: numericOwnerId,
                schema: INDEX_SCHEMA,
                total: Math.max(0, Number(previousMeta.total || 0) - 1),
                updatedAt: Date.now()
            });
        }
    };

    await transactionDone(tx);
}

export async function replaceIndexedAlbum(ownerId, albumId, photos, metaPatch = {}) {
    const numericOwnerId = Number(ownerId);
    const numericAlbumId = Number(albumId);
    const compact = (Array.isArray(photos) ? photos : [])
        .map(photo => compactPhotoForIndex(photo, numericOwnerId))
        .filter(Boolean)
        .map(photo => ({
            ...photo,
            owner_id: numericOwnerId,
            album_id: numericAlbumId,
            key: photoKey(numericOwnerId, photo.id),
            owner_album_key: albumKey(numericOwnerId, numericAlbumId)
        }));

    const [db, keys, previousMeta] = await Promise.all([
        openDb(),
        albumPhotoKeys(numericOwnerId, numericAlbumId),
        getPhotoIndexMeta(numericOwnerId)
    ]);

    const tx = db.transaction([PHOTO_STORE, META_STORE], "readwrite");
    const photoStore = tx.objectStore(PHOTO_STORE);
    const metaStore = tx.objectStore(META_STORE);

    keys.forEach(key => photoStore.delete(key));
    compact.forEach(photo => photoStore.put(photo));

    const previousTotal = Math.max(0, Number(previousMeta.total || 0));
    const nextTotal = previousMeta.complete
        ? Math.max(0, previousTotal - keys.length + compact.length)
        : previousTotal;

    metaStore.put({
        ...previousMeta,
        ...metaPatch,
        key: metaKey(numericOwnerId),
        owner_id: numericOwnerId,
        schema: INDEX_SCHEMA,
        total: Number(metaPatch.total ?? nextTotal),
        lastPartialSync: Date.now(),
        updatedAt: Date.now()
    });

    await transactionDone(tx);
    return { removed: keys.length, inserted: compact.length };
}

export async function updatePhotoIndexMeta(ownerId, patch = {}) {
    const numericOwnerId = Number(ownerId);
    const [db, previousMeta] = await Promise.all([
        openDb(),
        getPhotoIndexMeta(numericOwnerId)
    ]);

    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put({
        ...previousMeta,
        ...patch,
        key: metaKey(numericOwnerId),
        owner_id: numericOwnerId,
        schema: INDEX_SCHEMA,
        updatedAt: Date.now()
    });
    await transactionDone(tx);
}

export async function clearPhotoIndex(ownerId) {
    const numericOwnerId = Number(ownerId);
    const [db, keys] = await Promise.all([openDb(), ownerPhotoKeys(numericOwnerId)]);
    const tx = db.transaction([PHOTO_STORE, META_STORE], "readwrite");
    const photoStore = tx.objectStore(PHOTO_STORE);
    keys.forEach(key => photoStore.delete(key));
    tx.objectStore(META_STORE).delete(metaKey(numericOwnerId));
    await transactionDone(tx);
}

function dirtyStorageKey(ownerId) {
    return DIRTY_PREFIX + Number(ownerId);
}

export function markPhotoIndexAlbumDirty(ownerId, albumId, reason = "external") {
    const numericOwnerId = Number(ownerId);
    const numericAlbumId = Number(albumId);
    if (!numericOwnerId || !numericAlbumId) return;

    try {
        const key = dirtyStorageKey(numericOwnerId);
        const current = JSON.parse(localStorage.getItem(key) || "{}") || {};
        const id = String(numericAlbumId);
        const previousReasons = Array.isArray(current[id]?.reasons) ? current[id].reasons : [];
        current[id] = {
            albumId: numericAlbumId,
            markedAt: Date.now(),
            reasons: [...new Set([...previousReasons, String(reason || "external")])]
        };
        localStorage.setItem(key, JSON.stringify(current));
    } catch (error) {
        console.warn("Не удалось сохранить dirty-метку фотоиндекса:", error);
    }
}

export function getDirtyPhotoIndexAlbums(ownerId) {
    try {
        const raw = localStorage.getItem(dirtyStorageKey(ownerId));
        const parsed = raw ? JSON.parse(raw) : {};
        return Object.values(parsed || {})
            .filter(item => Number(item?.albumId || 0))
            .sort((a, b) => Number(a.markedAt || 0) - Number(b.markedAt || 0));
    } catch {
        return [];
    }
}

export function clearPhotoIndexAlbumDirty(ownerId, albumId) {
    try {
        const key = dirtyStorageKey(ownerId);
        const parsed = JSON.parse(localStorage.getItem(key) || "{}") || {};
        delete parsed[String(Number(albumId))];
        if (Object.keys(parsed).length) localStorage.setItem(key, JSON.stringify(parsed));
        else localStorage.removeItem(key);
    } catch {}
}

export function clearPhotoIndexDirtyThrough(ownerId, markedAtInclusive) {
    const cutoff = Number(markedAtInclusive || 0);
    if (!cutoff) return 0;

    try {
        const key = dirtyStorageKey(ownerId);
        const parsed = JSON.parse(localStorage.getItem(key) || "{}") || {};
        let removed = 0;

        for (const [albumId, entry] of Object.entries(parsed)) {
            if (Number(entry?.markedAt || 0) <= cutoff) {
                delete parsed[albumId];
                removed += 1;
            }
        }

        if (Object.keys(parsed).length) localStorage.setItem(key, JSON.stringify(parsed));
        else localStorage.removeItem(key);
        return removed;
    } catch {
        return 0;
    }
}

export async function getPhotoIndexDiagnostics(ownerId) {
    const snapshot = await getPhotoIndexSnapshot(ownerId);
    const dirty = getDirtyPhotoIndexAlbums(ownerId);
    const malformed = snapshot.items.filter(photo => (
        !photo?.id ||
        Number(photo.owner_id) !== Number(ownerId) ||
        typeof photo.text !== "string" ||
        !photo.key
    )).length;

    let approxBytes = 0;
    try {
        approxBytes = new Blob([JSON.stringify(snapshot.items)]).size;
    } catch {
        approxBytes = JSON.stringify(snapshot.items).length * 2;
    }

    let storageEstimate = null;
    try {
        storageEstimate = await navigator.storage?.estimate?.() || null;
    } catch {}

    return {
        ownerId: Number(ownerId),
        count: snapshot.items.length,
        meta: snapshot.meta,
        dirty,
        malformed,
        approxIndexBytes: approxBytes,
        storageEstimate,
        countMatchesMeta: !snapshot.meta.complete || Number(snapshot.meta.total) === snapshot.items.length
    };
}
