import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/manifest+json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png" };

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    const relative = pathname === "/reading-journal/" ? "index.html" : pathname.replace(/^\/reading-journal\//, "");
    const file = resolve(root, relative);
    if (!file.startsWith(root) || !(await stat(file)).isFile()) throw new Error("not found");
    response.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control": "no-cache" });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404); response.end("Not found");
  }
});
await new Promise(resolveReady => server.listen(4173, "127.0.0.1", resolveReady));

async function launch(profile) {
  const chrome = spawn(chromePath, ["--headless=new", "--no-first-run", "--disable-gpu", "--window-size=390,844", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "http://127.0.0.1:4173/reading-journal/"], { stdio: ["ignore", "ignore", "pipe"] });
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(new Error("Chrome debugging endpoint timeout: " + output)), 10000);
    chrome.stderr.on("data", chunk => {
      output += chunk;
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); resolveEndpoint(match[1]); }
    });
    chrome.once("exit", code => reject(new Error("Chrome exited early: " + code + " " + output)));
  });
  const port = new URL(endpoint).port;
  let pages = [];
  for (let attempt = 0; attempt < 40 && !pages.length; attempt += 1) {
    pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(result => result.json());
    if (!pages.length) await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  const page = pages.find(item => item.type === "page");
  assert(page, "Chrome page target exists");
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const handler = pending.get(message.id); pending.delete(message.id); message.error ? handler.reject(new Error(message.error.message)) : handler.resolve(message.result); }
  };
  function command(method, params = {}) {
    const commandId = ++id;
    socket.send(JSON.stringify({ id: commandId, method, params }));
    return new Promise((resolveCommand, reject) => pending.set(commandId, { resolve: resolveCommand, reject }));
  }
  async function evaluate(expression) {
    const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ": " + (result.result.description || ""));
    return result.result.value;
  }
  async function waitFor(expression, timeout = 7000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      try { if (await evaluate(expression)) return; } catch {}
      await new Promise(resolveWait => setTimeout(resolveWait, 100));
    }
    throw new Error("Timed out waiting for: " + expression);
  }
  await command("Runtime.enable");
  await command("Network.enable");
  await waitFor("document.readyState === 'complete' && !document.querySelector('#entry-content').disabled");
  return { chrome, socket, command, evaluate, waitFor };
}

const profile = await mkdtemp(join(tmpdir(), "reading-journal-e2e-"));
const secondProfile = await mkdtemp(join(tmpdir(), "reading-journal-e2e-fresh-"));
let browser;
let freshBrowser;
try {
  browser = await launch(profile);
  const { evaluate, waitFor, command } = browser;
  assert.equal(await evaluate("document.querySelector('#entry-date').value"), new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  assert.equal(await evaluate("document.querySelector('#today-button').getBoundingClientRect().right <= document.documentElement.clientWidth"), true, "mobile header action stays in viewport");

  await evaluate(`(() => { const t=document.querySelector('#entry-content'); t.dispatchEvent(new CompositionEvent('compositionstart')); t.value='中文組字測試'; t.dispatchEvent(new InputEvent('input',{data:'試',inputType:'insertCompositionText'})); })()`);
  await new Promise(resolveWait => setTimeout(resolveWait, 800));
  assert.equal(await evaluate(`new Promise(r=>{const q=indexedDB.open('reading-journal-local');q.onsuccess=()=>{const x=q.result.transaction('drafts').objectStore('drafts').get(document.querySelector('#entry-date').value);x.onsuccess=()=>r(x.result||null)}})`), null, "composition does not autosave mid-sequence");
  await evaluate(`document.querySelector('#entry-content').dispatchEvent(new CompositionEvent('compositionend',{data:'中文組字測試'}))`);
  await waitFor("document.querySelector('#save-status').textContent.includes('自動保存')");
  assert.equal(await evaluate(`new Promise(r=>{const q=indexedDB.open('reading-journal-local');q.onsuccess=()=>{const x=q.result.transaction('drafts').objectStore('drafts').get(document.querySelector('#entry-date').value);x.onsuccess=()=>r(x.result.content)}})`), "中文組字測試");

  await evaluate("document.querySelector('#save-button').click()");
  await waitFor("document.querySelector('#save-status').textContent === '已儲存'");
  await command("Page.reload", { ignoreCache: true });
  await waitFor("document.readyState === 'complete' && !document.querySelector('#entry-content').disabled");
  assert.equal(await evaluate("document.querySelector('#entry-content').value"), "中文組字測試", "saved note survives reload");

  const yesterday = await evaluate(`(() => { const d=new Date(); d.setDate(d.getDate()-1); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-') })()`);
  await evaluate(`(() => { const t=document.querySelector('#entry-content'); t.value='今天的長文草稿 '+('內容'.repeat(2000)); t.dispatchEvent(new InputEvent('input')); const d=document.querySelector('#entry-date'); d.value=${JSON.stringify(yesterday)}; d.dispatchEvent(new Event('change')); })()`);
  await waitFor(`document.querySelector('#entry-date').value === ${JSON.stringify(yesterday)} && !document.querySelector('#entry-content').disabled`);
  await evaluate(`(() => { const t=document.querySelector('#entry-content'); t.value='昨天筆記'; t.dispatchEvent(new InputEvent('input')); document.querySelector('#save-button').click(); })()`);
  await waitFor("document.querySelector('#save-status').textContent === '已儲存'");
  await evaluate("document.querySelector('#today-button').click()");
  await waitFor("document.querySelector('#entry-content').value.startsWith('今天的長文草稿')");
  assert.equal(await evaluate("document.querySelector('#entry-content').value.length"), 4008, "long draft survives immediate date switch");

  await evaluate(`(() => { const payload={format:'reading-journal',version:2,entries:[{date:${JSON.stringify(yesterday)},content:'不應靜默覆蓋'},{date:'2020-01-02',content:'匯入的新筆記'}],drafts:[]}; const f=new File([JSON.stringify(payload)],'backup.json',{type:'application/json'}); const dt=new DataTransfer();dt.items.add(f);const i=document.querySelector('#import-file');Object.defineProperty(i,'files',{value:dt.files,configurable:true});i.dispatchEvent(new Event('change')); })()`);
  await waitFor("document.querySelector('#import-dialog').open");
  assert.equal(await evaluate("document.querySelectorAll('#conflict-list div').length"), 1, "same-date conflict is shown");
  await evaluate("document.querySelector('#import-skip').click()");
  await waitFor("document.querySelector('#data-status').textContent.includes('匯入完成')");
  assert.equal(await evaluate(`new Promise(r=>{const q=indexedDB.open('reading-journal-local');q.onsuccess=()=>{const x=q.result.transaction('entries').objectStore('entries').get(${JSON.stringify(yesterday)});x.onsuccess=()=>r(x.result.content)}})`), "昨天筆記", "skip preserves current conflict");
  assert.equal(await evaluate(`new Promise(r=>{const q=indexedDB.open('reading-journal-local');q.onsuccess=()=>{const x=q.result.transaction('entries').objectStore('entries').get('2020-01-02');x.onsuccess=()=>r(x.result.content)}})`), "匯入的新筆記");

  await evaluate(`(() => { const payload={format:'reading-journal',version:2,entries:[{date:${JSON.stringify(yesterday)},content:'明確覆蓋後的版本'}],drafts:[]}; const f=new File([JSON.stringify(payload)],'backup.json',{type:'application/json'}); const dt=new DataTransfer();dt.items.add(f);const i=document.querySelector('#import-file');Object.defineProperty(i,'files',{value:dt.files,configurable:true});i.dispatchEvent(new Event('change')); })()`);
  await waitFor("document.querySelector('#import-dialog').open");
  await evaluate("document.querySelector('#import-overwrite').click()");
  await waitFor("document.querySelector('#data-status').textContent.includes('備份版本')");
  assert.equal(await evaluate(`new Promise(r=>{const q=indexedDB.open('reading-journal-local');q.onsuccess=()=>{const x=q.result.transaction('entries').objectStore('entries').get(${JSON.stringify(yesterday)});x.onsuccess=()=>r(x.result.content)}})`), "明確覆蓋後的版本", "overwrite only happens after explicit choice");

  await evaluate(`window.__backupBlob=null;window.__oldCreate=URL.createObjectURL;URL.createObjectURL=b=>{window.__backupBlob=b;return window.__oldCreate(b)};document.querySelector('#export-button').click()`);
  await waitFor("window.__backupBlob !== null");
  const exported = JSON.parse(await evaluate("window.__backupBlob.text()"));
  assert.equal(exported.format, "reading-journal"); assert.equal(exported.version, 2); assert(Array.isArray(exported.entries)); assert(Array.isArray(exported.drafts));

  await evaluate("caches.open('obsolete-login-shell-v1').then(()=>navigator.serviceWorker.ready)");
  await evaluate("navigator.serviceWorker.getRegistration().then(r=>r.unregister())");
  await command("Page.reload", { ignoreCache: true });
  await waitFor("navigator.serviceWorker.getRegistration().then(Boolean)");
  await waitFor("caches.keys().then(k=>!k.includes('obsolete-login-shell-v1'))");
  await command("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await command("Page.reload", { ignoreCache: false });
  await waitFor("document.readyState === 'complete' && !document.querySelector('#entry-content').disabled");
  await evaluate(`(() => { const t=document.querySelector('#entry-content');t.value='離線草稿';t.dispatchEvent(new InputEvent('input')) })()`);
  await waitFor("document.querySelector('#save-status').textContent.includes('自動保存')");
  assert.equal(await evaluate("document.querySelector('#entry-content').value"), "離線草稿");
  await command("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  freshBrowser = await launch(secondProfile);
  assert.equal(await freshBrowser.evaluate(`new Promise(r=>{const q=indexedDB.open('reading-journal-local');q.onsuccess=()=>{const x=q.result.transaction('entries').objectStore('entries').count();x.onsuccess=()=>r(x.result)}})`), 0, "separate browser profile has independent data");
  await freshBrowser.evaluate(`localStorage.setItem('daily-reading-journal-v1', JSON.stringify({'2019-03-04':'舊本機筆記'})); location.reload()`);
  await freshBrowser.waitFor("document.readyState === 'complete' && !document.querySelector('#entry-content').disabled");
  assert.equal(await freshBrowser.evaluate(`new Promise(r=>{const q=indexedDB.open('reading-journal-local');q.onsuccess=()=>{const x=q.result.transaction('entries').objectStore('entries').get('2019-03-04');x.onsuccess=()=>r(x.result.content)}})`), "舊本機筆記", "legacy localStorage is copied");
  assert.equal(await freshBrowser.evaluate("localStorage.getItem('daily-reading-journal-v1') !== null"), true, "legacy source remains untouched");
  console.log("PASS: local writing, composition, autosave, reload, date switching, long text, import conflict, export, service-worker update, offline write, and profile isolation");
} finally {
  async function stop(instance) {
    if (!instance) return;
    instance.socket.close();
    if (instance.chrome.exitCode === null) {
      const exited = new Promise(resolveExit => instance.chrome.once("exit", resolveExit));
      instance.chrome.kill("SIGTERM");
      await exited;
    }
  }
  await stop(browser);
  await stop(freshBrowser);
  server.close();
  await rm(profile, { recursive: true, force: true });
  await rm(secondProfile, { recursive: true, force: true });
}
