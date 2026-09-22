"use strict";

const $ = (id) => document.getElementById(id);
const config = window.VIBENT_ADMIN_CONFIG || {};
const storageKey = "vibent-admin-session";
const pageSize = 30;
const state = { session: null, catalog: [], table: null, rows: [], total: 0, page: 0, editing: null };
let noticeTimer;

function notify(message, error = false) {
  const box = $("notice");
  box.textContent = message;
  box.classList.toggle("error", error);
  box.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { box.hidden = true; }, 5500);
}

function configured() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.supabaseUrl || "") &&
    typeof config.publishableKey === "string" &&
    config.publishableKey.length > 20 &&
    !config.publishableKey.includes("TEST_PROJECT");
}

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(storageKey) || "null"); }
  catch { return null; }
}

function setSession(session) {
  state.session = session;
  if (session) sessionStorage.setItem(storageKey, JSON.stringify(session));
  else sessionStorage.removeItem(storageKey);
}

async function api(path, options = {}, retry = true) {
  const headers = new Headers(options.headers || {});
  headers.set("apikey", config.publishableKey);
  if (state.session?.access_token) headers.set("Authorization", `Bearer ${state.session.access_token}`);
  if (options.body && !(options.body instanceof File)) headers.set("Content-Type", "application/json");
  const response = await fetch(`${config.supabaseUrl}${path}`, { ...options, headers });
  if (response.status === 401 && retry && state.session?.refresh_token && !path.includes("refresh_token")) {
    await refreshSession();
    return api(path, options, false);
  }
  const raw = await response.text();
  let value;
  try { value = raw ? JSON.parse(raw) : null; } catch { value = raw; }
  if (!response.ok) {
    const message = typeof value === "object" && value
      ? (value.msg || value.message || value.error_description || value.error)
      : null;
    throw new Error(message || `İstek tamamlanamadı (${response.status}).`);
  }
  return value;
}

async function refreshSession() {
  const token = state.session?.refresh_token;
  if (!token) throw new Error("Oturumun sona erdi. Yeniden giriş yap.");
  try {
    const next = await api("/auth/v1/token?grant_type=refresh_token", {
      method: "POST", body: JSON.stringify({ refresh_token: token })
    }, false);
    setSession(next);
  } catch (error) {
    setSession(null);
    throw error;
  }
}

function rpc(name, args = {}) {
  return api(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(args) });
}

function showLogin(message = "") {
  $("login-view").hidden = false;
  $("app-view").hidden = true;
  $("login-error").hidden = !message;
  $("login-error").textContent = message;
  $("password").value = "";
}

function showApp() {
  $("login-view").hidden = true;
  $("app-view").hidden = false;
  $("account-email").textContent = state.session?.user?.email || "Yönetici";
}

async function loadCatalog() {
  const result = await rpc("admin_catalog");
  if (!Array.isArray(result)) throw new Error("Yönetici yetkisi doğrulanamadı.");
  state.catalog = result;
  showApp();
  renderTableList();
  if (result.length) await selectTable(result[0].name);
  else $("table-state").textContent = "Yönetilebilir tablo bulunamadı.";
}

function renderTableList() {
  const list = $("table-list");
  const query = $("table-search").value.trim().toLocaleLowerCase("tr");
  list.replaceChildren();
  for (const table of state.catalog.filter((item) => item.name.toLocaleLowerCase("tr").includes(query))) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = table.name;
    button.classList.toggle("selected", state.table?.name === table.name);
    button.addEventListener("click", () => selectTable(table.name));
    list.append(button);
  }
}

async function selectTable(name) {
  state.table = state.catalog.find((item) => item.name === name) || null;
  state.page = 0;
  $("table-title").textContent = name;
  $("table-description").textContent = "Kayıtları görüntüle, ekle veya düzenle.";
  $("add-row-button").disabled = !state.table;
  $("row-search").value = "";
  renderTableList();
  await loadRows();
}

async function loadRows() {
  if (!state.table) return;
  $("table-state").hidden = false;
  $("table-state").textContent = "Kayıtlar yükleniyor…";
  $("rows-container").hidden = true;
  try {
    const result = await rpc("admin_rows", {
      p_table: state.table.name,
      p_limit: pageSize,
      p_offset: state.page * pageSize
    });
    state.rows = result.rows || [];
    state.total = result.total || 0;
    renderRows();
  } catch (error) {
    $("table-state").textContent = `Kayıtlar yüklenemedi: ${error.message}`;
    notify(error.message, true);
  }
}

function valueText(value) {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function renderRows() {
  const columns = state.table.columns;
  const query = $("row-search").value.trim().toLocaleLowerCase("tr");
  const rows = state.rows.filter((row) => !query || Object.values(row).some((value) => valueText(value).toLocaleLowerCase("tr").includes(query)));
  const head = $("rows-head");
  const body = $("rows-body");
  head.replaceChildren();
  body.replaceChildren();
  const headRow = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = column.name;
    headRow.append(th);
  }
  const actionHead = document.createElement("th");
  actionHead.scope = "col";
  actionHead.textContent = "İşlem";
  headRow.append(actionHead);
  head.append(headRow);
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const column of columns) {
      const td = document.createElement("td");
      td.textContent = valueText(row[column.name]);
      td.title = valueText(row[column.name]);
      tr.append(td);
    }
    const td = document.createElement("td");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Düzenle";
    edit.addEventListener("click", () => openRecord(row));
    td.append(edit);
    tr.append(td);
    body.append(tr);
  }
  $("rows-container").hidden = !rows.length;
  $("table-state").hidden = !!rows.length;
  if (!rows.length) $("table-state").textContent = state.rows.length ? "Aramayla eşleşen kayıt yok." : "Bu tabloda henüz kayıt yok.";
  const start = state.total ? state.page * pageSize + 1 : 0;
  const end = Math.min((state.page + 1) * pageSize, state.total);
  $("page-info").textContent = `${start}–${end} / ${state.total}`;
  $("prev-page").disabled = state.page === 0;
  $("next-page").disabled = (state.page + 1) * pageSize >= state.total;
}

function recordKey(row) {
  const names = state.table.columns.filter((column) => column.is_primary).map((column) => column.name);
  if (!names.length) return null;
  return Object.fromEntries(names.map((name) => [name, row[name]]));
}

function openRecord(row = null) {
  state.editing = row;
  $("dialog-title").textContent = row ? `${state.table.name} · Düzenle` : `${state.table.name} · Yeni kayıt`;
  $("record-error").hidden = true;
  $("delete-button").hidden = !row || !recordKey(row);
  const fields = $("record-fields");
  fields.replaceChildren();
  for (const column of state.table.columns) {
    if (column.is_generated || (row && column.is_primary) || (!row && column.has_default)) continue;
    const wrapper = document.createElement("div");
    wrapper.className = "field";
    const label = document.createElement("label");
    label.htmlFor = `field-${column.name}`;
    label.textContent = column.name;
    let input;
    if (column.data_type === "boolean") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!row?.[column.name];
    } else if (["json", "jsonb", "ARRAY"].includes(column.data_type)) {
      input = document.createElement("textarea");
      input.value = row?.[column.name] == null ? "" : JSON.stringify(row[column.name], null, 2);
    } else {
      input = document.createElement("input");
      input.type = "text";
      input.value = row?.[column.name] == null ? "" : String(row[column.name]);
    }
    input.id = `field-${column.name}`;
    input.dataset.column = column.name;
    input.dataset.type = column.data_type;
    if (!column.is_nullable && !column.has_default && input.type !== "checkbox") input.required = true;
    wrapper.append(label, input);
    const hint = document.createElement("small");
    hint.textContent = `${column.data_type}${column.is_nullable ? " · boş bırakılırsa NULL" : ""}`;
    wrapper.append(hint);
    fields.append(wrapper);
  }
  $("record-dialog").showModal();
}

function formValues() {
  const values = {};
  for (const input of $("record-fields").querySelectorAll("[data-column]")) {
    const name = input.dataset.column;
    const type = input.dataset.type;
    if (type === "boolean") { values[name] = input.checked; continue; }
    const raw = input.value.trim();
    if (raw === "") { values[name] = null; continue; }
    if (["json", "jsonb", "ARRAY"].includes(type)) {
      try { values[name] = JSON.parse(raw); }
      catch { throw new Error(`${name}: geçerli JSON gir.`); }
    } else if (["smallint", "integer", "bigint", "numeric", "real", "double precision"].includes(type)) {
      const number = Number(raw);
      if (!Number.isFinite(number)) throw new Error(`${name}: geçerli sayı gir.`);
      values[name] = number;
    } else values[name] = raw;
  }
  return values;
}

async function saveRecord(event) {
  event.preventDefault();
  const button = $("save-button");
  button.disabled = true;
  $("record-error").hidden = true;
  try {
    const key = state.editing ? recordKey(state.editing) : null;
    if (state.editing && !key) throw new Error("Bu tablonun birincil anahtarı yok; düzenleme kapalı.");
    await rpc("admin_write", { p_table: state.table.name, p_values: formValues(), p_key: key });
    $("record-dialog").close();
    notify("Kayıt kaydedildi.");
    await loadRows();
  } catch (error) {
    $("record-error").textContent = error.message;
    $("record-error").hidden = false;
  } finally { button.disabled = false; }
}

async function deleteRecord() {
  const key = state.editing && recordKey(state.editing);
  if (!key || !confirm("Bu kaydı kalıcı olarak silmek istiyor musun?")) return;
  const button = $("delete-button");
  button.disabled = true;
  try {
    await rpc("admin_delete", { p_table: state.table.name, p_key: key });
    $("record-dialog").close();
    notify("Kayıt silindi.");
    await loadRows();
  } catch (error) { notify(error.message, true); }
  finally { button.disabled = false; }
}

async function uploadImage(event) {
  event.preventDefault();
  const file = $("image-file").files[0];
  if (!file) return;
  if (file.type !== "image/jpeg" || file.size > 5 * 1024 * 1024) {
    notify("En fazla 5 MB boyutunda JPG seç.", true);
    return;
  }
  const button = $("upload-button");
  button.disabled = true;
  try {
    const path = `hobbies/${crypto.randomUUID()}.jpg`;
    await api(`/storage/v1/object/hobby-covers/${path}`, {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", "x-upsert": "false" },
      body: file
    });
    const url = `${config.supabaseUrl}/storage/v1/object/public/hobby-covers/${path}`;
    $("upload-url").value = url;
    $("upload-preview").src = url;
    $("upload-result").hidden = false;
    notify("Görsel yüklendi.");
  } catch (error) { notify(`Yükleme başarısız: ${error.message}`, true); }
  finally { button.disabled = false; }
}

function switchView(view) {
  const media = view === "media";
  $("tables-view").hidden = media;
  $("media-view").hidden = !media;
  $("tables-nav").classList.toggle("selected", !media);
  $("media-nav").classList.toggle("selected", media);
  $("page-title").textContent = media ? "Görseller" : "Tablolar";
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!configured()) { showLogin("Panelin test veritabanı ayarı henüz tamamlanmadı."); return; }
  const button = $("login-button");
  button.disabled = true;
  $("login-error").hidden = true;
  try {
    const session = await api("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email: $("email").value.trim(), password: $("password").value })
    });
    setSession(session);
    await loadCatalog();
  } catch (error) {
    setSession(null);
    showLogin(`Giriş veya yönetici yetkisi doğrulanamadı: ${error.message}`);
  } finally { button.disabled = false; }
});

$("logout-button").addEventListener("click", async () => {
  try { await api("/auth/v1/logout", { method: "POST" }, false); } catch { /* Yerel oturum yine kapatılır. */ }
  setSession(null);
  state.catalog = [];
  state.rows = [];
  showLogin();
});
$("tables-nav").addEventListener("click", () => switchView("tables"));
$("media-nav").addEventListener("click", () => switchView("media"));
$("table-search").addEventListener("input", renderTableList);
$("row-search").addEventListener("input", renderRows);
$("refresh-button").addEventListener("click", loadRows);
$("add-row-button").addEventListener("click", () => openRecord());
$("prev-page").addEventListener("click", () => { if (state.page > 0) { state.page--; loadRows(); } });
$("next-page").addEventListener("click", () => { if ((state.page + 1) * pageSize < state.total) { state.page++; loadRows(); } });
$("close-dialog").addEventListener("click", () => $("record-dialog").close());
$("cancel-button").addEventListener("click", () => $("record-dialog").close());
$("record-form").addEventListener("submit", saveRecord);
$("delete-button").addEventListener("click", deleteRecord);
$("upload-form").addEventListener("submit", uploadImage);
$("copy-url-button").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("upload-url").value); notify("Bağlantı kopyalandı."); }
  catch { $("upload-url").select(); notify("Bağlantıyı seçip kopyalayabilirsin."); }
});

if (!configured()) showLogin("Panelin test veritabanı ayarı henüz tamamlanmadı.");
else {
  setSession(readSession());
  if (state.session) loadCatalog().catch((error) => {
    setSession(null);
    showLogin(`Oturum doğrulanamadı: ${error.message}`);
  });
}
