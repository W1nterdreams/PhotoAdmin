export const VK_APP_ID = 54771516;
export const VK_API_VERSION = "5.199";

// Кэш нужен прежде всего для мгновенного показа интерфейса.
// После открытия экранов данные дополнительно перепроверяются в фоне,
// поэтому TTL можно держать коротким и не показывать пользователю устаревшее долго.
export const CACHE_TTL = {
    albums: 2 * 60 * 1000,
    albumIndex: 30 * 60 * 1000,
    photos: 2 * 60 * 1000,
    comments: 2 * 60 * 1000
};

export const COMMENTS_DAYS = 10;
