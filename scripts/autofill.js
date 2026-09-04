(() => {
  // Avoid registering duplicate message handlers when popup.js injects this
  // file into a tab that already received the manifest content script.
  if (globalThis.__tealtAutofillLoaded) return;
  globalThis.__tealtAutofillLoaded = true;

  const STORAGE_KEY = "tealtApplicationProfile";

  /** Converts labels, names, and values into comparable search text. */
  const normalize = (value) => String(value ?? "").toLowerCase().replace(/[_\-\[\]()/:*]+/g, " ").replace(/\s+/g, " ").trim();

  // Common labels used by native and third-party applicant tracking systems.
  const aliases = {
    firstName: ["first name", "given name", "firstname", "given-name"], lastName: ["last name", "family name", "surname", "lastname", "family-name"],
    email: ["email", "email address", "e-mail"], phone: ["phone", "phone number", "mobile", "telephone", "tel"],
    address1: ["address 1", "address line 1", "address1", "street address", "street address line 1", "mailing address"],
    address2: ["address 2", "address line 2", "address2", "street address line 2", "apartment", "apartment suite", "apt suite", "unit"],
    city: ["city", "town", "locality"],
    state: ["state", "province", "region", "address-level1"], postalCode: ["postal code", "zip code", "zipcode", "postcode", "postal-code"],
    country: ["country", "country name", "country-name"], currentTitle: ["current job title", "current title", "professional title", "headline"],
    yearsExperience: ["years of experience", "years experience", "total experience"], linkedin: ["linkedin", "linkedin url", "linkedin profile"],
    portfolio: ["portfolio", "website", "personal website", "portfolio url"], github: ["github", "github url", "github profile"],
    education: ["highest education", "education level", "highest degree"], summary: ["professional summary", "summary", "about you", "profile"],
    skills: ["skills", "core skills", "key skills"], salary: ["desired salary", "salary expectation", "expected salary", "compensation"],
    startDate: ["available start date", "start date", "date available", "availability date"], workSetting: ["preferred work setting", "work setting", "workplace type", "remote preference"],
    employmentType: ["employment type", "job type", "position type"], workAuthorized: ["authorized to work", "work authorization", "legally authorized", "eligible to work"],
    sponsorship: ["visa sponsorship", "require sponsorship", "sponsorship"], relocate: ["willing to relocate", "relocation", "relocate"], travel: ["willing to travel", "travel"],
    gender: ["gender", "gender identity", "sex"],
    ethnicity: ["ethnicity", "hispanic or latino", "hispanic latino", "are you hispanic", "latino origin", "ethnic origin"],
    race: ["race", "racial group", "racial background", "race category"],
    veteran: ["veteran", "veteran status"], disability: ["disability", "disability status"],
  };
  const repeatAliases = {
    employer: ["employer", "company", "organization"], jobTitle: ["job title", "position title", "role"], workPhone: ["work phone", "company phone"], supervisor: ["supervisor", "manager"],
    workAddress: ["work address", "company address"], workCity: ["work city", "company city"], workState: ["work state", "company state"], workPostalCode: ["work postal code", "company zip"],
    workCountry: ["work country", "company country"], jobStart: ["employment start date", "job start date"], jobEnd: ["employment end date", "job end date"],
    achievements: ["responsibilities", "achievements", "job description"], school: ["school", "institution", "university", "college"], degree: ["degree", "credential"],
    fieldOfStudy: ["field of study", "major", "discipline"], graduationDate: ["graduation date", "graduated"], schoolAddress: ["school address"], schoolCity: ["school city"],
    schoolState: ["school state"], schoolPostalCode: ["school postal code", "school zip"], schoolCountry: ["school country"],
  };
  const repeatSections = {
    work: {
      recordsKey: "work",
      anchorKey: "employer",
      sectionNames: ["work experience", "work history", "employment history", "experience"],
      addNames: ["add work experience", "add experience", "add employment", "add another position", "add another job"],
    },
    education: {
      recordsKey: "educationHistory",
      anchorKey: "school",
      sectionNames: ["education", "education history", "academic background"],
      addNames: ["add education", "add school", "add another school", "add education history"],
    },
  };

  /** Returns text referenced by an ARIA id-list attribute. */
  function ariaText(element, attribute) {
    return (element.getAttribute(attribute) || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.innerText || "")
      .filter(Boolean);
  }

  /**
   * Finds the nearest reasonably sized block of visible question text. Form
   * builders often render labels as nested divs instead of semantic labels.
   */
  function nearbyQuestionText(element) {
    const text = [];
    let ancestor = element.parentElement;

    for (let depth = 0; ancestor && depth < 5; depth += 1, ancestor = ancestor.parentElement) {
      const candidate = ancestor.innerText?.trim();
      if (candidate && candidate.length <= 500) text.push(candidate);
    }

    return text;
  }

  /** Builds a searchable description from a control and its accessible labels. */
  function descriptor(element) {
    const labels = element.labels ? [...element.labels].map((label) => label.innerText) : [];
    const container = element.closest("label, fieldset, [role=group], [class*=field], [class*=question]");
    return normalize([
      element.name,
      element.id,
      element.type,
      element.autocomplete,
      element.placeholder,
      element.getAttribute("aria-label"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-automation-id"),
      ...labels,
      ...ariaText(element, "aria-labelledby"),
      ...ariaText(element, "aria-describedby"),
      container?.querySelector("legend")?.innerText,
      container?.querySelector("label")?.innerText,
      ...nearbyQuestionText(element),
    ].filter(Boolean).join(" "));
  }

  /** Flattens the saved profile into values and the field names they can match. */
  function profileEntries(profile) {
    const result = Object.entries(aliases).filter(([key]) => profile[key] !== undefined && profile[key] !== "")
      .map(([key, names]) => ({ value: profile[key], names: [key, ...names].map(normalize) }));
    if (!profile.address1 && profile.address) {
      result.push({ value: profile.address, names: ["address1", ...aliases.address1].map(normalize) });
    }
    return result;
  }

  /** Returns true when an element is rendered and available for interaction. */
  function isVisible(element) {
    return Boolean(element?.getClientRects().length) && element.getAttribute("aria-hidden") !== "true";
  }

  /** Scores normalized text against a collection of field or button aliases. */
  function aliasScore(text, names) {
    const normalizedText = normalize(text);
    return Math.max(...names.map((name) => {
      const normalizedName = normalize(name);
      if (normalizedText === normalizedName) return 100;
      return normalizedText.includes(normalizedName) ? 60 + Math.min(normalizedName.length, 30) : 0;
    }));
  }

  /** Finds page controls matching a repeated-record field such as employer. */
  function repeatedControls(names) {
    return [...document.querySelectorAll('input:not([type="hidden"]):not([type="file"]), textarea, select, [role="combobox"], [contenteditable="true"]')]
      .filter((control) => isVisible(control) && aliasScore(descriptor(control), names) >= 60);
  }

  /** Finds a narrowly identified add button for one repeatable section. */
  function findAddButton(config) {
    const candidates = [...document.querySelectorAll('button, input[type="button"], input[type="submit"], [role="button"]')]
      .filter((button) => isVisible(button) && !button.disabled && button.getAttribute("aria-disabled") !== "true");

    const explicit = candidates.find((button) => aliasScore([
      button.innerText,
      button.value,
      button.getAttribute("aria-label"),
      button.title,
    ].filter(Boolean).join(" "), config.addNames) >= 60);
    if (explicit) return explicit;

    // Some systems label every repeater button only "Add" or "Add another".
    // Accept those only when a nearby container clearly names the section.
    return candidates.find((button) => {
      const buttonText = normalize(`${button.innerText || ""} ${button.value || ""} ${button.getAttribute("aria-label") || ""}`);
      if (!/^(add|add another|new|create new)$/.test(buttonText)) return false;

      let container = button.parentElement;
      for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
        const text = container.innerText || "";
        if (text.length <= 1000 && aliasScore(text, config.sectionNames) >= 60) return true;
      }
      return false;
    });
  }

  /** Waits briefly for a repeater click to add another matching control. */
  function waitForAdditionalControl(anchorNames, previousCount) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (added) => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        clearTimeout(timeoutId);
        resolve(added);
      };
      const observer = new MutationObserver(() => {
        if (repeatedControls(anchorNames).length > previousCount) finish(true);
      });
      const timeoutId = setTimeout(() => finish(repeatedControls(anchorNames).length > previousCount), 1500);
      observer.observe(document.body, { childList: true, subtree: true });
    });
  }

  /** Expands a work or education repeater until it has one group per record. */
  async function expandRepeatSection(config, desiredCount) {
    const anchorNames = repeatAliases[config.anchorKey];
    let currentCount = repeatedControls(anchorNames).length;
    let added = 0;

    while (currentCount < desiredCount) {
      const addButton = findAddButton(config);
      if (!addButton) break;

      addButton.click();
      if (!await waitForAdditionalControl(anchorNames, currentCount)) break;
      currentCount = repeatedControls(anchorNames).length;
      added += 1;
    }

    return added;
  }

  /** Fills a native or custom control used by a repeated record. */
  async function fillRepeatedControl(control, value) {
    if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) {
      return fillNative(control, value);
    }
    return fillCustom(control, value);
  }

  /** Expands and fills every saved record in a repeatable page section. */
  async function fillRepeatSection(profile, config) {
    const records = (profile[config.recordsKey] || []).filter((record) =>
      record && Object.values(record).some((value) => value !== undefined && value !== ""));
    if (!records.length) return 0;

    let filled = 0;

    for (let recordIndex = 0; recordIndex < records.length; recordIndex += 1) {
      await expandRepeatSection(config, recordIndex + 1);
      const record = records[recordIndex];
      for (const [key, value] of Object.entries(record)) {
        if (value === undefined || value === "" || !repeatAliases[key]) continue;
        const controls = repeatedControls(repeatAliases[key]);
        const control = controls[recordIndex];
        if (control && await fillRepeatedControl(control, value)) filled += 1;
      }

      // Yield between records so large histories do not block the page.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (globalThis.scheduler?.yield) await globalThis.scheduler.yield();
    }

    return filled;
  }

  /** Returns the highest-scoring saved-profile match for a page control. */
  function bestMatch(element, entries) {
    const text = descriptor(element);
    return entries.map((entry) => ({ entry, score: Math.max(...entry.names.map((name) => text === name ? 100 : text.includes(name) ? 60 + Math.min(name.length, 30) : 0)) }))
      .sort((a, b) => b.score - a.score)[0];
  }

  /** Returns the best saved field whose alias appears in a visible text node. */
  function bestTextMatch(text, entries) {
    const normalizedText = normalize(text);
    if (!normalizedText) return undefined;

    return entries
      .map((entry) => ({
        entry,
        score: Math.max(...entry.names.map((name) =>
          normalizedText === name ? 100 : normalizedText.includes(name) ? 70 + Math.min(name.length, 20) : 0)),
      }))
      .sort((a, b) => b.score - a.score)[0];
  }

  /** Whether a control is an empty, editable autofill target. */
  function isAvailableControl(element) {
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement)) return false;
    if (element.disabled || element.readOnly || element.dataset.tealtFilled) return false;
    if (element instanceof HTMLInputElement && ["hidden", "file", "submit", "button", "reset", "image"].includes(element.type)) return false;
    return ["radio", "checkbox"].includes(element.type) || !element.value;
  }

  /**
   * Finds the closest usable form control in the label's local DOM region.
   * Explicit label associations win, followed by descendants and nearby
   * siblings, before progressively checking small ancestor containers.
   */
  function closestControl(textElement) {
    const label = textElement.closest("label");
    if (label?.control && isAvailableControl(label.control)) return label.control;

    const selector = 'input:not([type="hidden"]):not([type="file"]), textarea, select';
    const nested = textElement.querySelector?.(selector);
    if (isAvailableControl(nested)) return nested;

    let sibling = textElement.nextElementSibling;
    for (let offset = 0; sibling && offset < 3; offset += 1, sibling = sibling.nextElementSibling) {
      if (isAvailableControl(sibling)) return sibling;
      const insideSibling = sibling.querySelector?.(selector);
      if (isAvailableControl(insideSibling)) return insideSibling;
    }

    let container = textElement.parentElement;
    for (let depth = 0; container && depth < 4; depth += 1, container = container.parentElement) {
      const controls = [...container.querySelectorAll(selector)].filter(isAvailableControl);
      if (controls.length === 1) return controls[0];
    }

    return undefined;
  }

  /**
   * Scans visible text throughout the page and fills the closest control for
   * every recognized profile label. This supports forms without semantic
   * labels, useful names, ARIA metadata, or predictable CSS classes.
   */
  function fillByVisibleText(entries) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.textContent.trim() || parent.closest("script, style, noscript, template, [hidden], [aria-hidden=true]")) {
          return NodeFilter.FILTER_REJECT;
        }
        return parent.getClientRects().length ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    let filled = 0;
    let node;

    while ((node = walker.nextNode())) {
      const match = bestTextMatch(node.textContent, entries);
      if (!match || match.score < 70) continue;

      const control = closestControl(node.parentElement);
      if (control && fillNative(control, match.entry.value)) filled += 1;
    }

    return filled;
  }

  /** Sets a native control value in a way observed by framework event handlers. */
  function setValue(element, value) {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(element, String(value)); else element.value = String(value);
    element.dispatchEvent(new Event("input", { bubbles: true })); element.dispatchEvent(new Event("change", { bubbles: true })); element.dispatchEvent(new Event("blur", { bubbles: true }));
    element.dataset.tealtFilled = "true";
  }

  /** Adapts the stored ISO date to a date or month input when necessary. */
  function dateValue(element, value) {
    const match = String(value).match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/); if (!match) return value;
    if (element.type === "month") return `${match[1]}-${match[2]}`; if (element.type === "date") return `${match[1]}-${match[2]}-${match[3] || "01"}`; return value;
  }

  /** Fills a standard input, textarea, select, checkbox, or radio control. */
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

  /** Fills ARIA-based comboboxes and other custom application controls. */
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

  /** Recreates the stored resume and assigns it to the first compatible input. */
  async function attachResume(resume) {
    if (!resume?.data) return false;
    const input = [...document.querySelectorAll('input[type="file"]')].find((item) => !item.disabled && !item.files?.length && (!item.accept || /pdf|doc|word/i.test(item.accept)));
    if (!input) return false; const response = await fetch(resume.data); const transfer = new DataTransfer();
    transfer.items.add(new File([await response.blob()], resume.name, { type: resume.type, lastModified: resume.lastModified })); input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true })); input.dispatchEvent(new Event("change", { bubbles: true })); return true;
  }

  /** Fills all empty matching controls on the current page. */
  async function autofill() {
    const stored = await chrome.storage.local.get(STORAGE_KEY); const profile = stored[STORAGE_KEY];
    if (!profile) throw new Error("Save your details in Tealt before using autofill."); const entries = profileEntries(profile); let filled = 0;
    filled += await fillRepeatSection(profile, repeatSections.work);
    filled += await fillRepeatSection(profile, repeatSections.education);
    for (const control of document.querySelectorAll('input:not([type=hidden]):not([type=file]):not([role=combobox]), textarea:not([role=combobox]), select')) {
      const match = bestMatch(control, entries); if (match?.score >= 60 && fillNative(control, match.entry.value)) filled += 1;
    }
    for (const control of document.querySelectorAll('[role="combobox"], [role="listbox"]')) {
      const match = bestMatch(control, entries); if (match?.score >= 60 && await fillCustom(control, match.entry.value)) filled += 1;
    }
    filled += fillByVisibleText(entries);
    if (await attachResume(profile.resume).catch(() => false)) filled += 1; return filled;
  }

  // Keep the asynchronous response channel open until autofill completes.
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type !== "TEALT_AUTOFILL") return undefined;
    autofill().then((filled) => respond({ ok: true, filled })).catch((error) => respond({ ok: false, error: error.message })); return true;
  });
})();
