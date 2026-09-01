(() => {
  const STORAGE_KEY = "tealtApplicationProfile";
  const normalize = (value) => String(value ?? "").toLowerCase().replace(/[_\-\[\]()/:*]+/g, " ").replace(/\s+/g, " ").trim();
  const aliases = {
    firstName: ["first name", "given name", "firstname", "given-name"], lastName: ["last name", "family name", "surname", "lastname", "family-name"],
    email: ["email", "email address", "e-mail"], phone: ["phone", "phone number", "mobile", "telephone", "tel"],
    address: ["street address", "address line 1", "address1", "mailing address"], city: ["city", "town", "locality"],
    state: ["state", "province", "region", "address-level1"], postalCode: ["postal code", "zip code", "zipcode", "postcode", "postal-code"],
    country: ["country", "country name", "country-name"], currentTitle: ["current job title", "current title", "professional title", "headline"],
    yearsExperience: ["years of experience", "years experience", "total experience"], linkedin: ["linkedin", "linkedin url", "linkedin profile"],
    portfolio: ["portfolio", "website", "personal website", "portfolio url"], github: ["github", "github url", "github profile"],
    education: ["highest education", "education level", "highest degree"], summary: ["professional summary", "summary", "about you", "profile"],
    skills: ["skills", "core skills", "key skills"], salary: ["desired salary", "salary expectation", "expected salary", "compensation"],
    startDate: ["available start date", "start date", "date available", "availability date"], workSetting: ["preferred work setting", "work setting", "workplace type", "remote preference"],
    employmentType: ["employment type", "job type", "position type"], workAuthorized: ["authorized to work", "work authorization", "legally authorized", "eligible to work"],
    sponsorship: ["visa sponsorship", "require sponsorship", "sponsorship"], relocate: ["willing to relocate", "relocation", "relocate"], travel: ["willing to travel", "travel"],
    gender: ["gender", "gender identity", "sex"], ethnicity: ["race", "ethnicity", "race ethnicity"], veteran: ["veteran", "veteran status"], disability: ["disability", "disability status"],
  };
  const repeatAliases = {
    employer: ["employer", "company", "organization"], jobTitle: ["job title", "position title", "role"], workPhone: ["work phone", "company phone"], supervisor: ["supervisor", "manager"],
    workAddress: ["work address", "company address"], workCity: ["work city", "company city"], workState: ["work state", "company state"], workPostalCode: ["work postal code", "company zip"],
    workCountry: ["work country", "company country"], jobStart: ["employment start date", "job start date"], jobEnd: ["employment end date", "job end date"],
    achievements: ["responsibilities", "achievements", "job description"], school: ["school", "institution", "university", "college"], degree: ["degree", "credential"],
    fieldOfStudy: ["field of study", "major", "discipline"], graduationDate: ["graduation date", "graduated"], schoolAddress: ["school address"], schoolCity: ["school city"],
    schoolState: ["school state"], schoolPostalCode: ["school postal code", "school zip"], schoolCountry: ["school country"],
  };

  function descriptor(element) {
    const labels = element.labels ? [...element.labels].map((label) => label.innerText) : [];
    const labelled = (element.getAttribute("aria-labelledby") || "").split(/\s+/).map((id) => document.getElementById(id)?.innerText || "");
    const container = element.closest("label, fieldset, [role=group], [class*=field], [class*=question]");
    return normalize([element.name, element.id, element.autocomplete, element.placeholder, element.getAttribute("aria-label"), element.getAttribute("data-testid"),
      ...labels, ...labelled, container?.querySelector("legend")?.innerText, container?.querySelector("label")?.innerText].filter(Boolean).join(" "));
  }

  function profileEntries(profile) {
    const result = Object.entries(aliases).filter(([key]) => profile[key] !== undefined && profile[key] !== "")
      .map(([key, names]) => ({ value: profile[key], names: [key, ...names].map(normalize) }));
    [profile.work?.[0], profile.educationHistory?.[0]].filter(Boolean).forEach((record) => Object.entries(record).forEach(([key, value]) => {
      if (value !== undefined && value !== "" && repeatAliases[key]) result.push({ value, names: repeatAliases[key].map(normalize) });
    }));
    return result;
  }

  function bestMatch(element, entries) {
    const text = descriptor(element);
    return entries.map((entry) => ({ entry, score: Math.max(...entry.names.map((name) => text === name ? 100 : text.includes(name) ? 60 + Math.min(name.length, 30) : 0)) }))
      .sort((a, b) => b.score - a.score)[0];
  }

  function setValue(element, value) {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(element, String(value)); else element.value = String(value);
    element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); element.dispatchEvent(new Event("blur", { bubbles: true }));
    element.dataset.tealtFilled = "true";
  }

  function dateValue(element, value) {
    const match = String(value).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/); if (!match) return value;
    if (element.type === "month") return `${match[1]}-${match[2]}`; if (element.type === "date") return `${match[1]}-${match[2]}-${match[3] || "01"}`; return value;
  }

  function fillNative(element, value) {
    if (element.disabled || element.readOnly || value === "" || value == null) return false;
    if (!["radio", "checkbox"].includes(element.type) && element.value) return false;
    if (element instanceof HTMLSelectElement) {
      const wanted = normalize(value); const options = [...element.options];
      const option = options.find((item) => normalize(item.value) === wanted || normalize(item.textContent) === wanted)
        || options.find((item) => normalize(item.textContent).includes(wanted) || wanted.includes(normalize(item.textContent)));
      if (!option) return false; setValue(element, option.value); return true;
    }
    if (element.type === "radio") {
      const group = [...document.querySelectorAll(`input[type=radio][name="${CSS.escape(element.name)}"]`)]; const wanted = normalize(value);
      const radio = group.find((item) => normalize(`${item.value} ${descriptor(item)}`).includes(wanted)); if (!radio) return false; radio.click(); return true;
    }
    if (element.type === "checkbox") {
      const checked = ["yes", "true", "1", "on"].includes(normalize(value)); if (element.checked !== checked) element.click(); return true;
    }
    setValue(element, dateValue(element, value)); return true;
  }

  async function fillCustom(element, value) {
    if (element.dataset.tealtFilled || element.getAttribute("aria-disabled") === "true") return false;
    element.click(); element.focus();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) setValue(element, value);
    else if (element.isContentEditable) { element.textContent = value; element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) })); }
    await new Promise((resolve) => setTimeout(resolve, 100)); const wanted = normalize(value);
    const options = [...document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="radio"]')]
      .filter((option) => option.getClientRects().length && option.getAttribute("aria-disabled") !== "true");
    const option = options.find((item) => normalize(item.textContent) === wanted) || options.find((item) => normalize(item.textContent).includes(wanted));
    if (option) option.click(); else element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    element.dataset.tealtFilled = "true"; return true;
  }

  async function attachResume(resume) {
    if (!resume?.data) return false;
    const input = [...document.querySelectorAll('input[type="file"]')].find((item) => !item.disabled && !item.files?.length && (!item.accept || /pdf|doc|word/i.test(item.accept)));
    if (!input) return false; const response = await fetch(resume.data); const transfer = new DataTransfer();
    transfer.items.add(new File([await response.blob()], resume.name, { type: resume.type, lastModified: resume.lastModified })); input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true;
  }

  async function autofill() {
    const stored = await chrome.storage.local.get(STORAGE_KEY); const profile = stored[STORAGE_KEY];
    if (!profile) throw new Error("Save your details in Tealt before using autofill."); const entries = profileEntries(profile); let filled = 0;
    for (const control of document.querySelectorAll('input:not([type=hidden]):not([type=file]):not([role=combobox]), textarea:not([role=combobox]), select')) {
      const match = bestMatch(control, entries); if (match?.score >= 60 && fillNative(control, match.entry.value)) filled += 1;
    }
    for (const control of document.querySelectorAll('[role="combobox"], [role="listbox"]')) {
      const match = bestMatch(control, entries); if (match?.score >= 60 && await fillCustom(control, match.entry.value)) filled += 1;
    }
    if (await attachResume(profile.resume).catch(() => false)) filled += 1; return filled;
  }

  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== "TEALT_AUTOFILL") return undefined;
    autofill().then((filled) => respond({ ok: true, filled })).catch((error) => respond({ ok: false, error: error.message })); return true;
  });
})();
