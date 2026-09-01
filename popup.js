const updateDetailsButton = document.querySelector("#update-details-button");
const autofillButton = document.querySelector("#autofill-button");
const statusText = document.querySelector(".status-copy");

/** Opens the extension's locally stored application-profile editor. */
updateDetailsButton.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("form.html") });
});

/**
 * Sends an autofill request to the active tab. If the tab predates the current
 * extension session, injects the content script and retries the request once.
 *
 * @param {number} tabId Chrome's identifier for the active tab.
 * @returns {Promise<{ok: boolean, filled?: number, error?: string}>}
 */
async function requestAutofill(tabId) {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "TEALT_AUTOFILL" });
  } catch (error) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(error.message)) throw error;

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["scripts/autofill.js"],
    });
    return chrome.tabs.sendMessage(tabId, { type: "TEALT_AUTOFILL" });
  }
}

/** Runs autofill for the current web page and exposes progress to the user. */
autofillButton.addEventListener("click", async () => {
  autofillButton.disabled = true;
  statusText.textContent = "Filling this page...";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/i.test(tab.url ?? "")) throw new Error("Open a website form before using autofill.");
    const response = await requestAutofill(tab.id);
    if (!response?.ok) throw new Error(response?.error || "This page could not be filled.");
    statusText.textContent = response.filled
      ? `Filled ${response.filled} field${response.filled === 1 ? "" : "s"}.`
      : "No matching empty fields were found.";
  } catch (error) {
    statusText.textContent = error.message || "This page could not be filled.";
  } finally {
    autofillButton.disabled = false;
  }
});
