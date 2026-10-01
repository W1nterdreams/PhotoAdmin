export const state = {
    currentUser: null,
    accessToken: null,
    accessScope: "",

    group: null,

    albums: [],
    albumsTotal: 0,
    albumsOffset: 0,
    albumsHasMore: false,
    albumsLoadingMore: false,

    albumIndex: [],
    albumIndexReady: false,
    albumIndexBuilding: false,
    currentAlbum: null,
    currentPhoto: null,
    photoViewerSource: "",
    photos: [],
    photosTotal: 0,
    photosOffset: 0,
    photosHasMore: false,
    photosLoadingMore: false,
    photosFreshAlbumId: null,
    photoSortMode: "vk",
    photoSearchText: "",
    suppressPhotoOpenUntil: 0,

    albumSearchText: "",
    currentScreen: "albums"
};
