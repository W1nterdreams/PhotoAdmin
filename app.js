"use strict";


/* ==========================================
   CONFIG
   ========================================== */

const VK_APP_ID = 54771516;
const VK_API_VERSION = "5.199";


/* ==========================================
   STATE
   ========================================== */

let currentUser = null;
let accessToken = null;

let albums = [];
let currentAlbum = null;
let photos = [];

let albumSearchText = "";

let currentScreen = "albums";


/* ==========================================
   DOM
   ========================================== */

const userElement =
    document.getElementById("user");

const pageTitleElement =
    document.getElementById("pageTitle");

const albumsScreen =
    document.getElementById("albumsScreen");

const photosScreen =
    document.getElementById("photosScreen");

const commentsScreen =
    document.getElementById("commentsScreen");

const albumsElement =
    document.getElementById("albums");

const photosElement =
    document.getElementById("photos");

const commentsElement =
    document.getElementById("comments");

const albumTitleElement =
    document.getElementById("albumTitle");

const albumDescriptionElement =
    document.getElementById("albumDescription");

const photoCountElement =
    document.getElementById("photoCount");

const refreshAlbumsButton =
    document.getElementById("refreshAlbums");

const refreshCommentsButton =
    document.getElementById("refreshComments");

const backButton =
    document.getElementById("backButton");

const albumSearch =
    document.getElementById("albumSearch");

const clearSearchButton =
    document.getElementById("clearSearch");


const menuButton =
    document.getElementById("menuButton");

const mainMenu =
    document.getElementById("mainMenu");

const menuContainer =
    document.querySelector(".menu-container");

const createAlbumMenuButton =
    document.getElementById("createAlbumMenuButton");

const commentsMenuButton =
    document.getElementById("commentsMenuButton");


/* CREATE ALBUM */

const createAlbumModal =
    document.getElementById(
        "createAlbumModal"
    );

const createAlbumForm =
    document.getElementById(
        "createAlbumForm"
    );

const newAlbumTitle =
    document.getElementById(
        "newAlbumTitle"
    );

const newAlbumDescription =
    document.getElementById(
        "newAlbumDescription"
    );

const createAlbumError =
    document.getElementById(
        "createAlbumError"
    );

const submitCreateAlbum =
    document.getElementById(
        "submitCreateAlbum"
    );

const closeCreateAlbumButton =
    document.getElementById(
        "closeCreateAlbum"
    );

const cancelCreateAlbumButton =
    document.getElementById(
        "cancelCreateAlbum"
    );


/* ==========================================
   HELPERS
   ========================================== */

function escapeHtml(value) {

    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


function getErrorMessage(error) {

    if (!error) {
        return "Неизвестная ошибка";
    }

    if (typeof error === "string") {
        return error;
    }

    if (error.message) {
        return error.message;
    }

    if (error.error_msg) {
        return error.error_msg;
    }

    if (
        error.error &&
        error.error.error_msg
    ) {
        return error.error.error_msg;
    }

    try {

        return JSON.stringify(
            error,
            null,
            2
        );

    } catch {

        return String(error);

    }
}


function logError(title, error) {

    console.error(
        title,
        error
    );

    try {

        console.error(
            `${title} JSON:`,
            JSON.stringify(
                error,
                null,
                2
            )
        );

    } catch {
        /* nothing */
    }
}


/* ==========================================
   VK
   ========================================== */

async function vkInit() {

    await vkBridge.send(
        "VKWebAppInit"
    );

    console.log(
        "VK Bridge initialized"
    );
}


async function loadUser() {

    const result =
        await vkBridge.send(
            "VKWebAppGetUserInfo"
        );

    currentUser =
        result;

    const name =
        `${result.first_name || ""} ${result.last_name || ""}`
            .trim();

    userElement.textContent =
        name || "Пользователь";

    console.log(
        "Current user:",
        result
    );
}


async function getAccessToken() {

    const result =
        await vkBridge.send(
            "VKWebAppGetAuthToken",
            {
                app_id:
                    VK_APP_ID,

                scope:
                    "photos"
            }
        );

    accessToken =
        result.access_token;

    if (!accessToken) {

        throw new Error(
            "VK не вернул access token."
        );

    }

    console.log(
        "Photos access token получен"
    );
}


async function vkApi(
    method,
    params = {}
) {

    if (!accessToken) {

        throw new Error(
            "Нет access token."
        );

    }

    try {

        const response =
            await vkBridge.send(
                "VKWebAppCallAPIMethod",
                {
                    method,

                    params: {
                        ...params,

                        access_token:
                            accessToken,

                        v:
                            VK_API_VERSION
                    }
                }
            );

        if (
            response &&
            response.error
        ) {

            throw response.error;

        }

        if (
            !response ||
            typeof response.response ===
                "undefined"
        ) {

            throw new Error(
                "VK API не вернул response."
            );

        }

        return response.response;

    } catch (error) {

        logError(
            `VK API ${method}:`,
            error
        );

        throw error;

    }
}


/* ==========================================
   SCREEN CONTROL
   ========================================== */

function hideScreens() {

    albumsScreen
        .classList
        .add("hidden");

    photosScreen
        .classList
        .add("hidden");

    commentsScreen
        .classList
        .add("hidden");
}


function showAlbumsScreen() {

    hideScreens();

    albumsScreen
        .classList
        .remove("hidden");

    currentScreen =
        "albums";

    currentAlbum =
        null;

    pageTitleElement.textContent =
        "Фотоальбомы";

    backButton
        .classList
        .add("hidden");

    refreshAlbumsButton
        .classList
        .remove("hidden");

    window.scrollTo(
        0,
        0
    );
}


function showPhotosScreen() {

    hideScreens();

    photosScreen
        .classList
        .remove("hidden");

    currentScreen =
        "photos";

    backButton
        .classList
        .remove("hidden");

    refreshAlbumsButton
        .classList
        .add("hidden");

    window.scrollTo(
        0,
        0
    );
}


function showCommentsScreen() {

    hideScreens();

    commentsScreen
        .classList
        .remove("hidden");

    currentScreen =
        "comments";

    pageTitleElement.textContent =
        "Комментарии";

    backButton
        .classList
        .remove("hidden");

    refreshAlbumsButton
        .classList
        .add("hidden");

    window.scrollTo(
        0,
        0
    );
}


/* ==========================================
   MENU
   ========================================== */

/*
 * ВАЖНО:
 * Переносим само всплывающее меню непосредственно в <body>.
 * Теперь оно не является дочерним элементом sticky-шапки и
 * не может быть обрезано overflow/stacking context родителя.
 */
if (mainMenu && mainMenu.parentElement !== document.body) {
    document.body.appendChild(mainMenu);
}

function openMenu() {

    if (!mainMenu) {
        console.error("mainMenu not found");
        return;
    }

    /*
     * Убираем и CSS-класс hidden, и HTML-атрибут hidden,
     * если он случайно присутствует в index.html.
     */
    mainMenu.classList.remove("hidden");
    mainMenu.hidden = false;
    mainMenu.removeAttribute("hidden");

    /*
     * Критические свойства задаём inline.
     * Это имеет приоритет над обычными правилами style.css.
     */
    Object.assign(
        mainMenu.style,
        {
            display: "block",
            position: "fixed",
            top: "62px",
            left: "8px",
            width: "240px",
            zIndex: "2147483647",
            visibility: "visible",
            opacity: "1",
            transform: "none",
            background: "#24272a",
            color: "#ffffff"
        }
    );

    console.log(
        "Menu opened:",
        mainMenu.getBoundingClientRect()
    );
}


function closeMenu() {

    if (!mainMenu) {
        return;
    }

    mainMenu.classList.add("hidden");

    /*
     * display удаляем из inline-стилей, чтобы .hidden
     * снова полностью управлял закрытым состоянием.
     */
    mainMenu.style.removeProperty("display");
}


function toggleMenu() {

    if (!mainMenu) {
        return;
    }

    const isClosed =
        mainMenu.classList.contains("hidden") ||
        mainMenu.hidden ||
        getComputedStyle(mainMenu).display === "none";

    if (isClosed) {
        openMenu();
    } else {
        closeMenu();
    }
}


if (menuButton) {

    menuButton.addEventListener(
        "click",
        event => {

            event.preventDefault();
            event.stopPropagation();

            toggleMenu();
        }
    );
}


if (mainMenu) {

    mainMenu.addEventListener(
        "click",
        event => {

            /*
             * Нажатие по самому popup не должно закрывать его
             * раньше, чем обработается пункт меню.
             */
            event.stopPropagation();
        }
    );
}


document.addEventListener(
    "click",
    event => {

        if (
            menuButton &&
            (
                event.target === menuButton ||
                menuButton.contains(event.target)
            )
        ) {
            return;
        }

        if (
            mainMenu &&
            mainMenu.contains(event.target)
        ) {
            return;
        }

        closeMenu();
    }
);


/* ==========================================
   ALBUM COVER
   ========================================== */

function getAlbumCover(album) {

    if (
        Array.isArray(album.sizes) &&
        album.sizes.length
    ) {

        const sizes =
            album.sizes
                .filter(
                    size =>
                        size &&
                        (
                            size.src ||
                            size.url
                        )
                )
                .sort(
                    (a, b) =>
                        (
                            (b.width || 0) *
                            (b.height || 0)
                        ) -
                        (
                            (a.width || 0) *
                            (a.height || 0)
                        )
                );

        if (sizes.length) {

            return (
                sizes[0].src ||
                sizes[0].url
            );

        }

    }


    if (
        album.thumb &&
        Array.isArray(
            album.thumb.sizes
        )
    ) {

        const sizes =
            album.thumb.sizes
                .filter(
                    size =>
                        size &&
                        (
                            size.url ||
                            size.src
                        )
                )
                .sort(
                    (a, b) =>
                        (
                            (b.width || 0) *
                            (b.height || 0)
                        ) -
                        (
                            (a.width || 0) *
                            (a.height || 0)
                        )
                );

        if (sizes.length) {

            return (
                sizes[0].url ||
                sizes[0].src
            );

        }

    }


    return "";
}


/* ==========================================
   ALBUMS
   ========================================== */

async function loadAlbums() {

    albumsElement.innerHTML = `
        <div class="status-message">
            Загружаем альбомы...
        </div>
    `;

    const result =
        await vkApi(
            "photos.getAlbums",
            {
                owner_id:
                    currentUser.id,

                need_system:
                    1,

                need_covers:
                    1,

                photo_sizes:
                    1,

                count:
                    100
            }
        );

    albums =
        result.items || [];

    console.log(
        "Albums:",
        albums
    );

    renderAlbums();
}


function getFilteredAlbums() {

    const search =
        albumSearchText
            .trim()
            .toLocaleLowerCase("ru");

    if (!search) {
        return albums;
    }

    return albums.filter(
        album => {

            const title =
                String(
                    album.title || ""
                )
                    .toLocaleLowerCase("ru");

            return title.includes(
                search
            );
        }
    );
}


function renderAlbums() {

    albumsElement.innerHTML =
        "";

    const visibleAlbums =
        getFilteredAlbums();

    if (!visibleAlbums.length) {

        albumsElement.innerHTML = `
            <div class="status-message">
                ${
                    albumSearchText.trim()
                        ? "Альбомы не найдены"
                        : "Альбомов нет"
                }
            </div>
        `;

        return;
    }


    visibleAlbums.forEach(
        album => {

            const card =
                document.createElement(
                    "div"
                );

            card.className =
                "album-card";


            const cover =
                getAlbumCover(
                    album
                );


            if (cover) {

                const image =
                    document.createElement(
                        "img"
                    );

                image.className =
                    "album-cover";

                image.src =
                    cover;

                image.alt =
                    album.title || "";

                image.loading =
                    "lazy";

                card.appendChild(
                    image
                );

            } else {

                const placeholder =
                    document.createElement(
                        "div"
                    );

                placeholder.className =
                    "album-placeholder";

                placeholder.textContent =
                    "▣";

                card.appendChild(
                    placeholder
                );
            }


            const info =
                document.createElement(
                    "div"
                );

            info.className =
                "album-info";


            const name =
                document.createElement(
                    "div"
                );

            name.className =
                "album-name";

            name.textContent =
                album.title ||
                "Без названия";


            const count =
                document.createElement(
                    "div"
                );

            count.className =
                "album-count";

            count.textContent =
                String(
                    album.size || 0
                );


            info.append(
                name,
                count
            );

            card.appendChild(
                info
            );


            card.addEventListener(
                "click",
                () => {

                    openAlbum(
                        album
                    );

                }
            );


            albumsElement.appendChild(
                card
            );

        }
    );
}


/* ==========================================
   SEARCH
   ========================================== */

albumSearch.addEventListener(
    "input",
    event => {

        albumSearchText =
            event.target.value;

        clearSearchButton
            .classList
            .toggle(
                "hidden",
                !albumSearchText
            );

        renderAlbums();
    }
);


clearSearchButton.addEventListener(
    "click",
    () => {

        albumSearch.value =
            "";

        albumSearchText =
            "";

        clearSearchButton
            .classList
            .add("hidden");

        renderAlbums();

        albumSearch.focus();
    }
);


/* ==========================================
   CREATE ALBUM
   ========================================== */

function openCreateAlbumModal() {

    closeMenu();

    createAlbumError
        .classList
        .add("hidden");

    createAlbumError.textContent =
        "";

    newAlbumTitle.value =
        "";

    newAlbumDescription.value =
        "";

    createAlbumModal
        .classList
        .remove("hidden");

    setTimeout(
        () => {

            newAlbumTitle.focus();

        },
        50
    );
}


function closeCreateAlbumModal() {

    createAlbumModal
        .classList
        .add("hidden");
}


createAlbumMenuButton.addEventListener(
    "click",
    openCreateAlbumModal
);


closeCreateAlbumButton.addEventListener(
    "click",
    closeCreateAlbumModal
);


cancelCreateAlbumButton.addEventListener(
    "click",
    closeCreateAlbumModal
);


createAlbumModal.addEventListener(
    "click",
    event => {

        if (
            event.target ===
            createAlbumModal
        ) {

            closeCreateAlbumModal();

        }

    }
);


createAlbumForm.addEventListener(
    "submit",
    async event => {

        event.preventDefault();


        const title =
            newAlbumTitle.value.trim();

        const description =
            newAlbumDescription.value.trim();


        if (!title) {
            return;
        }


        createAlbumError
            .classList
            .add("hidden");


        submitCreateAlbum.disabled =
            true;

        submitCreateAlbum.textContent =
            "Создаём...";


        try {

            const result =
                await vkApi(
                    "photos.createAlbum",
                    {
                        title:
                            title,

                        description:
                            description,

                        privacy_view:
                            "all",

                        privacy_comment:
                            "all",

                        comments_disabled:
                            0
                    }
                );


            console.log(
                "Album created:",
                result
            );


            closeCreateAlbumModal();


            /*
             * После создания сразу
             * перечитываем альбомы.
             */

            await loadAlbums();


            showAlbumsScreen();


        } catch (error) {

            createAlbumError.textContent =
                getErrorMessage(
                    error
                );

            createAlbumError
                .classList
                .remove("hidden");

        } finally {

            submitCreateAlbum.disabled =
                false;

            submitCreateAlbum.textContent =
                "Создать";

        }

    }
);


/* ==========================================
   PHOTOS
   ========================================== */

async function openAlbum(album) {

    currentAlbum =
        album;

    showPhotosScreen();

    pageTitleElement.textContent =
        album.title ||
        "Альбом";

    albumTitleElement.textContent =
        album.title ||
        "Альбом";

    albumDescriptionElement.textContent =
        album.description ||
        "";

    photoCountElement.textContent =
        `${album.size || 0} фото`;

    photosElement.innerHTML = `
        <div class="status-message">
            Загружаем фотографии...
        </div>
    `;


    try {

        await loadPhotos(
            album
        );

    } catch (error) {

        photosElement.innerHTML = `
            <div class="error">

                Не удалось загрузить фотографии.

                <br><br>

                ${escapeHtml(
                    getErrorMessage(error)
                )}

            </div>
        `;

    }
}


async function loadPhotos(album) {

    const result =
        await vkApi(
            "photos.get",
            {
                owner_id:
                    currentUser.id,

                album_id:
                    album.id,

                extended:
                    1,

                photo_sizes:
                    1,

                count:
                    100
            }
        );

    photos =
        result.items || [];

    renderPhotos();

    photoCountElement.textContent =
        `${photos.length} фото`;
}


function getBestPhotoUrl(photo) {

    if (
        !photo ||
        !Array.isArray(photo.sizes)
    ) {
        return "";
    }

    const sizes =
        photo.sizes
            .filter(
                size =>
                    size &&
                    size.url
            )
            .sort(
                (a, b) =>
                    (
                        (b.width || 0) *
                        (b.height || 0)
                    ) -
                    (
                        (a.width || 0) *
                        (a.height || 0)
                    )
            );

    return sizes.length
        ? sizes[0].url
        : "";
}


function renderPhotos() {

    photosElement.innerHTML =
        "";

    if (!photos.length) {

        photosElement.innerHTML = `
            <div class="status-message">
                В этом альбоме нет фотографий
            </div>
        `;

        return;
    }


    photos.forEach(
        photo => {

            const card =
                document.createElement(
                    "div"
                );

            card.className =
                "photo-card";


            const url =
                getBestPhotoUrl(
                    photo
                );


            if (url) {

                const image =
                    document.createElement(
                        "img"
                    );

                image.src =
                    url;

                image.alt =
                    photo.text || "";

                image.loading =
                    "lazy";

                card.appendChild(
                    image
                );
            }


            card.addEventListener(
                "click",
                () => {

                    console.log(
                        "Selected photo:",
                        photo
                    );

                }
            );


            photosElement.appendChild(
                card
            );

        }
    );
}


/* ==========================================
   COMMENTS
   ========================================== */

commentsMenuButton.addEventListener(
    "click",
    async () => {

        closeMenu();

        showCommentsScreen();

        await loadAllComments();

    }
);


refreshCommentsButton.addEventListener(
    "click",
    loadAllComments
);


async function loadAllComments() {

    commentsElement.innerHTML = `
        <div class="status-message">
            Загружаем комментарии...
        </div>
    `;


    refreshCommentsButton.disabled =
        true;


    try {

        /*
         * Комментарии принадлежат фотографиям,
         * поэтому проходим по альбомам,
         * получаем фотографии и затем
         * комментарии.
         *
         * Начинаем с ограниченного количества,
         * чтобы не отправлять огромное число
         * запросов одновременно.
         */

        const allComments =
            [];


        for (const album of albums) {

            let albumPhotos;

            try {

                const result =
                    await vkApi(
                        "photos.get",
                        {
                            owner_id:
                                currentUser.id,

                            album_id:
                                album.id,

                            photo_sizes:
                                1,

                            count:
                                100
                        }
                    );

                albumPhotos =
                    result.items || [];

            } catch (error) {

                console.warn(
                    "Не удалось получить фото альбома:",
                    album.title,
                    error
                );

                continue;
            }


            for (
                const photo of albumPhotos
            ) {

                try {

                    const result =
                        await vkApi(
                            "photos.getComments",
                            {
                                owner_id:
                                    currentUser.id,

                                photo_id:
                                    photo.id,

                                extended:
                                    1,

                                count:
                                    100,

                                sort:
                                    "desc"
                            }
                        );


                    const items =
                        result.items || [];


                    for (
                        const comment of items
                    ) {

                        allComments.push({
                            comment,
                            photo,
                            album,
                            profiles:
                                result.profiles || [],
                            groups:
                                result.groups || []
                        });

                    }

                } catch (error) {

                    console.warn(
                        "Не удалось получить комментарии фото:",
                        photo.id,
                        error
                    );

                }

            }

        }


        /*
         * Новые комментарии выше.
         */

        allComments.sort(
            (a, b) =>
                (
                    b.comment.date || 0
                ) -
                (
                    a.comment.date || 0
                )
        );


        renderComments(
            allComments
        );


    } catch (error) {

        commentsElement.innerHTML = `
            <div class="error">

                Не удалось загрузить комментарии.

                <br><br>

                ${escapeHtml(
                    getErrorMessage(error)
                )}

            </div>
        `;

    } finally {

        refreshCommentsButton.disabled =
            false;

    }
}


/* ==========================================
   COMMENT AUTHOR
   ========================================== */

function getCommentAuthor(data) {

    const fromId =
        data.comment.from_id;


    if (fromId > 0) {

        const profile =
            data.profiles.find(
                item =>
                    item.id === fromId
            );


        if (profile) {

            return (
                `${profile.first_name || ""} ${profile.last_name || ""}`
                    .trim()
            );

        }

    }


    if (fromId < 0) {

        const groupId =
            Math.abs(fromId);


        const group =
            data.groups.find(
                item =>
                    item.id === groupId
            );


        if (group) {

            return (
                group.name ||
                "Сообщество"
            );

        }

    }


    return "Пользователь";
}


/* ==========================================
   RENDER COMMENTS
   ========================================== */

function renderComments(items) {

    commentsElement.innerHTML =
        "";


    if (!items.length) {

        commentsElement.innerHTML = `
            <div class="status-message">
                Комментариев нет
            </div>
        `;

        return;
    }


    items.forEach(
        data => {

            const card =
                document.createElement(
                    "div"
                );

            card.className =
                "comment-card";


            /*
             * Фото.
             */

            const photoUrl =
                getBestPhotoUrl(
                    data.photo
                );


            if (photoUrl) {

                const image =
                    document.createElement(
                        "img"
                    );

                image.className =
                    "comment-photo";

                image.src =
                    photoUrl;

                image.alt =
                    "";

                image.loading =
                    "lazy";

                card.appendChild(
                    image
                );

            }


            /*
             * Текстовая часть.
             */

            const body =
                document.createElement(
                    "div"
                );

            body.className =
                "comment-body";


            const album =
                document.createElement(
                    "div"
                );

            album.className =
                "comment-album";

            album.textContent =
                data.album.title ||
                "Альбом";


            const author =
                document.createElement(
                    "div"
                );

            author.className =
                "comment-author";

            author.textContent =
                getCommentAuthor(
                    data
                );


            const text =
                document.createElement(
                    "div"
                );

            text.className =
                "comment-text";

            text.textContent =
                data.comment.text ||
                "(без текста)";


            const date =
                document.createElement(
                    "div"
                );

            date.className =
                "comment-date";


            if (data.comment.date) {

                date.textContent =
                    new Date(
                        data.comment.date *
                        1000
                    )
                        .toLocaleString(
                            "ru-RU"
                        );

            }


            body.append(
                album,
                author,
                text,
                date
            );


            card.appendChild(
                body
            );


            commentsElement.appendChild(
                card
            );

        }
    );
}


/* ==========================================
   BACK
   ========================================== */

backButton.addEventListener(
    "click",
    () => {

        if (
            currentScreen ===
            "photos"
        ) {

            showAlbumsScreen();
            return;

        }


        if (
            currentScreen ===
            "comments"
        ) {

            showAlbumsScreen();
            return;

        }


        showAlbumsScreen();

    }
);


/* ==========================================
   REFRESH ALBUMS
   ========================================== */

refreshAlbumsButton.addEventListener(
    "click",
    async () => {

        try {

            await loadAlbums();

        } catch (error) {

            albumsElement.innerHTML = `
                <div class="error">

                    Не удалось обновить альбомы.

                    <br><br>

                    ${escapeHtml(
                        getErrorMessage(error)
                    )}

                </div>
            `;

        }

    }
);


/* ==========================================
   ESC
   ========================================== */

document.addEventListener(
    "keydown",
    event => {

        if (
            event.key !== "Escape"
        ) {
            return;
        }


        if (
            !createAlbumModal
                .classList
                .contains("hidden")
        ) {

            closeCreateAlbumModal();
            return;

        }


        if (
            !mainMenu
                .classList
                .contains("hidden")
        ) {

            closeMenu();
            return;

        }


        if (
            currentScreen !== "albums"
        ) {

            showAlbumsScreen();

        }

    }
);


/* ==========================================
   START
   ========================================== */

async function startApp() {

    console.log(
        "Starting VK Photo Manager..."
    );


    try {

        await vkInit();

        await loadUser();

        await getAccessToken();

        await loadAlbums();

        showAlbumsScreen();


        console.log(
            "VK Photo Manager started."
        );


    } catch (error) {

        logError(
            "Application startup error:",
            error
        );


        albumsElement.innerHTML = `
            <div class="error">

                <b>
                    Ошибка запуска приложения
                </b>

                <br><br>

                ${escapeHtml(
                    getErrorMessage(error)
                )}

            </div>
        `;

    }
}


startApp();
