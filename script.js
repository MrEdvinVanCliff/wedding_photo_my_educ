"use strict";

const modal = document.querySelector("#upload-modal");
const openModalButton = document.querySelector("#open-upload-modal");
const uploadForm = document.querySelector("#upload-form");
const uploadModes = document.querySelectorAll('input[name="uploadMode"]');
const photoStyles = document.querySelector("#photo-styles");
const anonymousCheckbox = document.querySelector("#anonymous-checkbox");
const nameField = document.querySelector("#name-field");
const nameInput = document.querySelector("#guest-name");
const photoInput = document.querySelector("#photo-input");
const photoPickerArea = document.querySelector("#photo-picker-area");
const photoPreview = document.querySelector("#photo-preview");
const photoPlaceholder = document.querySelector("#photo-placeholder");
const photoSubtitle = document.querySelector("#photo-hint");
const photoError = document.querySelector("#photo-error");
const photoCount = document.querySelector("#photo-count");
const uploadStatus = document.querySelector("#upload-status");
const submitButton = uploadForm.querySelector('[type="submit"]');

const MAX_PHOTOS = 12;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
const MAX_PHOTO_PIXELS = 50_000_000;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const modeSelections = { standard: [], advanced: [] };
let currentUploadMode = "standard";
let nextPhotoId = 0;
let isSelecting = false;

openModalButton.addEventListener("click", () => {
    modal.showModal();
    modal.querySelector(".modal__sheet").scrollTop = 0;
    document.body.classList.add("modal-open");
});

document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", closeModal);
});

function restorePageFocus() {
    if (modal.open) return;
    document.body.classList.remove("modal-open");
    openModalButton.focus({ preventScroll: true });
}

function closeModal() {
    modal.close();
    restorePageFocus();
}

modal.addEventListener("close", restorePageFocus);
modal.addEventListener("cancel", (event) => {
    event.preventDefault();
    closeModal();
});

// Native <dialog> makes the background inert. Keep Tab cycling within the
// form as well, including browsers that otherwise move focus to their toolbar.
modal.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const controls = [...modal.querySelectorAll("button, input")].filter((element) =>
        !element.matches(":disabled") && element.getClientRects().length
        && (element.type !== "radio" || element.checked));
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
});

function syncAnonymous() {
    nameField.hidden = anonymousCheckbox.checked;
    nameInput.disabled = anonymousCheckbox.checked;
}

anonymousCheckbox.addEventListener("change", syncAnonymous);

function setPhotoError(message = "") {
    photoError.textContent = message;
}

function setUploadStatus(message = "") {
    uploadStatus.textContent = message;
}

function choosePhotos() {
    if (!isSelecting) photoInput.click();
}

photoPlaceholder.addEventListener("click", choosePhotos);
photoInput.addEventListener("change", handleFileSelection);
uploadModes.forEach((input) => input.addEventListener("change", syncUploadMode));

function validatePhoto(file) {
    const hasSupportedExtension = /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name);
    if (!SUPPORTED_TYPES.has(file.type) && !(file.type === "" && hasSupportedExtension)) {
        return `«${file.name}»: виберіть JPG, PNG, WebP, GIF або AVIF.`;
    }
    if (!file.size) return `«${file.name}»: файл порожній.`;
    if (file.size > MAX_PHOTO_SIZE) return `«${file.name}»: розмір перевищує 10 МБ.`;
    return "";
}

// Keep the original file, but display a small thumbnail instead of decoding
// up to twelve full-resolution photos every time the mode changes.
async function createPhotoPreview(file) {
    const sourceUrl = URL.createObjectURL(file);
    const image = new Image();
    try {
        image.src = sourceUrl;
        await image.decode();
        if (image.naturalWidth * image.naturalHeight > MAX_PHOTO_PIXELS) {
            throw new Error("Фото перевищує 50 мегапікселів. Виберіть зменшену копію.");
        }
        const scale = Math.min(1, 640 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        const thumbnail = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
        if (!thumbnail) throw new Error("Не вдалося створити попередній перегляд.");
        return URL.createObjectURL(thumbnail);
    } finally {
        image.removeAttribute("src");
        URL.revokeObjectURL(sourceUrl);
    }
}

function setSelectionBusy(busy) {
    isSelecting = busy;
    uploadForm.setAttribute("aria-busy", String(busy));
    photoInput.disabled = busy;
    submitButton.disabled = busy;
    uploadModes.forEach((input) => { input.disabled = busy; });
    photoPickerArea.querySelectorAll("button").forEach((button) => { button.disabled = busy; });
}

async function handleFileSelection(event) {
    const files = Array.from(event.target.files);
    photoInput.value = "";
    if (!files.length || isSelecting) return;

    setPhotoError();
    setUploadStatus("Готуємо попередній перегляд…");
    setSelectionBusy(true);
    const selectedFiles = modeSelections[currentUploadMode];
    const isAdvanced = currentUploadMode === "advanced";
    const errors = new Set();

    try {
        for (const file of (isAdvanced ? files.slice(0, 1) : files)) {
            if (!isAdvanced && selectedFiles.length >= MAX_PHOTOS) {
                errors.add(`Можна вибрати не більше ${MAX_PHOTOS} фото.`);
                break;
            }
            const error = validatePhoto(file);
            if (error) {
                errors.add(error);
                continue;
            }
            if (!isAdvanced && selectedFiles.some((photo) => photo.file.name === file.name
                && photo.file.size === file.size && photo.file.lastModified === file.lastModified)) {
                errors.add(`«${file.name}» уже вибрано.`);
                continue;
            }
            try {
                const previewUrl = await createPhotoPreview(file);
                if (isAdvanced) clearSelectedPhotos(selectedFiles);
                selectedFiles.push({ id: ++nextPhotoId, file, previewUrl });
            } catch (error) {
                errors.add(`«${file.name}»: ${error.name === "EncodingError"
                    ? "не вдалося прочитати зображення. Перевірте файл або виберіть JPG чи PNG."
                    : error.message}`);
            }
        }
        if (isAdvanced && files.length > 1) errors.add("У розширеному режимі можна вибрати лише одне фото.");
    } finally {
        setSelectionBusy(false);
        setUploadStatus();
        setPhotoError([...errors].join(" "));
        renderPhotoPreview();
        if (modal.open) focusPhotoControl();
    }
}

function clearSelectedPhotos(photos) {
    photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    photos.length = 0;
}

function removeSelectedPhoto(id) {
    if (isSelecting) return;
    const photos = modeSelections[currentUploadMode];
    const index = photos.findIndex((photo) => photo.id === id);
    if (index === -1) return;
    URL.revokeObjectURL(photos[index].previewUrl);
    photos.splice(index, 1);
    setPhotoError();
    setUploadStatus();
    renderPhotoPreview();
    focusPhotoControl(index);
}

function focusPhotoControl(index = 0) {
    const removeButtons = photoPreview.querySelectorAll(".photo-preview__remove");
    const target = removeButtons[Math.min(index, removeButtons.length - 1)] || photoPlaceholder;
    target.focus({ preventScroll: true });
}

function renderPhotoPreview() {
    const selectedFiles = modeSelections[currentUploadMode];
    const fragment = document.createDocumentFragment();
    photoPlaceholder.hidden = selectedFiles.length > 0;

    selectedFiles.forEach((photo) => {
        const item = document.createElement("div");
        item.className = "photo-preview__item";
        const image = document.createElement("img");
        image.src = photo.previewUrl;
        image.alt = photo.file.name;
        image.decoding = "async";
        const removeButton = document.createElement("button");
        removeButton.className = "photo-preview__remove";
        removeButton.type = "button";
        removeButton.setAttribute("aria-label", `Прибрати ${photo.file.name}`);
        removeButton.textContent = "×";
        removeButton.addEventListener("click", () => removeSelectedPhoto(photo.id));

        if (currentUploadMode === "advanced") {
            const replaceButton = document.createElement("button");
            replaceButton.type = "button";
            replaceButton.className = "photo-preview__replace";
            replaceButton.setAttribute("aria-label", "Замінити фото");
            replaceButton.append(image);
            replaceButton.addEventListener("click", choosePhotos);
            item.append(replaceButton, removeButton);
        } else {
            item.append(image, removeButton);
        }
        fragment.append(item);
    });

    if (currentUploadMode === "standard" && selectedFiles.length > 0 && selectedFiles.length < MAX_PHOTOS) {
        const addButton = document.createElement("button");
        addButton.className = "photo-preview__add";
        addButton.type = "button";
        addButton.setAttribute("aria-label", "Додати ще фото");
        addButton.textContent = "+";
        addButton.addEventListener("click", choosePhotos);
        fragment.append(addButton);
    }

    photoPreview.replaceChildren(fragment);
    const limit = currentUploadMode === "advanced" ? 1 : MAX_PHOTOS;
    photoCount.hidden = selectedFiles.length === 0;
    photoCount.textContent = selectedFiles.length ? `вибрано ${selectedFiles.length} фото з ${limit}` : "";
}

function syncUploadMode() {
    currentUploadMode = uploadForm.elements.uploadMode.value;
    const isAdvanced = currentUploadMode === "advanced";
    photoInput.multiple = !isAdvanced;
    photoStyles.hidden = !isAdvanced;
    photoStyles.disabled = !isAdvanced;
    photoPickerArea.classList.toggle("is-advanced", isAdvanced);
    photoSubtitle.textContent = isAdvanced ? "1 фото, максимум 10 МБ" : "до 12 фото, максимум 10 МБ кожне";
    setPhotoError();
    setUploadStatus();
    renderPhotoPreview();
}

uploadForm.addEventListener("submit", (event) => {
    // No upload service is connected. Never navigate with guest data in the URL
    // or report a successful upload without actually saving the files.
    event.preventDefault();
    if (isSelecting) return;
    if (!modeSelections[currentUploadMode].length) {
        setPhotoError("Спочатку виберіть хоча б одне фото.");
        photoPlaceholder.focus();
        return;
    }
    setPhotoError();
    setUploadStatus("Завантаження ще недоступне. Фото залишаються лише в попередньому перегляді й не збережені в альбомі.");
});

window.addEventListener("pagehide", (event) => {
    // Retain thumbnails when the browser caches this page for Back/Forward.
    if (!event.persisted) Object.values(modeSelections).forEach(clearSelectedPhotos);
});

syncAnonymous();
syncUploadMode();
openModalButton.disabled = false;
