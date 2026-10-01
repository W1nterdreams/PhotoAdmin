export function escapeHtml(v) {
    return String(v ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

export function getErrorMessage(e) {
    if (!e) return "Неизвестная ошибка";
    if (typeof e === "string") return e;

    return (
        e.message ||
        e.error_msg ||
        e.error?.error_msg ||
        e.error_data?.error_msg ||
        String(e)
    );
}

export function logError(title, error) {
    console.error(title, error);

    if (error && typeof error === "object") {
        try {
            console.error(
                `${title} DETAILS:\n${JSON.stringify(error, null, 2)}`
            );
        } catch (jsonError) {
            console.error(
                `${title} — не удалось вывести объект ошибки`,
                jsonError
            );
        }
    }
}

export function getBestPhotoUrl(p) {
    if (!Array.isArray(p?.sizes)) return "";

    const a = [...p.sizes]
        .filter(x => x?.url)
        .sort(
            (a, b) =>
                (b.width || 0) * (b.height || 0) -
                (a.width || 0) * (a.height || 0)
        );

    return a[0]?.url || "";
}

export function getPhotoPreviewUrl(p, targetSize = 200) {
    if (!Array.isArray(p?.sizes)) return "";

    const sizes = [...p.sizes]
        .filter(x => x?.url)
        .map(x => ({
            ...x,
            maxSide: Math.max(Number(x.width || 0), Number(x.height || 0))
        }))
        .sort((a, b) => a.maxSide - b.maxSide);

    if (!sizes.length) return "";

    // Для сетки берём самый маленький вариант, который уже достаточно
    // крупный для чёткой карточки. Если такого нет — берём максимальный.
    const suitable = sizes.find(x => x.maxSide >= targetSize);
    return (suitable || sizes[sizes.length - 1]).url || "";
}

export function getAlbumCover(a) {
    const sizes = [
        ...(Array.isArray(a?.sizes) ? a.sizes : []),
        ...(Array.isArray(a?.thumb?.sizes) ? a.thumb.sizes : [])
    ].filter(x => x && (x.src || x.url));

    if (!sizes.length) return "";

    const TARGET = 200;

    const suitable = sizes
        .filter(x => Math.max(x.width || 0, x.height || 0) >= TARGET)
        .sort((a, b) =>
            Math.max(a.width || 0, a.height || 0) -
            Math.max(b.width || 0, b.height || 0)
        );

    const selected = suitable[0] || sizes.sort((a, b) =>
        (b.width || 0) * (b.height || 0) -
        (a.width || 0) * (a.height || 0)
    )[0];

    return selected?.src || selected?.url || "";
}

