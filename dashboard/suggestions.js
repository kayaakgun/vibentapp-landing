"use strict";

let suggestionRows = [];
let suggestionHobbies = [];
let suggestionVenues = [];

async function loadSuggestions() {
  const status = $("suggestions-filter").value;
  $("suggestions-state").textContent = "Öneriler yükleniyor…";
  $("suggestions-list").replaceChildren();
  try {
    const query = status === "all" ? "" : `&status=eq.${encodeURIComponent(status)}`;
    const [rows, hobbies, venues] = await Promise.all([
      api(`/rest/v1/content_suggestions?select=*&order=created_at.desc&limit=100${query}`),
      allAdminRows("hobbies"),
      allAdminRows("venues")
    ]);
    suggestionRows = rows;
    suggestionHobbies = hobbies;
    suggestionVenues = venues;
    await loadUserLabels(rows);
    $("suggestions-state").textContent = rows.length
      ? `${rows.length} öneri gösteriliyor.` : "Bu durumda öneri yok.";
    for (const row of rows) renderSuggestion(row);
  } catch (error) {
    $("suggestions-state").textContent = `Öneriler yüklenemedi: ${error.message}`;
  }
}

function suggestionText(label, value) {
  const line = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = `${label}: `;
  line.append(strong, document.createTextNode(value || "—"));
  return line;
}

function renderSuggestion(row) {
  const card = document.createElement("article");
  card.className = "management-panel";
  const title = document.createElement("h3");
  title.textContent = `${row.kind === "hobby" ? "Hobi" : "Atölye / mekân"} · ${row.name}`;
  card.append(title, suggestionText("Açıklama", row.description));
  if (row.reason) card.append(suggestionText("Neden", row.reason));
  if (row.kind === "venue") card.append(suggestionText("Konum", `${row.city}, ${row.district} · ${row.address}`));
  if (row.source_url) {
    const link = document.createElement("a");
    link.href = row.source_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Kaynak bağlantısı ↗";
    card.append(link);
  }
  const sender = document.createElement("div");
  sender.append(document.createTextNode("Gönderen kullanıcı: "), userCell(row.user_id));
  card.append(sender,
    suggestionText("Gönderilme", new Date(row.created_at).toLocaleString("tr-TR")),
    suggestionText("Durum", ({pending:"İnceleniyor", approved:"Onaylandı, hazırlanıyor", added:"Eklendi", rejected:"Uygun bulunmadı"})[row.status] || row.status));
  if (row.public_note) card.append(suggestionText("Kullanıcıya gösterilen not", row.public_note));
  if (row.status === "approved" && (row.hobby_id || row.venue_id)) {
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "Taslağı düzenle →";
    open.addEventListener("click", () => {
      if (row.kind === "hobby") switchView("hobbies", row.hobby_id);
      else switchView("venues", row.venue_id);
    });
    card.append(open);
  }
  if (row.status === "pending") {
    const actions = document.createElement("div");
    actions.className = "suggestion-actions";
    const note = document.createElement("textarea");
    note.placeholder = "Kullanıcıya gösterilecek kısa not / ret gerekçesi";
    note.maxLength = 500;
    note.setAttribute("aria-label", "Öneri kararı notu");
    const existing = document.createElement("select");
    existing.setAttribute("aria-label", "Mevcut hobi veya mekân");
    existing.append(new Option("Mevcut kayıt seç", ""));
    const candidates = row.kind === "hobby" ? suggestionHobbies : suggestionVenues;
    for (const item of candidates) existing.append(new Option(
      `${item.name}${item.city ? ` · ${item.city}` : ""}`, item.id));
    const draft = document.createElement("button");
    draft.type = "button";
    draft.textContent = "Taslak oluştur";
    const link = document.createElement("button");
    link.type = "button";
    link.textContent = "Mevcut kayıtla eşleştir";
    const reject = document.createElement("button");
    reject.type = "button";
    reject.textContent = "Uygun bulunmadı";
    async function decide(action) {
      if (action === "link" && !existing.value) { notify("Önce mevcut kayıt seç.", true); return; }
      if (action === "reject" && !note.value.trim()) { notify("Ret gerekçesi yaz.", true); return; }
      if (!confirm(`“${row.name}” önerisi için ${action === "create_draft" ? "yayına kapalı taslak oluşturulsun" : action === "link" ? "seçilen kayıtla eşleştirilsin" : "ret kararı kaydedilsin"} mu?`)) return;
      for (const button of [draft, link, reject]) button.disabled = true;
      try {
        await rpc("admin_review_content_suggestion", {
          p_id: row.id, p_action: action, p_note: note.value.trim() || null,
          p_existing_id: action === "link" ? existing.value : null
        });
        notify("Öneri kararı kaydedildi. Taslak yayımlanmadan önce editörde doğrula.");
        await loadSuggestions();
      } catch (error) {
        notify(error.message, true);
        for (const button of [draft, link, reject]) button.disabled = false;
      }
    }
    draft.addEventListener("click", () => decide("create_draft"));
    link.addEventListener("click", () => decide("link"));
    reject.addEventListener("click", () => decide("reject"));
    actions.append(note, existing, draft, link, reject);
    card.append(actions);
  }
  $("suggestions-list").append(card);
}

$("suggestions-filter").addEventListener("change", loadSuggestions);
$("suggestions-refresh").addEventListener("click", loadSuggestions);
