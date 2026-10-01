import { state } from "./state.js?v=20261001-comments-light47";
import { openPhotoTransferMany } from "./photo-transfer.js?v=20261001-comments-light47";

let active = false;
let selectedIds = new Set();
let toolbar = null;
let countLabel = null;
let moveButton = null;

function installStyles() {
    if (document.getElementById("photoMultiSelectStyles")) return;

    const style = document.createElement("style");
    style.id = "photoMultiSelectStyles";
    style.textContent = `
        body.photo-multiselect-active #photos {
            padding-bottom: 86px;
        }

        .photo-card.photo-multi-selected {
            outline: 3px solid var(--app-red-500);
            outline-offset: -3px;
        }

        .photo-select-check {
            position: absolute;
            z-index: 6;
            top: 7px;
            right: 7px;
            display: flex;
            align-items: center;
            justify-content: center;
            width: 27px;
            height: 27px;
            border: 2px solid rgba(255,255,255,0.95);
            border-radius: 50%;
            background: rgba(20,22,24,0.58);
            color: transparent;
            font-size: 17px;
            font-weight: 800;
            line-height: 1;
            box-shadow: 0 1px 5px rgba(0,0,0,0.45);
            pointer-events: none;
        }

        .photo-card.photo-multi-selected .photo-select-check {
            background: linear-gradient(180deg, #f64a5b, #cf0d27);
            color: #fff;
        }

        .photo-multiselect-toolbar {
            position: fixed;
            z-index: 90000;
            left: 0;
            right: 0;
            bottom: 0;
            display: flex;
            align-items: center;
            gap: 8px;
            min-height: 64px;
            padding: 9px 10px calc(9px + env(safe-area-inset-bottom, 0px));
            border-top: 1px solid rgba(255,255,255,.16);
            background: linear-gradient(150deg, rgba(125,0,16,.98), rgba(72,0,9,.98));
            box-shadow: 0 -4px 18px rgba(0,0,0,0.34);
        }

        .photo-multiselect-count {
            flex: 1;
            min-width: 0;
            color: #fff;
            font-size: 15px;
            font-weight: 600;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .photo-multiselect-button {
            flex: 0 0 auto;
            min-height: 40px;
            padding: 7px 13px;
            border: 0;
            border-radius: 9px;
            color: #fff;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
        }

        .photo-multiselect-move {
            background: linear-gradient(180deg, #f64a5b, #cf0d27);
        }

        .photo-multiselect-cancel {
            background: rgba(255,255,255,.14);
        }

        .photo-multiselect-button:disabled {
            opacity: 0.45;
            cursor: default;
        }
    `;
    document.head.appendChild(style);
}

function ensureToolbar() {
    if (toolbar) return;
    installStyles();

    toolbar = document.createElement("div");
    toolbar.className = "photo-multiselect-toolbar hidden";

    countLabel = document.createElement("div");
    countLabel.className = "photo-multiselect-count";

    moveButton = document.createElement("button");
    moveButton.type = "button";
    moveButton.className = "photo-multiselect-button photo-multiselect-move";
    moveButton.textContent = "Переместить";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "photo-multiselect-button photo-multiselect-cancel";
    cancelButton.textContent = "Отмена";

    moveButton.addEventListener("click", () => {
        const photos = getSelectedPhotos();
        if (!photos.length) return;

        void openPhotoTransferMany(photos, {
            onComplete: () => cancelPhotoMultiSelect()
        });
    });

    cancelButton.addEventListener("click", () => cancelPhotoMultiSelect());

    toolbar.append(countLabel, moveButton, cancelButton);
    document.body.appendChild(toolbar);
}

function updateToolbar() {
    ensureToolbar();
    const count = selectedIds.size;
    countLabel.textContent = `Выбрано: ${count}`;
    moveButton.disabled = count === 0;
    toolbar.classList.toggle("hidden", !active);
    document.body.classList.toggle("photo-multiselect-active", active);
}

function notifyChanged() {
    updateToolbar();
    window.dispatchEvent(new CustomEvent("photo-multiselect-change"));
}

export function isPhotoMultiSelectActive() {
    return active;
}

export function isPhotoSelected(photoOrId) {
    const id = typeof photoOrId === "object" ? photoOrId?.id : photoOrId;
    return selectedIds.has(String(id ?? ""));
}

export function getSelectedPhotos() {
    if (!active || !selectedIds.size) return [];
    return state.photos.filter(photo => selectedIds.has(String(photo.id)));
}

export function startPhotoMultiSelect(initialPhoto = null) {
    ensureToolbar();
    active = true;
    selectedIds = new Set();

    if (initialPhoto?.id != null) {
        selectedIds.add(String(initialPhoto.id));
    }

    state.suppressPhotoOpenUntil = Date.now() + 700;
    notifyChanged();
}

export function togglePhotoSelection(photo) {
    if (!active || photo?.id == null) return;

    const id = String(photo.id);
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);

    notifyChanged();
}

export function cancelPhotoMultiSelect({ silent = false } = {}) {
    if (!active && selectedIds.size === 0) return;

    active = false;
    selectedIds.clear();
    updateToolbar();

    if (!silent) {
        window.dispatchEvent(new CustomEvent("photo-multiselect-change"));
    }
}
