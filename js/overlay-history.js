import { state } from "./state.js?v=20260927-captiontop43";

let activeOverlay = null;
let closingPromise = null;
let resolveClosing = null;

function setVkSwipeHistory(enabled) {
    try {
        if (!window.vkBridge?.send) return;

        Promise.resolve(
            window.vkBridge.send("VKWebAppSetSwipeSettings", {
                history: Boolean(enabled)
            })
        ).catch(error => {
            console.debug("VK swipe settings are unavailable:", error);
        });
    } catch (error) {
        console.debug("VK swipe settings are unavailable:", error);
    }
}

function restoreScreenSwipeMode() {
    setVkSwipeHistory(state.currentScreen !== "albums");
}

function finishClose() {
    const current = activeOverlay;
    activeOverlay = null;

    if (current?.closeDirect) {
        try {
            current.closeDirect();
        } catch (error) {
            console.warn("Не удалось закрыть активное окно:", error);
        }
    }

    restoreScreenSwipeMode();

    const resolve = resolveClosing;
    resolveClosing = null;

    // ВАЖНО: finishClose() вызывается прямо из обработчика popstate.
    // Если разрешить Promise немедленно, код после `await closeSwipeOverlay()`
    // может продолжить навигацию, пока другие popstate-listener'ы ещё
    // обрабатывают старое состояние истории. Это создавало гонку, при которой
    // открытие комментариев альбома тут же принималось за уход с экрана.
    // Переносим продолжение в следующую задачу event loop.
    window.setTimeout(() => {
        closingPromise = null;
        resolve?.(true);
    }, 0);
}

export function openSwipeOverlay(id, closeDirect) {
    if (!id || typeof closeDirect !== "function") return false;

    if (activeOverlay?.id === id) {
        setVkSwipeHistory(true);
        return true;
    }

    // Одновременно у приложения должен быть только один верхний оверлей.
    // Переходы между меню выполняются через await closeSwipeOverlay(),
    // поэтому эта ветка служит только страховкой.
    if (activeOverlay) {
        try { activeOverlay.closeDirect(); } catch {}
        activeOverlay = null;
    }

    activeOverlay = { id, closeDirect };

    const current = { ...(history.state || {}) };
    delete current.__uiOverlay;

    history.pushState(
        { ...current, __uiOverlay: id },
        "",
        window.location.href
    );

    // На корневом экране VK обычно отдаёт свайп контейнеру приложения.
    // Пока открыто наше окно, просим VK передать жест истории WebView.
    setVkSwipeHistory(true);
    return true;
}

export function closeSwipeOverlay(id) {
    if (!activeOverlay || activeOverlay.id !== id) {
        return Promise.resolve(false);
    }

    if (closingPromise) return closingPromise;

    closingPromise = new Promise(resolve => {
        resolveClosing = resolve;
    });

    if (history.state?.__uiOverlay === id) {
        history.back();
    } else {
        // Если состояние истории было заменено внешним кодом, всё равно
        // корректно закрываем интерфейс, не отправляя пользователя назад.
        queueMicrotask(finishClose);
    }

    return closingPromise;
}

export function handleOverlayPopState() {
    if (!activeOverlay) return false;

    finishClose();
    return true;
}

export function hasActiveSwipeOverlay() {
    return Boolean(activeOverlay);
}
