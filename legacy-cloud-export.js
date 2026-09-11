(function () {
  "use strict";
  var config = window.SUPABASE_CONFIG || {};
  var form = document.getElementById("legacy-auth-form");
  var email = document.getElementById("legacy-email");
  var exportButton = document.getElementById("legacy-export");
  var signoutButton = document.getElementById("legacy-signout");
  var status = document.getElementById("legacy-status");
  var client;

  function show(message, error) { status.textContent = message; status.classList.toggle("error", Boolean(error)); }
  function configured() { return config.url && config.anonKey && window.supabase; }
  function localToday() { var now = new Date(); return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-"); }

  async function updateSession(session) {
    var signedIn = Boolean(session && session.user);
    form.hidden = signedIn;
    exportButton.disabled = !signedIn;
    signoutButton.hidden = !signedIn;
    show(signedIn ? "已登入 " + (session.user.email || "舊帳號") + "，可以下載。" : "請登入原本的帳號。", false);
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    show("登入連結寄送中⋯", false);
    var result = await client.auth.signInWithOtp({ email: email.value.trim(), options: { emailRedirectTo: window.location.href.split("#")[0].split("?")[0] } });
    show(result.error ? "寄送失敗：" + result.error.message : "請開啟 Email 中的登入連結，再回到此頁。", Boolean(result.error));
  });

  exportButton.addEventListener("click", async function () {
    exportButton.disabled = true;
    show("正在讀取舊雲端筆記⋯", false);
    var result = await client.from("reading_entries").select("entry_date,content,updated_at").order("entry_date", { ascending: true });
    if (result.error) { show("讀取失敗：" + result.error.message, true); exportButton.disabled = false; return; }
    var entries = (result.data || []).map(function (item) { return { date: item.entry_date, content: item.content, updatedAt: item.updated_at }; });
    var backup = { format: "reading-journal", version: 2, exportedAt: new Date().toISOString(), entries: entries, drafts: [], source: "legacy-supabase" };
    var url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }));
    var link = document.createElement("a");
    link.href = url;
    link.download = "reading-journal-cloud-backup-" + localToday() + ".json";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    show("已下載 " + entries.length + " 篇舊雲端筆記。回到主頁匯入即可。", false);
    exportButton.disabled = false;
  });

  signoutButton.addEventListener("click", async function () { await client.auth.signOut(); await updateSession(null); });

  if (!configured()) { show("舊 Supabase 設定不存在，無法使用此搬移工具。", true); return; }
  client = window.supabase.createClient(config.url, config.anonKey);
  client.auth.onAuthStateChange(function (_event, session) { updateSession(session); });
  client.auth.getSession().then(function (result) { if (result.error) show("無法讀取登入狀態。", true); else updateSession(result.data.session); });
}());
