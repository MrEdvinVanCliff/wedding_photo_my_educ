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