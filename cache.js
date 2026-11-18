const PREFIX = "vk-photo-manager:v5:";
const LEGACY_ROOT_PREFIX = "vk-photo-manager:";
const MAX_STALE_CACHE_AGE = 7 * 24 * 60 * 60 * 1000;
const PERSISTENT_AUX_PREFIXES = [
    "vk-photo-manager:photo-index-dirty:v1:",
    "vk-photo-manager:album-fingerprints:v1:"
];
let lastPruneAt = 0;

function fullKey(key) {
    return PREFIX + key;
}

function appCacheEntries() {
    const entries = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const storageKey = localStorage.key(i);
            if (!storageKey || !storageKey.startsWith(PREFIX)) continue;

            let savedAt = 0;
            try {
                const parsed = JSON.parse(localStorage.getItem(storageKey) || "null");
                savedAt = Number(parsed?.savedAt || 0);
            } catch {}
            entries.push({ storageKey, savedAt });
        }
    } catch {}
    return entries;
}

function pruneVeryOldAppCache() {
    const now = Date.now();
    if (now - lastPruneAt < 5 * 60 * 1000) return;
    lastPruneAt = now;

    try {
        for (const entry of appCacheEntries()) {
            if (!entry.savedAt || now - entry.savedAt > MAX_STALE_CACHE_AGE) {
                localStorage.removeItem(entry.storageKey);
            }
        }
    } catch (error) {
        console.warn("Не удалось очистить старый UI-кэш:", error);
    }
}

function isQuotaError(error) {
    return Boolean(
        error && (
            error.name === "QuotaExceededError" ||
            error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
            error.code === 22 ||
            error.code === 1014
        )
    );
}

export function cacheSet(key, value) {
    const storageKey = fullKey(key);
    let payload = "";
    try {
        payload = JSON.stringify({
            savedAt: Date.now(),
            value
        });
    } catch (error) {
        console.warn("Не удалось сериализовать кэш:", key, error);
        return false;
    }

    pruneVeryOldAppCache();

    try {
        localStorage.setItem(storageKey, payload);
        return true;
    } catch (error) {
        if (!isQuotaError(error)) {
            console.warn("Не удалось записать кэш:", key, error);
            return false;
        }

        // localStorage мал. При переполнении удаляем самые старые UI-снимки
        // по одному и после каждого удаления повторяем запись. Постоянный
        // глобальный фотоиндекс здесь не хранится и не затрагивается.
        const candidates = appCacheEntries()
            .filter(entry => entry.storageKey !== storageKey)
            .sort((a, b) => a.savedAt - b.savedAt);

        for (const entry of candidates) {
            try {
                localStorage.removeItem(entry.storageKey);
                localStorage.setItem(storageKey, payload);
                return true;
            } catch (retryError) {
                if (!isQuotaError(retryError)) {
                    console.warn("Не удалось записать кэш после очистки:", key, retryError);
                    return false;
                }
            }
        }

        console.warn("Недостаточно места в localStorage для UI-кэша:", key);
        return false;
    }
}

export function cacheGet(key, maxAgeMs = 0) {
    try {
        const raw = localStorage.getItem(fullKey(key));
        if (!raw) return null;

        const data = JSON.parse(raw);

        if (
            !data ||
            typeof data.savedAt !== "number" ||
            !("value" in data)
        ) {
            cacheRemove(key);
            return null;
        }

        if (
            maxAgeMs > 0 &&
            Date.now() - data.savedAt > maxAgeMs
        ) {
            return null;
        }

        return data.value;
    } catch (error) {
        console.warn("Не удалось прочитать кэш:", key, error);
        return null;
    }
}

export function cacheGetStale(key) {
    try {
        const raw = localStorage.getItem(fullKey(key));
        if (!raw) return null;
        const data = JSON.parse(raw);
        return data?.value ?? null;
    } catch {
        return null;
    }
}

export function cacheRemove(key) {
    try {
        localStorage.removeItem(fullKey(key));
    } catch {}
}

export function cacheRemoveByPrefix(keyPrefix) {
    try {
        const prefix = fullKey(keyPrefix);
        const keys = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) keys.push(key);
        }

        keys.forEach(key => localStorage.removeItem(key));
    } catch (error) {
        console.warn("Не удалось очистить часть кэша:", error);
    }
}

export function clearAppCache() {
    try {
        const keys = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(PREFIX)) keys.push(key);
        }

        keys.forEach(key => localStorage.removeItem(key));
    } catch (error) {
        console.warn("Не удалось очистить кэш приложения:", error);
    }
}

// Удаляем старые схемы кэша. Это важно после изменений структуры данных:
// старый частичный индекс альбомов больше никогда не должен считаться полным.
export function cleanupLegacyCache() {
    try {
        const keys = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (
                key &&
                key.startsWith(LEGACY_ROOT_PREFIX) &&
                !key.startsWith(PREFIX) &&
                !PERSISTENT_AUX_PREFIXES.some(prefix => key.startsWith(prefix))
            ) {
                keys.push(key);
            }
        }

        keys.forEach(key => localStorage.removeItem(key));
    } catch (error) {
        console.warn("Не удалось удалить старый кэш приложения:", error);
    }

    pruneVeryOldAppCache();
}

export function albumPhotosKey(ownerId, albumId) {
    return `photos-v4:${ownerId}:${albumId}`;
}

export function photoCommentsKey(ownerId, photoId) {
    return `comments:${ownerId}:${photoId}`;
}

export function albumsKey(ownerId) {
    return `albums:${ownerId}`;
}

export function commentsFeedKey(ownerId) {
    return `comments-feed:${ownerId}`;
}

export function albumIndexKey(ownerId) {
    return `album-index-v3:${ownerId}`;
}

export function invalidateAlbumCaches(ownerId) {
    cacheRemove(albumsKey(ownerId));
    cacheRemove(albumIndexKey(ownerId));
}

export function invalidateAlbumPhotosCache(ownerId, albumId) {
    if (!ownerId || !albumId) return;
    cacheRemove(albumPhotosKey(ownerId, albumId));
}

export function invalidateCommentCaches(ownerId, { photoId = 0 } = {}) {
    if (photoId) cacheRemove(photoCommentsKey(ownerId, photoId));

    // Эти ленты имеют свои schema/version в ключе, поэтому чистим по типу.
    cacheRemoveByPrefix("global-comments:");
    cacheRemoveByPrefix("album-comments:");
    cacheRemove(commentsFeedKey(ownerId));
}

export function invalidatePhotoActivityCaches(ownerId, albumId, photoId = 0) {
    invalidateAlbumPhotosCache(ownerId, albumId);
    invalidateCommentCaches(ownerId, { photoId });
}
