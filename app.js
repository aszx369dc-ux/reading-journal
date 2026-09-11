(function () {
  "use strict";

  var DB_NAME = "reading-journal-local";
  var DB_VERSION = 1;
  var LEGACY_KEY = "daily-reading-journal-v1";
  var BACKUP_FORMAT = "reading-journal";
  var BACKUP_VERSION = 2;
  var AUTOSAVE_DELAY = 650;
  var db;
  var currentDate = "";
  var composing = false;
  var autosaveTimer = null;
  var writeChain = Promise.resolve();
  var switchToken = 0;
  var pendingImport = null;

  var dateInput = document.getElementById("entry-date");
  var dateHeading = document.getElementById("date-heading");
  var textarea = document.getElementById("entry-content");
  var saveButton = document.getElementById("save-button");
  var saveStatus = document.getElementById("save-status");
  var draftBadge = document.getElementById("draft-badge");
  var historyList = document.getElementById("history-list");
  var entryCount = document.getElementById("entry-count");
  var dataStatus = document.getElementById("data-status");
  var importFile = document.getElementById("import-file");
  var exportButton = document.getElementById("export-button");
  var importButton = document.getElementById("import-button");
  var importDialog = document.getElementById("import-dialog");
  var importSummary = document.getElementById("import-summary");
  var conflictList = document.getElementById("conflict-list");

  function localToday() {
    var now = new Date();
    var year = String(now.getFullYear());
    var month = String(now.getMonth() + 1).padStart(2, "0");
    var day = String(now.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parts = value.split("-").map(Number);
    var parsed = new Date(parts[0], parts[1] - 1, parts[2]);
    return parsed.getFullYear() === parts[0] && parsed.getMonth() === parts[1] - 1 && parsed.getDate() === parts[2];
  }

  function displayDate(value) {
    var parts = value.split("-").map(Number);
    return new Intl.DateTimeFormat("zh-Hant-TW", { year: "numeric", month: "long", day: "numeric", weekday: "long" })
      .format(new Date(parts[0], parts[1] - 1, parts[2], 12));
  }

  function setStatus(element, message, isError) {
    element.textContent = message;
    element.classList.toggle("error", Boolean(isError));
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) { reject(new Error("IndexedDB unavailable")); return; }
      var request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = function () {
        var database = request.result;
        if (!database.objectStoreNames.contains("entries")) database.createObjectStore("entries", { keyPath: "date" });
        if (!database.objectStoreNames.contains("drafts")) database.createObjectStore("drafts", { keyPath: "date" });
      };
      request.onsuccess = function () {
        db = request.result;
        db.onversionchange = function () { db.close(); };
        resolve(db);
      };
      request.onerror = function () { reject(request.error || new Error("Cannot open IndexedDB")); };
      request.onblocked = function () { reject(new Error("Database upgrade blocked")); };
    });
  }

  function requestResult(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function getRecord(store, key) {
    return requestResult(db.transaction(store, "readonly").objectStore(store).get(key));
  }

  function getAll(store) {
    return requestResult(db.transaction(store, "readonly").objectStore(store).getAll());
  }

  function transactionComplete(transaction) {
    return new Promise(function (resolve, reject) {
      transaction.oncomplete = function () { resolve(); };
      transaction.onerror = function () { reject(transaction.error || new Error("IndexedDB transaction failed")); };
      transaction.onabort = function () { reject(transaction.error || new Error("IndexedDB transaction aborted")); };
    });
  }

  function putDraft(date, content) {
    var transaction = db.transaction("drafts", "readwrite");
    transaction.objectStore("drafts").put({ date: date, content: content, updatedAt: new Date().toISOString() });
    return transactionComplete(transaction);
  }

  function queueWrite(operation) {
    writeChain = writeChain.catch(function () {}).then(operation);
    return writeChain;
  }

  function queueDraft(date, content, announce) {
    return queueWrite(function () { return putDraft(date, content); }).then(function () {
      if (announce && date === currentDate && content === textarea.value) setStatus(saveStatus, "草稿已自動保存", false);
    }).catch(function (error) {
      console.error("Draft save failed", error);
      if (date === currentDate) setStatus(saveStatus, "草稿保存失敗，文字仍保留在畫面上。請匯出或複製文字。", true);
      throw error;
    });
  }

  function scheduleAutosave() {
    window.clearTimeout(autosaveTimer);
    var date = currentDate;
    autosaveTimer = window.setTimeout(function () {
      autosaveTimer = null;
      queueDraft(date, textarea.value, true).catch(function () {});
    }, AUTOSAVE_DELAY);
  }

  function flushDraft(date, content) {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = null;
    return queueDraft(date, content, false);
  }

  async function loadDate(date, skipFlush) {
    var token = ++switchToken;
    var oldDate = currentDate;
    var oldContent = textarea.value;
    textarea.disabled = true;
    saveButton.disabled = true;
    try {
      if (!skipFlush && db && oldDate) await flushDraft(oldDate, oldContent);
      var results = await Promise.all([getRecord("entries", date), getRecord("drafts", date)]);
      if (token !== switchToken) return;
      currentDate = date;
      dateInput.value = date;
      dateHeading.textContent = displayDate(date);
      var entry = results[0];
      var draft = results[1];
      textarea.value = draft ? draft.content : (entry ? entry.content : "");
      draftBadge.hidden = !draft;
      setStatus(saveStatus, draft ? "已載入自動保存的草稿" : (entry ? "已載入這一天的筆記" : "可以開始書寫"), false);
      textarea.disabled = false;
      saveButton.disabled = false;
    } catch (error) {
      console.error("Date change failed", error);
      dateInput.value = oldDate;
      textarea.value = oldContent;
      textarea.disabled = false;
      saveButton.disabled = false;
      setStatus(saveStatus, "切換前無法保存目前草稿，因此沒有離開這一天。文字仍保留。", true);
    }
  }

  async function saveEntry() {
    var date = currentDate;
    var content = textarea.value;
    window.clearTimeout(autosaveTimer);
    autosaveTimer = null;
    saveButton.disabled = true;
    setStatus(saveStatus, "儲存中⋯", false);
    try {
      await queueWrite(function () {
        var transaction = db.transaction(["entries", "drafts"], "readwrite");
        transaction.objectStore("entries").put({ date: date, content: content, updatedAt: new Date().toISOString() });
        transaction.objectStore("drafts").delete(date);
        return transactionComplete(transaction);
      });
      if (date === currentDate && content === textarea.value) {
        draftBadge.hidden = true;
        setStatus(saveStatus, "已儲存", false);
      } else if (date === currentDate) {
        scheduleAutosave();
        draftBadge.hidden = false;
        setStatus(saveStatus, "先前內容已儲存；新輸入將另存草稿", false);
      }
      await renderHistory();
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    } catch (error) {
      console.error("Entry save failed", error);
      if (date === currentDate) setStatus(saveStatus, "儲存失敗，文字仍保留在畫面上。請再試一次或先複製文字。", true);
    } finally {
      saveButton.disabled = false;
    }
  }

  async function renderHistory() {
    var entries = await getAll("entries");
    entries.sort(function (a, b) { return b.date.localeCompare(a.date); });
    historyList.textContent = "";
    entryCount.textContent = entries.length ? entries.length + " 篇" : "";
    if (!entries.length) {
      var empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "還沒有正式儲存的筆記。草稿會留在各自的日期中。";
      historyList.appendChild(empty);
      return;
    }
    entries.forEach(function (entry) {
      var button = document.createElement("button");
      var date = document.createElement("span");
      var preview = document.createElement("span");
      button.type = "button";
      button.className = "history-item";
      date.className = "history-date";
      preview.className = "history-preview";
      date.textContent = displayDate(entry.date);
      preview.textContent = entry.content || "（空白筆記）";
      button.appendChild(date);
      button.appendChild(preview);
      button.addEventListener("click", function () { loadDate(entry.date).then(function () { window.scrollTo({ top: 0, behavior: "smooth" }); }); });
      historyList.appendChild(button);
    });
  }

  function validRecordArray(value) {
    return Array.isArray(value) && value.every(function (record) {
      return record && isValidDate(record.date) && typeof record.content === "string" &&
        (record.updatedAt === undefined || typeof record.updatedAt === "string");
    }) && new Set(value.map(function (record) { return record.date; })).size === value.length;
  }

  function parseBackup(value) {
    if (value && value.format === BACKUP_FORMAT && value.version === BACKUP_VERSION && validRecordArray(value.entries) && validRecordArray(value.drafts || [])) {
      return { entries: value.entries, drafts: value.drafts || [], source: "v2" };
    }
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(function (key) { return isValidDate(key) && typeof value[key] === "string"; })) {
      return { entries: Object.keys(value).map(function (key) { return { date: key, content: value[key] }; }), drafts: [], source: "legacy" };
    }
    throw new Error("Invalid backup format");
  }

  async function exportBackup() {
    try {
      await flushDraft(currentDate, textarea.value);
      var values = await Promise.all([getAll("entries"), getAll("drafts")]);
      var backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), entries: values[0], drafts: values[1] };
      var url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
      var link = document.createElement("a");
      link.href = url;
      link.download = "reading-journal-backup-" + localToday() + ".json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      setStatus(dataStatus, "已匯出全部筆記與草稿。", false);
    } catch (error) {
      console.error("Export failed", error);
      setStatus(dataStatus, "匯出失敗，沒有變更現有資料。", true);
    }
  }

  async function prepareImport(file) {
    if (!file) return;
    try {
      await flushDraft(currentDate, textarea.value);
      var parsed = parseBackup(JSON.parse(await file.text()));
      var current = await Promise.all([getAll("entries"), getAll("drafts")]);
      var currentDates = new Set(current[0].concat(current[1]).map(function (item) { return item.date; }));
      var incomingDates = new Set(parsed.entries.concat(parsed.drafts).map(function (item) { return item.date; }));
      var conflictDates = Array.from(incomingDates).filter(function (date) { return currentDates.has(date); }).sort().reverse();
      pendingImport = { parsed: parsed, conflicts: new Set(conflictDates), incomingDates: incomingDates };
      importSummary.textContent = "備份包含 " + parsed.entries.length + " 篇筆記與 " + parsed.drafts.length + " 份草稿。" +
        (conflictDates.length ? "其中 " + conflictDates.length + " 個日期與目前筆記或草稿衝突，請明確選擇處理方式。" : "沒有日期衝突。請確認匯入。") +
        (parsed.source === "legacy" ? "這是舊版 JSON 格式，會安全轉換，原檔不受影響。" : "");
      conflictList.textContent = "";
      conflictDates.forEach(function (date) { var row = document.createElement("div"); row.textContent = displayDate(date); conflictList.appendChild(row); });
      document.getElementById("import-skip").textContent = conflictDates.length ? "保留目前版本並匯入其餘" : "匯入";
      document.getElementById("import-overwrite").hidden = !conflictDates.length;
      importDialog.showModal();
    } catch (error) {
      console.error("Import validation failed", error);
      setStatus(dataStatus, "備份格式無效或檔案無法讀取；目前資料完全未變更。", true);
    }
  }

  async function applyImport(overwrite) {
    if (!pendingImport) return;
    var payload = pendingImport;
    pendingImport = null;
    try {
      await flushDraft(currentDate, textarea.value);
      await queueWrite(function () {
        var transaction = db.transaction(["entries", "drafts"], "readwrite");
        var entryStore = transaction.objectStore("entries");
        var draftStore = transaction.objectStore("drafts");
        if (overwrite) payload.incomingDates.forEach(function (date) { entryStore.delete(date); draftStore.delete(date); });
        payload.parsed.entries.forEach(function (item) {
          if (overwrite || !payload.conflicts.has(item.date)) entryStore.put({ date: item.date, content: item.content, updatedAt: item.updatedAt || new Date().toISOString() });
        });
        payload.parsed.drafts.forEach(function (item) {
          if (overwrite || !payload.conflicts.has(item.date)) draftStore.put({ date: item.date, content: item.content, updatedAt: item.updatedAt || new Date().toISOString() });
        });
        return transactionComplete(transaction);
      });
      await renderHistory();
      await loadDate(currentDate, true);
      setStatus(dataStatus, overwrite ? "匯入完成；衝突日期已使用備份版本。" : "匯入完成；衝突日期保留目前版本。", false);
    } catch (error) {
      console.error("Import failed", error);
      setStatus(dataStatus, "匯入失敗；單一資料庫交易已取消，請檢查備份後重試。", true);
    }
  }

  async function migrateLegacyLocal() {
    var raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return 0;
    var legacy;
    try { legacy = parseBackup(JSON.parse(raw)); } catch (error) { return 0; }
    var existing = await getAll("entries");
    var existingDates = new Set(existing.map(function (item) { return item.date; }));
    var rows = legacy.entries.filter(function (item) { return !existingDates.has(item.date); });
    if (!rows.length) return 0;
    var transaction = db.transaction("entries", "readwrite");
    rows.forEach(function (item) { transaction.objectStore("entries").put({ date: item.date, content: item.content, updatedAt: new Date().toISOString() }); });
    await transactionComplete(transaction);
    return rows.length;
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(function (error) { console.error("Service worker registration failed", error); });
  }

  textarea.addEventListener("compositionstart", function () { composing = true; window.clearTimeout(autosaveTimer); });
  textarea.addEventListener("compositionend", function () { composing = false; draftBadge.hidden = false; scheduleAutosave(); });
  textarea.addEventListener("input", function () { draftBadge.hidden = false; setStatus(saveStatus, "尚未正式儲存", false); if (!composing) scheduleAutosave(); });
  dateInput.addEventListener("change", function () { if (isValidDate(dateInput.value) && dateInput.value !== currentDate) loadDate(dateInput.value); });
  saveButton.addEventListener("click", saveEntry);
  document.getElementById("today-button").addEventListener("click", function () { if (currentDate !== localToday()) loadDate(localToday()); });
  exportButton.addEventListener("click", exportBackup);
  importButton.addEventListener("click", function () { importFile.click(); });
  importFile.addEventListener("change", function () { prepareImport(importFile.files[0]); importFile.value = ""; });
  document.getElementById("import-skip").addEventListener("click", function () { applyImport(false); });
  document.getElementById("import-overwrite").addEventListener("click", function () { applyImport(true); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden" && db && !composing) flushDraft(currentDate, textarea.value).catch(function () {}); });
  window.addEventListener("pagehide", function () { if (db && !composing) flushDraft(currentDate, textarea.value).catch(function () {}); });

  openDatabase().then(async function () {
    var migrated = await migrateLegacyLocal();
    await loadDate(localToday(), true);
    await renderHistory();
    exportButton.disabled = false;
    importButton.disabled = false;
    if (migrated) setStatus(dataStatus, "已從這台瀏覽器的舊版資料安全複製 " + migrated + " 篇筆記；舊資料仍保留。", false);
    registerServiceWorker();
  }).catch(function (error) {
    console.error("Initialization failed", error);
    textarea.disabled = false;
    setStatus(saveStatus, "無法開啟本機資料庫。文字可以先寫在畫面上，但無法保存；請勿關閉頁面並先複製文字。", true);
  });
}());
