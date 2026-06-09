const authStatus = document.getElementById("auth-status");
const loginBtn = document.getElementById("login-btn");
const logoutBtn = document.getElementById("logout-btn");
const ingestForm = document.getElementById("ingest-form");
const previewBtn = document.getElementById("preview-btn");
const ingestBtn = document.getElementById("ingest-btn");
const previewList = document.getElementById("preview-list");
const previewCount = document.getElementById("preview-count");
const jobsList = document.getElementById("jobs-list");
const formMessage = document.getElementById("form-message");
const jobResultsCard = document.getElementById("job-results-card");
const jobResults = document.getElementById("job-results");

function formatSize(bytes) {
  if (!bytes) return "—";
  const b = parseInt(bytes, 10);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || "Request failed");
  return payload;
}

function setMessage(text, type = "") {
  formMessage.hidden = !text;
  formMessage.textContent = text;
  formMessage.className = `message ${type}`.trim();
}

function setLoading(btn, loading, label) {
  btn.disabled = loading;
  btn.textContent = loading ? "..." : label;
}

function gateForm(authenticated) {
  ingestForm.querySelectorAll("input, button").forEach((el) => {
    el.disabled = !authenticated;
  });
  document.getElementById("ingest-card").classList.toggle("dimmed", !authenticated);
}

function renderPreview(files) {
  previewCount.textContent = `${files.length} file${files.length === 1 ? "" : "s"}`;
  if (!files.length) {
    previewList.className = "preview-list muted";
    previewList.textContent = "No files found in that Drive location.";
    return;
  }
  previewList.className = "preview-list";
  previewList.innerHTML = files
    .map(
      (f) => `
        <div class="file-row">
          <div>
            <strong>${f.name}</strong>
            <div class="file-meta">${f.rel_path}</div>
          </div>
          <div class="file-meta">${formatSize(f.size)}</div>
        </div>`
    )
    .join("");
}

function renderJobs(jobs) {
  if (!jobs.length) {
    jobsList.className = "jobs-list muted";
    jobsList.textContent = "No jobs yet.";
    return;
  }
  jobsList.className = "jobs-list";
  jobsList.innerHTML = jobs
    .map(
      (job) => `
        <div class="job-row">
          <div>
            <strong>${job.name}</strong>
            <div class="job-meta">${job.path}</div>
          </div>
          <div class="job-meta">${job.file_count} files</div>
        </div>`
    )
    .join("");
}

function renderJobResults(job) {
  jobResultsCard.hidden = false;
  if (job.status === "running") {
    jobResults.innerHTML = `<p class="muted pulse-text">Downloading files</p>`;
    return;
  }
  if (job.status === "error") {
    jobResults.innerHTML = `<p class="message error">${job.error || "Ingest failed"}</p>`;
    return;
  }
  const rows = (job.files || [])
    .map(
      (f) => `
        <div class="file-row">
          <div>
            <strong>${f.name}</strong>
            <div class="file-meta">${f.rel_path}</div>
          </div>
          <span class="result-badge ${f.success ? "ok" : "err"}">${f.success ? "ok" : "failed"}</span>
        </div>`
    )
    .join("");
  jobResults.innerHTML = `
    <div class="row between" style="margin-bottom:12px">
      <span>${job.succeeded}/${job.total} files downloaded</span>
      <span class="file-meta">${job.destination}</span>
    </div>
    <div class="preview-list">${rows}</div>
  `;
}

async function pollJobStatus(jobId) {
  while (true) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const job = await api(`/api/jobs/${jobId}/status`);
      renderJobResults(job);
      if (job.status !== "running") {
        const failed = job.failed || 0;
        setMessage(
          job.status === "done"
            ? `Ingested ${job.succeeded}/${job.total} files.`
            : `Ingest failed: ${job.error}`,
          failed > 0 || job.status === "error" ? "error" : "success"
        );
        await refreshJobs();
        setLoading(ingestBtn, false, "Ingest to local storage");
        return;
      }
    } catch {
      setMessage("Lost connection while tracking ingest job.", "error");
      setLoading(ingestBtn, false, "Ingest to local storage");
      return;
    }
  }
}

async function refreshSession() {
  const session = await api("/api/session");
  if (session.authenticated) {
    authStatus.textContent = `Connected as ${session.email}`;
    loginBtn.hidden = true;
    logoutBtn.hidden = false;
    gateForm(true);
    await refreshJobs();
    return;
  }
  authStatus.textContent = "Not connected";
  loginBtn.hidden = false;
  logoutBtn.hidden = true;
  gateForm(false);
}

async function refreshJobs() {
  try {
    const payload = await api("/api/jobs");
    renderJobs(payload.jobs || []);
  } catch {
    renderJobs([]);
  }
}

previewBtn.addEventListener("click", async () => {
  setMessage("");
  const driveUrl = document.getElementById("drive-url").value.trim();
  if (!driveUrl) {
    setMessage("Enter a Google Drive URL first.", "error");
    return;
  }
  setLoading(previewBtn, true, "Preview files");
  try {
    const payload = await api("/api/preview", {
      method: "POST",
      body: JSON.stringify({ drive_url: driveUrl }),
    });
    renderPreview(payload.files || []);
  } catch (err) {
    setMessage(err.message, "error");
  } finally {
    setLoading(previewBtn, false, "Preview files");
  }
});

ingestForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setMessage("");
  const driveUrl = document.getElementById("drive-url").value.trim();
  const jobName = document.getElementById("job-name").value.trim();
  setLoading(ingestBtn, true, "Ingest to local storage");
  try {
    const payload = await api("/api/ingest", {
      method: "POST",
      body: JSON.stringify({ drive_url: driveUrl, job_name: jobName }),
    });
    renderJobResults({ status: "running" });
    setMessage("Ingest started — downloading in background...");
    pollJobStatus(payload.job_id);
  } catch (err) {
    setMessage(err.message, "error");
    setLoading(ingestBtn, false, "Ingest to local storage");
  }
});

logoutBtn.addEventListener("click", async () => {
  await api("/auth/logout", { method: "POST" });
  window.location.reload();
});

refreshSession().catch((err) => {
  authStatus.textContent = err.message;
});

if (new URLSearchParams(window.location.search).get("connected") === "1") {
  setMessage("Google Drive connected.", "success");
}
