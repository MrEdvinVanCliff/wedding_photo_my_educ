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

const photoPickerArea = document.querySelector("#photo-picker-area");


photoPickerArea.addEventListener('click', () => {
  photoInput.click();
});


const photoPreview = document.querySelector("#photo-preview");
const photoPlaceholder = document.querySelector("#photo-placeholder");
const photoCounter = document.querySelector("#photo-counter");

const MAX_PHOTOS = 12;
const MAX_PHOTO_SIZE = 10 * 1024 * 1024;

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
    const files = Array.from(event.target.files);

    const availableSlots = MAX_PHOTOS - selectedFiles.length;

    const filesToAdd = files.slice(0, availableSlots);

    selectedFiles.push(...filesToAdd);

    renderPhotoPreview();

    photoInput.value = "";
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

    photoPreview.innerHTML = "";

    if (selectedFiles.length === 0) {
        photoPlaceholder.style.display = "flex";
    } else {
        photoPlaceholder.style.display = "none";
    }

    selectedFiles.forEach((file) => {

        const item = document.createElement("div");
        item.classList.add("photo-preview__item");

        const image = document.createElement("img");

        image.src = URL.createObjectURL(file);
        image.alt = file.name;

        item.appendChild(image);

        photoPreview.appendChild(item);
    });


    if (selectedFiles.length < MAX_PHOTOS) {

        const addButton = document.createElement("div");

        addButton.classList.add("photo-preview__add");

        addButton.innerHTML = "+";

        addButton.addEventListener("click", (event) => {
            event.stopPropagation();

            photoInput.click();
        });

        photoPreview.appendChild(addButton);
    }


    photoCounter.textContent =
        `${selectedFiles.length} / ${MAX_PHOTOS}`;
}

console.log({
    photoInput,
    photoPicker,
    photoPreview,
    photoError
});