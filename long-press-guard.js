const DEFAULT_GRACE_MS = 250;
const FAILSAFE_MS = 2500;

let guardGeneration = 0;
let blockedUntil = 0;
let waitingForRelease = false;

function isBlockedNow() {
    return waitingForRelease || Date.now() < blockedUntil;
}

/**
 * Блокирует клики по только что открывшемуся меню long press до отпускания
 * исходного указателя и ещё на небольшую паузу. Это защищает от WebView,
 * которые после удержания генерируют обычный click уже по новому overlay/menu.
 */
export function armLongPressReleaseGuard(pointerId = null, graceMs = DEFAULT_GRACE_MS) {
    const generation = ++guardGeneration;
    const expectedPointerId = pointerId !== null && pointerId !== undefined && Number.isFinite(Number(pointerId))
        ? Number(pointerId)
        : null;
    waitingForRelease = true;
    blockedUntil = Number.POSITIVE_INFINITY;

    let failSafeTimer = null;

    const cleanup = () => {
        document.removeEventListener("pointerup", onRelease, true);
        document.removeEventListener("pointercancel", onRelease, true);
        if (failSafeTimer !== null) {
            window.clearTimeout(failSafeTimer);
            failSafeTimer = null;
        }
    };

    const finish = () => {
        if (generation !== guardGeneration) {
            cleanup();
            return;
        }
        waitingForRelease = false;
        blockedUntil = Date.now() + Math.max(0, Number(graceMs) || 0);
        cleanup();
    };

    function onRelease(event) {
        if (generation !== guardGeneration) {
            cleanup();
            return;
        }
        if (expectedPointerId !== null && Number(event.pointerId) !== expectedPointerId) return;
        finish();
    }

    document.addEventListener("pointerup", onRelease, true);
    document.addEventListener("pointercancel", onRelease, true);

    // Страховка на случай, если WebView потерял pointerup/pointercancel.
    failSafeTimer = window.setTimeout(finish, FAILSAFE_MS);
}

export function isLongPressReleaseGuardActive() {
    return isBlockedNow();
}

/** Возвращает true, если click был поглощён защитой. */
export function consumeLongPressSyntheticClick(event) {
    if (!isBlockedNow()) return false;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();
    return true;
}
