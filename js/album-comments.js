import { dom } from "./dom.js?v=20260927-captiontop43";
import { state } from "./state.js?v=20260927-captiontop43";
import { vkApi } from "./vk-api.js?v=20260927-captiontop43";
import {
    escapeHtml,
    getPhotoPreviewUrl
} from "./helpers.js?v=20260927-captiontop43";
import {
    showCommentsScreen,
    pushCommentsHistory
} from "./navigation.js?v=20260927-captiontop43";
import { getOwnerId } from "./group-context.js?v=20260927-captiontop43";
import { cacheGet, cacheSet, invalidateCommentCaches } from "./cache.js?v=20260927-captiontop43";
import { CACHE_TTL } from "./config.js?v=20260927-captiontop43";
import { createPhotoComment, getPhotoCommentErrorText } from "./photo-comment-api.js?v=20260927-captiontop43";
import { openVkProfile, openVkTarget, openVkPhoto } from "./vk-links.js?v=20260927-captiontop43";
import { openPhotoViewer } from "./photo-viewer.js?v=20260927-captiontop43";
import { armLongPressReleaseGuard, consumeLongPressSyntheticClick } from "./long-press-guard.js?v=20260927-captiontop43";

const ALBUM_COMMENTS_DAYS = 3;
const PAGE_SIZE = 100;
const MAX_COMMENTS = 30;
const LONG_PRESS_MS = 900;
const MOVE_TOLERANCE = 15;
const READ_TIMEOUT_MS = 7000;
const PHOTO_LIST_TIMEOUT_MS = 10000;
const MUTATION_TIMEOUT_MS = 15000;
const DEEP_SCAN_CONCURRENCY = 6;
const CACHE_SCHEMA = 7;

let activeAlbum = null;
let replyEditor = null;
let commentMenuOverlay = null;
let loadSequence = 0;
let albumCommentsSessionActive = false;
let albumCommentsOpenSequence = 0;
let initialLoadTimer = null;
const sessionAuthors = new Map();

function commentsTitleElement() {
    return document.querySelector(".comments-title");
}

function cacheKey(album) {
    return `album-comments:v${CACHE_SCHEMA}:${getOwnerId()}:${album.id}:${ALBUM_COMMENTS_DAYS}d:${MAX_COMMENTS}`;
}

function cutoffTimestamp() {
    return Math.floor((Date.now() - ALBUM_COMMENTS_DAYS * 86400000) / 1000);
}

function commentPhotoId(comment) {
    const value = comment?.photo_id ?? comment?.pid;
    const id = Number(value);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function commentId(comment) {
    const id = Number(comment?.id || comment?.cid || 0);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function threadParentIds(comment) {
    const ids = new Set();

    const stored = Number(comment?._parent_comment_id || 0);
    if (stored > 0) ids.add(stored);

    const direct = Number(comment?.reply_to_comment || comment?.reply_to_comment_id || 0);
    if (direct > 0) ids.add(direct);

    const stack = Array.isArray(comment?.parents_stack) ? comment.parents_stack : [];
    for (const raw of stack) {
        const id = Number(raw || 0);
        if (id > 0) ids.add(id);
    }

    return [...ids];
}

function firstThreadParentId(comment) {
    const ids = threadParentIds(comment);
    return ids.length ? ids[ids.length - 1] : null;
}

function mentionedAuthorId(text) {
    // VK часто оставляет в тексте ответа кликабельное упоминание вида
    // [id123|Имя], даже если getAllComments не отдал parent id.
    const match = String(text || "").match(/^\s*\[((?:id|club|public))(\d+)\|[^\]]+\]/i);
    if (!match) return null;

    const id = Number(match[2] || 0);
    if (!id) return null;
    return match[1].toLowerCase() === "id" ? id : -Math.abs(id);
}

function decorateCommentThreads(items) {
    const result = (Array.isArray(items) ? items : []).map(comment => ({ ...comment }));
    const byPhoto = new Map();

    for (const comment of result) {
        const photoKey = String(commentPhotoId(comment) || 0);
        if (!byPhoto.has(photoKey)) byPhoto.set(photoKey, []);
        byPhoto.get(photoKey).push(comment);
    }

    for (const group of byPhoto.values()) {
        group.sort((a, b) => Number(b?.date || 0) - Number(a?.date || 0));

        // Сначала определяем, что является ответом. Если VK дал явный parent —
        // используем его. Если нет, аккуратно восстанавливаем ветку по первому
        // VK-упоминанию и ближайшему более старому комментарию этого автора.
        for (let i = 0; i < group.length; i += 1) {
            const comment = group[i];
            let parentId = firstThreadParentId(comment);

            if (!parentId) {
                const targetAuthorId = mentionedAuthorId(comment?.text);
                if (targetAuthorId) {
                    for (let j = i + 1; j < group.length; j += 1) {
                        const candidate = group[j];
                        if (Number(candidate?.from_id || 0) !== targetAuthorId) continue;
                        const candidateId = commentId(candidate);
                        if (!candidateId) continue;
                        parentId = candidateId;
                        break;
                    }
                }
            }

            comment._parent_comment_id = parentId || null;
            comment._is_reply = Boolean(parentId);
        }

        // Собираем все comment_id, на которые уже есть ответ. parents_stack
        // учитываем полностью, чтобы корень ветки тоже считался отвеченным.
        const answered = new Set();
        for (const comment of group) {
            for (const id of threadParentIds(comment)) answered.add(String(id));
            if (comment._parent_comment_id) answered.add(String(comment._parent_comment_id));
        }

        const currentUserId = Number(state.currentUser?.id || 0);
        const communityOwnerId = Number(getOwnerId() || 0);

        for (const comment of group) {
            const id = commentId(comment);
            const authorId = Number(comment?.from_id || 0);
            const ownComment = Boolean(
                (currentUserId && authorId === currentUserId) ||
                (communityOwnerId && authorId === communityOwnerId)
            );

            comment._unanswered = Boolean(
                !comment._is_reply &&
                id &&
                !ownComment &&
                !answered.has(String(id))
            );
        }
    }

    return result.sort((a, b) => Number(b?.date || 0) - Number(a?.date || 0));
}

function normalizeGroupsResponse(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.groups)) return response.groups;
    if (Array.isArray(response?.items)) return response.items;
    return [];
}

function formatDate(ts) {
    if (!ts) return "";
    return new Date(Number(ts) * 1000).toLocaleString("ru-RU");
}

function getAuthorLinkById(id) {
    if (id > 0) return `https://vk.com/id${id}`;
    if (id < 0) return `https://vk.com/club${Math.abs(id)}`;
    return "https://vk.com";
}

function describeError(error) {
    if (!error) return "Неизвестная ошибка";
    if (typeof error === "string") return error;

    const candidates = [
        error.message,
        error.error_msg,
        error.error?.error_msg,
        error.error_data?.error_msg,
        error.error_data?.error_reason,
        error.data?.error_msg,
        error.data?.message
    ];

    for (const value of candidates) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }

    try {
        return JSON.stringify(error);
    } catch (_) {
        return String(error);
    }
}

function withTimeout(promise, ms, label) {
    let timer = null;

    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`${label}: превышено время ожидания (${Math.round(ms / 1000)} с)`));
        }, ms);
    });

    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function apiRead(method, params, timeout = READ_TIMEOUT_MS) {
    return withTimeout(vkApi(method, params), timeout, method);
}

function apiMutation(method, params) {
    // Мутации не повторяем автоматически: один клик = один запрос.
    return withTimeout(vkApi(method, params), MUTATION_TIMEOUT_MS, method);
}


function updateCommentsTitle(album) {
    const title = commentsTitleElement();
    if (title) title.textContent = `Комментарии: ${album?.title || "Альбом"}`;
    dom.pageTitle.textContent = "Комментарии альбома";
}

async function loadRecentRawCommentsFast(album) {
    const ownerId = getOwnerId();
    const cutoff = cutoffTimestamp();

    // Для последних 30 комментариев достаточно первой страницы из 100:
    // getAllComments отсортирован от новых к старым.
    const result = await apiRead("photos.getAllComments", {
        owner_id: ownerId,
        album_id: Number(album.id),
        count: PAGE_SIZE,
        offset: 0
    }, READ_TIMEOUT_MS);

    const items = Array.isArray(result?.items) ? result.items : [];

    return items
        .filter(comment => Number(comment?.date || 0) >= cutoffTimestamp())
        .sort((a, b) => Number(b.date || 0) - Number(a.date || 0))
        .slice(0, MAX_COMMENTS);
}

async function loadAlbumPhotosWithCommentCounts(album) {
    const ownerId = getOwnerId();
    const all = [];
    let offset = 0;
    const count = 1000;

    while (true) {
        const result = await apiRead("photos.get", {
            owner_id: ownerId,
            album_id: Number(album.id),
            photo_sizes: 1,
            extended: 1,
            count,
            offset
        }, PHOTO_LIST_TIMEOUT_MS);

        const items = Array.isArray(result?.items) ? result.items : [];
        if (!items.length) break;

        all.push(...items);
        offset += items.length;

        if (items.length < count) break;
    }

    return all;
}

function commentKey(comment) {
    return `${commentPhotoId(comment) || 0}:${commentId(comment) || 0}`;
}

function mergeRecentComments(...lists) {
    const cutoff = cutoffTimestamp();
    const map = new Map();

    for (const list of lists) {
        for (const comment of Array.isArray(list) ? list : []) {
            if (Number(comment?.date || 0) < cutoff) continue;
            map.set(commentKey(comment), comment);
        }
    }

    return [...map.values()]
        .sort((a, b) => Number(b.date || 0) - Number(a.date || 0))
        .slice(0, MAX_COMMENTS);
}

function addProfilesToAuthors(authors, profiles = [], groups = []) {
    for (const user of Array.isArray(profiles) ? profiles : []) {
        const id = Number(user?.id || 0);
        if (!id) continue;
        authors.set(id, {
            id,
            name: `${user.first_name || ""} ${user.last_name || ""}`.trim() || `id${id}`,
            url: getAuthorLinkById(id),
            isGroup: false
        });
    }

    for (const group of Array.isArray(groups) ? groups : []) {
        const rawId = Number(group?.id || 0);
        if (!rawId) continue;
        const id = -Math.abs(rawId);
        authors.set(id, {
            id,
            name: group.name || `club${rawId}`,
            url: getAuthorLinkById(id),
            isGroup: true
        });
    }
}

function normalizePhotoComments(items, photoId) {
    const result = [];

    for (const comment of Array.isArray(items) ? items : []) {
        const normalized = {
            ...comment,
            photo_id: commentPhotoId(comment) || Number(photoId)
        };
        result.push(normalized);

        // Если VK вложил часть ответов в thread.items, тоже учитываем их.
        const threadItems = Array.isArray(comment?.thread?.items)
            ? comment.thread.items
            : [];

        const rootId = commentId(normalized);
        for (const reply of threadItems) {
            result.push({
                ...reply,
                photo_id: commentPhotoId(reply) || Number(photoId),
                _parent_comment_id: firstThreadParentId(reply) || rootId || null,
                _is_reply: true
            });
        }
    }

    return result;
}

async function deepScanAlbumComments(album, baseData, seq, key) {
    let photos;

    try {
        photos = await loadAlbumPhotosWithCommentCounts(album);
    } catch (error) {
        console.warn("Не удалось получить список фотографий для полной проверки комментариев:", error);
        return baseData;
    }

    if (!currentRequestIsValid(seq, album)) return baseData;

    const photosMap = new Map(baseData.photos);
    for (const photo of photos) {
        if (photo?.id) photosMap.set(String(photo.id), photo);
    }

    let comments = mergeRecentComments(baseData.comments);
    const authors = new Map(baseData.authors);

    // Уже на этом этапе обновляем карточки — поэтому миниатюры появляются
    // независимо от photos.getById.
    let current = { comments, photos: photosMap, authors, complete: false };
    if (comments.length) renderComments(album, current);

    const candidates = photos.filter(photo => Number(photo?.comments?.count || 0) > 0);

    if (!candidates.length) {
        current.complete = true;
        cacheSet(key, serializeForCache(current));
        if (currentRequestIsValid(seq, album)) renderComments(album, current);
        return current;
    }

    let nextIndex = 0;
    let finished = 0;

    async function worker() {
        while (true) {
            if (!currentRequestIsValid(seq, album)) return;

            const index = nextIndex++;
            if (index >= candidates.length) return;

            const photo = candidates[index];

            try {
                const response = await apiRead("photos.getComments", {
                    owner_id: getOwnerId(),
                    photo_id: Number(photo.id),
                    count: MAX_COMMENTS,
                    offset: 0,
                    sort: "desc",
                    extended: 1
                }, READ_TIMEOUT_MS);

                if (!currentRequestIsValid(seq, album)) return;

                const found = normalizePhotoComments(response?.items, photo.id)
                    .filter(comment => Number(comment?.date || 0) >= cutoffTimestamp());

                comments = mergeRecentComments(comments, found);
                addProfilesToAuthors(authors, response?.profiles, response?.groups);
            } catch (error) {
                console.warn(`Комментарии фото ${photo?.id}:`, error);
            } finally {
                finished += 1;

                if (currentRequestIsValid(seq, album)) {
                    current = {
                        comments,
                        photos: photosMap,
                        authors,
                        complete: false
                    };

                    // Перерисовываем при найденных комментариях и периодически
                    // во время долгой проверки большого альбома.
                    if (comments.length && !replyEditor && !commentMenuOverlay) {
                        renderComments(album, current);
                    }
                }
            }
        }
    }

    await Promise.all(
        Array.from(
            { length: Math.min(DEEP_SCAN_CONCURRENCY, candidates.length) },
            () => worker()
        )
    );

    if (!currentRequestIsValid(seq, album)) return current;

    current = {
        comments: mergeRecentComments(comments),
        photos: photosMap,
        authors,
        complete: true
    };

    // Если часть авторов пришла только из быстрого getAllComments,
    // добираем их одним компактным запросом.
    try {
        const extraAuthors = await loadAuthors(current.comments);
        for (const [id, author] of extraAuthors) {
            if (!current.authors.has(id)) current.authors.set(id, author);
        }
    } catch (error) {
        console.warn("Не удалось дополнить имена авторов:", error);
    }

    if (currentRequestIsValid(seq, album)) {
        cacheSet(key, serializeForCache(current));
        if (!replyEditor && !commentMenuOverlay) {
            renderComments(album, current);
        }
    }

    return current;
}

function photosFromCurrentState(comments) {
    const wanted = new Set(comments.map(commentPhotoId).filter(Boolean).map(String));
    const map = new Map();

    for (const photo of Array.isArray(state.photos) ? state.photos : []) {
        if (wanted.has(String(photo?.id))) {
            map.set(String(photo.id), photo);
        }
    }

    return map;
}

async function loadPhotosForComments(comments, existing = new Map()) {
    const ownerId = getOwnerId();
    const map = new Map(existing);

    for (const [id, photo] of photosFromCurrentState(comments)) {
        if (!map.has(id)) map.set(id, photo);
    }

    const ids = [...new Set(comments.map(commentPhotoId).filter(Boolean))]
        .filter(id => !map.has(String(id)));

    for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        if (!chunk.length) continue;

        const photosParam = chunk.map(id => `${ownerId}_${id}`).join(",");

        try {
            const photos = await apiRead("photos.getById", {
                photos: photosParam,
                photo_sizes: 1,
                extended: 1
            });

            for (const photo of Array.isArray(photos) ? photos : []) {
                map.set(String(photo.id), photo);
            }
        } catch (error) {
            console.warn("Не удалось получить превью фотографий комментариев:", error);
        }
    }

    return map;
}

async function loadAuthors(comments) {
    const allUserIds = [...new Set(
        comments
            .map(item => Number(item?.from_id || 0))
            .filter(id => id > 0)
    )];

    const allGroupIds = [...new Set(
        comments
            .map(item => Number(item?.from_id || 0))
            .filter(id => id < 0)
            .map(id => Math.abs(id))
    )];

    const authors = new Map();

    // Имена авторов не являются складскими данными и не требуют повторной
    // загрузки при каждом открытии комментариев. Держим их только в памяти
    // текущего запуска приложения; сами комментарии по-прежнему читаются
    // свежими с VK при каждом открытии экрана.
    for (const id of allUserIds) {
        if (sessionAuthors.has(id)) authors.set(id, sessionAuthors.get(id));
    }
    for (const rawId of allGroupIds) {
        const id = -Math.abs(rawId);
        if (sessionAuthors.has(id)) authors.set(id, sessionAuthors.get(id));
    }

    const userIds = allUserIds.filter(id => !authors.has(id));
    const groupIds = allGroupIds.filter(rawId => !authors.has(-Math.abs(rawId)));

    if (userIds.length) {
        try {
            const users = await apiRead("users.get", {
                user_ids: userIds.join(",")
            });

            for (const user of Array.isArray(users) ? users : []) {
                const id = Number(user.id);
                const name = `${user.first_name || ""} ${user.last_name || ""}`.trim() || `id${id}`;
                const author = {
                    id,
                    name,
                    url: getAuthorLinkById(id),
                    isGroup: false
                };
                authors.set(id, author);
                sessionAuthors.set(id, author);
            }
        } catch (error) {
            console.warn("Не удалось получить имена авторов комментариев:", error);
        }
    }

    if (groupIds.length) {
        try {
            const response = await apiRead("groups.getById", {
                group_ids: groupIds.join(",")
            });

            for (const group of normalizeGroupsResponse(response)) {
                const id = -Math.abs(Number(group.id));
                const author = {
                    id,
                    name: group.name || `club${group.id}`,
                    url: getAuthorLinkById(id),
                    isGroup: true
                };
                authors.set(id, author);
                sessionAuthors.set(id, author);
            }
        } catch (error) {
            console.warn("Не удалось получить названия сообществ-авторов:", error);
        }
    }

    return authors;
}

function authorInfo(comment, authors) {
    const id = Number(comment?.from_id || 0);
    if (authors.has(id)) return authors.get(id);

    return {
        id,
        name: id > 0 ? `Пользователь ${id}` : id < 0 ? `Сообщество ${Math.abs(id)}` : "Пользователь",
        url: getAuthorLinkById(id),
        isGroup: id < 0
    };
}

function serializeForCache(data) {
    return {
        comments: data.comments,
        photos: [...data.photos.entries()],
        authors: [...data.authors.entries()],
        complete: Boolean(data.complete)
    };
}

function restoreFromCache(data) {
    return {
        comments: Array.isArray(data?.comments) ? data.comments : [],
        photos: new Map(Array.isArray(data?.photos) ? data.photos : []),
        authors: new Map(Array.isArray(data?.authors) ? data.authors : []),
        complete: Boolean(data?.complete)
    };
}

function clearReplyEditor() {
    if (replyEditor?.container?.remove) replyEditor.container.remove();
    replyEditor = null;
}

function closeCommentMenu() {
    if (commentMenuOverlay?.remove) commentMenuOverlay.remove();
    commentMenuOverlay = null;
}

async function copyText(text) {
    const value = String(text || "").trim();
    if (!value) return;

    try {
        await navigator.clipboard.writeText(value);
        return;
    } catch (_) {
        const input = document.createElement("textarea");
        input.value = value;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.focus();
        input.select();
        document.execCommand("copy");
        input.remove();
    }
}

function userCanEditComment(comment) {
    if (Number(comment?.can_edit || 0) === 1 || comment?.can_edit === true) return true;
    const currentId = Number(state.currentUser?.id || 0);
    return currentId > 0 && Number(comment?.from_id || 0) === currentId;
}

function appendRichCommentText(container, text) {
    const raw = String(text || "");
    if (!raw) {
        container.textContent = "(без текста)";
        return;
    }

    const re = /\[((?:id|club|public)\d+)\|([^\]]+)\]/g;
    let lastIndex = 0;
    let match;

    while ((match = re.exec(raw)) !== null) {
        const [full, target, label] = match;

        if (match.index > lastIndex) {
            container.appendChild(document.createTextNode(raw.slice(lastIndex, match.index)));
        }

        const link = document.createElement("button");
        link.type = "button";
        link.className = "comment-inline-link";
        link.textContent = label;
        link.addEventListener("click", event => {
            event.stopPropagation();
            openVkTarget(target);
        });
        container.appendChild(link);

        lastIndex = match.index + full.length;
    }

    if (lastIndex < raw.length) {
        container.appendChild(document.createTextNode(raw.slice(lastIndex)));
    }
}

function showInlineError(errorBox, error, prefix = "") {
    const message = describeError(error);
    errorBox.textContent = prefix ? `${prefix}: ${message}` : message;
    errorBox.classList.remove("hidden");
    console.error(prefix || "Ошибка комментария", error);
}

function createReplyEditor(card, body, comment, mode = "reply", { photo = null, author = null } = {}) {
    clearReplyEditor();

    const container = document.createElement("div");
    container.className = "comment-reply-box";

    if (mode === "reply") {
        const target = document.createElement("div");
        target.className = "comment-reply-target";

        const prefix = document.createElement("span");
        prefix.textContent = "Ответ для ";

        const link = document.createElement("button");
        link.type = "button";
        link.className = "comment-reply-target-link";
        link.textContent = author?.name || "пользователя";
        if (author?.id) {
            link.addEventListener("click", event => {
                event.stopPropagation();
                openVkProfile(author.id);
            });
        }

        target.append(prefix, link);
        container.appendChild(target);
    }

    const textarea = document.createElement("textarea");
    textarea.className = "comment-reply-input";
    textarea.placeholder = mode === "reply" ? "Ответ на комментарий..." : "Изменить комментарий...";
    textarea.value = mode === "edit" ? String(comment?.text || "") : "";

    const actions = document.createElement("div");
    actions.className = "comment-reply-actions";

    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "secondary-button";
    cancel.textContent = "Отмена";
    cancel.addEventListener("click", () => clearReplyEditor());

    const submit = document.createElement("button");
    submit.type = "button";
    submit.className = "primary-button";
    submit.textContent = mode === "reply" ? "Ответить" : "Сохранить";

    const error = document.createElement("div");
    error.className = "form-error comment-reply-error hidden";

    submit.addEventListener("click", async () => {
        const message = textarea.value.trim();
        if (!message) {
            error.textContent = "Введите текст комментария.";
            error.classList.remove("hidden");
            return;
        }

        const photoId = commentPhotoId(comment);
        const id = commentId(comment);

        if (!photoId || !id) {
            error.textContent = "VK не вернул ID фотографии или комментария. Обновите список.";
            error.classList.remove("hidden");
            return;
        }

        submit.disabled = true;
        cancel.disabled = true;
        error.classList.add("hidden");

        try {
            if (mode === "reply") {
                const replyPhoto = photo || {
                    id: photoId,
                    owner_id: getOwnerId()
                };

                await createPhotoComment({
                    photo: replyPhoto,
                    album: activeAlbum,
                    message,
                    replyToComment: id
                });
            } else {
                await apiMutation("photos.editComment", {
                    owner_id: getOwnerId(),
                    comment_id: id,
                    message
                });
            }

            clearReplyEditor();
            invalidateCommentCaches(getOwnerId(), { photoId });

            // Ошибка повторной загрузки не должна выглядеть как ошибка отправки.
            if (activeAlbum) {
                void loadAlbumComments(activeAlbum, { force: true }).catch(refreshError => {
                    console.warn("Комментарий отправлен, но список не обновился:", refreshError);
                });
            }
        } catch (apiError) {
            if (mode === "reply") {
                error.textContent = getPhotoCommentErrorText(apiError, {
                    photo: photo || { id: photoId, owner_id: getOwnerId() },
                    album: activeAlbum,
                    replyToComment: id
                });
                error.classList.remove("hidden");
                console.error("Не удалось отправить ответ:", apiError);
            } else {
                showInlineError(error, apiError, "Не удалось сохранить");
            }
        } finally {
            submit.disabled = false;
            cancel.disabled = false;
        }
    });

    actions.append(cancel, submit);
    container.append(textarea, error, actions);
    body.appendChild(container);

    textarea.focus();
    textarea.selectionStart = textarea.value.length;
    textarea.selectionEnd = textarea.value.length;

    replyEditor = { container, card, commentId: commentId(comment), mode };
}

async function deleteComment(comment) {
    const id = commentId(comment);
    if (!id) return;

    if (!window.confirm("Удалить этот комментарий?")) return;

    try {
        await apiMutation("photos.deleteComment", {
            owner_id: getOwnerId(),
            comment_id: id
        });

        invalidateCommentCaches(getOwnerId(), {
            photoId: commentPhotoId(comment) || 0
        });

        if (activeAlbum) {
            void loadAlbumComments(activeAlbum, { force: true });
        }
    } catch (error) {
        alert(`Не удалось удалить комментарий.\n\n${describeError(error)}`);
    }
}

function createMenuButton(label, onClick, { dangerous = false } = {}) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `context-menu-button${dangerous ? " context-menu-button-danger" : ""}`;
    btn.textContent = label;
    btn.addEventListener("click", async event => {
        event.stopPropagation();
        closeCommentMenu();
        await onClick();
    });
    return btn;
}

function openCommentMenu({ card, body, comment }) {
    closeCommentMenu();

    const overlay = document.createElement("div");
    overlay.className = "context-menu-overlay";

    const menu = document.createElement("div");
    menu.className = "context-menu-sheet";

    menu.appendChild(createMenuButton("Копировать", async () => {
        await copyText(comment?.text || "");
    }));

    if (userCanEditComment(comment)) {
        menu.appendChild(createMenuButton("Редактировать", async () => {
            createReplyEditor(card, body, comment, "edit");
        }));
    }

    menu.appendChild(createMenuButton("Удалить", async () => {
        await deleteComment(comment);
    }, { dangerous: true }));

    const cancel = createMenuButton("Отмена", async () => {});
    cancel.classList.add("context-menu-button-cancel");
    menu.appendChild(cancel);

    overlay.appendChild(menu);
    overlay.addEventListener("click", event => {
        if (consumeLongPressSyntheticClick(event)) return;
        if (event.target === overlay) closeCommentMenu();
    }, true);

    document.body.appendChild(overlay);
    commentMenuOverlay = overlay;
}

function installLongPress(card, handler) {
    let timer = null;
    let startX = 0;
    let startY = 0;
    let longPressed = false;

    const clear = () => {
        if (timer) clearTimeout(timer);
        timer = null;
    };

    const onPointerDown = event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        longPressed = false;
        startX = event.clientX;
        startY = event.clientY;
        clear();
        timer = setTimeout(() => {
            longPressed = true;
            armLongPressReleaseGuard(event.pointerId);
            handler(event);
        }, LONG_PRESS_MS);
    };

    const onPointerMove = event => {
        if (!timer) return;
        const dx = Math.abs(event.clientX - startX);
        const dy = Math.abs(event.clientY - startY);
        if (dx > MOVE_TOLERANCE || dy > MOVE_TOLERANCE) clear();
    };

    card.addEventListener("pointerdown", onPointerDown, { passive: true });
    card.addEventListener("pointermove", onPointerMove, { passive: true });
    card.addEventListener("pointerup", clear, { passive: true });
    card.addEventListener("pointercancel", clear, { passive: true });
    card.addEventListener("contextmenu", event => {
        event.preventDefault();
        handler(event);
    });

    return () => longPressed;
}

function createCommentCard(comment, data) {
    const card = document.createElement("div");
    card.className = "comment-card comment-card-rich";
    if (comment?._is_reply) card.classList.add("comment-thread-reply");
    if (comment?._unanswered) card.classList.add("comment-unanswered");

    const photoId = commentPhotoId(comment);
    const photo = photoId ? data.photos.get(String(photoId)) : null;
    const photoUrl = getPhotoPreviewUrl(photo, 200);
    const author = authorInfo(comment, data.authors);

    const thumbWrap = document.createElement("button");
    thumbWrap.type = "button";
    thumbWrap.className = "comment-thumb-button";

    if (photoUrl) {
        const img = document.createElement("img");
        img.className = "comment-photo";
        img.src = photoUrl;
        img.alt = "";
        img.loading = "lazy";
        thumbWrap.appendChild(img);
    } else {
        const ph = document.createElement("div");
        ph.className = "comment-photo comment-photo-placeholder";
        ph.textContent = "🖼";
        thumbWrap.appendChild(ph);
    }

    thumbWrap.addEventListener("click", event => {
        event.stopPropagation();
        if (!photoId) return;

        const targetPhoto = photo || {
            id: photoId,
            owner_id: getOwnerId(),
            album_id: Number(activeAlbum?.id || 0)
        };

        void openPhotoViewer(targetPhoto, activeAlbum, { fromComments: true });
    });

    const body = document.createElement("div");
    body.className = "comment-body";

    const header = document.createElement("div");
    header.className = "comment-header";

    const authorBtn = document.createElement("button");
    authorBtn.type = "button";
    authorBtn.className = "comment-author-link";
    authorBtn.textContent = author.name;
    authorBtn.addEventListener("click", event => {
        event.stopPropagation();
        openVkProfile(author.id);
    });

    header.appendChild(authorBtn);

    const text = document.createElement("div");
    text.className = "comment-text";
    appendRichCommentText(text, comment.text || "");

    const meta = document.createElement("div");
    meta.className = "comment-meta-row";

    const date = document.createElement("div");
    date.className = "comment-date";
    date.textContent = formatDate(comment.date);

    const reply = document.createElement("button");
    reply.type = "button";
    reply.className = "comment-reply-link";
    reply.textContent = "Ответить";
    reply.addEventListener("click", event => {
        event.stopPropagation();

        const targetPhoto = photo || {
            id: photoId,
            owner_id: getOwnerId(),
            album_id: Number(activeAlbum?.id || 0)
        };

        // Сбрасываем комментарии ДО ухода в VK. Если WebView будет выгружен,
        // приложение не сможет получить vk-native-return, но старый кэш уже
        // не будет показан при следующем запуске.
        invalidateCommentCaches(getOwnerId(), { photoId: Number(targetPhoto.id || 0) });

        // photos.createComment из Mini App блокируется VK для non-standalone
        // приложений. Поэтому "Ответить" открывает эту фотографию в
        // нативном VK, где ответ можно отправить штатным интерфейсом VK.
        openVkPhoto(targetPhoto, getOwnerId());
    });

    meta.append(date, reply);
    body.append(header, text, meta);

    const wasLongPress = installLongPress(card, () => {
        openCommentMenu({ card, body, comment });
    });

    card.addEventListener("click", event => {
        if (wasLongPress()) {
            event.preventDefault();
            event.stopPropagation();
        }
    });

    card.append(thumbWrap, body);
    return card;
}

function renderComments(album, data) {
    dom.comments.innerHTML = "";
    clearReplyEditor();
    closeCommentMenu();

    if (!data.comments.length) {
        dom.comments.innerHTML = `
            <div class="status-message">
                Комментариев за последние ${ALBUM_COMMENTS_DAYS} дня нет
            </div>
        `;
        return;
    }

    const decoratedComments = decorateCommentThreads(data.comments);
    for (const comment of decoratedComments) {
        dom.comments.appendChild(createCommentCard(comment, data));
    }
}

function currentRequestIsValid(seq, album) {
    return seq === loadSequence && activeAlbum && String(activeAlbum.id) === String(album.id);
}

async function enrichFastAuthors(album, data, seq, key) {
    try {
        const authors = await loadAuthors(data.comments);
        if (!currentRequestIsValid(seq, album)) return;

        const enriched = {
            ...data,
            authors,
            complete: false
        };
        cacheSet(key, serializeForCache(enriched));
        renderComments(album, enriched);
    } catch (error) {
        console.warn("Не удалось быстро получить имена авторов:", error);
    }
}

export async function loadAlbumComments(album, { force = false, silent = false } = {}) {
    if (!album) return;

    activeAlbum = album;
    updateCommentsTitle(album);

    const seq = ++loadSequence;
    const key = cacheKey(album);

    if (!force) {
        const cached = cacheGet(key, CACHE_TTL.comments);
        if (cached) {
            try {
                const restored = restoreFromCache(cached);
                renderComments(album, restored);
                if (restored.complete) return;
            } catch (error) {
                // Повреждённый/устаревший кэш не должен оставлять экран
                // в состоянии «Загрузка…». Просто идём за свежими данными.
                console.warn("Не удалось восстановить кэш комментариев альбома:", error);
            }
        }
    }

    // ВАЖНО: комментарии конкретного альбома получаем ОДНИМ методом
    // photos.getAllComments. VK сам возвращает их от новых к старым.
    // Мы НЕ перебираем фотографии альбома и НЕ вызываем getComments для каждой.
    if (!silent) {
        dom.comments.innerHTML = `
            <div class="status-message">
                Загружаем последние ${MAX_COMMENTS} комментариев за ${ALBUM_COMMENTS_DAYS} дня...
            </div>
        `;
    }

    try {
        const comments = await loadRecentRawCommentsFast(album);
        if (!currentRequestIsValid(seq, album)) return;

        if (!comments.length) {
            const emptyData = {
                comments: [],
                photos: new Map(),
                authors: new Map(),
                complete: true
            };
            cacheSet(key, serializeForCache(emptyData));
            renderComments(album, emptyData);
            return;
        }

        // Сами комментарии уже есть — показываем их сразу.
        // Фото и ФИО догружаются отдельными компактными запросами.
        let data = {
            comments,
            photos: photosFromCurrentState(comments),
            authors: new Map(),
            complete: false
        };

        renderComments(album, data);

        const [photos, authors] = await Promise.all([
            loadPhotosForComments(comments, data.photos),
            loadAuthors(comments)
        ]);

        if (!currentRequestIsValid(seq, album)) return;

        data = {
            comments,
            photos,
            authors,
            complete: true
        };

        cacheSet(key, serializeForCache(data));

        if (!replyEditor && !commentMenuOverlay) {
            renderComments(album, data);
        }
    } catch (error) {
        console.error("Не удалось загрузить комментарии альбома:", error);

        if (!currentRequestIsValid(seq, album)) return;

        if (activeAlbum && String(activeAlbum.id) === String(album.id) && state.currentScreen === "comments") {
            dom.comments.innerHTML = `
                <div class="error">
                    Не удалось загрузить комментарии альбома.<br><br>
                    ${escapeHtml(describeError(error))}
                    <br><br>Нажмите «Обновить», чтобы повторить.
                </div>
            `;
        }
    }
}

function openAlbumComments(album) {
    if (!album) return;

    const openSeq = ++albumCommentsOpenSequence;
    activeAlbum = album;
    albumCommentsSessionActive = true;

    if (initialLoadTimer !== null) {
        window.clearTimeout(initialLoadTimer);
        initialLoadTimer = null;
    }

    pushCommentsHistory();
    showCommentsScreen();
    updateCommentsTitle(album);

    dom.comments.innerHTML = `
        <div class="status-message">
            Загружаем последние ${MAX_COMMENTS} комментариев за ${ALBUM_COMMENTS_DAYS} дня...
        </div>
    `;

    // Контекстное меню альбома закрывается через history.back(). В Android
    // WebView VK следующий Bridge/API-вызов в тот же цикл иногда терялся.
    // Запускаем чтение отдельной задачей уже после завершения перехода.
    initialLoadTimer = window.setTimeout(() => {
        initialLoadTimer = null;

        const sameAlbum = activeAlbum && String(activeAlbum.id) === String(album.id);
        if (
            openSeq !== albumCommentsOpenSequence ||
            !albumCommentsSessionActive ||
            !sameAlbum ||
            state.currentScreen !== "comments"
        ) {
            return;
        }

        void loadAlbumComments(activeAlbum, { force: true });
    }, 0);
}

export function initAlbumComments() {
    window.addEventListener("album-menu-action", event => {
        if (event?.detail?.action !== "comments") return;
        const album = event.detail.album;
        if (!album) return;
        openAlbumComments(album);
    });

    dom.refreshComments.addEventListener("click", event => {
        if (!activeAlbum) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void loadAlbumComments(activeAlbum, { force: true });
    }, true);

    dom.commentsMenuButton.addEventListener("click", () => {
        albumCommentsSessionActive = false;
        activeAlbum = null;
        ++albumCommentsOpenSequence;
        ++loadSequence;
        if (initialLoadTimer !== null) {
            window.clearTimeout(initialLoadTimer);
            initialLoadTimer = null;
        }
        clearReplyEditor();
        closeCommentMenu();
        const title = commentsTitleElement();
        if (title) title.textContent = "Комментарии к фотографиям";
    }, true);

    dom.comments.addEventListener("click", () => {
        closeCommentMenu();
    });

    window.addEventListener("vk-native-return", event => {
        if (!activeAlbum || state.currentScreen !== "comments") return;
        if (event?.detail?.type !== "photo") return;

        const returnedAlbumId = Number(event.detail.albumId || 0);
        if (returnedAlbumId && returnedAlbumId !== Number(activeAlbum.id)) return;

        invalidateCommentCaches(getOwnerId(), {
            photoId: Number(event.detail.photoId || 0)
        });
        void loadAlbumComments(activeAlbum, { force: true, silent: true });
    });

    window.addEventListener("popstate", event => {
        if (!albumCommentsSessionActive) return;

        closeCommentMenu();
        clearReplyEditor();

        // popstate также используется overlay-history для закрытия меню
        // долгого нажатия. Решать, покинул ли пользователь комментарии,
        // прямо внутри этого события нельзя: следующий переход экрана может
        // быть продолжением `await closeSwipeOverlay()`.
        // Проверяем фактический экран уже в следующей задаче event loop.
        if (event?.state?.screen !== "comments") {
            const sessionSeq = albumCommentsOpenSequence;

            window.setTimeout(() => {
                if (!albumCommentsSessionActive) return;
                if (sessionSeq !== albumCommentsOpenSequence) return;

                // Если за время завершения popstate мы уже открыли экран
                // комментариев альбома, это было лишь закрытие оверлея.
                if (state.currentScreen === "comments" && activeAlbum) {
                    return;
                }

                albumCommentsSessionActive = false;
                ++albumCommentsOpenSequence;
                ++loadSequence;

                if (initialLoadTimer !== null) {
                    window.clearTimeout(initialLoadTimer);
                    initialLoadTimer = null;
                }
            }, 0);
            return;
        }

        if (!activeAlbum) return;
        window.setTimeout(() => {
            if (albumCommentsSessionActive && activeAlbum && state.currentScreen === "comments") {
                void loadAlbumComments(activeAlbum, { force: true, silent: true });
            }
        }, 0);
    });
}
