const updateDetailsButton = document.querySelector("#update-details-button");

updateDetailsButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("form.html") });
});
