import { vkApi } from "./vk-api.js?v=20260927-captiontop43";
import { getOwnerId } from "./group-context.js?v=20260927-captiontop43";
import { state } from "./state.js?v=20260927-captiontop43";

function errorCode(error) {
    return Number(
        error?.error_code ??
        error?.error_data?.error_code ??
        error?.error?.error_code ??
        0
    ) || 0;
}

function errorMessage(error) {
    const values = [
        error?.error_msg,
        error?.error_data?.error_msg,
        error?.error?.error_msg,
        error?.message,
        error?.error_data?.error_reason
    ];

    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }

    try {
        return JSON.stringify(error);
    } catch (_) {
        return String(error || "Неизвестная ошибка");
    }
}

function makeGuid() {
    const rnd = Math.random().toString(36).slice(2, 10);
    return `vkpm-${Date.now()}-${rnd}`;
}

export function photoCommentOwnerId(photo) {
    const ownerId = Number(photo?.owner_id ?? getOwnerId());
    return Number.isFinite(ownerId) && ownerId !== 0 ? ownerId : getOwnerId();
}

export function formatPhotoCommentError(error, {
    photo,
    replyToComment = null,
    album = null
} = {}) {
    const code = errorCode(error);
    const message = errorMessage(error);
    const ownerId = photoCommentOwnerId(photo);
    const photoId = Number(photo?.id || 0);
    const canComment = photo?.can_comment;
    const commentsDisabled = album?.comments_disabled;

    const details = [
        `VK: ${message}${code ? ` (код ${code})` : ""}`,
        `owner_id=${ownerId}`,
        `photo_id=${photoId || "?"}`,
        `reply_to_comment=${replyToComment || "—"}`,
        `can_comment=${typeof canComment === "undefined" ? "?" : Number(canComment)}`,
        `comments_disabled=${typeof commentsDisabled === "undefined" ? "?" : Number(commentsDisabled)}`,
        `scope=${state.accessScope || "?"}`
    ];

    if (code === 15) {
        details.unshift("VK запретил добавление комментария для текущего токена/объекта.");
    }

    return details.join("\n");
}

export async function createPhotoComment({
    photo,
    message,
    replyToComment = null,
    album = null
}) {
    const text = String(message || "").trim();
    if (!text) throw new Error("Введите текст комментария.");

    const photoId = Number(photo?.id || 0);
    if (!photoId) throw new Error("Неизвестен ID фотографии.");

    const params = {
        owner_id: photoCommentOwnerId(photo),
        photo_id: photoId,
        message: text,
        from_group: 0,
        guid: makeGuid()
    };

    if (replyToComment) {
        params.reply_to_comment = Number(replyToComment);
    }

    if (photo?.access_key) {
        params.access_key = String(photo.access_key);
    }

    try {
        return await vkApi("photos.createComment", params);
    } catch (error) {
        const diagnostic = formatPhotoCommentError(error, {
            photo,
            replyToComment,
            album
        });

        if (error && typeof error === "object") {
            error.photoCommentDiagnostic = diagnostic;
            throw error;
        }

        const wrapped = new Error(diagnostic);
        wrapped.photoCommentDiagnostic = diagnostic;
        throw wrapped;
    }
}

export function getPhotoCommentErrorText(error, context = {}) {
    if (error?.photoCommentDiagnostic) return error.photoCommentDiagnostic;
    return formatPhotoCommentError(error, context);
}
