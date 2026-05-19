const folderInput = document.getElementById("folder-input");
const filesInput = document.getElementById("files-input");
const pickFolderBtn = document.getElementById("pick-folder");
const pickFilesBtn = document.getElementById("pick-files");
const fileListEl = document.getElementById("file-list");
const submitBtn = document.getElementById("submit-btn");
const form = document.getElementById("upload-form");
const dropzone = document.getElementById("dropzone");
const promptEl = document.getElementById("prompt");
const progressCard = document.getElementById("progress-card");
const bar = document.getElementById("bar");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const downloadEl = document.getElementById("download");

let selected = [];
const ACCEPTED = /\.(png|jpe?g|gif|webp)$/i;

function setFiles(files) {
  selected = [...files].filter((f) => ACCEPTED.test(f.name));
  renderList();
  submitBtn.disabled = selected.length === 0;
}

function renderList() {
  fileListEl.innerHTML = "";
  if (selected.length === 0) return;
  const head = document.createElement("div");
  head.className = "row";
  head.innerHTML = `<strong>Файлов: ${selected.length}</strong><span>${formatSize(
    selected.reduce((s, f) => s + f.size, 0),
  )}</span>`;
  fileListEl.appendChild(head);
  for (const f of selected.slice(0, 20)) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${f.webkitRelativePath || f.name}</span><span>${formatSize(
      f.size,
    )}</span>`;
    fileListEl.appendChild(row);
  }
  if (selected.length > 20) {
    const more = document.createElement("div");
    more.className = "row";
    more.textContent = `…ещё ${selected.length - 20}`;
    fileListEl.appendChild(more);
  }
}

function formatSize(b) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}

pickFolderBtn.addEventListener("click", (e) => {
  e.preventDefault();
  folderInput.click();
});
pickFilesBtn.addEventListener("click", (e) => {
  e.preventDefault();
  filesInput.click();
});
folderInput.addEventListener("change", () => setFiles(folderInput.files));
filesInput.addEventListener("change", () => setFiles(filesInput.files));

["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
  }),
);
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  if (e.dataTransfer?.files) setFiles(e.dataTransfer.files);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (selected.length === 0) return;

  const format =
    document.querySelector('input[name="format"]:checked')?.value || "pdf";
  const userPrompt = (promptEl.value || "").trim();

  submitBtn.disabled = true;
  progressCard.hidden = false;
  logEl.innerHTML = "";
  downloadEl.hidden = true;
  statusEl.textContent = "Загрузка…";
  bar.style.width = "0%";

  const fd = new FormData();
  fd.append("format", format);
  if (userPrompt) fd.append("prompt", userPrompt);
  for (const f of selected) fd.append("files", f, f.webkitRelativePath || f.name);

  const res = await fetch("/api/jobs", { method: "POST", body: fd });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    statusEl.textContent = `Ошибка загрузки: ${res.status} ${body}`;
    submitBtn.disabled = false;
    return;
  }
  const { jobId, total } = await res.json();
  statusEl.textContent = `Распознаю ${total} страниц…`;

  const es = new EventSource(`/api/jobs/${jobId}/events`);
  let processed = 0;
  const rows = new Map();

  function ensureRow(idx, file) {
    if (rows.has(idx)) return rows.get(idx);
    const li = document.createElement("li");
    li.dataset.idx = idx;
    li.innerHTML = `<span>${file}</span><span class="state">старт</span>`;
    logEl.appendChild(li);
    logEl.scrollTop = logEl.scrollHeight;
    rows.set(idx, li);
    return li;
  }
  function setState(idx, file, text, klass) {
    const li = ensureRow(idx, file);
    const s = li.querySelector(".state");
    s.textContent = text;
    s.className = `state ${klass || ""}`;
  }

  es.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    if (ev.type === "start") {
      statusEl.textContent = `Старт: ${ev.totalPages} страниц (параллельно)`;
    } else if (ev.type === "page-start") {
      ensureRow(ev.pageIndex, ev.file);
    } else if (ev.type === "page-claude") {
      setState(ev.pageIndex, ev.file, "claude ✓", "step");
    } else if (ev.type === "page-gpt") {
      setState(ev.pageIndex, ev.file, "gpt ✓", "step");
    } else if (ev.type === "page-merge") {
      setState(ev.pageIndex, ev.file, "сверка…", "step");
    } else if (ev.type === "page-done") {
      processed++;
      bar.style.width = `${(processed / (total + 1)) * 100}%`;
      const agree = Math.round((ev.agreement ?? 0) * 100);
      const cls = agree >= 85 ? "agree" : agree >= 60 ? "agree low" : "agree bad";
      setState(ev.pageIndex, ev.file, `${agree}%`, cls);
      statusEl.textContent = `${processed}/${total} обработано`;
    } else if (ev.type === "filter") {
      statusEl.textContent = "Удаляю повторяющийся мусор…";
      bar.style.width = `${(total / (total + 1)) * 100}%`;
    } else if (ev.type === "done") {
      bar.style.width = "100%";
      statusEl.textContent = `Готово (${format.toUpperCase()})`;
      downloadEl.href = `/api/jobs/${jobId}/output`;
      downloadEl.textContent = `Скачать ${format.toUpperCase()}`;
      downloadEl.hidden = false;
      es.close();
      submitBtn.disabled = false;
    } else if (ev.type === "error") {
      statusEl.textContent = `Ошибка: ${ev.message}`;
      es.close();
      submitBtn.disabled = false;
    }
  };
  es.onerror = () => {
    es.close();
  };
});
