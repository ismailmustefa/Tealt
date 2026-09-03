const form = document.querySelector("#application-profile");
const saveMessage = document.querySelector("#save-message");
const storageKey = "tealtApplicationProfile";
const maxResumeSize = 5 * 1024 * 1024;
const resumeInput = document.querySelector("#resume-file");
const resumeDetails = document.querySelector("#resume-file-details");
const resumeName = document.querySelector("#resume-file-name");
const resumeSize = document.querySelector("#resume-file-size");
const resumeMessage = document.querySelector("#resume-message");
const removeResumeButton = document.querySelector("#remove-resume");
let savedResume = null;

// DOM references for repeatable employment and education sections.
const repeaters = {
  work: {
    list: document.querySelector("#work-list"),
    template: document.querySelector("#work-template"),
    addButton: document.querySelector("#add-work"),
  },
  education: {
    list: document.querySelector("#education-list"),
    template: document.querySelector("#education-template"),
    addButton: document.querySelector("#add-education"),
  },
};

/** Updates visible numbering and storage-compatible field names after edits. */
function renumberEntries(type) {
  const cards = [...repeaters[type].list.querySelectorAll(".repeat-card")];

  cards.forEach((card, index) => {
    card.querySelector(".entry-number").textContent = index + 1;
    card.querySelectorAll("[data-field]").forEach((field) => {
      field.name = `${type}[${index}][${field.dataset.field}]`;
    });
  });
}

/** Adds one repeatable work or education card, optionally with saved values. */
function addEntry(type, values = {}) {
  const repeater = repeaters[type];
  const card = repeater.template.content.firstElementChild.cloneNode(true);

  card.querySelectorAll("[data-field]").forEach((field) => {
    field.value = values[field.dataset.field] ?? "";
  });

  card.querySelector(".remove-button").addEventListener("click", () => {
    card.remove();
    renumberEntries(type);
  });

  repeater.list.append(card);
  renumberEntries(type);
}

/** Serializes every card in a repeatable section. */
function collectEntries(type) {
  return [...repeaters[type].list.querySelectorAll(".repeat-card")].map((card) =>
    Object.fromEntries(
      [...card.querySelectorAll("[data-field]")].map((field) => [field.dataset.field, field.value.trim()]),
    ),
  );
}

/** Creates the complete profile object persisted in extension-local storage. */
function collectProfile() {
  const profile = {};

  form.querySelectorAll("input:not([data-field]), select:not([data-field]), textarea:not([data-field])").forEach((field) => {
    if (field.name) profile[field.name] = field.value;
  });

  profile.work = collectEntries("work");
  profile.educationHistory = collectEntries("education");
  profile.resume = savedResume;
  return profile;
}

/** Formats a byte count for the resume summary. */
function formatFileSize(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/** Synchronizes the resume model and its upload/summary UI. */
function showResume(resume) {
  savedResume = resume;
  resumeDetails.hidden = !resume;
  document.querySelector(".upload-dropzone").hidden = Boolean(resume);
  resumeName.textContent = resume?.name ?? "";
  resumeSize.textContent = resume ? `${formatFileSize(resume.size)} · Saved in Chrome` : "";
}

/** Reads an uploaded file into a storage-safe data URL. */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
}

/** Validates and stages a newly selected resume for the next profile save. */
resumeInput.addEventListener("change", async () => {
  const file = resumeInput.files[0];
  resumeMessage.textContent = "";
  if (!file) return;

  if (file.size > maxResumeSize) {
    resumeInput.value = "";
    resumeMessage.textContent = "Please choose a resume smaller than 5 MB.";
    return;
  }

  try {
    showResume({
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
      data: await readFileAsDataUrl(file),
    });
    resumeMessage.textContent = "Resume ready. Save your details to keep it.";
  } catch (error) {
    console.error("Could not read the resume:", error);
    resumeMessage.textContent = "That resume could not be read. Please try another file.";
  }
});

/** Clears the staged resume; persistence occurs when the profile is saved. */
removeResumeButton.addEventListener("click", () => {
  resumeInput.value = "";
  showResume(null);
  resumeMessage.textContent = "Resume removed. Save your details to confirm.";
});

/** Restores saved scalar fields, resume data, and repeatable history entries. */
async function restoreProfile() {
  const result = await chrome.storage.local.get(storageKey);
  const savedProfile = result[storageKey] ?? {};
  showResume(savedProfile.resume ?? null);

  form.querySelectorAll("input:not([data-field]), select:not([data-field]), textarea:not([data-field])").forEach((field) => {
    if (!field.name) return;

    // Profiles saved before address lines were separated used the `address`
    // key. Restore that value into Address 1 without losing existing data.
    if (field.name === "address1" && savedProfile.address1 === undefined && savedProfile.address !== undefined) {
      field.value = savedProfile.address;
    } else if (savedProfile[field.name] !== undefined) {
      field.value = savedProfile[field.name];
    }
  });

  const savedWork = savedProfile.work?.length
    ? savedProfile.work
    : [{
        employer: savedProfile.employer,
        jobTitle: savedProfile.jobTitle,
        jobStart: savedProfile.jobStart,
        jobEnd: savedProfile.jobEnd,
        achievements: savedProfile.achievements,
      }];

  const savedEducation = savedProfile.educationHistory?.length
    ? savedProfile.educationHistory
    : [{ school: savedProfile.school, fieldOfStudy: savedProfile.fieldOfStudy }];

  savedWork.forEach((entry) => addEntry("work", entry));
  savedEducation.forEach((entry) => addEntry("education", entry));
}

repeaters.work.addButton.addEventListener("click", () => addEntry("work"));
repeaters.education.addButton.addEventListener("click", () => addEntry("education"));

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    await chrome.storage.local.set({ [storageKey]: collectProfile() });
    saveMessage.textContent = "Your details have been saved.";
  } catch (error) {
    console.error("Could not save the application profile:", error);
    saveMessage.textContent = "Your details could not be saved. Please try again.";
  }

  window.setTimeout(() => { saveMessage.textContent = ""; }, 3500);
});

restoreProfile().catch((error) => {
  console.error("Could not restore the application profile:", error);
  addEntry("work");
  addEntry("education");
  saveMessage.textContent = "Saved details could not be loaded.";
});
