console.log("script.js працює");

const modal = document.querySelector("#upload-modal");
const openModalButton = document.querySelector("#open-upload-modal");
const closeModalButtons = document.querySelectorAll("[data-close-modal]");

function openModal() {
    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");

    document.body.classList.add("modal-open");
}

function closeModal() {
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");

    document.body.classList.remove("modal-open");
}

openModalButton.addEventListener("click", openModal);

closeModalButtons.forEach((button) => {
    button.addEventListener("click", closeModal);
});

// приховування імені
const anonymousCheckbox =
    document.querySelector("#anonymous-checkbox");

const nameField =
    document.querySelector("#name-field");

const nameInput =
    document.querySelector("#guest-name");

anonymousCheckbox.addEventListener("change", () => {
    const isAnonymous = anonymousCheckbox.checked;

    nameField.classList.toggle("is-hidden", isAnonymous);
    nameInput.disabled = isAnonymous;

    if (isAnonymous) {
        nameInput.value = "";
    }
});

// вибір фото

const photoInput = document.querySelector("#photo-input");

console.log("Знайдене поле:", photoInput);

photoInput.addEventListener("change", handleFileSelection);

const photoPicker = document.querySelector(".photo-picker");
const photoPreview = document.querySelector("#photo-preview");
const photoError = document.querySelector("#photo-error");

const MAX_FILES = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

let selectedFiles = [];

// перевірка помилок при виборі фото

function showPhotoError(message) {
    photoError.textContent = message;
    photoError.classList.add("is-visible");
}

function clearPhotoError() {
    photoError.textContent = "";
    photoError.classList.remove("is-visible");
}


// очищення попереднього перегляду фото

function clearPhotoPreview() {
    photoPreview
        .querySelectorAll("img")
        .forEach((image) => {
            URL.revokeObjectURL(image.src);
        });

    photoPreview.innerHTML = "";
}


// обробка вибору файлів

function handleFileSelection(event) {
    clearPhotoError();

    const newFiles = Array.from(event.target.files);

    for (const file of newFiles) {
        if (!file.type.startsWith("image/")) {
            showPhotoError(`Файл "${file.name}" не є зображенням.`);
            continue;
        }

        if (file.size > MAX_FILE_SIZE) {
            showPhotoError(
                `Файл "${file.name}" перевищує максимальний розмір 10 MB.`
            );
            continue;
        }

        if (selectedFiles.length >= MAX_FILES) {
            showPhotoError(
                `Можна вибрати не більше ${MAX_FILES} фотографій.`
            );
            break;
        }

        selectedFiles.push(file);
    }

    photoInput.value = "";

    console.log("Фото в масиві:", selectedFiles);

    renderPhotoPreview();

    console.log(selectedFiles);
}

// відображення попереднього перегляду фото

function createPhotoItem(file) {
    const item = document.createElement("div");
    item.classList.add("photo-picker__item");

    const image = document.createElement("img");
    image.classList.add("photo-picker__image");
    image.src = URL.createObjectURL(file);
    image.alt = "Вибрана фотографія";

    item.append(image);

    return item;
}

// створення кнопки додавання фото

function createAddButton() {
    const addButton = document.createElement("label");

    addButton.classList.add("photo-picker__add");
    addButton.setAttribute("for", "photo-input");
    addButton.setAttribute("aria-label", "Додати ще фото");
    addButton.textContent = "+";

    return addButton;
}

// створення елемента для відображення кількості прихованих фото

function createMoreItem(file, hiddenCount) {
    const item = createPhotoItem(file);

    item.classList.add("photo-picker__more");

    const count = document.createElement("span");
    count.classList.add("photo-picker__count");
    count.textContent = `+${hiddenCount}`;

    item.append(count);

    return item;
}

// рендеринг попереднього перегляду фото

function renderPhotoPreview() {

    console.log("renderPhotoPreview запущено");
    console.log("Кількість фото:", selectedFiles.length);

    clearPhotoPreview();

    const hasPhotos = selectedFiles.length > 0;

    photoPicker.classList.toggle("has-photos", hasPhotos);

    if (!hasPhotos) {
        return;
    }

    if (selectedFiles.length <= 4) {
        selectedFiles.forEach((file) => {
            const item = createPhotoItem(file);
            photoPreview.append(item);
        });

        if (selectedFiles.length < 4) {
            photoPreview.append(createAddButton());
        }

        return;
    }

    const visibleFiles = selectedFiles.slice(0, 3);
    const hiddenCount = selectedFiles.length - 3;

    visibleFiles.forEach((file) => {
        photoPreview.append(createPhotoItem(file));
    });

    photoPreview.append(
        createMoreItem(selectedFiles[3], hiddenCount)
    );
}

console.log({
    photoInput,
    photoPicker,
    photoPreview,
    photoError
});