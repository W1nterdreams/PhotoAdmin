// Политика обслуживания глобального фотоиндекса.
// Важно: этот модуль сам ничего не запрашивает у VK. Он только решает,
// какая проверка нужна В МОМЕНТ открытия глобального поиска.

export const PHOTO_INDEX_POLICY = Object.freeze({
    // Повторные открытия глобального поиска в течение этого окна не вызывают
    // даже быструю photos.getAll-проверку, если нет dirty-альбомов.
    quickSyncIntervalMs: 30 * 60 * 1000,

    // Глобальный поиск используется редко, поэтому полную сверку 11 000+ фото
    // выполняем только при самом открытии поиска и только если последний полный
    // снимок старше этого возраста.
    fullSyncMaxAgeMs: 7 * 24 * 60 * 60 * 1000
});

function safeAge(now, timestamp) {
    const value = Number(timestamp || 0);
    if (!value) return Number.POSITIVE_INFINITY;
    return Math.max(0, Number(now) - value);
}

export function getPhotoIndexSyncPlan(meta = {}, {
    forceFull = false,
    forceQuick = false,
    now = Date.now()
} = {}) {
    const complete = Boolean(meta?.complete);
    const fullAgeMs = safeAge(now, meta?.lastFullSync);
    const quickAgeMs = safeAge(now, meta?.lastQuickSync);

    if (forceFull) {
        return {
            mode: "full",
            reason: "forced",
            complete,
            fullAgeMs,
            quickAgeMs
        };
    }

    if (!complete) {
        return {
            mode: "full",
            reason: "missing-complete-index",
            complete,
            fullAgeMs,
            quickAgeMs
        };
    }

    if (forceQuick) {
        return {
            mode: "quick",
            reason: "forced-quick",
            complete,
            fullAgeMs,
            quickAgeMs
        };
    }

    if (fullAgeMs >= PHOTO_INDEX_POLICY.fullSyncMaxAgeMs) {
        return {
            mode: "full",
            reason: "full-index-stale",
            complete,
            fullAgeMs,
            quickAgeMs
        };
    }

    if (quickAgeMs >= PHOTO_INDEX_POLICY.quickSyncIntervalMs) {
        return {
            mode: "quick",
            reason: "quick-check-due",
            complete,
            fullAgeMs,
            quickAgeMs
        };
    }

    return {
        mode: "dirty-only",
        reason: "fresh-enough",
        complete,
        fullAgeMs,
        quickAgeMs
    };
}
