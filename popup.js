const updateDetailsButton = document.querySelector("#update-details-button");
const autofillButton = document.querySelector("#autofill-button");
const statusText = document.querySelector(".status-copy");

updateDetailsButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("form.html") });
});

autofillButton.addEventListener("click", async () => {
  autofillButton.disabled = true;
  statusText.textContent = "Filling this page...";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/i.test(tab.url ?? "")) throw new Error("Open a website form before using autofill.");
    const response = await chrome.tabs.sendMessage(tab.id, { type: "TEALT_AUTOFILL" });
    if (!response?.ok) throw new Error(response?.error || "This page could not be filled.");
    statusText.textContent = response.filled
      ? `Filled ${response.filled} field${response.filled === 1 ? "" : "s"}.`
      : "No matching empty fields were found.";
  } catch (error) {
    statusText.textContent = error.message.includes("Receiving end")
      ? "Reload this webpage, then try again."
      : error.message;
  } finally {
    autofillButton.disabled = false;
  }
});
