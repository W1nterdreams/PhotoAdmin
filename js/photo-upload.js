import { state } from "./state.js?v=20260927-captiontop43";
import { dom } from "./dom.js?v=20260927-captiontop43";
import { getOwnerId } from "./group-context.js?v=20260927-captiontop43";
import { closeMenu } from "./main-menu.js?v=20260927-captiontop43";
import { openVkTarget } from "./vk-links.js?v=20260927-captiontop43";
import { loadPhotos } from "./photos.js?v=20260927-captiontop43";
import { renderAlbums } from "./albums.js?v=20260927-captiontop43";
import {
    invalidateAlbumCaches,
    invalidateAlbumPhotosCache
} from "./cache.js?v=20260927-captiontop43";
import { markPhotoIndexAlbumDirty } from "./photo-index-db.js?v=20260927-captiontop43";

function findAlbum(albumId) {
    const id = String(albumId || "");

    return (
        (state.currentAlbum && String(state.currentAlbum.id) === id
            ? state.currentAlbum
            : null) ||
        state.albums.find(album => String(album.id) === id) ||
        state.albumIndex.find(album => String(album.id) === id) ||
        null
    );
}

function buildNativeUploadTarget(album) {
    const ownerId = Number(album?.owner_id || getOwnerId());
    const albumId = Number(album?.id || 0);

    if (!ownerId || !albumId) return "";

    // У VK нет документированного Bridge-метода, который сразу открывает
    // системный выбор файлов для конкретного фотоальбома. Поэтому открываем
    // именно этот альбом в штатном VK и просим старый веб-маршрут act=add.
    // Если мобильный клиент игнорирует act=add, пользователь всё равно
    // попадает прямо в нужный альбом и загружает фото штатной кнопкой VK.
    return `https://vk.com/album${ownerId}_${albumId}?act=add`;
}

async function openNativeUpload() {
    await closeMenu();

    const album = state.currentAlbum;
    if (!album || state.currentScreen !== "photos") return;

    const target = buildNativeUploadTarget(album);
    if (!target) {
        window.alert("Не удалось открыть альбом в VK.");
        return;
    }

    const ownerId = Number(album.owner_id || getOwnerId());
    markPhotoIndexAlbumDirty(ownerId, Number(album.id), "album-upload");
    invalidateAlbumPhotosCache(ownerId, Number(album.id));
    invalidateAlbumCaches(ownerId);

    openVkTarget(target, {
        type: "album-upload",
        albumId: Number(album.id),
        ownerId: Number(album.owner_id || getOwnerId())
    });
}

async function refreshAfterNativeUpload(detail) {
    if (detail?.type !== "album-upload") return;

    const albumId = Number(detail.albumId || 0);
    if (!albumId) return;

    const ownerId = getOwnerId();

    // После возврата из штатного VK считаем локальные данные устаревшими:
    // пользователь мог загрузить одну или несколько фотографий.
    invalidateAlbumPhotosCache(ownerId, albumId);
    invalidateAlbumCaches(ownerId);

    const album = findAlbum(albumId);
    if (!album) return;

    // Если пользователь вернулся именно в тот же открытый альбом — сразу
    // перечитываем фотографии и счётчик с сервера VK.
    if (
        state.currentScreen === "photos" &&
        state.currentAlbum &&
        Number(state.currentAlbum.id) === albumId
    ) {
        try {
            await loadPhotos(album, { force: true });
            renderAlbums();
        } catch (error) {
            console.warn("Не удалось обновить альбом после возврата из VK:", error);
        }
    }
}

export function initPhotoUpload() {
    dom.uploadPhotoMenuButton?.addEventListener("click", () => void openNativeUpload());

    window.addEventListener("vk-native-return", event => {
        void refreshAfterNativeUpload(event.detail);
    });
}
