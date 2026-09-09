(function () {
  "use strict";

  var STORAGE_KEY = "daily-reading-journal-v1";
  var TIME_ZONE = "Asia/Taipei";
  var config = window.SUPABASE_CONFIG || {};
  var supabaseClient = null;
  var currentUser = null;
  var currentDateKey = "";
  var weekdayNames = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

  var authView = document.getElementById("auth-view");
  var appView = document.getElementById("app-view");
  var historyView = document.getElementById("history-view");
  var authForm = document.getElementById("auth-form");
  var authMessage = document.getElementById("auth-message");
  var emailInput = document.getElementById("email");
  var dateLabel = document.getElementById("today-label");
  var content = document.getElementById("entry-content");
  var saveButton = document.getElementById("save-button");
  var saveMessage = document.getElementById("save-message");
  var historyList = document.getElementById("history-list");
  var dataMessage = document.getElementById("data-message");
  var migrationPanel = document.getElementById("migration-panel");
  var accountLabel = document.getElementById("account-label");
  var historyAccountLabel = document.getElementById("history-account-label");

  function isConfigured() {
    return typeof config.url === "string" && config.url.indexOf("https://") === 0 &&
      typeof config.anonKey === "string" && config.anonKey.length > 20 &&
      config.anonKey.indexOf("YOUR_") !== 0;
  }

  function showOnly(view) {
    [authView, appView, historyView].forEach(function (item) { item.hidden = item !== view; });
  }

  function setAuthMessage(message) { authMessage.textContent = message; }
  function setDataMessage(message) { dataMessage.textContent = message; }

  function dateKeyFromParts(parts) {
    return [parts.year, parts.month, parts.day].join("-");
  }

  function todayKey() {
    var parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return dateKeyFromParts(values);
  }

  function displayDate(key) {
    var date = new Date(key + "T12:00:00+08:00");
    var parts = new Intl.DateTimeFormat("zh-Hant-TW", { timeZone: TIME_ZONE, year: "numeric", month: "numeric", day: "numeric", weekday: "long" }).formatToParts(date);
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    var weekday = values.weekday || weekdayNames[date.getDay()];
    return values.year + " 年 " + values.month + " 月 " + values.day + " 日・" + weekday;
  }

  function isValidDateKey(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    var parts = key.split("-").map(Number);
    var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return date.getUTCFullYear() === parts[0] && date.getUTCMonth() === parts[1] - 1 && date.getUTCDate() === parts[2];
  }

  function isValidEntryMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    return Object.keys(value).every(function (key) { return isValidDateKey(key) && typeof value[key] === "string"; });
  }

  function readLegacyEntries() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var entries = JSON.parse(raw);
      if (!isValidEntryMap(entries)) return null;
      var nonBlank = {};
      Object.keys(entries).forEach(function (key) {
        if (entries[key].trim()) nonBlank[key] = entries[key];
      });
      return Object.keys(nonBlank).length ? nonBlank : null;
    } catch (error) { return null; }
  }

  async function loadToday() {
    currentDateKey = todayKey();
    dateLabel.textContent = displayDate(currentDateKey);
    content.value = "";
    saveButton.disabled = true;
    var result = await supabaseClient.from("reading_entries").select("content").eq("entry_date", currentDateKey).maybeSingle();
    if (result.error) throw result.error;
    content.value = result.data ? result.data.content : "";
    content.disabled = false;
    saveButton.disabled = false;
  }

  async function saveToday() {
    saveButton.disabled = true;
    saveMessage.textContent = "儲存中⋯";
    var result = await supabaseClient.from("reading_entries").upsert({
      user_id: currentUser.id,
      entry_date: currentDateKey,
      content: content.value
    }, { onConflict: "user_id,entry_date" }).select().single();
    saveButton.disabled = false;
    if (result.error) {
      saveMessage.textContent = result.error.code === "23514" ? "請先寫下一點內容。" : "儲存失敗，請稍後再試。";
      return;
    }
    saveMessage.textContent = "今天留下來了。";
  }

  async function fetchEntries() {
    var result = await supabaseClient.from("reading_entries").select("entry_date,content,created_at,updated_at").order("entry_date", { ascending: false });
    if (result.error) throw result.error;
    return result.data || [];
  }

  function renderHistory(entries) {
    historyList.innerHTML = "";
    if (!entries.length) {
      historyList.innerHTML = '<p class="empty-state">還沒有留下任何日子。</p>';
      return;
    }
    entries.forEach(function (entry) {
      var button = document.createElement("button");
      button.type = "button";
      button.className = "history-item";
      button.innerHTML = '<span class="history-item-date"></span><span class="history-item-preview"></span>';
      button.querySelector(".history-item-date").textContent = displayDate(entry.entry_date);
      button.querySelector(".history-item-preview").textContent = entry.content;
      button.addEventListener("click", function () { showDetail(entry); });
      historyList.appendChild(button);
    });
  }

  function showDetail(entry) {
    historyList.innerHTML = "";
    var detail = document.createElement("article");
    detail.className = "history-detail";
    detail.innerHTML = '<button type="button" class="text-link detail-back"><span aria-hidden="true">←</span> 返回日子列表</button><p class="detail-date"></p><div class="detail-content"></div>';
    detail.querySelector(".detail-date").textContent = displayDate(entry.entry_date);
    detail.querySelector(".detail-content").textContent = entry.content;
    detail.querySelector("button").addEventListener("click", function () { loadHistory(); });
    historyList.appendChild(detail);
  }

  async function loadHistory() {
    setDataMessage("");
    historyList.innerHTML = '<p class="empty-state">讀取中⋯</p>';
    try {
      renderHistory(await fetchEntries());
      migrationPanel.hidden = !readLegacyEntries();
    } catch (error) {
      historyList.innerHTML = '<p class="empty-state">目前無法讀取日記，請稍後再試。</p>';
      setDataMessage("讀取失敗，請檢查 Supabase 設定。");
    }
  }

  async function showHistory() {
    showOnly(historyView);
    await loadHistory();
    window.scrollTo(0, 0);
  }

  async function showHome() {
    showOnly(appView);
    try { await loadToday(); } catch (error) { saveMessage.textContent = "目前無法讀取今天的日記。"; }
    window.scrollTo(0, 0);
  }

  async function sendMagicLink(event) {
    event.preventDefault();
    if (!isConfigured()) {
      setAuthMessage("請先完成 config.js 設定。");
      return;
    }
    var email = emailInput.value.trim();
    setAuthMessage("登入連結寄送中⋯");
    var result = await supabaseClient.auth.signInWithOtp({
      email: email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname }
    });
    setAuthMessage(result.error ? "登入連結寄送失敗，請稍後再試。" : "請查看你的 Email，點擊登入連結。返回此頁即可開始書寫。");
  }

  async function signOut() {
    await supabaseClient.auth.signOut();
    showOnly(authView);
    setAuthMessage("已登出。");
  }

  async function exportBackup() {
    try {
      var entries = await fetchEntries();
      if (!entries.length) { setDataMessage("目前沒有可以備份的日記。"); return; }
      var backup = {};
      entries.forEach(function (entry) { backup[entry.entry_date] = entry.content; });
      var blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      var link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "reading-journal-backup-" + todayKey() + ".json";
      link.click();
      URL.revokeObjectURL(link.href);
      setDataMessage("備份已下載。");
    } catch (error) { setDataMessage("備份失敗，請稍後再試。"); }
  }

  function readBackupFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = async function () {
      var backup;
      try { backup = JSON.parse(reader.result); } catch (error) {
        setDataMessage("這不是有效的 JSON 備份檔。");
        return;
      }
      if (!isValidEntryMap(backup)) {
        setDataMessage("備份格式不正確，沒有更改目前資料。");
        return;
      }
      if (!window.confirm("這會以備份內容取代目前的閱讀日記，確定要繼續嗎？")) return;
      try {
        var rows = Object.keys(backup).filter(function (key) { return backup[key].trim(); }).map(function (key) {
          return { user_id: currentUser.id, entry_date: key, content: backup[key] };
        });
        var existing = await fetchEntries();
        var upsertResult = rows.length ? await supabaseClient.from("reading_entries").upsert(rows, { onConflict: "user_id,entry_date" }) : { error: null };
        if (upsertResult.error) throw upsertResult.error;
        var keys = {};
        rows.forEach(function (row) { keys[row.entry_date] = true; });
        for (var index = 0; index < existing.length; index += 1) {
          if (!keys[existing[index].entry_date]) {
            var deleteResult = await supabaseClient.from("reading_entries").delete().eq("user_id", currentUser.id).eq("entry_date", existing[index].entry_date);
            if (deleteResult.error) throw deleteResult.error;
          }
        }
        window.location.reload();
      } catch (error) { setDataMessage("還原失敗，現有資料未完成變更。"); }
    };
    reader.onerror = function () { setDataMessage("備份檔讀取失敗，沒有更改目前資料。"); };
    reader.readAsText(file);
  }

  async function migrateLegacy() {
    var legacy = readLegacyEntries();
    if (!legacy || !window.confirm("這會把這台裝置上的舊日記匯入目前登入帳號，確定要繼續嗎？")) return;
    var rows = Object.keys(legacy).map(function (key) { return { user_id: currentUser.id, entry_date: key, content: legacy[key] }; });
    var result = await supabaseClient.from("reading_entries").upsert(rows, { onConflict: "user_id,entry_date" });
    if (result.error) { setDataMessage("舊日記匯入失敗，原本的裝置資料仍保留。"); return; }
    if (window.confirm("舊日記已匯入。要移除這台裝置上的舊資料嗎？")) localStorage.removeItem(STORAGE_KEY);
    migrationPanel.hidden = true;
    setDataMessage("舊日記已匯入。");
    await loadHistory();
  }

  async function initialize() {
    if (!isConfigured()) {
      showOnly(authView);
      setAuthMessage("請先複製 config.example.js 為 config.js，填入 Supabase 設定。");
      return;
    }
    supabaseClient = window.supabase.createClient(config.url, config.anonKey);
    supabaseClient.auth.onAuthStateChange(function (event, session) {
      currentUser = session ? session.user : null;
      if (!currentUser) {
        showOnly(authView);
        return;
      }
      accountLabel.textContent = currentUser.email || "已登入";
      historyAccountLabel.textContent = currentUser.email || "已登入";
      showOnly(appView);
      loadToday().catch(function () { saveMessage.textContent = "目前無法讀取今天的日記。"; });
    });
    var sessionResult = await supabaseClient.auth.getSession();
    if (sessionResult.error) { setAuthMessage("登入狀態讀取失敗。"); return; }
    currentUser = sessionResult.data.session ? sessionResult.data.session.user : null;
    if (currentUser) {
      accountLabel.textContent = currentUser.email || "已登入";
      historyAccountLabel.textContent = currentUser.email || "已登入";
      showOnly(appView);
      try { await loadToday(); } catch (error) { saveMessage.textContent = "目前無法讀取今天的日記。"; }
    } else showOnly(authView);
  }

  authForm.addEventListener("submit", sendMagicLink);
  saveButton.addEventListener("click", saveToday);
  document.getElementById("history-link").addEventListener("click", showHistory);
  document.getElementById("back-link").addEventListener("click", showHome);
  document.getElementById("export-button").addEventListener("click", exportBackup);
  document.getElementById("import-button").addEventListener("click", function () { document.getElementById("import-file").click(); });
  document.getElementById("import-file").addEventListener("change", function (event) { readBackupFile(event.target.files[0]); event.target.value = ""; });
  document.getElementById("migration-button").addEventListener("click", migrateLegacy);
  document.getElementById("sign-out-button").addEventListener("click", signOut);
  document.getElementById("sign-out-secondary").addEventListener("click", signOut);
  initialize();
}());
