const SEARCH_INPUT_SELECTOR = 'input[type="search"], .photo-transfer-search';
const CLEAR_BUTTON_SELECTOR = '.clear-search, .global-photo-search-clear, .photo-transfer-clear';

let initialized = false;

function getElement(target) {
    if (target instanceof Element) return target;
    return target?.parentElement || null;
}

function isSearchInput(element) {
    return element instanceof HTMLInputElement && element.matches(SEARCH_INPUT_SELECTOR);
}

function hideSearchKeyboard(input) {
    if (isSearchInput(input) && document.activeElement === input) {
        input.blur();
    }
}

/**
 * Dismiss the Android/VK WebView keyboard when the user taps away from a
 * search field. Delegation also covers search controls created later in
 * dynamically opened overlays.
 */
export function initSearchKeyboardDismiss() {
    if (initialized) return;
    initialized = true;

    document.addEventListener("pointerdown", event => {
        const activeInput = document.activeElement;
        if (!isSearchInput(activeInput)) return;

        const target = getElement(event.target);
        if (!target || target === activeInput || activeInput.contains(target)) return;

        // Clearing a query deliberately keeps the field focused so the user
        // can immediately type a replacement.
        if (target.closest(CLEAR_BUTTON_SELECTOR)) return;

        // Let another editable control take focus normally.
        if (target.closest('input, textarea, select, [contenteditable="true"]')) return;

        // This includes the magnifying-glass icon, empty screen space, and
        // the results area. Blur on pointer-down so a swipe can begin with
        // the keyboard already closing instead of being trapped by it.
        hideSearchKeyboard(activeInput);
    }, true);

    // The Android keyboard's Search/Enter action should also dismiss it.
    document.addEventListener("keydown", event => {
        if (event.key !== "Enter") return;
        const activeInput = document.activeElement;
        if (!isSearchInput(activeInput)) return;
        event.preventDefault();
        hideSearchKeyboard(activeInput);
    }, true);
}
