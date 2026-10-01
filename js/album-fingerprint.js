import { markPhotoIndexAlbumDirty } from "./photo-index-db.js?v=20260927-captiontop43";

const FINGERPRINT_PREFIX = "vk-photo-manager:album-fingerprints:v1:";
const SCHEMA = 1;

function storageKey(ownerId) {
    return FINGERPRINT_PREFIX + Number(ownerId);
}

function finiteNumberOrNull(value) {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
}

function thumbIdOf(album) {
    const direct = finiteNumberOrNull(album?.thumb_id);
    if (direct !== null) return direct;
    return finiteNumberOrNull(album?.thumb?.id);
}

export function albumFingerprint(album) {
    const albumId = Number(album?.id || 0);
    if (!albumId) return null;

    return {
        albumId,
        size: Math.max(0, Number(album?.size || 0)),
        updated: finiteNumberOrNull(album?.updated),
        thumbId: thumbIdOf(album)
    };
}

function readState(ownerId) {
    try {
        const raw = localStorage.getItem(storageKey(ownerId));
        const parsed = raw ? JSON.parse(raw) : null;
        if (parsed?.schema === SCHEMA && parsed?.albums && typeof parsed.albums === "object") {
            return parsed;
        }
    } catch (error) {
        console.warn("Не удалось прочитать отпечатки альбомов:", error);
    }

    return {
        schema: SCHEMA,
        ownerId: Number(ownerId),
        updatedAt: 0,
        baselineReady: false,
        albums: {}
    };
}

function writeState(ownerId, state) {
    try {
        localStorage.setItem(storageKey(ownerId), JSON.stringify({
            ...state,
            schema: SCHEMA,
            ownerId: Number(ownerId),
            updatedAt: Date.now()
        }));
        return true;
    } catch (error) {
        console.warn("Не удалось сохранить отпечатки альбомов:", error);
        return false;
    }
}

function fingerprintReasons(previous, next) {
    const reasons = [];
    if (Number(previous?.size ?? 0) !== Number(next?.size ?? 0)) {
        reasons.push("album-fingerprint-size");
    }

    // updated может отсутствовать у системных альбомов. Считаем изменением
    // только сравнение двух реально известных значений, чтобы не создавать
    // ложный dirty из-за разницы форматов ответа VK.
    if (
        previous?.updated !== null && previous?.updated !== undefined &&
        next?.updated !== null && next?.updated !== undefined &&
        Number(previous.updated) !== Number(next.updated)
    ) {
        reasons.push("album-fingerprint-updated");
    }

    if (
        previous?.thumbId !== null && previous?.thumbId !== undefined &&
        next?.thumbId !== null && next?.thumbId !== undefined &&
        Number(previous.thumbId) !== Number(next.thumbId)
    ) {
        reasons.push("album-fingerprint-cover");
    }

    return reasons;
}

export function observeAlbumFingerprints(ownerId, albums) {
    const numericOwnerId = Number(ownerId);
    const list = Array.isArray(albums) ? albums : [];
    if (!numericOwnerId || !list.length) return [];

    const state = readState(numericOwnerId);
    const changes = [];

    for (const album of list) {
        const next = albumFingerprint(album);
        if (!next) continue;

        const key = String(next.albumId);
        const previous = state.albums[key] || null;

        if (previous) {
            const reasons = fingerprintReasons(previous, next);
            if (reasons.length) {
                reasons.forEach(reason => markPhotoIndexAlbumDirty(numericOwnerId, next.albumId, reason));
                changes.push({
                    albumId: next.albumId,
                    previous,
                    current: next,
                    reasons
                });
            }
        } else if (state.baselineReady) {
            // После того как полный список уже однажды зафиксирован, новый id
            // означает реально появившийся альбом, а не первичное заполнение базы.
            const reasons = ["album-fingerprint-added"];
            markPhotoIndexAlbumDirty(numericOwnerId, next.albumId, reasons[0]);
            changes.push({ albumId: next.albumId, previous: null, current: next, reasons });
        }

        // До первого полного списка новые записи лишь формируют baseline.
        state.albums[key] = next;
    }

    writeState(numericOwnerId, state);
    return changes;
}

export function reconcileAlbumFingerprints(ownerId, currentAlbumIds) {
    const numericOwnerId = Number(ownerId);
    if (!numericOwnerId) return [];

    const state = readState(numericOwnerId);
    const current = new Set(
        (Array.isArray(currentAlbumIds) ? currentAlbumIds : [])
            .map(value => Number(value))
            .filter(Boolean)
            .map(String)
    );
    const removed = [];

    for (const [id, previous] of Object.entries(state.albums || {})) {
        if (current.has(String(id))) continue;
        const albumId = Number(id);
        if (!albumId) continue;

        markPhotoIndexAlbumDirty(numericOwnerId, albumId, "album-fingerprint-removed");
        removed.push({ albumId, previous, reasons: ["album-fingerprint-removed"] });
        delete state.albums[id];
    }

    state.baselineReady = true;
    writeState(numericOwnerId, state);
    return removed;
}

export function getAlbumFingerprintDiagnostics(ownerId) {
    const state = readState(ownerId);
    return {
        ownerId: Number(ownerId),
        count: Object.keys(state.albums || {}).length,
        updatedAt: Number(state.updatedAt || 0),
        albums: state.albums || {}
    };
}
