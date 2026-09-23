"use strict";

const $ = (id) => document.getElementById(id);
const config = window.VIBENT_ADMIN_CONFIG || {};
const storageKey = "vibent-admin-session";
const pageSize = 30;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const state = {
  session: null, catalog: [], table: null, rows: [], total: 0, page: 0,
  editing: null, userLabels: {}, memberships: [], membershipFilter: "all",
  membershipsLoaded: false, users: [], usersTotal: 0, usersPage: 0,
  hobbies: [], categories: [], moods: [], hobbyMoods: [], hobbyTips: [],
  hobbyImages: [], hobbyId: null, hobbiesLoaded: false
};
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
  switchView("tables");
  renderTableList();
  if (result.length) await selectTable(result[0].name);
  else $("table-state").textContent = "Yönetilebilir tablo bulunamadı.";
}

async function loadUserLabels(rows) {
  const ids = [...new Set(rows.flatMap((row) => Object.values(row)
    .filter((value) => typeof value === "string" && uuidPattern.test(value))))]
    .filter((id) => !(id in state.userLabels));
  for (let index = 0; index < ids.length; index += 300) {
    const labels = await rpc("admin_user_labels", { p_ids: ids.slice(index, index + 300) });
    Object.assign(state.userLabels, labels || {});
    for (const id of ids.slice(index, index + 300)) {
      if (!(id in state.userLabels)) state.userLabels[id] = null;
    }
  }
}

function userLabel(id) {
  const user = state.userLabels[id];
  if (!user) return null;
  return {
    name: user.name || (user.username ? `@${user.username}` : user.email || id),
    email: user.email || id
  };
}

function userCell(id) {
  const label = userLabel(id);
  const wrap = document.createElement("div");
  wrap.className = "person-cell";
  wrap.title = `Kullanıcı ID: ${id}`;
  const name = document.createElement("strong");
  name.textContent = label?.name || id;
  wrap.append(name);
  if (label && label.email !== label.name) {
    const email = document.createElement("small");
    email.textContent = label.email;
    wrap.append(email);
  }
  return wrap;
}

function columnTitle(name) {
  if (name === "id" && state.table?.name === "profiles") return "Kullanıcı";
  return ({ user_id: "Kullanıcı", creator_user_id: "Oluşturan", sender_user_id: "Gönderen",
    recipient_user_id: "Alıcı", first_name: "Ad", last_name: "Soyad",
    tier: "Üyelik", source: "Kaynak" })[name] || name;
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
  const table = state.table;
  $("table-state").hidden = false;
  $("table-state").textContent = "Kayıtlar yükleniyor…";
  $("rows-container").hidden = true;
  try {
    const result = await rpc("admin_rows", {
      p_table: table.name,
      p_limit: pageSize,
      p_offset: state.page * pageSize
    });
    if (state.table !== table) return;
    state.rows = result.rows || [];
    state.total = result.total || 0;
    await loadUserLabels(state.rows);
    if (state.table !== table) return;
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
  if (!state.table) return;
  const columns = state.table.columns;
  const query = $("row-search").value.trim().toLocaleLowerCase("tr");
  const rows = state.rows.filter((row) => !query || Object.values(row).some((value) => {
    const label = typeof value === "string" ? userLabel(value) : null;
    return `${valueText(value)} ${label?.name || ""} ${label?.email || ""}`
      .toLocaleLowerCase("tr").includes(query);
  }));
  const head = $("rows-head");
  const body = $("rows-body");
  head.replaceChildren();
  body.replaceChildren();
  const headRow = document.createElement("tr");
  for (const column of columns) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = columnTitle(column.name);
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
      const value = row[column.name];
      if (typeof value === "string" && userLabel(value)) {
        td.append(userCell(value));
        td.className = "user-table-cell";
      } else {
        td.textContent = valueText(value);
        td.title = valueText(value);
      }
      tr.append(td);
    }
    const td = document.createElement("td");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Düzenle";
    edit.addEventListener("click", () => openRecord(row));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "row-delete";
    remove.textContent = "Sil";
    remove.disabled = !recordKey(row);
    remove.title = remove.disabled ? "Bu kaydın birincil anahtarı yok; silme kapalı." : "Kaydı sil";
    remove.addEventListener("click", () => deleteRecord(row, state.table));
    td.className = "row-actions";
    td.append(edit, remove);
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

function recordKey(row, table = state.table) {
  const names = table?.columns.filter((column) => column.is_primary).map((column) => column.name) || [];
  if (!names.length) return null;
  return Object.fromEntries(names.map((name) => [name, row[name]]));
}

function openRecord(row = null) {
  state.editing = row;
  const person = row && userLabel(row.user_id || row.id);
  $("dialog-title").textContent = row
    ? `${state.table.name} · ${person?.name || "Düzenle"}`
    : `${state.table.name} · Yeni kayıt`;
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
    if (state.table.name === "user_memberships" && ["tier", "source"].includes(column.name)) {
      input = document.createElement("select");
      const values = column.name === "tier"
        ? [["standard", "Standart"], ["vip", "VIP"]]
        : [["manual", "Elle tanımlandı"], ["promotion", "Promosyon"]];
      if (column.name === "source" && ["apple", "google"].includes(row?.source)) {
        values.push([row.source, row.source === "apple" ? "App Store satın alımı" : "Google Play satın alımı"]);
        input.disabled = true;
      }
      for (const [value, text] of values) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        input.append(option);
      }
      input.value = row?.[column.name] || (column.name === "tier" ? "standard" : "manual");
    } else if (column.data_type === "boolean") {
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
    if (state.table.name === "user_memberships" && state.membershipsLoaded) await loadMemberships();
  } catch (error) {
    $("record-error").textContent = error.message;
    $("record-error").hidden = false;
  } finally { button.disabled = false; }
}

async function deleteRecord(row = state.editing, table = state.table) {
  const key = row && recordKey(row, table);
  if (!key) return;
  const label = Object.values(key).map((value) => userLabel(value)?.name || value).join(", ");
  if (!confirm(`${table.name} tablosundaki “${label}” kaydını kalıcı olarak silmek istiyor musun? İlişkili kayıtlar da etkilenebilir; bu işlem geri alınamaz.`)) return;
  const button = $("delete-button");
  button.disabled = true;
  try {
    await rpc("admin_delete", { p_table: table.name, p_key: key });
    if ($("record-dialog").open) $("record-dialog").close();
    notify("Kayıt silindi.");
    if (state.table === table) await loadRows();
    if (table.name === "user_memberships" && state.membershipsLoaded) await loadMemberships();
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

function membershipGroup(row) {
  if (row.tier !== "vip") return "standard";
  if (["apple", "google"].includes(row.source)) return "purchased";
  return row.source === "promotion" ? "promotion" : "manual";
}

function membershipStatus(row) {
  if (row.tier !== "vip") return ["Standart", "standard"];
  const now = Date.now();
  if (row.vip_started_at && Date.parse(row.vip_started_at) > now) return ["Başlayacak", "upcoming"];
  if (row.vip_expires_at && Date.parse(row.vip_expires_at) <= now) return ["Süresi doldu", "expired"];
  return ["Aktif VIP", "active"];
}

function membershipSource(row) {
  return ({ manual: "Elle tanımlandı", apple: "App Store", google: "Google Play",
    promotion: "Promosyon" })[row.source] || "Bilinmiyor";
}

function shortDate(value) {
  if (!value) return "Süresiz";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium" }).format(date);
}

function dateOrDash(value) { return value ? shortDate(value) : "—"; }

async function loadUsers() {
  $("users-state").hidden = false;
  $("users-state").textContent = "Kullanıcılar yükleniyor…";
  $("users-table-wrap").hidden = true;
  try {
    const result = await rpc("admin_users", {
      p_search: $("users-search").value.trim(), p_limit: pageSize,
      p_offset: state.usersPage * pageSize
    });
    state.users = result.rows || [];
    state.usersTotal = result.total || 0;
    renderUsers();
  } catch (error) {
    $("users-state").textContent = `Kullanıcılar yüklenemedi: ${error.message}`;
    notify(error.message, true);
  }
}

function renderUsers() {
  const body = $("users-rows");
  body.replaceChildren();
  for (const row of state.users) {
    const tr = document.createElement("tr");
    const person = document.createElement("td");
    const cell = document.createElement("div");
    cell.className = "person-cell";
    const name = document.createElement("strong");
    name.textContent = [row.first_name, row.last_name].filter(Boolean).join(" ") || row.username || "İsim girilmemiş";
    const email = document.createElement("small");
    email.textContent = row.email || "E-posta yok";
    cell.append(name, email);
    person.append(cell);
    const location = document.createElement("td");
    location.textContent = [row.district, row.city].filter(Boolean).join(", ") || "—";
    const tier = document.createElement("td");
    const [status, kind] = membershipStatus(row);
    const badge = document.createElement("span");
    badge.className = `status-badge ${kind}`;
    badge.textContent = status;
    tier.append(badge);
    const source = document.createElement("td");
    source.textContent = row.tier === "vip" ? membershipSource(row) : "—";
    const created = document.createElement("td");
    created.textContent = dateOrDash(row.created_at);
    const signed = document.createElement("td");
    signed.textContent = dateOrDash(row.last_sign_in_at);
    const actions = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "VIP bölümüne git";
    button.addEventListener("click", () => {
      $("membership-search").value = row.email || row.id;
      switchView("memberships");
    });
    actions.append(button);
    tr.append(person, location, tier, source, created, signed, actions);
    body.append(tr);
  }
  $("users-table-wrap").hidden = !state.users.length;
  $("users-state").hidden = !!state.users.length;
  if (!state.users.length) $("users-state").textContent = "Eşleşen kullanıcı yok.";
  const start = state.usersTotal ? state.usersPage * pageSize + 1 : 0;
  const end = Math.min((state.usersPage + 1) * pageSize, state.usersTotal);
  $("users-page-info").textContent = `${start}–${end} / ${state.usersTotal}`;
  $("users-prev").disabled = state.usersPage === 0;
  $("users-next").disabled = end >= state.usersTotal;
}

async function allAdminRows(table) {
  const rows = [];
  let total = 0;
  do {
    const result = await rpc("admin_rows", { p_table: table, p_limit: 100, p_offset: rows.length });
    rows.push(...(result.rows || []));
    total = result.total || 0;
    if (!result.rows?.length) break;
  } while (rows.length < total);
  return rows;
}

async function loadHobbies(preferredId = state.hobbyId) {
  $("hobby-list").textContent = "Hobiler yükleniyor…";
  try {
    const [hobbies, categories, moods, hobbyMoods, hobbyTips, hobbyImages] = await Promise.all([
      "hobbies", "categories", "moods", "hobby_moods", "hobby_tips", "hobby_images"
    ].map(allAdminRows));
    Object.assign(state, { hobbies, categories, moods, hobbyMoods, hobbyTips, hobbyImages, hobbiesLoaded: true });
    renderHobbyList();
    editHobby(preferredId && hobbies.some((hobby) => hobby.id === preferredId) ? preferredId : null);
  } catch (error) {
    $("hobby-list").textContent = `Hobiler yüklenemedi: ${error.message}`;
    notify(error.message, true);
  }
}

function renderHobbyList() {
  const query = $("hobby-search").value.trim().toLocaleLowerCase("tr");
  const list = $("hobby-list");
  list.replaceChildren();
  for (const hobby of [...state.hobbies].sort((a, b) => a.name.localeCompare(b.name, "tr"))
    .filter((item) => item.name.toLocaleLowerCase("tr").includes(query))) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hobby-list-item";
    button.classList.toggle("selected", state.hobbyId === hobby.id);
    const image = document.createElement("img");
    image.src = hobby.hero_image_url || "/assets/vibent-icon.png";
    image.alt = "";
    const details = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = hobby.name;
    const status = document.createElement("small");
    status.textContent = hobby.is_active ? "Yayında" : "Taslak";
    details.append(name, status);
    button.append(image, details);
    button.addEventListener("click", () => editHobby(hobby.id));
    list.append(button);
  }
  if (!list.children.length) list.textContent = "Eşleşen hobi yok.";
}

function editHobby(id = null) {
  state.hobbyId = id;
  const hobby = state.hobbies.find((item) => item.id === id) || {};
  const form = $("hobby-form");
  form.reset();
  $("hobby-error").hidden = true;
  $("hobby-editor-title").textContent = hobby.name || "Yeni hobi";
  const category = $("hobby-category");
  category.replaceChildren(new Option("Kategori seç", ""));
  for (const item of state.categories.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))) {
    category.add(new Option(item.name, item.id));
  }
  const names = ["name", "slug", "category_id", "sort_order", "short_description", "description",
    "difficulty", "environment", "typical_duration", "typical_duration_minutes", "social_level", "energy_level",
    "what_to_expect", "what_to_bring", "beginner_note", "safety_note", "video_url"];
  for (const name of names) form.elements.namedItem(name).value = hobby[name] ?? "";
  if (!id) form.elements.namedItem("sort_order").value = "0";
  form.elements.namedItem("is_beginner_friendly").checked = hobby.is_beginner_friendly ?? true;
  form.elements.namedItem("is_active").checked = hobby.is_active ?? false;
  const moodBox = $("hobby-moods");
  moodBox.replaceChildren();
  const selected = new Set(state.hobbyMoods.filter((link) => link.hobby_id === id).map((link) => link.mood_id));
  for (const mood of state.moods) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = mood.id;
    input.checked = selected.has(mood.id);
    label.append(input, ` ${mood.name}`);
    moodBox.append(label);
  }
  for (const type of ["know_before", "bring"]) {
    form.elements.namedItem(type).value = state.hobbyTips
      .filter((tip) => tip.hobby_id === id && tip.tip_type === type)
      .sort((a, b) => a.sort_order - b.sort_order).map((tip) => tip.content).join("\n");
  }
  $("hobby-photo-hint").hidden = !!id;
  $("hobby-delete").hidden = !id;
  $("hobby-photo-file").disabled = !id;
  $("hobby-photo-upload").disabled = !id;
  renderHobbyGallery();
  renderHobbyList();
}

function renderHobbyGallery() {
  const hobby = state.hobbies.find((item) => item.id === state.hobbyId);
  const cover = $("hobby-cover-preview");
  cover.hidden = !hobby?.hero_image_url;
  if (hobby?.hero_image_url) cover.src = hobby.hero_image_url;
  const gallery = $("hobby-gallery");
  gallery.replaceChildren();
  for (const photo of state.hobbyImages.filter((item) => item.hobby_id === state.hobbyId)
    .sort((a, b) => a.sort_order - b.sort_order)) {
    const card = document.createElement("div");
    card.className = "photo-card";
    const image = document.createElement("img");
    image.src = photo.image_url;
    image.alt = photo.alt_text || hobby?.name || "Hobi fotoğrafı";
    const actions = document.createElement("div");
    const select = document.createElement("button");
    select.type = "button";
    select.textContent = hobby?.hero_image_url === photo.image_url ? "Kapak ✓" : "Kapak yap";
    select.disabled = hobby?.hero_image_url === photo.image_url;
    select.addEventListener("click", () => setHobbyCover(photo.image_url));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Kaldır";
    remove.addEventListener("click", () => removeHobbyPhoto(photo));
    actions.append(select, remove);
    card.append(image, actions);
    gallery.append(card);
  }
}

async function saveHobby(event) {
  event.preventDefault();
  const form = $("hobby-form");
  const button = $("hobby-save");
  button.disabled = true;
  $("hobby-error").hidden = true;
  try {
    const old = state.hobbies.find((item) => item.id === state.hobbyId) || {};
    const fields = ["name", "slug", "category_id", "sort_order", "short_description", "description",
      "difficulty", "environment", "typical_duration", "typical_duration_minutes", "social_level", "energy_level",
      "what_to_expect", "what_to_bring", "beginner_note", "safety_note", "video_url"];
    const hobby = { id: state.hobbyId, hero_image_url: old.hero_image_url || null, image_prompt: old.image_prompt || null };
    for (const name of fields) hobby[name] = form.elements.namedItem(name).value.trim();
    hobby.is_beginner_friendly = form.elements.namedItem("is_beginner_friendly").checked;
    hobby.is_active = form.elements.namedItem("is_active").checked;
    const moodIds = [...$("hobby-moods").querySelectorAll("input:checked")].map((input) => input.value);
    const tips = ["know_before", "bring"].flatMap((type) => form.elements.namedItem(type).value
      .split("\n").map((content) => content.trim()).filter(Boolean).map((content) => ({ tip_type: type, content })));
    const saved = await rpc("admin_hobby_save", { p_hobby: hobby, p_mood_ids: moodIds, p_tips: tips });
    notify(`“${saved.name}” kaydedildi.`);
    await loadHobbies(saved.id);
  } catch (error) {
    $("hobby-error").textContent = error.message;
    $("hobby-error").hidden = false;
  } finally { button.disabled = false; }
}

async function setHobbyCover(url) {
  try {
    await rpc("admin_write", { p_table: "hobbies", p_key: { id: state.hobbyId }, p_values: { hero_image_url: url } });
    notify("Kapak fotoğrafı değiştirildi.");
    await loadHobbies(state.hobbyId);
  } catch (error) { notify(error.message, true); }
}

async function uploadHobbyPhotos() {
  const files = [...$("hobby-photo-file").files];
  if (!state.hobbyId || !files.length) return;
  if (files.some((file) => file.type !== "image/jpeg" || file.size > 5 * 1024 * 1024)) {
    notify("Her fotoğraf JPG biçiminde ve en fazla 5 MB olmalı.", true);
    return;
  }
  const button = $("hobby-photo-upload");
  button.disabled = true;
  const id = state.hobbyId;
  try {
    let cover = state.hobbies.find((item) => item.id === id)?.hero_image_url;
    for (const file of files) {
      const path = `hobbies/${id}/${crypto.randomUUID()}.jpg`;
      await api(`/storage/v1/object/hobby-covers/${path}`, {
        method: "POST", headers: { "Content-Type": "image/jpeg", "x-upsert": "false" }, body: file
      });
      const url = `${config.supabaseUrl}/storage/v1/object/public/hobby-covers/${path}`;
      await rpc("admin_write", { p_table: "hobby_images", p_key: null,
        p_values: { hobby_id: id, image_url: url, alt_text: file.name, sort_order: state.hobbyImages.length } });
      if (!cover) {
        await rpc("admin_write", { p_table: "hobbies", p_key: { id }, p_values: { hero_image_url: url } });
        cover = url;
      }
    }
    $("hobby-photo-file").value = "";
    notify(`${files.length} fotoğraf yüklendi.`);
    await loadHobbies(id);
  } catch (error) { notify(`Fotoğraf yükleme tamamlanamadı: ${error.message}`, true); await loadHobbies(id); }
  finally { button.disabled = false; }
}

async function removeHobbyPhoto(photo) {
  const cover = state.hobbies.find((item) => item.id === state.hobbyId)?.hero_image_url;
  if (cover === photo.image_url) { notify("Önce başka bir fotoğrafı kapak yap.", true); return; }
  if (!confirm("Fotoğrafı hobi galerisinden kaldırmak istiyor musun? Yüklenen dosya depoda kalır.")) return;
  try {
    await rpc("admin_delete", { p_table: "hobby_images", p_key: { id: photo.id } });
    notify("Fotoğraf galeriden kaldırıldı.");
    await loadHobbies(state.hobbyId);
  } catch (error) { notify(error.message, true); }
}

async function deleteHobby() {
  const hobby = state.hobbies.find((item) => item.id === state.hobbyId);
  if (!hobby || !confirm(`“${hobby.name}” hobisini kalıcı olarak silmek istiyor musun? Bağlı etkinlikler varsa veritabanı silmeyi engeller; görseller depoda kalır.`)) return;
  const button = $("hobby-delete");
  button.disabled = true;
  try {
    await rpc("admin_delete", { p_table: "hobbies", p_key: { id: hobby.id } });
    notify("Hobi silindi.");
    await loadHobbies(null);
  } catch (error) { notify(`Hobi silinemedi: ${error.message}`, true); }
  finally { button.disabled = false; }
}

async function changeVip(row, enable) {
  const person = userLabel(row.user_id)?.name || row.user_id;
  const question = enable
    ? `${person} için elle tanımlanan VIP üyeliği başlatmak istiyor musun?`
    : `${person} için elle tanımlanan VIP üyeliği kaldırmak istiyor musun?`;
  if (!confirm(question)) return;
  try {
    await rpc("admin_write", {
      p_table: "user_memberships",
      p_key: { user_id: row.user_id },
      p_values: enable
        ? { tier: "vip", source: "manual", vip_started_at: new Date().toISOString(), vip_expires_at: null }
        : { tier: "standard", source: "manual", vip_started_at: null, vip_expires_at: null }
    });
    notify(enable ? "VIP üyelik tanımlandı." : "VIP üyelik kaldırıldı.");
    await loadMemberships();
    if (state.table?.name === "user_memberships") await loadRows();
  } catch (error) { notify(error.message, true); }
}

async function loadMemberships() {
  $("membership-state").hidden = false;
  $("membership-state").textContent = "Üyelikler yükleniyor…";
  $("membership-table-wrap").hidden = true;
  try {
    const rows = [];
    let total = 0;
    do {
      const result = await rpc("admin_rows", {
        p_table: "user_memberships", p_limit: 100, p_offset: rows.length
      });
      rows.push(...(result.rows || []));
      total = result.total || 0;
      if (!result.rows?.length) break;
    } while (rows.length < total);
    await loadUserLabels(rows);
    state.memberships = rows;
    state.membershipsLoaded = true;
    renderMemberships();
  } catch (error) {
    $("membership-state").textContent = `Üyelikler yüklenemedi: ${error.message}`;
    notify(error.message, true);
  }
}

function renderMemberships() {
  if (!state.membershipsLoaded) return;
  const vip = state.memberships.filter((row) => row.tier === "vip");
  const active = vip.filter((row) => membershipStatus(row)[1] === "active");
  $("vip-active-count").textContent = String(active.length);
  $("vip-manual-count").textContent = String(active.filter((row) => membershipGroup(row) === "manual").length);
  $("vip-purchased-count").textContent = String(active.filter((row) => membershipGroup(row) === "purchased").length);
  $("vip-promotion-count").textContent = String(active.filter((row) => membershipGroup(row) === "promotion").length);
  for (const button of document.querySelectorAll("[data-membership-filter]")) {
    const selected = button.dataset.membershipFilter === state.membershipFilter;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }

  const query = $("membership-search").value.trim().toLocaleLowerCase("tr");
  const rows = state.memberships.filter((row) => {
    const group = membershipGroup(row);
    if (state.membershipFilter === "all" ? group === "standard" : group !== state.membershipFilter) return false;
    const label = userLabel(row.user_id);
    return !query || [label?.name, label?.email, row.user_id, membershipSource(row)]
      .some((value) => value?.toLocaleLowerCase("tr").includes(query));
  });

  const body = $("membership-rows");
  body.replaceChildren();
  for (const row of rows) {
    const tr = document.createElement("tr");
    const person = document.createElement("td");
    person.append(userCell(row.user_id));
    const status = document.createElement("td");
    const [text, kind] = membershipStatus(row);
    const badge = document.createElement("span");
    badge.className = `status-badge ${kind}`;
    badge.textContent = text;
    status.append(badge);
    const source = document.createElement("td");
    source.textContent = membershipSource(row);
    const start = document.createElement("td");
    start.textContent = row.vip_started_at ? shortDate(row.vip_started_at) : "—";
    const end = document.createElement("td");
    end.textContent = row.tier === "vip" ? shortDate(row.vip_expires_at) : "—";
    const action = document.createElement("td");
    const edit = document.createElement("button");
    edit.type = "button";
    edit.textContent = "Düzenle";
    edit.addEventListener("click", async () => {
      switchView("tables");
      await selectTable("user_memberships");
      openRecord(row);
    });
    action.append(edit);
    if (row.tier === "standard" || membershipGroup(row) === "manual") {
      const vipAction = document.createElement("button");
      vipAction.type = "button";
      vipAction.className = row.tier === "standard" ? "vip-grant" : "vip-revoke";
      vipAction.textContent = row.tier === "standard" ? "VIP yap" : "VIP kaldır";
      vipAction.addEventListener("click", () => changeVip(row, row.tier === "standard"));
      action.append(vipAction);
    }
    tr.append(person, status, source, start, end, action);
    body.append(tr);
  }
  $("membership-table-wrap").hidden = !rows.length;
  $("membership-state").hidden = !!rows.length;
  if (!rows.length) {
    $("membership-state").textContent = state.membershipFilter === "purchased"
      ? "Henüz App Store veya Google Play üzerinden satın alınmış VIP üyelik yok. Satın alma altyapısı açılınca kayıtlar burada görünecek."
      : "Bu bölümde gösterilecek üyelik yok.";
  }
}

function switchView(view) {
  const contentViews = ["events", "venues", "moods", "categories"];
  $("tables-view").hidden = view !== "tables";
  $("users-view").hidden = view !== "users";
  $("memberships-view").hidden = view !== "memberships";
  $("hobbies-view").hidden = view !== "hobbies";
  $("content-view").hidden = !contentViews.includes(view);
  $("media-view").hidden = view !== "media";
  for (const name of ["tables", "users", "memberships", "hobbies", ...contentViews, "media"]) {
    $(`${name}-nav`).classList.toggle("selected", name === view);
  }
  $("page-title").textContent = ({ tables: "Tablolar", users: "Kullanıcılar", memberships: "VIP Üyelikler", hobbies: "Hobiler", events: "Etkinlikler", venues: "Atölye / Mekânlar", moods: "Modlar", categories: "Kategoriler", media: "Görseller" })[view];
  if (view === "users") loadUsers();
  if (view === "memberships") loadMemberships();
  if (view === "hobbies") loadHobbies();
  if (contentViews.includes(view)) loadContentType(view);
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
  state.userLabels = {};
  state.memberships = [];
  state.membershipsLoaded = false;
  state.hobbiesLoaded = false;
  state.hobbyId = null;
  showLogin();
});
$("tables-nav").addEventListener("click", () => switchView("tables"));
$("users-nav").addEventListener("click", () => switchView("users"));
$("memberships-nav").addEventListener("click", () => switchView("memberships"));
$("hobbies-nav").addEventListener("click", () => switchView("hobbies"));
for (const name of ["events", "venues", "moods", "categories"]) {
  $(`${name}-nav`).addEventListener("click", () => switchView(name));
}
$("media-nav").addEventListener("click", () => switchView("media"));
let usersSearchTimer;
$("users-search").addEventListener("input", () => {
  clearTimeout(usersSearchTimer);
  usersSearchTimer = setTimeout(() => { state.usersPage = 0; loadUsers(); }, 300);
});
$("users-refresh").addEventListener("click", loadUsers);
$("users-prev").addEventListener("click", () => { if (state.usersPage > 0) { state.usersPage--; loadUsers(); } });
$("users-next").addEventListener("click", () => { if ((state.usersPage + 1) * pageSize < state.usersTotal) { state.usersPage++; loadUsers(); } });
$("hobby-search").addEventListener("input", renderHobbyList);
$("new-hobby").addEventListener("click", () => editHobby());
$("hobby-form").addEventListener("submit", saveHobby);
$("hobby-delete").addEventListener("click", deleteHobby);
$("hobby-photo-upload").addEventListener("click", uploadHobbyPhotos);
$("membership-search").addEventListener("input", renderMemberships);
for (const button of document.querySelectorAll("[data-membership-filter]")) {
  button.addEventListener("click", () => {
    state.membershipFilter = button.dataset.membershipFilter;
    renderMemberships();
  });
}
$("table-search").addEventListener("input", renderTableList);
$("row-search").addEventListener("input", renderRows);
$("refresh-button").addEventListener("click", loadRows);
$("add-row-button").addEventListener("click", () => openRecord());
$("prev-page").addEventListener("click", () => { if (state.page > 0) { state.page--; loadRows(); } });
$("next-page").addEventListener("click", () => { if ((state.page + 1) * pageSize < state.total) { state.page++; loadRows(); } });
$("close-dialog").addEventListener("click", () => $("record-dialog").close());
$("cancel-button").addEventListener("click", () => $("record-dialog").close());
$("record-form").addEventListener("submit", saveRecord);
$("delete-button").addEventListener("click", () => deleteRecord());
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
