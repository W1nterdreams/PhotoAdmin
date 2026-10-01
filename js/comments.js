import { state } from "./state.js?v=20260927-captiontop43";
import { dom } from "./dom.js?v=20260927-captiontop43";
import { vkApi } from "./vk-api.js?v=20260927-captiontop43";
import { escapeHtml, getErrorMessage, getPhotoPreviewUrl } from "./helpers.js?v=20260927-captiontop43";
import { showCommentsScreen, pushCommentsHistory } from "./navigation.js?v=20260927-captiontop43";
import { closeMenu } from "./main-menu.js?v=20260927-captiontop43";
import { CACHE_TTL } from "./config.js?v=20260927-captiontop43";
import { cacheGet, cacheSet, invalidateCommentCaches } from "./cache.js?v=20260927-captiontop43";
import { getOwnerId } from "./group-context.js?v=20260927-captiontop43";
import { openVkProfile, openVkPhoto, openVkTarget } from "./vk-links.js?v=20260927-captiontop43";
import { openPhotoViewer } from "./photo-viewer.js?v=20260927-captiontop43";

const GLOBAL_COMMENTS_DAYS = 5;
const PAGE_SIZE = 100;
const READ_TIMEOUT_MS = 9000;
const CACHE_SCHEMA = 3;

let globalFeedActive = false;
const sessionAuthors = new Map();

function cacheKey() {
    return `global-comments:v${CACHE_SCHEMA}:${getOwnerId()}:${GLOBAL_COMMENTS_DAYS}d`;
}

function cutoffTimestamp() {
    return Math.floor((Date.now() - GLOBAL_COMMENTS_DAYS * 86400000) / 1000);
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

function withTimeout(promise, ms, label) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}: превышено время ожидания`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function apiRead(method, params) {
    return withTimeout(vkApi(method, params), READ_TIMEOUT_MS, method);
}

function normalizeGroupsResponse(response) {
    if (Array.isArray(response)) return response;
    if (Array.isArray(response?.groups)) return response.groups;
    if (Array.isArray(response?.items)) return response.items;
    return [];
}

function albumById(albumId) {
    const id = String(albumId ?? "");
    return state.albums.find(a => String(a.id) === id) ||
        state.albumIndex.find(a => String(a.id) === id) ||
        null;
}

function albumTitleForPhoto(photo) {
    const album = albumById(photo?.album_id);
    return album?.title || (photo?.album_id ? `Альбом ${photo.album_id}` : "Альбом");
}

function authorInfo(comment, authors) {
    const id = Number(comment?.from_id || 0);
    const known = authors.get(id);
    if (known) return known;

    return {
        id,
        name: id > 0
            ? `Пользователь ${id}`
            : id < 0
                ? `Сообщество ${Math.abs(id)}`
                : "Пользователь"
    };
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

async function loadRecentComments() {
    const ownerId = getOwnerId();
    const cutoff = cutoffTimestamp();
    const comments = [];
    let offset = 0;

    while (true) {
        const result = await apiRead("photos.getAllComments", {
            owner_id: ownerId,
            count: PAGE_SIZE,
            offset
        });

        const items = Array.isArray(result?.items) ? result.items : [];
        if (!items.length) break;

        let reachedOldComments = false;
        for (const comment of items) {
            if (Number(comment?.date || 0) < cutoff) {
                reachedOldComments = true;
                break;
            }
            comments.push(comment);
        }

        if (reachedOldComments || items.length < PAGE_SIZE) break;
        offset += items.length;
    }

    return comments.sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
}

async function loadPhotos(comments) {
    const ownerId = getOwnerId();
    const ids = [...new Set(comments.map(commentPhotoId).filter(Boolean))];
    const photos = new Map();

    // Если нужная фотография уже находится в свежем/текущем альбоме,
    // используем её без повторного photos.getById. Остальные добираем пачками.
    const wanted = new Set(ids.map(String));
    for (const photo of Array.isArray(state.photos) ? state.photos : []) {
        if (wanted.has(String(photo?.id))) photos.set(String(photo.id), photo);
    }

    const missingIds = ids.filter(id => !photos.has(String(id)));

    for (let i = 0; i < missingIds.length; i += 500) {
        const chunk = missingIds.slice(i, i + 500);
        if (!chunk.length) continue;

        try {
            const result = await apiRead("photos.getById", {
                photos: chunk.map(id => `${ownerId}_${id}`).join(","),
                photo_sizes: 1,
                extended: 1
            });

            for (const photo of Array.isArray(result) ? result : []) {
                photos.set(String(photo.id), photo);
            }
        } catch (error) {
            console.warn("Не удалось получить фотографии для общей ленты комментариев:", error);
        }
    }

    return photos;
}

async function loadAuthors(comments) {
    const allUserIds = [...new Set(
        comments.map(c => Number(c?.from_id || 0)).filter(id => id > 0)
    )];
    const allGroupIds = [...new Set(
        comments.map(c => Number(c?.from_id || 0)).filter(id => id < 0).map(id => Math.abs(id))
    )];
    const authors = new Map();

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
            const users = await apiRead("users.get", { user_ids: userIds.join(",") });
            for (const user of Array.isArray(users) ? users : []) {
                const id = Number(user.id || 0);
                if (!id) continue;
                const author = {
                    id,
                    name: `${user.first_name || ""} ${user.last_name || ""}`.trim() || `id${id}`
                };
                authors.set(id, author);
                sessionAuthors.set(id, author);
            }
        } catch (error) {
            console.warn("Не удалось получить авторов общей ленты комментариев:", error);
        }
    }

    if (groupIds.length) {
        try {
            const response = await apiRead("groups.getById", { group_ids: groupIds.join(",") });
            for (const group of normalizeGroupsResponse(response)) {
                const id = -Math.abs(Number(group.id || 0));
                if (!id) continue;
                const author = {
                    id,
                    name: group.name || `club${Math.abs(id)}`
                };
                authors.set(id, author);
                sessionAuthors.set(id, author);
            }
        } catch (error) {
            console.warn("Не удалось получить сообщества-авторов общей ленты:", error);
        }
    }

    return authors;
}

function serializeData(data) {
    return {
        comments: data.comments,
        photos: [...data.photos.entries()],
        authors: [...data.authors.entries()]
    };
}

function restoreData(data) {
    return {
        comments: Array.isArray(data?.comments) ? data.comments : [],
        photos: new Map(Array.isArray(data?.photos) ? data.photos : []),
        authors: new Map(Array.isArray(data?.authors) ? data.authors : [])
    };
}

function renderComments(data) {
    dom.comments.innerHTML = "";

    const title = document.querySelector(".comments-title");
    if (title) title.textContent = `Комментарии за последние ${GLOBAL_COMMENTS_DAYS} дней`;
    dom.pageTitle.textContent = "Комментарии";

    if (!data.comments.length) {
        dom.comments.innerHTML = `
            <div class="status-message">
                Комментариев за последние ${GLOBAL_COMMENTS_DAYS} дней нет
            </div>
        `;
        return;
    }

    const decoratedComments = decorateCommentThreads(data.comments);

    for (const comment of decoratedComments) {
        const photoId = commentPhotoId(comment);
        const photo = photoId ? data.photos.get(String(photoId)) : null;
        const album = albumById(photo?.album_id);
        const author = authorInfo(comment, data.authors);

        const card = document.createElement("div");
        card.className = "comment-card comment-card-rich";
        if (comment?._is_reply) card.classList.add("comment-thread-reply");
        if (comment?._unanswered) card.classList.add("comment-unanswered");

        const thumb = document.createElement("button");
        thumb.type = "button";
        thumb.className = "comment-thumb-button";

        const photoUrl = getPhotoPreviewUrl(photo, 200);
        if (photoUrl) {
            const image = document.createElement("img");
            image.className = "comment-photo";
            image.src = photoUrl;
            image.alt = "";
            image.loading = "lazy";
            thumb.appendChild(image);
        } else {
            const placeholder = document.createElement("div");
            placeholder.className = "comment-photo comment-photo-placeholder";
            placeholder.textContent = "🖼";
            thumb.appendChild(placeholder);
        }

        thumb.addEventListener("click", event => {
            event.stopPropagation();
            if (!photoId) return;
            const targetPhoto = photo || {
                id: photoId,
                owner_id: getOwnerId(),
                album_id: album?.id
            };
            void openPhotoViewer(targetPhoto, album, { fromComments: true });
        });

        const body = document.createElement("div");
        body.className = "comment-body";

        const albumName = document.createElement("div");
        albumName.className = "comment-album";
        albumName.textContent = albumTitleForPhoto(photo);

        const header = document.createElement("div");
        header.className = "comment-header";

        const authorButton = document.createElement("button");
        authorButton.type = "button";
        authorButton.className = "comment-author-link";
        authorButton.textContent = author.name;
        authorButton.addEventListener("click", event => {
            event.stopPropagation();
            if (author.id) openVkProfile(author.id);
        });
        header.appendChild(authorButton);

        const text = document.createElement("div");
        text.className = "comment-text";
        appendRichCommentText(text, comment.text || "");

        const meta = document.createElement("div");
        meta.className = "comment-meta-row";

        const date = document.createElement("div");
        date.className = "comment-date";
        date.textContent = comment.date
            ? new Date(Number(comment.date) * 1000).toLocaleString("ru-RU")
            : "";

        const reply = document.createElement("button");
        reply.type = "button";
        reply.className = "comment-reply-link";
        reply.textContent = "Ответить";
        reply.addEventListener("click", event => {
            event.stopPropagation();
            if (!photoId) return;
            invalidateCommentCaches(getOwnerId(), { photoId });
            openVkPhoto(photo || { id: photoId, owner_id: getOwnerId() }, getOwnerId());
        });

        meta.append(date, reply);
        body.append(albumName, header, text, meta);
        card.append(thumb, body);
        dom.comments.appendChild(card);
    }
}

async function buildCommentsFeed() {
    const comments = await loadRecentComments();
    if (!comments.length) {
        return { comments: [], photos: new Map(), authors: new Map() };
    }

    const [photos, authors] = await Promise.all([
        loadPhotos(comments),
        loadAuthors(comments)
    ]);

    return { comments, photos, authors };
}

export async function loadAllComments({ force = false, silent = false } = {}) {
    const key = cacheKey();

    if (!force) {
        const cached = cacheGet(key, CACHE_TTL.comments);
        if (cached) {
            renderComments(restoreData(cached));
            return;
        }
    }

    if (!silent) {
        dom.comments.innerHTML = `
            <div class="status-message">
                Загружаем комментарии всех альбомов за ${GLOBAL_COMMENTS_DAYS} дней...
            </div>
        `;
        dom.refreshComments.disabled = true;
    }

    try {
        const data = await buildCommentsFeed();
        cacheSet(key, serializeData(data));
        if (globalFeedActive && state.currentScreen === "comments") {
            renderComments(data);
        }
    } catch (error) {
        if (globalFeedActive && state.currentScreen === "comments") {
            dom.comments.innerHTML = `
                <div class="error">
                    Не удалось загрузить комментарии.<br><br>
                    ${escapeHtml(getErrorMessage(error))}
                </div>
            `;
        }
    } finally {
        dom.refreshComments.disabled = false;
    }
}

export function initComments() {
    dom.commentsMenuButton.addEventListener("click", async () => {
        globalFeedActive = true;
        await closeMenu();
        pushCommentsHistory();
        showCommentsScreen();
        await loadAllComments();
    });

    // Если открыли комментарии конкретного альбома, общая лента больше не
    // должна перерисовывать тот же экран своими фоновыми запросами.
    window.addEventListener("album-menu-action", event => {
        if (event?.detail?.action === "comments") globalFeedActive = false;
    });

    dom.refreshComments.addEventListener("click", () => {
        if (!globalFeedActive) return;
        void loadAllComments({ force: true });
    });

    window.addEventListener("vk-native-return", event => {
        if (!globalFeedActive || state.currentScreen !== "comments") return;
        if (event?.detail?.type !== "photo") return;

        invalidateCommentCaches(getOwnerId(), {
            photoId: Number(event.detail.photoId || 0)
        });
        void loadAllComments({ force: true, silent: true });
    });

    window.addEventListener("popstate", event => {
        if (!globalFeedActive || event?.state?.screen !== "comments") return;
        setTimeout(() => {
            if (globalFeedActive && state.currentScreen === "comments") {
                void loadAllComments({ force: true, silent: true });
            }
        }, 0);
    });
}
