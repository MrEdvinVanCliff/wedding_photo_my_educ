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