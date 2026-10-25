import { state } from "./state.js?v=20261025-unanswered-fix53";
import { vkApi } from "./vk-api.js?v=20261025-comment-read54";
import { getOwnerId } from "./group-context.js?v=20261025-unanswered-fix53";

const READ_MARK_TTL_MS = 10 * 24 * 60 * 60 * 1000;
const READ_MARK_DB_NAME = "vk-photo-manager-comment-read-state";
const READ_MARK_DB_VERSION = 1;
const READ_MARK_STORE = "read-comments";
const READ_MARK_LOCAL_PREFIX = "vk-photo-manager:comment-read:v1:";
const MANAGER_PAGE_SIZE = 1000;
const MANAGER_REQUEST_TIMEOUT_MS = 9000;
const MANAGER_FAILURE_RETRY_MS = 60 * 1000;

let readDbPromise = null;
let readStatePromise = null;
let readStateLoaded = false;
let readStateMode = "indexeddb";
const readMarks = new Map();
const managerCache = new Map();
const managerRequests = new Map();

function commentId(comment) {
    const id = Number(comment?.id || comment?.cid || 0);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function commentPhotoId(comment) {
    const id = Number(comment?.photo_id ?? comment?.pid ?? 0);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function directParentId(comment) {
    // parents_stack с несколькими элементами содержит всю цепочку родителей;
    // последний элемент — ближайший родитель. Если VK вернул только корень,
    // используем явный reply_to_comment, а затем нормализованную связь.
    const stack = Array.isArray(comment?.parents_stack) ? comment.parents_stack : [];
    if (stack.length > 1) {
        const id = Number(stack[stack.length - 1] || 0);
        if (id > 0) return id;
    }

    const direct = Number(comment?.reply_to_comment || comment?.reply_to_comment_id || 0);
    if (direct > 0) return direct;

    const stored = Number(comment?._parent_comment_id || 0);
    if (stored > 0) return stored;

    const fromStack = Number(stack[stack.length - 1] || 0);
    return fromStack > 0 ? fromStack : null;
}

function makeReadMarkKey(ownerId, photoId, id) {
    const owner = Number(ownerId || 0);
    const photo = Number(photoId || 0);
    const comment = Number(id || 0);
    if (!owner || !photo || !comment) return null;
    return `${owner}:${photo}:${comment}`;
}

function openReadMarkDb() {
    if (readDbPromise) return readDbPromise;

    readDbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
            reject(new Error("IndexedDB недоступен в этом WebView."));
            return;
        }

        const request = indexedDB.open(READ_MARK_DB_NAME, READ_MARK_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(READ_MARK_STORE)) {
                db.createObjectStore(READ_MARK_STORE, { keyPath: "key" });
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => db.close();
            resolve(db);
        };
        request.onerror = () => reject(request.error || new Error("Не удалось открыть базу отметок комментариев."));
        request.onblocked = () => console.warn("Открытие базы отметок комментариев заблокировано другой вкладкой.");
    }).catch(error => {
        readDbPromise = null;
        throw error;
    });

    return readDbPromise;
}

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Ошибка IndexedDB для отметок комментариев."));
    });
}

function readLocalFallbackMarks() {
    const result = [];
    try {
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith(READ_MARK_LOCAL_PREFIX)) continue;
            try {
                const record = JSON.parse(localStorage.getItem(key) || "null");
                if (record?.key && Number(record?.readAt || 0) > 0) result.push(record);
            } catch {}
        }
    } catch (error) {
        console.warn("Не удалось прочитать резервные отметки комментариев:", error);
    }
    return result;
}

function writeLocalFallbackMark(record) {
    try {
        localStorage.setItem(`${READ_MARK_LOCAL_PREFIX}${record.key}`, JSON.stringify(record));
        return true;
    } catch (error) {
        console.warn("Не удалось сохранить резервную отметку комментария:", error);
        return false;
    }
}

function removeLocalFallbackMark(key) {
    try {
        localStorage.removeItem(`${READ_MARK_LOCAL_PREFIX}${key}`);
    } catch {}
}

async function persistReadMark(record) {
    if (readStateMode === "indexeddb") {
        try {
            const db = await openReadMarkDb();
            const tx = db.transaction(READ_MARK_STORE, "readwrite");
            tx.objectStore(READ_MARK_STORE).put(record);
            await new Promise((resolve, reject) => {
                tx.oncomplete = resolve;
                tx.onerror = () => reject(tx.error || new Error("Не удалось сохранить отметку комментария."));
                tx.onabort = () => reject(tx.error || new Error("Сохранение отметки комментария отменено."));
            });
            removeLocalFallbackMark(record.key);
            return true;
        } catch (error) {
            console.warn("IndexedDB недоступна для отметки комментария, используем резервное хранилище:", error);
        }
    }

    readStateMode = "localStorage";
    return writeLocalFallbackMark(record);
}

async function deleteExpiredReadMarks(expiredKeys) {
    if (!expiredKeys.length) return;

    for (const key of expiredKeys) {
        readMarks.delete(key);
        removeLocalFallbackMark(key);
    }

    if (readStateMode !== "indexeddb") return;

    try {
        const db = await openReadMarkDb();
        const tx = db.transaction(READ_MARK_STORE, "readwrite");
        const store = tx.objectStore(READ_MARK_STORE);
        for (const key of expiredKeys) store.delete(key);
        await new Promise((resolve, reject) => {
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error || new Error("Не удалось очистить старые отметки комментариев."));
            tx.onabort = () => reject(tx.error || new Error("Очистка старых отметок комментариев отменена."));
        });
    } catch (error) {
        console.warn("Не удалось удалить старые отметки комментариев из IndexedDB:", error);
    }
}

async function loadReadMarksOnce() {
    if (readStateLoaded) return;
    if (readStatePromise) return readStatePromise;

    readStatePromise = (async () => {
        let records = [];
        try {
            const db = await openReadMarkDb();
            const tx = db.transaction(READ_MARK_STORE, "readonly");
            records = await requestResult(tx.objectStore(READ_MARK_STORE).getAll());
            readStateMode = "indexeddb";
        } catch (error) {
            readStateMode = "localStorage";
            console.warn("Используем резервное локальное хранилище отметок комментариев:", error);
        }

        // Если раньше IndexedDB временно была недоступна, объединяем резервные
        // записи с основной базой и переносим их обратно, когда это возможно.
        const localRecords = readLocalFallbackMarks();
        const combined = new Map();
        for (const record of [...(Array.isArray(records) ? records : []), ...localRecords]) {
            if (!record?.key) continue;
            const previous = combined.get(String(record.key));
            if (!previous || Number(record.readAt || 0) > Number(previous.readAt || 0)) {
                combined.set(String(record.key), record);
            }
        }

        const now = Date.now();
        const expired = [];
        for (const [key, record] of combined) {
            const readAt = Number(record.readAt || 0);
            if (!readAt || now - readAt >= READ_MARK_TTL_MS) {
                expired.push(key);
                continue;
            }
            readMarks.set(key, { ...record, key, readAt });
        }

        readStateLoaded = true;

        if (expired.length) await deleteExpiredReadMarks(expired);

        if (readStateMode === "indexeddb" && localRecords.length) {
            try {
                const db = await openReadMarkDb();
                const tx = db.transaction(READ_MARK_STORE, "readwrite");
                const store = tx.objectStore(READ_MARK_STORE);
                for (const record of localRecords) {
                    if (readMarks.has(String(record.key))) store.put(readMarks.get(String(record.key)));
                }
                await new Promise((resolve, reject) => {
                    tx.oncomplete = resolve;
                    tx.onerror = () => reject(tx.error || new Error("Не удалось перенести резервные отметки."));
                    tx.onabort = () => reject(tx.error || new Error("Перенос резервных отметок отменён."));
                });
                for (const record of localRecords) removeLocalFallbackMark(String(record.key));
            } catch (error) {
                console.warn("Не удалось перенести резервные отметки в IndexedDB:", error);
            }
        }
    })().finally(() => {
        readStatePromise = null;
    });

    return readStatePromise;
}

async function pruneReadMarksIfNeeded() {
    const now = Date.now();
    const expired = [];
    for (const [key, record] of readMarks) {
        if (!Number(record?.readAt || 0) || now - Number(record.readAt) >= READ_MARK_TTL_MS) {
            expired.push(key);
        }
    }
    if (expired.length) await deleteExpiredReadMarks(expired);
}

function currentOwnerId() {
    try {
        return Number(getOwnerId() || 0);
    } catch {
        return 0;
    }
}

function currentUserId() {
    return Number(state.currentUser?.id || 0);
}

async function withTimeout(promise, ms, label) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: превышено время ожидания`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function parseManagerIds(response) {
    const items = Array.isArray(response?.items) ? response.items : [];
    const ids = [];
    for (const item of items) {
        const rawId = typeof item === "number" || typeof item === "string"
            ? Number(item)
            : Number(item?.user_id ?? item?.id ?? item?.uid ?? 0);
        if (Number.isInteger(rawId) && rawId > 0) ids.push(rawId);
    }
    return { ids, count: Number(response?.count || items.length), itemCount: items.length };
}

async function loadCommunityManagerIds(ownerId) {
    const fallback = new Set([currentUserId()].filter(id => id > 0));
    if (ownerId >= 0) {
        if (ownerId > 0) fallback.add(ownerId);
        return { ids: fallback, failed: false, loadedAt: Date.now() };
    }

    const groupId = Math.abs(ownerId);
    fallback.add(currentUserId());
    const cached = managerCache.get(ownerId);
    if (cached && (!cached.failed || Date.now() - cached.loadedAt < MANAGER_FAILURE_RETRY_MS)) {
        return cached;
    }

    if (managerRequests.has(ownerId)) return managerRequests.get(ownerId);

    const request = (async () => {
        const ids = new Set([...fallback].filter(id => id > 0));
        let offset = 0;
        let receivedManagerIds = false;
        try {
            while (true) {
                const response = await withTimeout(vkApi("groups.getMembers", {
                    group_id: groupId,
                    filter: "managers",
                    count: MANAGER_PAGE_SIZE,
                    offset
                }), MANAGER_REQUEST_TIMEOUT_MS, "groups.getMembers");

                const parsed = parseManagerIds(response);
                if (parsed.ids.length) receivedManagerIds = true;
                for (const id of parsed.ids) ids.add(id);

                if (!parsed.itemCount || parsed.itemCount < MANAGER_PAGE_SIZE) break;
                offset += parsed.itemCount;
                if (parsed.count > 0 && offset >= parsed.count) break;
                // Защита от неожиданного ответа API, который повторяет одну страницу.
                if (offset > 10000) break;
            }

            if (!receivedManagerIds) {
                throw new Error("VK не вернул идентификаторы руководителей сообщества.");
            }

            const result = { ids, failed: false, loadedAt: Date.now() };
            managerCache.set(ownerId, result);
            return result;
        } catch (error) {
            console.warn("Не удалось получить список руководителей сообщества для статусов комментариев:", error);
            const result = { ids, failed: true, loadedAt: Date.now() };
            managerCache.set(ownerId, result);
            return result;
        }
    })().finally(() => managerRequests.delete(ownerId));

    managerRequests.set(ownerId, request);
    return request;
}

export async function initializeCommentReadState() {
    await loadReadMarksOnce();
    await pruneReadMarksIfNeeded();
}

export async function prepareCommentStatus() {
    await initializeCommentReadState();

    const ownerId = currentOwnerId();
    if (!ownerId) return;
    await loadCommunityManagerIds(ownerId);
}

export function isCommentMarkedRead(ownerId, photoId, id) {
    const key = makeReadMarkKey(ownerId, photoId, id);
    if (!key) return false;

    const record = readMarks.get(key);
    if (!record) return false;

    if (Date.now() - Number(record.readAt || 0) >= READ_MARK_TTL_MS) {
        // Не удаляем запись из памяти здесь: плановая очистка должна увидеть
        // её и удалить также из IndexedDB, а не только перестать учитывать.
        return false;
    }
    return true;
}

export async function markCommentRead(ownerId, photoId, id) {
    await loadReadMarksOnce();
    await pruneReadMarksIfNeeded();

    const key = makeReadMarkKey(ownerId, photoId, id);
    if (!key) return false;

    const record = {
        key,
        owner_id: Number(ownerId),
        photo_id: Number(photoId),
        comment_id: Number(id),
        readAt: Date.now()
    };
    readMarks.set(key, record);
    return persistReadMark(record);
}

export function markUnansweredComments(items, options = {}) {
    const list = Array.isArray(items) ? items : [];
    const ownerId = Number(options.ownerId ?? currentOwnerId() ?? 0);
    const fallbackPhotoId = Number(options.photoId || 0);
    const managers = managerCache.get(ownerId)?.ids || new Set();
    const currentId = currentUserId();

    function isLeadership(comment) {
        const authorId = Number(comment?.from_id || 0);
        if (!authorId) return false;
        if (authorId === ownerId || authorId === currentId) return true;
        return authorId > 0 && managers.has(authorId);
    }

    // Снимаем плашку только тогда, когда руководитель ответил именно на ID
    // конкретного комментария. Ответ обычного участника статус не закрывает.
    const answeredByLeadership = new Set();
    for (const comment of list) {
        if (!isLeadership(comment)) continue;
        const parentId = directParentId(comment);
        if (parentId) answeredByLeadership.add(String(parentId));
    }

    const unansweredIds = new Set();
    for (const comment of list) {
        const id = commentId(comment);
        const photoId = commentPhotoId(comment) || fallbackPhotoId;
        const isManagerComment = isLeadership(comment);
        const isRead = id && isCommentMarkedRead(ownerId, photoId, id);
        const unanswered = Boolean(
            id && !isManagerComment && !isRead && !answeredByLeadership.has(String(id))
        );
        comment._unanswered = unanswered;
        comment._is_community_leader = isManagerComment;
        if (unanswered) unansweredIds.add(String(id));
    }

    return unansweredIds;
}
