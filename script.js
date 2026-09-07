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

photoInput.addEventListener("change", handleFileSelection);

const photoPickerArea = document.querySelector("#photo-picker-area");


photoPickerArea.addEventListener('click', () => {
  photoInput.click();
});


const photoPreview = document.querySelector("#photo-preview");
const photoPlaceholder = document.querySelector("#photo-placeholder");


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




// обробка вибору файлів

function handleFileSelection(event) {
    const files = Array.from(event.target.files);

    const availableSlots = MAX_PHOTOS - selectedFiles.length;

    const filesToAdd = files.slice(0, availableSlots);

    selectedFiles.push(...filesToAdd);

    updatePhotoCount(selectedFiles.length);

    renderPhotoPreview();

    photoInput.value = "";
}



// оновлення лічильника фото

console.log("Кількість вибраних фото:", selectedFiles.length);

const photoCount = document.querySelector("#photo-count");

function updatePhotoCount(count) {
  if (count === 0) {
    photoCount.style.display = "none";
  } else {
    photoCount.style.display = "block";
    photoCount.textContent = `додано ${count} фото з ${MAX_PHOTOS}`;
  }
}



// рендеринг попереднього перегляду фото

function renderPhotoPreview() {

    photoPreview.innerHTML = "";

    if (selectedFiles.length === 0) {
        photoPlaceholder.style.display = "flex";
    } else {
        photoPlaceholder.style.display = "none";
    }

    selectedFiles.forEach((file, index) => {

        const item = document.createElement("div");
        item.classList.add("photo-preview__item");

        const image = document.createElement("img");
        image.src = URL.createObjectURL(file);
        image.alt = file.name;

        const removeButton = document.createElement("button");
        removeButton.classList.add("photo-preview__remove");
        removeButton.type = "button";
        removeButton.textContent = "×";

        removeButton.addEventListener("click", (event) => {
            event.stopPropagation();
            selectedFiles.splice(index, 1);
            updatePhotoCount(selectedFiles.length);
            renderPhotoPreview();
        });
        
        item.appendChild(image);
        item.appendChild(removeButton);
        photoPreview.appendChild(item);

    });


    if (selectedFiles.length > 0 && selectedFiles.length < MAX_PHOTOS) {

        const addButton = document.createElement("div");

        addButton.classList.add("photo-preview__add");

        addButton.innerHTML = "+";

        addButton.addEventListener("click", (event) => {
            event.stopPropagation();

            photoInput.click();
        });

        photoPreview.appendChild(addButton);
    }

}




console.log({
    photoInput,
    photoPicker,
    photoPreview,
    photoError
});