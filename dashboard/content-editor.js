"use strict";

// Bu dosya dashboard.js sonrasında yüklenir; aynı güvenli admin RPC katmanını kullanır.
const contentDefinitions = {
  events: {
    title: "Etkinlikler", singular: "Etkinlik", table: "events",
    description: "Etkinlikleri oluştur, tarih ve katılım ayrıntılarını düzenle. Yayındaki bir etkinliği iptal etmek katılımcı ve sohbet geçmişini korur; silmek kalıcıdır.",
    imageField: "cover_image_url", galleryTable: "event_images", galleryKey: "event_id",
    fields: [
      { name: "title", label: "Etkinlik adı", required: true, max: 100 },
      { name: "status", label: "Durum", type: "select", values: [["draft", "Taslak"], ["published", "Yayında"], ["cancelled", "İptal"]], initial: "draft" },
      { name: "description", label: "Açıklama", type: "textarea", wide: true, max: 500 },
      { name: "creator_user_id", label: "Oluşturan kişi", type: "users", required: true },
      { name: "hobby_id", label: "Hobi", type: "hobbies", required: true },
      { name: "mood_id", label: "Mod", type: "moods", required: true },
      { name: "meeting_type", label: "Buluşma şekli", type: "select", values: [["online", "Çevrimiçi"], ["physical", "Yüz yüze"]], initial: "online" },
      { name: "venue_id", label: "Atölye / mekân", type: "venues" },
      { name: "starts_at", label: "Başlangıç", type: "datetime-local", required: true },
      { name: "ends_at", label: "Bitiş", type: "datetime-local", required: true },
      { name: "capacity_type", label: "Kontenjan", type: "select", values: [["limited", "Sınırlı"], ["unlimited", "Sınırsız"]], initial: "limited" },
      { name: "capacity", label: "Kişi sayısı (2–100)", type: "number", min: 2, max: 100, initial: 10 },
      { name: "preparation_notes", label: "Hazırlık notları (her satır bir not)", type: "lines", wide: true },
      { name: "tags", label: "Etiketler (virgül veya satır ile ayır)", type: "tags", wide: true },
      { name: "cover_image_url", label: "Kapak görseli bağlantısı", type: "url", wide: true }
    ]
  },
  venues: {
    title: "Atölye / Mekânlar", singular: "Mekân", table: "venues",
    description: "Uygulamadaki atölyeler ayrı bir tablo değildir: mekâna bağlı etkinlikler üzerinden görünür. Burada mekân bilgisi ve görselleri düzenlenir.",
    imageField: "cover_image_url", galleryTable: "venue_images", galleryKey: "venue_id",
    fields: [
      { name: "name", label: "Mekân / atölye adı", required: true },
      { name: "city", label: "Şehir", required: true, initial: "İstanbul" },
      { name: "district", label: "İlçe", required: true },
      { name: "address", label: "Adres", required: true, wide: true },
      { name: "is_active", label: "Yayında", type: "checkbox", initial: true },
      { name: "description", label: "Mekân açıklaması", type: "textarea", wide: true },
      { name: "latitude", label: "Enlem", type: "number", step: "any", min: -90, max: 90 },
      { name: "longitude", label: "Boylam", type: "number", step: "any", min: -180, max: 180 },
      { name: "cover_image_url", label: "Kapak görseli bağlantısı", type: "url", wide: true }
    ]
  },
  moods: {
    title: "Modlar", singular: "Mod", table: "moods",
    description: "Modun adını, açıklamasını, simgesini, sırasını ve görselini yönet. Etkinlikler ve hobiler bu modlara bağlanır.",
    imageField: "image_url",
    fields: [
      { name: "name", label: "Mod adı", required: true },
      { name: "icon_name", label: "Simge adı" },
      { name: "description", label: "Açıklama", type: "textarea", wide: true },
      { name: "sort_order", label: "Sıralama", type: "number", initial: 0 },
      { name: "is_active", label: "Yayında", type: "checkbox", initial: false },
      { name: "image_url", label: "Görsel bağlantısı", type: "url", wide: true }
    ]
  },
  categories: {
    title: "Kategoriler", singular: "Kategori", table: "categories",
    description: "Hobilerin bağlı olduğu kategorileri düzenle. Bağlı hobisi olan kategoriyi silmek veritabanı tarafından engellenebilir.",
    imageField: "image_url",
    fields: [
      { name: "name", label: "Kategori adı", required: true },
      { name: "slug", label: "URL adı", required: true, pattern: "[a-z0-9]+(-[a-z0-9]+)*" },
      { name: "description", label: "Açıklama", type: "textarea", wide: true },
      { name: "sort_order", label: "Sıralama", type: "number", initial: 0 },
      { name: "is_active", label: "Yayında", type: "checkbox", initial: false },
      { name: "image_url", label: "Görsel bağlantısı", type: "url", wide: true }
    ]
  }
};

state.content = { kind: null, id: null, rows: [], images: [], tags: [], references: {}, loadToken: 0 };

async function allAdminUsers() {
  const rows = [];
  let total = 0;
  do {
    const result = await rpc("admin_users", { p_search: "", p_limit: 100, p_offset: rows.length });
    rows.push(...(result.rows || []));
    total = result.total || 0;
    if (!result.rows?.length) break;
  } while (rows.length < total);
  return rows;
}

async function loadContentType(kind, preferredId = null) {
  const definition = contentDefinitions[kind];
  if (!definition) return;
  const token = ++state.content.loadToken;
  state.content.kind = kind;
  $("content-heading").textContent = definition.title;
  $("content-description").textContent = definition.description;
  $("content-list").textContent = "Kayıtlar yükleniyor…";
  $("content-form").hidden = true;
  try {
    const needEvents = kind === "events";
    const [rows, images, tags, hobbies, moods, venues, users, hobbyMoods] = await Promise.all([
      allAdminRows(definition.table),
      definition.galleryTable ? allAdminRows(definition.galleryTable) : Promise.resolve([]),
      needEvents ? allAdminRows("event_tags") : Promise.resolve([]),
      needEvents ? allAdminRows("hobbies") : Promise.resolve([]),
      needEvents ? allAdminRows("moods") : Promise.resolve([]),
      needEvents ? allAdminRows("venues") : Promise.resolve([]),
      needEvents ? allAdminUsers() : Promise.resolve([]),
      needEvents ? allAdminRows("hobby_moods") : Promise.resolve([])
    ]);
    if (token !== state.content.loadToken) return;
    Object.assign(state.content, { rows, images, tags, references: { hobbies, moods, venues, users, hobbyMoods } });
    renderContentList();
    editContent(preferredId && rows.some((item) => item.id === preferredId) ? preferredId : null);
    $("content-form").hidden = false;
  } catch (error) {
    if (token !== state.content.loadToken) return;
    $("content-list").textContent = `Kayıtlar yüklenemedi: ${error.message}`;
    notify(error.message, true);
  }
}

function contentLabel(row, kind = state.content.kind) {
  return kind === "events" ? row.title : row.name;
}

function contentSubline(row, kind = state.content.kind) {
  if (kind === "events") return `${({ draft: "Taslak", published: "Yayında", cancelled: "İptal" })[row.status] || row.status} · ${dateOrDash(row.starts_at)}`;
  if (kind === "venues") return [row.district, row.city].filter(Boolean).join(", ");
  return row.is_active ? "Yayında" : "Taslak";
}

function renderContentList() {
  const query = $("content-search").value.trim().toLocaleLowerCase("tr");
  const list = $("content-list");
  list.replaceChildren();
  for (const row of [...state.content.rows].sort((a, b) => contentLabel(a).localeCompare(contentLabel(b), "tr"))
    .filter((item) => `${contentLabel(item)} ${contentSubline(item)}`.toLocaleLowerCase("tr").includes(query))) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hobby-list-item";
    button.classList.toggle("selected", state.content.id === row.id);
    const image = document.createElement("img");
    image.src = row[contentDefinitions[state.content.kind].imageField] || "/assets/vibent-icon.png";
    image.alt = "";
    const wrap = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = contentLabel(row);
    const sub = document.createElement("small");
    sub.textContent = contentSubline(row);
    wrap.append(name, sub);
    button.append(image, wrap);
    button.addEventListener("click", () => editContent(row.id));
    list.append(button);
  }
  if (!list.children.length) list.textContent = "Eşleşen kayıt yok.";
}

function contentOptions(field) {
  const refs = state.content.references;
  if (field.type === "select") return field.values;
  if (field.type === "users") return refs.users.map((user) => [user.id,
    `${[user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || user.email || user.id} · ${user.email || user.id}`]);
  if (field.type === "hobbies") return refs.hobbies.map((item) => [item.id, item.name]);
  if (field.type === "moods") return refs.moods.map((item) => [item.id, item.name]);
  if (field.type === "venues") return refs.venues.map((item) => [item.id, `${item.name} · ${item.district}`]);
  return [];
}

function dateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function editContent(id = null) {
  const kind = state.content.kind;
  const definition = contentDefinitions[kind];
  const row = state.content.rows.find((item) => item.id === id) || {};
  state.content.id = id;
  $("content-error").hidden = true;
  $("content-delete").hidden = !id;
  $("content-editor-title").textContent = id ? contentLabel(row) : `Yeni ${definition.singular.toLocaleLowerCase("tr")}`;
  const fields = $("content-fields");
  fields.replaceChildren();
  for (const field of definition.fields) {
    const label = document.createElement("label");
    if (field.wide) label.classList.add("wide");
    const text = document.createElement("span");
    text.textContent = `${field.label}${field.required ? " *" : ""}`;
    label.append(text);
    let input;
    if (["select", "users", "hobbies", "moods", "venues"].includes(field.type)) {
      input = document.createElement("select");
      input.add(new Option("— Seç —", ""));
      for (const [value, title] of contentOptions(field)) input.add(new Option(title, value));
    } else if (["textarea", "lines", "tags"].includes(field.type)) {
      input = document.createElement("textarea");
      input.rows = field.type === "textarea" ? 4 : 3;
    } else {
      input = document.createElement("input");
      input.type = field.type || "text";
      if (field.type === "number") input.step = field.step || "1";
    }
    input.name = field.name;
    if (field.required) input.required = true;
    if (field.max && field.type !== "number") input.maxLength = field.max;
    if (field.min !== undefined) input.min = field.min;
    if (field.max !== undefined && field.type === "number") input.max = field.max;
    if (field.pattern) input.pattern = field.pattern;
    if (field.type === "checkbox") {
      input.checked = row[field.name] ?? field.initial ?? false;
      label.classList.add("check-line");
    } else if (field.type === "datetime-local") input.value = dateInputValue(row[field.name]);
    else if (field.type === "lines") input.value = (row[field.name] || []).join("\n");
    else if (field.type === "tags") input.value = state.content.tags.filter((tag) => tag.event_id === id).map((tag) => tag.tag).join("\n");
    else input.value = row[field.name] ?? field.initial ?? "";
    label.append(input);
    fields.append(label);
  }
  if (kind === "events") {
    fields.querySelector('[name="hobby_id"]').addEventListener("change", syncEventMoodOptions);
    syncEventMoodOptions();
    fields.querySelector('[name="meeting_type"]').addEventListener("change", syncEventConditionalFields);
    fields.querySelector('[name="capacity_type"]').addEventListener("change", syncEventConditionalFields);
    syncEventConditionalFields();
  }
  $("content-photo-hint").hidden = !!id;
  $("content-photo-file").disabled = !id;
  $("content-photo-upload").disabled = !id;
  $("content-photo-file").multiple = !!definition.galleryTable;
  $("content-image-help").textContent = definition.galleryTable
    ? "JPG, her biri en fazla 5 MB. Bir görseli kapak seçebilirsin; mobil uygulama şu anda kapağı gösterir."
    : "JPG, en fazla 5 MB. Yeni yükleme mevcut görseli değiştirir.";
  renderContentGallery();
  renderContentList();
}

function syncEventMoodOptions() {
  const fields = $("content-fields");
  const hobbyId = fields.querySelector('[name="hobby_id"]').value;
  const moodSelect = fields.querySelector('[name="mood_id"]');
  const old = moodSelect.value;
  const allowed = new Set(state.content.references.hobbyMoods.filter((link) => link.hobby_id === hobbyId).map((link) => link.mood_id));
  moodSelect.replaceChildren(new Option("— Seç —", ""));
  for (const mood of state.content.references.moods.filter((item) => !hobbyId || allowed.has(item.id))) {
    moodSelect.add(new Option(mood.name, mood.id));
  }
  moodSelect.value = [...moodSelect.options].some((option) => option.value === old) ? old : "";
}

function syncEventConditionalFields() {
  const fields = $("content-fields");
  const physical = fields.querySelector('[name="meeting_type"]').value === "physical";
  const limited = fields.querySelector('[name="capacity_type"]').value === "limited";
  const venue = fields.querySelector('[name="venue_id"]');
  const capacity = fields.querySelector('[name="capacity"]');
  venue.required = physical;
  venue.closest("label").hidden = !physical;
  capacity.required = limited;
  capacity.closest("label").hidden = !limited;
}

function contentFormValues() {
  const definition = contentDefinitions[state.content.kind];
  const form = $("content-form");
  const values = {};
  for (const field of definition.fields) {
    if (field.type === "tags") continue;
    const input = form.elements.namedItem(field.name);
    if (field.type === "checkbox") values[field.name] = input.checked;
    else if (field.type === "lines") values[field.name] = input.value.split("\n").map((line) => line.trim()).filter(Boolean);
    else if (field.type === "number") values[field.name] = input.value.trim() ? Number(input.value) : null;
    else if (field.type === "datetime-local") values[field.name] = input.value ? new Date(input.value).toISOString() : null;
    else values[field.name] = input.value.trim() || null;
  }
  if (state.content.kind === "events") {
    values.description ||= "";
    if (values.meeting_type === "online") values.venue_id = null;
    if (values.capacity_type === "unlimited") values.capacity = null;
    if (values.meeting_type === "physical" && !values.venue_id) throw new Error("Yüz yüze etkinlik için mekân seç.");
    if (values.capacity_type === "limited" && (!Number.isInteger(values.capacity) || values.capacity < 2 || values.capacity > 100)) throw new Error("Kontenjan 2–100 arasında olmalı.");
    if (Date.parse(values.ends_at) <= Date.parse(values.starts_at)) throw new Error("Bitiş başlangıçtan sonra olmalı.");
  }
  return values;
}

function desiredEventTags() {
  const raw = $("content-form").elements.namedItem("tags").value;
  const tags = [...new Set(raw.split(/[,\n]/).map((item) => item.trim()).filter(Boolean).map((item) => item.startsWith("#") ? item : `#${item}`))];
  if (tags.some((tag) => !/^#[^\s#]{2,30}$/u.test(tag))) throw new Error("Etiketler boşluksuz ve en az iki karakter olmalı.");
  return tags;
}

async function saveContent(event) {
  event.preventDefault();
  const definition = contentDefinitions[state.content.kind];
  const button = $("content-save");
  button.disabled = true;
  $("content-error").hidden = true;
  try {
    const values = contentFormValues();
    const tags = state.content.kind === "events" ? desiredEventTags() : [];
    const key = state.content.id ? { id: state.content.id } : null;
    const saved = state.content.kind === "events"
      ? await rpc("admin_event_save", { p_values: values, p_key: key, p_tags: tags })
      : await rpc("admin_write", { p_table: definition.table, p_key: key, p_values: values });
    notify(`${definition.singular} kaydedildi.`);
    await loadContentType(state.content.kind, saved.id);
  } catch (error) {
    $("content-error").textContent = error.message;
    $("content-error").hidden = false;
  } finally { button.disabled = false; }
}

async function deleteContent() {
  const definition = contentDefinitions[state.content.kind];
  const row = state.content.rows.find((item) => item.id === state.content.id);
  if (!row || !confirm(`“${contentLabel(row)}” kaydını kalıcı olarak silmek istiyor musun? Bağlı kayıtlar silinebilir veya veritabanı bu işlemi engelleyebilir. Yüklenen dosyalar depoda kalır.`)) return;
  const button = $("content-delete");
  button.disabled = true;
  try {
    await rpc("admin_delete", { p_table: definition.table, p_key: { id: row.id } });
    notify(`${definition.singular} silindi.`);
    await loadContentType(state.content.kind);
  } catch (error) { notify(`Silinemedi: ${error.message}`, true); }
  finally { button.disabled = false; }
}

function renderContentGallery() {
  const definition = contentDefinitions[state.content.kind];
  const row = state.content.rows.find((item) => item.id === state.content.id);
  const cover = $("content-cover-preview");
  cover.hidden = !row?.[definition.imageField];
  if (!cover.hidden) cover.src = row[definition.imageField];
  const gallery = $("content-gallery");
  gallery.replaceChildren();
  if (!definition.galleryTable) return;
  for (const photo of state.content.images.filter((item) => item[definition.galleryKey] === state.content.id)
    .sort((a, b) => a.sort_order - b.sort_order)) {
    const card = document.createElement("div");
    card.className = "photo-card";
    const image = document.createElement("img");
    image.src = photo.image_url;
    image.alt = photo.alt_text || contentLabel(row);
    const actions = document.createElement("div");
    const choose = document.createElement("button");
    choose.type = "button";
    choose.textContent = row?.[definition.imageField] === photo.image_url ? "Kapak ✓" : "Kapak yap";
    choose.disabled = row?.[definition.imageField] === photo.image_url;
    choose.addEventListener("click", () => setContentCover(photo.image_url));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Kaldır";
    remove.addEventListener("click", () => removeContentPhoto(photo));
    actions.append(choose, remove);
    card.append(image, actions);
    gallery.append(card);
  }
}

async function setContentCover(url) {
  const definition = contentDefinitions[state.content.kind];
  try {
    await rpc("admin_write", { p_table: definition.table, p_key: { id: state.content.id }, p_values: { [definition.imageField]: url } });
    notify("Kapak görseli değiştirildi.");
    await loadContentType(state.content.kind, state.content.id);
  } catch (error) { notify(error.message, true); }
}

async function uploadContentPhotos() {
  const files = [...$("content-photo-file").files];
  const definition = contentDefinitions[state.content.kind];
  const id = state.content.id;
  if (!id || !files.length) return;
  if (files.some((file) => file.type !== "image/jpeg" || file.size > 5 * 1024 * 1024)) {
    notify("Her görsel JPG biçiminde ve en fazla 5 MB olmalı.", true);
    return;
  }
  const button = $("content-photo-upload");
  button.disabled = true;
  try {
    let currentCover = state.content.rows.find((item) => item.id === id)?.[definition.imageField];
    for (const file of files) {
      const path = `${definition.table}/${id}/${crypto.randomUUID()}.jpg`;
      await api(`/storage/v1/object/hobby-covers/${path}`, {
        method: "POST", headers: { "Content-Type": "image/jpeg", "x-upsert": "false" }, body: file
      });
      const url = `${config.supabaseUrl}/storage/v1/object/public/hobby-covers/${path}`;
      if (definition.galleryTable) {
        await rpc("admin_write", { p_table: definition.galleryTable, p_key: null,
          p_values: { [definition.galleryKey]: id, image_url: url, alt_text: file.name.slice(0, 200), sort_order: state.content.images.length } });
      }
      if (!currentCover || !definition.galleryTable) {
        await rpc("admin_write", { p_table: definition.table, p_key: { id }, p_values: { [definition.imageField]: url } });
        currentCover = url;
      }
    }
    $("content-photo-file").value = "";
    notify(`${files.length} görsel yüklendi.`);
    await loadContentType(state.content.kind, id);
  } catch (error) {
    notify(`Görsel yükleme tamamlanamadı: ${error.message}`, true);
    await loadContentType(state.content.kind, id);
  } finally { button.disabled = false; }
}

async function removeContentPhoto(photo) {
  const definition = contentDefinitions[state.content.kind];
  const row = state.content.rows.find((item) => item.id === state.content.id);
  if (row?.[definition.imageField] === photo.image_url) { notify("Önce başka bir görseli kapak yap.", true); return; }
  if (!confirm("Görseli galeriden kaldırmak istiyor musun? Dosya depoda kalır.")) return;
  try {
    await rpc("admin_delete", { p_table: definition.galleryTable, p_key: { id: photo.id } });
    notify("Görsel galeriden kaldırıldı.");
    await loadContentType(state.content.kind, state.content.id);
  } catch (error) { notify(error.message, true); }
}

$("content-search").addEventListener("input", renderContentList);
$("new-content").addEventListener("click", () => editContent());
$("content-form").addEventListener("submit", saveContent);
$("content-delete").addEventListener("click", deleteContent);
$("content-photo-upload").addEventListener("click", uploadContentPhotos);
