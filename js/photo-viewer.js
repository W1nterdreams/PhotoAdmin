import { armLongPressReleaseGuard, consumeLongPressSyntheticClick } from "./long-press-guard.js?v=20260927-captiontop43";
import { state } from "./state.js?v=20260927-captiontop43";
import { dom } from "./dom.js?v=20260927-captiontop43";
import { vkApi } from "./vk-api.js?v=20260927-captiontop43";
import { getBestPhotoUrl, getPhotoPreviewUrl, escapeHtml } from "./helpers.js?v=20260927-captiontop43";
import { getOwnerId } from "./group-context.js?v=20260927-captiontop43";
import {
    showPhotoViewerScreen,
    pushPhotoHistory,
    replacePhotoHistory
} from "./navigation.js?v=20260927-captiontop43";
import { photoCommentOwnerId } from "./photo-comment-api.js?v=20260927-captiontop43";
import { openVkProfile, openVkTarget, openVkPhoto } from "./vk-links.js?v=20260927-captiontop43";
import { invalidatePhotoActivityCaches } from "./cache.js?v=20260927-captiontop43";
import { openSwipeOverlay, closeSwipeOverlay } from "./overlay-history.js?v=20260927-captiontop43";

const COMMENT_PAGE_SIZE = 100;
const LONG_PRESS_MS = 900;
const MOVE_TOLERANCE = 15;

let initialized = false;
let activePhoto = null;
let activeAlbum = null;
let authors = new Map();
const sessionAuthors = new Map();
let comments = [];
let contextOverlay = null;
let contextOverlayKind = "";
const VIEWER_ALBUM_MENU_OVERLAY_ID = "photo-viewer-album-menu";
let viewerSequence = 0;
let imageLoadSequence = 0;
let pendingHighResPhotoId = "";
let pendingHighResUrl = "";
let lastOpenPerf = null;
let viewerPhotoSequence = [];
let viewerSequenceDataFresh = false;

function normalizeGroupsResponse(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.groups)) return response.groups;
    if (Array.isArray(response?.items)) return response.items;
    return [];
}

function authorInfo(comment) {
    const id = Number(comment?.from_id || 0);
    if (authors.has(id)) return authors.get(id);
    return {
        id,
        name: id > 0 ? `Пользователь ${id}` : id < 0 ? `Сообщество ${Math.abs(id)}` : "Пользователь"
    };
}

function formatDate(ts) {
    if (!ts) return "";
    return new Date(Number(ts) * 1000).toLocaleString("ru-RU");
}

function commentId(comment) {
    const id = Number(comment?.id || comment?.cid || 0);
    return Number.isFinite(id) && id > 0 ? id : null;
}

function commentKey(comment) {
    return String(commentId(comment) || `${comment?.from_id || 0}:${comment?.date || 0}:${comment?.text || ""}`);
}

function parentCommentId(comment) {
    const stack = Array.isArray(comment?.parents_stack) ? comment.parents_stack : [];
    const fromStack = Number(stack[stack.length - 1] || 0);
    if (fromStack > 0) return fromStack;

    const direct = Number(comment?.reply_to_comment || comment?.reply_to_comment_id || 0);
    return direct > 0 ? direct : null;
}

function normalizeCommentForThread(comment, forcedParentId = null) {
    const parentId = Number(forcedParentId || parentCommentId(comment) || 0) || null;
    return {
        ...comment,
        _is_reply: Boolean(parentId),
        _parent_comment_id: parentId
    };
}

function flattenComments(items) {
    const map = new Map();

    for (const item of Array.isArray(items) ? items : []) {
        const root = normalizeCommentForThread(item);
        map.set(commentKey(root), root);

        const rootId = commentId(item);
        const threadItems = Array.isArray(item?.thread?.items) ? item.thread.items : [];
        for (const reply of threadItems) {
            const normalizedReply = normalizeCommentForThread(reply, parentCommentId(reply) || rootId);
            map.set(commentKey(normalizedReply), normalizedReply);
        }
    }

    return [...map.values()].sort((a, b) => Number(a.date || 0) - Number(b.date || 0));
}

function addAuthors(profiles = [], groups = []) {
    for (const user of Array.isArray(profiles) ? profiles : []) {
        const id = Number(user?.id || 0);
        if (!id) continue;
        const author = {
            id,
            name: `${user.first_name || ""} ${user.last_name || ""}`.trim() || `id${id}`
        };
        authors.set(id, author);
        sessionAuthors.set(id, author);
    }

    for (const group of Array.isArray(groups) ? groups : []) {
        const raw = Number(group?.id || 0);
        if (!raw) continue;
        const id = -Math.abs(raw);
        const author = {
            id,
            name: group.name || `club${raw}`
        };
        authors.set(id, author);
        sessionAuthors.set(id, author);
    }
}

async function loadMissingAuthors(items) {
    const userIds = [...new Set(
        items.map(x => Number(x?.from_id || 0)).filter(id => id > 0 && !authors.has(id))
    )];
    const groupIds = [...new Set(
        items.map(x => Number(x?.from_id || 0)).filter(id => id < 0 && !authors.has(id)).map(Math.abs)
    )];

    if (userIds.length) {
        try {
            const users = await vkApi("users.get", { user_ids: userIds.join(",") });
            addAuthors(users, []);
        } catch (error) {
            console.warn("Не удалось загрузить имена пользователей фото:", error);
        }
    }

    if (groupIds.length) {
        try {
            const groups = normalizeGroupsResponse(await vkApi("groups.getById", {
                group_ids: groupIds.join(",")
            }));
            addAuthors([], groups);
        } catch (error) {
            console.warn("Не удалось загрузить сообщества-авторы фото:", error);
        }
    }
}

async function fetchPhoto(photo) {
    const ownerId = Number(photo?.owner_id || getOwnerId());
    const photoId = Number(photo?.id || 0);
    if (!photoId) throw new Error("Неизвестен ID фотографии.");

    const result = await vkApi("photos.getById", {
        photos: `${ownerId}_${photoId}`,
        extended: 1,
        photo_sizes: 1
    });

    return Array.isArray(result) && result[0] ? result[0] : photo;
}

async function fetchAllComments(photo) {
    const ownerId = photoCommentOwnerId(photo);
    const photoId = Number(photo.id);
    const collected = [];
    authors = new Map(sessionAuthors);
    let offset = 0;
    let reportedCount = 0;

    while (true) {
        const result = await vkApi("photos.getComments", {
            owner_id: ownerId,
            photo_id: photoId,
            need_likes: 1,
            offset,
            count: COMMENT_PAGE_SIZE,
            sort: "desc",
            extended: 1,
            ...(photo.access_key ? { access_key: String(photo.access_key) } : {})
        });

        const items = Array.isArray(result?.items) ? result.items : [];
        const apiCount = Number(result?.count || 0);
        if (Number.isFinite(apiCount)) reportedCount = Math.max(reportedCount, apiCount);
        collected.push(...items);
        addAuthors(result?.profiles, result?.groups);

        if (!items.length || items.length < COMMENT_PAGE_SIZE) break;
        offset += items.length;
    }

    comments = flattenComments(collected);
    await loadMissingAuthors(comments);

    if (activePhoto && Number(activePhoto.id) === photoId) {
        const updated = {
            ...activePhoto,
            comments: {
                ...(activePhoto.comments || {}),
                count: Math.max(reportedCount, comments.length)
            }
        };
        syncViewerPhotoEverywhere(updated);
    }

    return comments;
}

function appendRichText(container, rawText) {
    const raw = String(rawText || "");
    if (!raw) {
        container.textContent = "(без текста)";
        return;
    }

    const re = /\[((?:id|club|public)\d+)\|([^\]]+)\]/g;
    let last = 0;
    let match;

    while ((match = re.exec(raw)) !== null) {
        if (match.index > last) {
            container.appendChild(document.createTextNode(raw.slice(last, match.index)));
        }

        const button = document.createElement("button");
        button.type = "button";
        button.className = "comment-inline-link";
        button.textContent = match[2];
        button.addEventListener("click", event => {
            event.stopPropagation();
            openVkTarget(match[1]);
        });
        container.appendChild(button);
        last = match.index + match[0].length;
    }

    if (last < raw.length) {
        container.appendChild(document.createTextNode(raw.slice(last)));
    }
}

function copyText(text) {
    const value = String(text || "");
    if (!value) return Promise.resolve();

    if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(value).catch(() => fallbackCopy(value));
    }

    return fallbackCopy(value);
}

function fallbackCopy(value) {
    const area = document.createElement("textarea");
    area.value = value;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    area.remove();
    return Promise.resolve();
}

function userCanEdit(comment) {
    if (Number(comment?.can_edit || 0) === 1 || comment?.can_edit === true) return true;
    return Number(comment?.from_id || 0) === Number(state.currentUser?.id || 0);
}

function closeContextMenuDirect() {
    if (contextOverlay?.remove) contextOverlay.remove();
    contextOverlay = null;
    contextOverlayKind = "";
}

async function closeContextMenu() {
    if (contextOverlayKind === "viewer-album") {
        const closedThroughHistory = await closeSwipeOverlay(VIEWER_ALBUM_MENU_OVERLAY_ID);
        if (closedThroughHistory) return;
    }

    closeContextMenuDirect();
}

function makeMenuButton(text, action, danger = false) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `context-menu-button${danger ? " context-menu-button-danger" : ""}`;
    button.textContent = text;
    button.addEventListener("click", async () => {
        await closeContextMenu();
        await action();
    });
    return button;
}

function makeLightMenuButton(text, action, extraClass = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `album-context-item ${extraClass}`.trim();
    button.textContent = text;
    button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();
        await closeContextMenu();
        await action();
    });
    return button;
}

function openCommentContext(comment) {
    closeContextMenu();

    const overlay = document.createElement("div");
    overlay.className = "context-menu-overlay";
    const sheet = document.createElement("div");
    sheet.className = "context-menu-sheet";

    sheet.appendChild(makeMenuButton("Копировать", () => copyText(comment.text || "")));

    sheet.appendChild(makeMenuButton("Удалить", async () => {
        if (!confirm("Удалить комментарий?")) return;

        try {
            await vkApi("photos.deleteComment", {
                owner_id: photoCommentOwnerId(activePhoto),
                comment_id: Number(comment.id)
            });
            invalidatePhotoActivityCaches(
                photoCommentOwnerId(activePhoto),
                Number(activePhoto?.album_id || activeAlbum?.id || 0),
                Number(activePhoto?.id || 0)
            );
            await refreshPhotoComments();
        } catch (error) {
            alert(`Не удалось удалить комментарий.\n\n${escapeHtml(String(error?.error_data?.error_msg || error?.error_msg || error?.message || error))}`);
        }
    }, true));

    sheet.appendChild(makeMenuButton("Отмена", async () => {}));
    overlay.appendChild(sheet);
    overlay.addEventListener("click", event => {
        if (consumeLongPressSyntheticClick(event)) return;
        if (event.target === overlay) void closeContextMenu();
    }, true);
    document.body.appendChild(overlay);
    contextOverlay = overlay;
    contextOverlayKind = "comment";
}

function installLongPress(element, handler) {
    let timer = null;
    let x = 0;
    let y = 0;

    const clear = () => {
        if (timer) clearTimeout(timer);
        timer = null;
    };

    element.addEventListener("pointerdown", event => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        x = event.clientX;
        y = event.clientY;
        clear();
        timer = setTimeout(() => {
            armLongPressReleaseGuard(event.pointerId);
            handler();
        }, LONG_PRESS_MS);
    }, { passive: true });

    element.addEventListener("pointermove", event => {
        if (!timer) return;
        if (Math.abs(event.clientX - x) > MOVE_TOLERANCE || Math.abs(event.clientY - y) > MOVE_TOLERANCE) {
            clear();
        }
    }, { passive: true });

    element.addEventListener("pointerup", clear, { passive: true });
    element.addEventListener("pointercancel", clear, { passive: true });
    element.addEventListener("contextmenu", event => {
        event.preventDefault();
        handler();
    });
}

function perfNow() {
    return typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now();
}

function markViewerPerf(stage, photoId, url = "") {
    if (!lastOpenPerf || Number(lastOpenPerf.photoId) !== Number(photoId)) return;
    const now = perfNow();
    lastOpenPerf[stage] = Math.max(0, now - lastOpenPerf.startedAt);
    if (url) lastOpenPerf[`${stage}Url`] = url;
}

function clearPhotoViewerImage() {
    imageLoadSequence += 1;
    pendingHighResPhotoId = "";
    pendingHighResUrl = "";
    dom.photoViewerImage.classList.add("is-loading");
    dom.photoViewerImage.removeAttribute("src");
    dom.photoViewerImage.removeAttribute("data-photo-id");
    dom.photoViewerImage.removeAttribute("data-photo-url");
    dom.photoViewerImage.alt = "Фотография";
}

function setPhotoViewerImage(photo) {
    const photoId = String(photo?.id || "");
    const previewUrl = getPhotoPreviewUrl(photo, 200);
    const highResUrl = getBestPhotoUrl(photo);
    const samePhotoAlreadyVisible = Boolean(
        photoId &&
        dom.photoViewerImage.dataset.photoId === photoId &&
        dom.photoViewerImage.getAttribute("src")
    );

    dom.photoViewerImage.alt = photo?.text || "Фотография";

    // Самое важное для скорости открытия: при клике не ждём самый большой
    // файл фотографии. Сразу показываем тот же небольшой URL, который уже
    // использовался карточкой в сетке и обычно находится в HTTP-кэше WebView.
    // Затем незаметно подменяем его на максимальное качество.
    if (!samePhotoAlreadyVisible) {
        if (previewUrl) {
            dom.photoViewerImage.src = previewUrl;
            dom.photoViewerImage.dataset.photoId = photoId;
            dom.photoViewerImage.dataset.photoUrl = previewUrl;
            dom.photoViewerImage.classList.remove("is-loading");
            markViewerPerf("previewMs", photoId, previewUrl);
        } else if (highResUrl) {
            // Нет отдельного preview — браузер начинает загружать доступный URL
            // сразу. Не прячем <img> до onload: пользователь увидит его в первый
            // возможный момент, а не после дополнительного JS-preload.
            dom.photoViewerImage.src = highResUrl;
            dom.photoViewerImage.dataset.photoId = photoId;
            dom.photoViewerImage.dataset.photoUrl = highResUrl;
            dom.photoViewerImage.classList.remove("is-loading");
            markViewerPerf("previewMs", photoId, highResUrl);
            return;
        } else {
            return;
        }
    }

    if (!highResUrl) return;
    if (dom.photoViewerImage.dataset.photoUrl === highResUrl) {
        dom.photoViewerImage.classList.remove("is-loading");
        return;
    }

    // Повторный renderPhotoHeader после photos.getById часто приносит тот же
    // URL. Не запускаем второй Image() для одной и той же фотографии.
    if (pendingHighResPhotoId === photoId && pendingHighResUrl === highResUrl) {
        return;
    }

    const token = ++imageLoadSequence;
    pendingHighResPhotoId = photoId;
    pendingHighResUrl = highResUrl;

    const loader = new Image();
    loader.decoding = "async";
    loader.onload = () => {
        if (token !== imageLoadSequence) return;
        if (state.currentScreen !== "photo") return;
        if (!activePhoto || Number(activePhoto.id) !== Number(photo?.id)) return;

        dom.photoViewerImage.src = highResUrl;
        dom.photoViewerImage.dataset.photoId = photoId;
        dom.photoViewerImage.dataset.photoUrl = highResUrl;
        dom.photoViewerImage.classList.remove("is-loading");
        pendingHighResPhotoId = "";
        pendingHighResUrl = "";
        markViewerPerf("highResMs", photoId, highResUrl);
    };
    loader.onerror = () => {
        if (token !== imageLoadSequence) return;
        pendingHighResPhotoId = "";
        pendingHighResUrl = "";
        // Preview уже остаётся видимым. Ошибка большого файла не должна делать
        // фотографию визуально "не открывшейся".
    };
    loader.src = highResUrl;
}

function renderPhotoHeader(photo) {
    setPhotoViewerImage(photo);
    dom.photoViewerDescription.textContent = photo.text || "";
    dom.photoViewerDescription.classList.toggle("hidden", !String(photo.text || "").trim());

    dom.photoViewerLikes.textContent = String(Number(photo?.likes?.count || 0));
    dom.photoViewerReposts.textContent = String(Number(photo?.reposts?.count || 0));
}

function unansweredPhotoCommentIds(items) {
    const answered = new Set();

    for (const comment of Array.isArray(items) ? items : []) {
        const stack = Array.isArray(comment?.parents_stack) ? comment.parents_stack : [];
        for (const raw of stack) {
            const id = Number(raw || 0);
            if (id > 0) answered.add(String(id));
        }

        const parent = Number(
            comment?._parent_comment_id ||
            comment?.reply_to_comment ||
            comment?.reply_to_comment_id ||
            0
        );
        if (parent > 0) answered.add(String(parent));
    }

    const currentUserId = Number(state.currentUser?.id || 0);
    const communityOwnerId = Number(getOwnerId() || 0);
    const result = new Set();

    for (const comment of Array.isArray(items) ? items : []) {
        if (comment?._is_reply) continue;
        const id = commentId(comment);
        if (!id || answered.has(String(id))) continue;

        const authorId = Number(comment?.from_id || 0);
        if (currentUserId && authorId === currentUserId) continue;
        if (communityOwnerId && authorId === communityOwnerId) continue;
        result.add(String(id));
    }

    return result;
}

function renderPhotoComments() {
    dom.photoViewerComments.innerHTML = "";

    if (!comments.length) {
        const empty = document.createElement("div");
        empty.className = "photo-viewer-empty-comments";

        const message = document.createElement("div");
        message.className = "status-message";
        message.textContent = "Комментариев пока нет";

        const openVk = document.createElement("button");
        openVk.type = "button";
        openVk.className = "secondary-button photo-viewer-open-vk-comment";
        openVk.textContent = "Написать первый комментарий в VK";
        openVk.addEventListener("click", () => {
            const ownerId = photoCommentOwnerId(activePhoto);
            invalidatePhotoActivityCaches(ownerId, Number(activePhoto?.album_id || activeAlbum?.id || 0), Number(activePhoto?.id || 0));
            openVkPhoto(activePhoto, ownerId);
        });

        empty.append(message, openVk);
        dom.photoViewerComments.appendChild(empty);
        return;
    }

    const unansweredIds = unansweredPhotoCommentIds(comments);

    for (const comment of comments) {
        const card = document.createElement("div");
        card.className = "photo-viewer-comment";
        if (comment?._is_reply) {
            card.classList.add("photo-viewer-comment-reply");
        } else if (unansweredIds.has(String(commentId(comment)))) {
            card.classList.add("photo-viewer-comment-unanswered");
        }

        const top = document.createElement("div");
        top.className = "photo-viewer-comment-top";

        const info = authorInfo(comment);
        const authorButton = document.createElement("button");
        authorButton.type = "button";
        authorButton.className = "comment-author-link";
        authorButton.textContent = info.name;
        authorButton.addEventListener("click", event => {
            event.stopPropagation();
            openVkProfile(info.id);
        });

        const date = document.createElement("span");
        date.className = "comment-date";
        date.textContent = formatDate(comment.date);
        top.append(authorButton, date);

        const text = document.createElement("div");
        text.className = "comment-text";
        appendRichText(text, comment.text || "");

        const actions = document.createElement("div");
        actions.className = "photo-viewer-comment-actions";
        const reply = document.createElement("button");
        reply.type = "button";
        reply.className = "comment-reply-link";
        reply.textContent = "Ответить";
        reply.addEventListener("click", () => {
            // Сбрасываем кэш до нативного перехода: возвратное событие может
            // не прийти, если WebView выгрузится системой.
            const ownerId = photoCommentOwnerId(activePhoto);
            invalidatePhotoActivityCaches(ownerId, Number(activePhoto?.album_id || activeAlbum?.id || 0), Number(activePhoto?.id || 0));

            // Ответы через photos.createComment из Mini App запрещены VK
            // для non-standalone приложений. Открываем фотографию в
            // нативном VK и отвечаем штатными средствами VK.
            openVkPhoto(activePhoto, ownerId);
        });
        actions.appendChild(reply);

        card.append(top, text, actions);
        installLongPress(card, () => openCommentContext(comment));
        dom.photoViewerComments.appendChild(card);
    }
}

async function refreshPhotoComments() {
    dom.photoViewerComments.innerHTML = '<div class="status-message">Загружаем комментарии...</div>';

    try {
        await fetchAllComments(activePhoto);
        renderPhotoHeader(activePhoto);
        renderPhotoComments();
    } catch (error) {
        dom.photoViewerComments.innerHTML = `
            <div class="error">
                Не удалось загрузить комментарии.<br><br>
                ${escapeHtml(String(error?.error_data?.error_msg || error?.error_msg || error?.message || error))}
            </div>
        `;
    }
}

async function refreshAfterNativePhotoReturn(detail) {
    if (!activePhoto || state.currentScreen !== "photo") return;
    if (detail?.type !== "photo") return;
    if (Number(detail?.photoId || 0) !== Number(activePhoto.id || 0)) return;

    const ownerId = photoCommentOwnerId(activePhoto);
    const albumId = Number(activePhoto?.album_id || activeAlbum?.id || detail?.albumId || 0);

    invalidatePhotoActivityCaches(ownerId, albumId, Number(activePhoto.id || 0));

    try {
        const fullPhoto = await fetchPhoto(activePhoto);
        syncViewerPhotoEverywhere(fullPhoto);
        updateViewerArrows();
        renderPhotoHeader(fullPhoto);
        await refreshPhotoComments();
    } catch (error) {
        console.warn("Не удалось обновить фотографию после возврата из VK:", error);
    }
}

function normalizeViewerSequence(sequence, currentPhoto) {
    const source = Array.isArray(sequence) && sequence.length
        ? sequence
        : (Array.isArray(state.photos) ? state.photos : []);
    const seen = new Set();
    const normalized = [];

    for (const item of source) {
        const id = Number(item?.id || 0);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        normalized.push(item);
    }

    const currentId = Number(currentPhoto?.id || 0);
    if (currentId && !seen.has(currentId)) normalized.push(currentPhoto);
    return normalized;
}

function activeViewerPhotoIndex() {
    const currentId = Number(activePhoto?.id || 0);
    if (!currentId) return -1;
    return viewerPhotoSequence.findIndex(item => Number(item?.id || 0) === currentId);
}

function albumForViewerPhoto(photo) {
    const albumId = String(photo?.album_id ?? activeAlbum?.id ?? "");
    if (!albumId) return activeAlbum;

    const known = state.albums.find(item => String(item.id) === albumId) ||
        state.albumIndex.find(item => String(item.id) === albumId) ||
        (activeAlbum && String(activeAlbum.id) === albumId ? activeAlbum : null);

    if (known) return known;

    return {
        id: Number(albumId),
        owner_id: Number(photo?.owner_id || activeAlbum?.owner_id || getOwnerId()),
        title: "Альбом",
        size: 0,
        description: ""
    };
}

function syncViewerPhotoEverywhere(photo) {
    if (!photo?.id) return;
    const id = Number(photo.id);

    activePhoto = photo;
    state.currentPhoto = photo;

    state.photos = (Array.isArray(state.photos) ? state.photos : []).map(item =>
        Number(item?.id || 0) === id ? { ...item, ...photo } : item
    );

    viewerPhotoSequence = viewerPhotoSequence.map(item =>
        Number(item?.id || 0) === id ? { ...item, ...photo } : item
    );
}

function updateViewerArrows() {
    const index = activeViewerPhotoIndex();
    const hasPrevious = index > 0;
    const hasNext = index >= 0 && index < viewerPhotoSequence.length - 1;

    dom.photoViewerPrev?.classList.toggle("hidden", !hasPrevious);
    dom.photoViewerNext?.classList.toggle("hidden", !hasNext);
}

function moveViewerByStep(step) {
    const index = activeViewerPhotoIndex();
    if (index < 0) return;

    const next = viewerPhotoSequence[index + step];
    if (!next?.id) return;

    const album = albumForViewerPhoto(next);

    // Стрелки меняют фотографию внутри одной записи history. Поэтому после
    // любого количества перелистываний «Назад» возвращает в исходный список.
    void openPhotoViewer(next, album, {
        replaceHistory: true,
        sequence: viewerPhotoSequence,
        viewerSource: state.photoViewerSource,
        photoDataFresh: viewerSequenceDataFresh
    });
}

function openViewerPhotoContext() {
    if (!activePhoto?.id) return;

    // Меню открывается поверх фотографии как отдельный history-overlay.
    // Поэтому системный свайп «Назад» сначала закрывает меню и только
    // следующий жест может покинуть просмотрщик фотографии.
    closeContextMenuDirect();

    const overlay = document.createElement("div");
    overlay.className = "album-context-overlay photo-viewer-album-context-overlay";
    const sheet = document.createElement("div");
    sheet.className = "album-context-menu photo-viewer-album-context-menu";

    sheet.appendChild(makeLightMenuButton("Перейти в альбом", async () => {
        const photo = activePhoto;
        const album = albumForViewerPhoto(photo);
        if (!album?.id) return;

        try {
            const { openAlbum } = await import("./photos.js?v=20260927-captiontop43");
            await openAlbum(album);
        } catch (error) {
            console.warn("Не удалось перейти в альбом фотографии:", error);
            alert("Не удалось открыть альбом этой фотографии.");
        }
    }));

    sheet.appendChild(makeLightMenuButton("Отмена", async () => {}));
    overlay.appendChild(sheet);
    sheet.addEventListener("click", event => event.stopPropagation());
    overlay.addEventListener("click", event => {
        if (consumeLongPressSyntheticClick(event)) return;
        if (event.target === overlay) void closeContextMenu();
    }, true);

    document.body.appendChild(overlay);
    contextOverlay = overlay;
    contextOverlayKind = "viewer-album";

    openSwipeOverlay(VIEWER_ALBUM_MENU_OVERLAY_ID, closeContextMenuDirect);
}

export async function openPhotoViewer(photo, album, {
    fromHistory = false,
    fromComments = false,
    replaceHistory = false,
    sequence = null,
    viewerSource = null,
    photoDataFresh = false
} = {}) {
    if (!photo?.id) return;

    const seq = ++viewerSequence;
    const requestedPhotoId = Number(photo.id);
    lastOpenPerf = {
        photoId: requestedPhotoId,
        startedAt: perfNow(),
        previewMs: null,
        highResMs: null
    };

    activeAlbum = album || state.currentAlbum || state.albums.find(a => String(a.id) === String(photo.album_id));
    activePhoto = photo;
    state.currentPhoto = photo;

    if (viewerSource !== null && viewerSource !== undefined) {
        state.photoViewerSource = String(viewerSource || "");
    } else if (!replaceHistory && !fromHistory) {
        state.photoViewerSource = "";
    }

    if (Array.isArray(sequence) && sequence.length) {
        viewerPhotoSequence = normalizeViewerSequence(sequence, photo);
        if (!replaceHistory || !viewerPhotoSequence.length) {
            viewerSequenceDataFresh = Boolean(photoDataFresh);
        }
    } else if (!replaceHistory && !fromHistory) {
        viewerPhotoSequence = normalizeViewerSequence(state.photos, photo);
        viewerSequenceDataFresh = Boolean(photoDataFresh);
    } else if (!viewerPhotoSequence.some(item => Number(item?.id || 0) === requestedPhotoId)) {
        viewerPhotoSequence = normalizeViewerSequence(state.photos, photo);
        viewerSequenceDataFresh = Boolean(photoDataFresh);
    }

    updateViewerArrows();

    if (!fromHistory) {
        if (replaceHistory) {
            replacePhotoHistory(photo, activeAlbum, {
                fromComments,
                viewerSource: state.photoViewerSource
            });
        } else {
            // Важно: источник сохраняется в history ДО смены currentAlbum.
            // Для глобального поиска открытая фотография может принадлежать
            // другому альбому, чем экран, поверх которого был открыт поиск.
            pushPhotoHistory(photo, activeAlbum, {
                fromComments,
                viewerSource: state.photoViewerSource
            });
        }
    }

    state.currentAlbum = activeAlbum || state.currentAlbum;

    // Очищаем изображение ДО показа экрана. Поэтому bitmap предыдущей
    // фотографии физически не может мелькнуть при открытии следующей.
    clearPhotoViewerImage();
    comments = [];
    authors = new Map(sessionAuthors);

    showPhotoViewerScreen();
    dom.pageTitle.textContent = "Фотография";
    dom.photoViewerComments.innerHTML = '<div class="status-message">Загружаем комментарии...</div>';

    // Показываем уже имеющуюся версию новой фотографии сразу, не ожидая
    // photos.getById. Она всё равно относится к правильному photo_id.
    renderPhotoHeader(photo);

    try {
        // Фото, открытое прямо из только что загруженного альбома, уже пришло
        // от photos.get extended=1. Повторный photos.getById здесь ничего не
        // добавляет к актуальности, но удваивает расход API при каждом просмотре.
        const fullPhoto = photoDataFresh ? photo : await fetchPhoto(photo);
        if (seq !== viewerSequence || state.currentScreen !== "photo" || Number(activePhoto?.id) !== requestedPhotoId) return;

        syncViewerPhotoEverywhere(fullPhoto);
        updateViewerArrows();
        renderPhotoHeader(fullPhoto);
        await refreshPhotoComments();
    } catch (error) {
        if (seq !== viewerSequence || state.currentScreen !== "photo" || Number(activePhoto?.id) !== requestedPhotoId) return;

        console.error("Не удалось открыть фотографию:", error);
        renderPhotoHeader(photo);
        dom.photoViewerComments.innerHTML = `
            <div class="error">
                Не удалось полностью загрузить фотографию.<br><br>
                ${escapeHtml(String(error?.error_data?.error_msg || error?.error_msg || error?.message || error))}
            </div>
        `;
    }
}

export function initPhotoViewer() {
    if (initialized) return;
    initialized = true;

    dom.photoViewerPrev?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        moveViewerByStep(-1);
    });

    dom.photoViewerNext?.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        moveViewerByStep(1);
    });

    if (dom.photoViewerImage) {
        dom.photoViewerImage.draggable = false;
        installLongPress(dom.photoViewerImage, openViewerPhotoContext);
    }

    window.photoViewerDebug = {
        last: () => lastOpenPerf ? { ...lastOpenPerf } : null
    };

    window.addEventListener("vk-native-return", event => {
        void refreshAfterNativePhotoReturn(event?.detail);
    });

    window.addEventListener("photo-data-updated", event => {
        const updated = event?.detail?.photo;
        if (!updated || !activePhoto) return;
        if (Number(updated.id) !== Number(activePhoto.id)) return;
        activePhoto = { ...activePhoto, ...updated };
        state.currentPhoto = activePhoto;
        renderPhotoHeader(activePhoto);
    });
}
