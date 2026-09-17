"use strict";

const modal = document.querySelector("#upload-modal");
const openModalButton = document.querySelector("#open-upload-modal");
const uploadForm = document.querySelector("#upload-form");
const uploadModes = document.querySelectorAll('input[name="uploadMode"]');
const photoStyles = document.querySelector("#photo-styles");
const anonymousCheckbox = document.querySelector("#anonymous-checkbox");
const nameField = document.querySelector("#name-field");
const nameInput = document.querySelector("#guest-name");
const commentInput = document.querySelector("#guest-comment");
const styleNotice = document.querySelector("#style-notice");
const photoInput = document.querySelector("#photo-input");
const photoPickerArea = document.querySelector("#photo-picker-area");
const photoPreview = document.querySelector("#photo-preview");
const photoPlaceholder = document.querySelector("#photo-placeholder");
const photoSubtitle = document.querySelector("#photo-hint");
const photoError = document.querySelector("#photo-error");
const photoCount = document.querySelector("#photo-count");
const uploadStatus = document.querySelector("#upload-status");
const submitButton = uploadForm.querySelector('[type="submit"]');
const galleryGrid = document.querySelector("#gallery-grid");
const galleryColumns = [document.querySelector("#gallery-left"), document.querySelector("#gallery-right")];
const galleryStatus = document.querySelector("#gallery-status");
const galleryRetry = document.querySelector("#gallery-retry");

const MAX_PHOTOS = 12;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;
const MAX_PHOTO_PIXELS = 50_000_000;
const SUPPORTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif"]);
const modeSelections = { standard: [], advanced: [] };
let currentUploadMode = "standard";
let nextPhotoId = 0;
let isSelecting = false;
let isUploading = false;
let submissionId = null;
let galleryVersion = 0;
const carouselObservers = new Set();
const deviceId = getDeviceId();

// randomUUID() is not available on plain HTTP on a phone's LAN address.
function createId() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function getDeviceId() {
    const key = "wedding.deviceId";
    try {
        const saved = localStorage.getItem(key);
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved || "")) return saved;
        const created = createId();
        localStorage.setItem(key, created);
        return created;
    } catch {
        // The gallery still works when the browser forbids persistent storage.
        return createId();
    }
}

uploadForm.addEventListener("input", () => { if (!isUploading) submissionId = null; });

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
    nameInput.required = !anonymousCheckbox.checked;
}

anonymousCheckbox.addEventListener("change", syncAnonymous);

function setPhotoError(message = "") {
    photoError.textContent = message;
}

function setUploadStatus(message = "") {
    uploadStatus.textContent = message;
}

function choosePhotos() {
    if (!isSelecting && !isUploading) photoInput.click();
}

photoPlaceholder.addEventListener("click", choosePhotos);
photoInput.addEventListener("change", handleFileSelection);
uploadModes.forEach((input) => input.addEventListener("change", syncUploadMode));

function validatePhoto(file) {
    const hasSupportedExtension = /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(file.name);
    if (!SUPPORTED_TYPES.has(file.type) && !(file.type === "" && hasSupportedExtension)) {
        return `«${file.name}»: виберіть JPG, PNG, WebP, GIF, AVIF або HEIC.`;
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
    } catch (error) {
        // Many phone browsers cannot decode HEIC. The server validates it and
        // creates a WebP for the gallery; show a placeholder until then.
        if (error.name === "EncodingError" && (/\.(heic|heif)$/i.test(file.name)
            || ["image/heic", "image/heif"].includes(file.type))) return "assets/empty_photo.webp";
        throw error;
    } finally {
        image.removeAttribute("src");
        URL.revokeObjectURL(sourceUrl);
    }
}

function setSelectionBusy(busy) {
    isSelecting = busy;
    syncBusyState();
}

function syncBusyState() {
    const busy = isSelecting || isUploading;
    uploadForm.setAttribute("aria-busy", String(busy));
    uploadForm.querySelectorAll("button, input").forEach((control) => { control.disabled = busy; });
    nameInput.disabled = busy || anonymousCheckbox.checked;
    photoStyles.disabled = busy || currentUploadMode !== "advanced";
    submitButton.textContent = isUploading ? "завантажуємо…" : "завантажити";
}

async function handleFileSelection(event) {
    const files = Array.from(event.target.files);
    photoInput.value = "";
    if (!files.length || isSelecting || isUploading) return;
    submissionId = null;

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
    if (isSelecting || isUploading) return;
    submissionId = null;
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
    styleNotice.hidden = !isAdvanced;
    photoPickerArea.classList.toggle("is-advanced", isAdvanced);
    photoSubtitle.textContent = isAdvanced ? "виберіть одну фотографію" : "виберіть до 12 фотографій";
    setPhotoError();
    setUploadStatus();
    renderPhotoPreview();
}

uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (isSelecting || isUploading) return;
    const photos = modeSelections[currentUploadMode];
    if (!photos.length) {
        setPhotoError("Спочатку виберіть хоча б одне фото.");
        photoPlaceholder.focus();
        return;
    }
    if (!anonymousCheckbox.checked && !nameInput.value.trim()) {
        setUploadStatus("Введіть ім’я або виберіть анонімний режим.");
        nameInput.focus();
        return;
    }
    setPhotoError();
    setUploadStatus("Завантажуємо й зберігаємо фотографії…");
    submissionId ||= createId();
    const data = new FormData();
    data.append("submissionId", submissionId);
    data.append("authorName", anonymousCheckbox.checked ? "" : nameInput.value.trim());
    data.append("isAnonymous", String(anonymousCheckbox.checked));
    data.append("comment", commentInput.value.trim());
    data.append("uploadMode", currentUploadMode);
    if (currentUploadMode === "advanced") data.append("photoStyle", uploadForm.elements.photoStyle.value);
    photos.forEach((photo) => data.append("photos", photo.file));
    isUploading = true;
    syncBusyState();
    try {
        const post = await apiRequest("/api/posts", { method: "POST", body: data });
        ++galleryVersion; // A slower initial GET must not overwrite this new post.
        const card = createPostCard(post);
        const column = galleryColumns[0].scrollHeight <= galleryColumns[1].scrollHeight
            ? galleryColumns[0] : galleryColumns[1];
        column.prepend(card);
        galleryGrid.setAttribute("aria-busy", "false");
        galleryStatus.textContent = "Фотографії збережено в альбомі.";
        galleryRetry.hidden = true;
        Object.values(modeSelections).forEach(clearSelectedPhotos);
        uploadForm.reset();
        syncAnonymous();
        syncUploadMode();
        submissionId = null;
        closeModal();
        document.querySelector("#gallery").scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    } catch (error) {
        // Preserve both files and submissionId so a retry cannot create duplicates.
        setUploadStatus(`${error.message} Вибрані фото збережені у формі — спробуйте ще раз.`);
    } finally {
        isUploading = false;
        syncBusyState();
    }
});

async function apiRequest(url, options = {}) {
    let response;
    try {
        response = await fetch(url, {
            ...options,
            headers: { "X-Device-Id": deviceId, ...options.headers },
            cache: "no-store",
        });
    } catch {
        throw new Error("Немає зв’язку із сервером. Перевірте Wi-Fi та запуск альбому на MacBook.");
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
        const detail = payload?.detail;
        throw new Error(typeof detail === "string" ? detail : `Не вдалося виконати запит (${response.status}).`);
    }
    if (!payload) throw new Error("Сервер повернув некоректну відповідь.");
    return payload;
}

function scrollBehavior() {
    return matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
}

function createPhotoElement(photo, author, index, total) {
    const image = document.createElement("img");
    image.className = "post-card__image";
    image.src = photo.url;
    if (photo.thumbnailWidth < photo.width) {
        image.srcset = `${photo.thumbnailUrl} ${photo.thumbnailWidth}w, ${photo.url} ${photo.width}w`;
        image.sizes = "(min-width: 1232px) 596px, calc((100vw - 40px) / 2)";
    }
    image.width = photo.width;
    image.height = photo.height;
    image.loading = "lazy";
    image.decoding = "async";
    image.alt = `${author}: фото ${index + 1} з ${total}`;
    return image;
}

function createCarousel(photos, author) {
    const media = document.createElement("div");
    media.className = "post-card__media";
    if (photos.length === 1) {
        media.append(createPhotoElement(photos[0], author, 0, 1));
        return [media];
    }
    media.classList.add("post-carousel");
    media.setAttribute("role", "region");
    media.setAttribute("aria-roledescription", "карусель");
    media.setAttribute("aria-label", `Фотографії: ${author}`);
    const track = document.createElement("div");
    track.className = "post-carousel__track";
    track.tabIndex = 0;
    track.setAttribute("aria-label", "Гортайте фото свайпом або стрілками ліворуч і праворуч");
    const dots = document.createElement("div");
    dots.className = "post-carousel__dots";
    dots.setAttribute("role", "group");
    dots.setAttribute("aria-label", "Оберіть фотографію");
    let activeIndex = 0;
    let frame = 0;
    let previousWidth = 0;

    const setActive = (index) => {
        activeIndex = index;
        const photo = photos[index];
        media.style.aspectRatio = `${photo.width} / ${photo.height}`;
        [...dots.children].forEach((dot, i) => {
            dot.setAttribute("aria-current", String(i === index));
        });
        [...track.children].forEach((slide, i) => {
            slide.setAttribute("aria-hidden", String(i !== index));
        });
    };
    const goTo = (index) => {
        const next = Math.max(0, Math.min(photos.length - 1, index));
        track.scrollTo({ left: next * track.clientWidth, behavior: scrollBehavior() });
    };
    photos.forEach((photo, index) => {
        const slide = document.createElement("div");
        slide.className = "post-carousel__slide";
        slide.setAttribute("role", "group");
        slide.setAttribute("aria-label", `${index + 1} з ${photos.length}`);
        slide.append(createPhotoElement(photo, author, index, photos.length));
        track.append(slide);
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "post-carousel__dot";
        dot.setAttribute("aria-label", `Фото ${index + 1} з ${photos.length}`);
        dot.addEventListener("click", () => goTo(index));
        dots.append(dot);
    });
    track.addEventListener("scroll", () => {
        if (frame) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            // Rotation changes the width before the scroll offset is realigned.
            // Let ResizeObserver preserve the current slide in that frame.
            if (!track.clientWidth || track.clientWidth !== previousWidth) return;
            const index = Math.max(0, Math.min(photos.length - 1, Math.round(track.scrollLeft / track.clientWidth)));
            if (index !== activeIndex) setActive(index);
        });
    }, { passive: true });
    track.addEventListener("keydown", (event) => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        goTo(event.key === "Home" ? 0 : event.key === "End" ? photos.length - 1
            : activeIndex + (event.key === "ArrowRight" ? 1 : -1));
    });
    const observer = new ResizeObserver(() => {
        const width = track.clientWidth;
        if (width && width !== previousWidth) {
            previousWidth = width;
            track.scrollLeft = activeIndex * width;
        }
    });
    observer.observe(track);
    carouselObservers.add(observer);
    media.append(track);
    setActive(0);
    return [media, dots];
}

function createPostCard(post) {
    const author = post.isAnonymous ? "анонімно" : post.authorName;
    const card = document.createElement("article");
    card.className = "post-card";
    card.dataset.postId = post.id;
    card.setAttribute("aria-label", `Публікація: ${author}`);
    card.append(...createCarousel(post.photos, author));
    const meta = document.createElement("div");
    meta.className = "post-card__meta";
    const name = document.createElement("span");
    name.className = "post-card__author";
    name.textContent = author;
    name.title = author;
    const like = document.createElement("button");
    like.className = "post-card__like";
    like.type = "button";
    const heart = document.createElement("span");
    heart.className = "post-card__heart";
    heart.setAttribute("aria-hidden", "true");
    const count = document.createElement("span");
    count.className = "post-card__likes-count";
    const errorMessage = document.createElement("p");
    errorMessage.className = "post-card__error";
    errorMessage.setAttribute("role", "alert");
    errorMessage.hidden = true;
    const renderLike = () => {
        like.setAttribute("aria-pressed", String(post.likedByDevice));
        like.setAttribute("aria-label", `${post.likedByDevice ? "Прибрати" : "Поставити"} вподобання. Усього: ${post.likesCount}`);
        heart.textContent = post.likedByDevice ? "♥" : "♡";
        count.textContent = String(post.likesCount);
    };
    like.append(heart, count);
    like.addEventListener("click", async () => {
        if (like.disabled) return;
        like.disabled = true;
        errorMessage.hidden = true;
        try {
            const result = await apiRequest(`/api/posts/${post.id}/like`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deviceId, liked: !post.likedByDevice }),
            });
            Object.assign(post, result);
            renderLike();
        } catch (error) {
            errorMessage.textContent = error.message;
            errorMessage.hidden = false;
        } finally {
            like.disabled = false;
        }
    });
    renderLike();
    meta.append(name, like);
    card.append(meta);
    if (post.comment) {
        const comment = document.createElement("p");
        comment.className = "post-card__comment";
        comment.textContent = post.comment;
        comment.title = post.comment;
        card.append(comment);
    }
    card.append(errorMessage);
    return card;
}

async function loadPosts() {
    const version = ++galleryVersion;
    galleryGrid.setAttribute("aria-busy", "true");
    galleryStatus.textContent = "Завантажуємо фотографії…";
    galleryRetry.hidden = true;
    try {
        const posts = await apiRequest("/api/posts");
        if (version !== galleryVersion) return;
        carouselObservers.forEach((observer) => observer.disconnect());
        carouselObservers.clear();
        galleryColumns.forEach((column) => column.replaceChildren());
        const columnWidth = galleryColumns[0].clientWidth || 175;
        const heights = [0, 0];
        const fragments = [document.createDocumentFragment(), document.createDocumentFragment()];
        posts.forEach((post) => {
            if (!post.photos?.length) return;
            const index = heights[0] <= heights[1] ? 0 : 1;
            fragments[index].append(createPostCard(post));
            const first = post.photos[0];
            heights[index] += columnWidth * first.height / first.width + 64
                + (post.comment ? 18 : 0) + (post.photos.length > 1 ? 27 : 0);
        });
        galleryColumns.forEach((column, index) => column.append(fragments[index]));
        galleryStatus.textContent = posts.length ? "" : "Тут з’являться ваші спільні спогади. Додайте перші фотографії.";
    } catch (error) {
        if (version !== galleryVersion) return;
        galleryStatus.textContent = error.message;
        galleryRetry.hidden = false;
    } finally {
        if (version === galleryVersion) galleryGrid.setAttribute("aria-busy", "false");
    }
}

galleryRetry.addEventListener("click", loadPosts);

window.addEventListener("pagehide", (event) => {
    // Retain thumbnails when the browser caches this page for Back/Forward.
    if (!event.persisted) Object.values(modeSelections).forEach(clearSelectedPhotos);
});

syncAnonymous();
syncUploadMode();
openModalButton.disabled = false;
loadPosts();
window.addEventListener("pageshow", (event) => { if (event.persisted) loadPosts(); });
