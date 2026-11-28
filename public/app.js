/* DAR Eastern Visayas Regional Office VIII — Document Tracking System Web App
 * Features: User Registration & Login, Strict Box A-E Role-Based Access Control,
 * Automated Incoming Tracking Status, Audit Trail, and Official Printable Slips.
 */

const LISTS = {
  incDocTypes: [
    "Invitation Letter", "Memorandum", "Letter / Communication", "Special Order",
    "Endorsement", "Accomplishment Report", "Petition / Legal Pleadings", "DARAB Case / Order",
    "Disbursement Voucher / Financial", "Procurement / BAC Document", "Travel Order", "Others"
  ],
  outDocTypes: ["Special Order", "Memorandum", "Accomplishment Report", "Endorsement", "Communication", "Others"],
  timeFrames: [
    "",
    "URGENT (WITHIN THE DAY)",
    "ROUTINE (WITHIN 15 DAYS)",
    "AS INDICATED IN THE DOC. DUE DATE",
    "FOR INFORMATION AND APPROPRIATE ACTION"
  ],
  thruModes: ["HAND CARRIED", "EMAIL", "COURIER (LBC/JRS/DHL)", "REGISTERED MAIL", "ORDINARY MAIL", "POUCH", "FAX"],
  transModes: ["", "Mail", "Registered Mail", "Ordinary Mail", "Pouch", "Fax", "WayBill JRS/LBC", "Personally", "Email"],
  dispatchModes: ["", "Pouch", "Mail", "Registered w/ret. Card", "Registered", "Ordinary", "Email", "Fax", "Waybill (DHL)", "Personally Received by", "Hand carried by"],
  returnedTypes: ["", "DTS Slip only (no attachment)", "File Copy of Action Documents with attachment"],
  incStatuses: [
    "Received by Records", "For RD Action", "For ARD Action", "Routed to Division",
    "In Progress", "For Dispatch", "Completed / Returned to Records", "Archived"
  ],
  outStatuses: [
    "Draft / Originating", "For Counter-Signature", "For Approval",
    "Returned to Originating Office", "Received by Records", "Dispatched / Released", "Archived"
  ]
};

const ROLE_INFO = {
  RECORDS: {
    short: "Records Section (Box A & E)",
    banner: "You are signed in as <strong>Records Section</strong> — you can encode <strong>New Incoming Documents (Box A)</strong> and complete <strong>Box E (Records Dispatch &amp; Return)</strong>.",
    hint: "<strong>Box A &amp; Box E Access:</strong> Encodes new Incoming documents and records final dispatch/return. Tracking Status updates automatically."
  },
  RD_SECRETARY: {
    short: "RD's Secretary (Box B)",
    banner: "You are signed in as <strong>RD's Secretary</strong> — you can edit <strong>Box B (RD Instructions &amp; Time Frame)</strong> on incoming documents.",
    hint: "<strong>Box B Access:</strong> Fills RD Date/Time Received, RD Instructions To (ARDO/ARDA or Division), and Time Frame of Action."
  },
  ARD_SECRETARY: {
    short: "ARD / ARD's Secretary (Box C)",
    banner: "Signed in as <strong>ARD Secretary</strong> — showing documents forwarded from RD Office (edit <strong>Box C</strong>).",
    hint: "<strong>Box C Access:</strong> Displays documents forwarded from RD Office to your ARD office and assigns the responsible Division Chief in Box D."
  },
  DIVISION_CHIEF: {
    short: "Division Chief (Box D)",
    banner: "Signed in as <strong>Division Chief</strong> — showing documents forwarded to your division (edit <strong>Box D</strong>).",
    hint: "<strong>Box D Access:</strong> Displays only documents forwarded to your Division (STO, LTS, LEGAL, ARBDSP, RARAD/DARAB, or STO Section) to record Action Taken and Date Acted."
  },
  ADMIN: {
    short: "System Administrator",
    banner: "You are signed in as <strong>System Administrator</strong> — full access to all Boxes (A–E), Settings, and User Account Management.",
    hint: "Full administrative access."
  }
};

let authToken = localStorage.getItem("dar_dts_token") || "";
let currentUser = null;
let state = { meta: {}, divisions: [], darpoOffices: [], incoming: [], outgoing: [], issuances: [], mailings: [], users: [] };
let currentView = "dashboard";
let selectedPortalDiv = "RD";
let selectedIssuanceCategory = "ALL";
let selectedMailingCourier = "ALL";
let editingIncomingIsNew = false;
let editingOutgoingIsNew = false;
let editingIssuanceIsNew = false;
let editingMailingIsNew = false;
let currentIncomingPerms = { boxA: false, boxB: false, boxC: false, boxD: false, boxE: false };
let currentAttachmentFile = null;
let pdfPreviewExpanded = true;
let currentIncReplyAttachmentFile = null;
let incReplyPdfPreviewExpanded = true;
let selectedIncBoxERecipients = new Set();
let currentOutAttachmentFile = null;
let outPdfPreviewExpanded = true;
let selectedFurnishedCopy = new Set();
let currentIssAttachmentFile = null;
let issPdfPreviewExpanded = true;
let selectedIssRecipients = new Set();
let currentMailAttachmentFile = null;
let mailPdfPreviewExpanded = true;

const DEFAULT_DARPO_OFFICES = [
  { code: "DARPO - Biliran", name: "DAR Provincial Office — Biliran", group: "DARPO" },
  { code: "DARPO - Eastern Samar", name: "DAR Provincial Office — Eastern Samar", group: "DARPO" },
  { code: "DARPO - Leyte", name: "DAR Provincial Office — Leyte", group: "DARPO" },
  { code: "DARPO - Northern Samar", name: "DAR Provincial Office — Northern Samar", group: "DARPO" },
  { code: "DARPO - Samar", name: "DAR Provincial Office — Samar", group: "DARPO" },
  { code: "DARPO - Southern Leyte", name: "DAR Provincial Office — Southern Leyte", group: "DARPO" },
];

function getAllFurnishedCopyOptions() {
  const roDivs = (state.divisions || []).map((d) => ({ code: d.code, name: d.name, group: "RO VIII" }));
  const darpos = (state.darpoOffices && state.darpoOffices.length ? state.darpoOffices : DEFAULT_DARPO_OFFICES).map((d) => ({
    code: d.code,
    name: d.name,
    group: "DARPO",
  }));
  return { roDivs, darpos, all: [...roDivs, ...darpos] };
}

function getPdfEmbedUrl(file) {
  if (!file) return "";
  if (file.localUrl) return file.localUrl;
  if (file.driveFileId) return `https://drive.google.com/file/d/${encodeURIComponent(file.driveFileId)}/preview`;
  if (file.url && file.url.includes("drive.google.com/file/d/")) {
    const m = file.url.match(/\/file\/d\/([^/]+)/);
    if (m) return `https://drive.google.com/file/d/${m[1]}/preview`;
  }
  return file.url || "";
}

function formatFileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function pdfBadgeHtml(doc) {
  if (!doc || !doc.attachmentFile || !doc.attachmentFile.url) return "";
  return `<a class="pdf-pill-link" href="${esc(doc.attachmentFile.url)}" target="_blank" rel="noopener" title="View ${esc(doc.attachmentFile.name)}">📄 PDF</a>`;
}

// ----------------- Utilities -----------------
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function nowDateTimeLocal() {
  const d = new Date();
  return `${todayISO()}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function toDatetimeLocalValue(str) {
  const s = String(str || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16);
  // Parse "YYYY-MM-DD h:mm AM/PM" or "YYYY-MM-DD HH:mm"
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})(?:\s*(AM|PM))?/i);
  if (m) {
    let hh = parseInt(m[2], 10);
    const mm = m[3];
    const ap = (m[4] || "").toUpperCase();
    if (ap === "PM" && hh < 12) hh += 12;
    if (ap === "AM" && hh === 12) hh = 0;
    return `${m[1]}T${String(hh).padStart(2, "0")}:${mm}`;
  }
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const mo = String(parsed.getMonth() + 1).padStart(2, "0");
    const da = String(parsed.getDate()).padStart(2, "0");
    const hr = String(parsed.getHours()).padStart(2, "0");
    const mi = String(parsed.getMinutes()).padStart(2, "0");
    return `${y}-${mo}-${da}T${hr}:${mi}`;
  }
  return "";
}

function fromDatetimeLocalValue(val) {
  const s = String(val || "").trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!m) return s;
  let hh = parseInt(m[2], 10);
  const mm = m[3];
  const ap = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 || 12;
  return `${m[1]} ${h12}:${mm} ${ap}`;
}

function nowDateTimeStamp() {
  return fromDatetimeLocalValue(nowDateTimeLocal());
}

function formatDateLong(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-US", { month: "long", day: "2-digit", year: "numeric" });
}

function formatDateTimeDisplay(val) {
  const s = String(val || "").trim();
  if (!s) return "";
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](.+))?$/);
  if (!m) return s;
  const datePart = formatDateShort(m[1]);
  return m[2] ? `${datePart} ${m[2]}` : datePart;
}

function formatDateShort(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

// Mirror of server's Automated Status Engine (for live real-time preview inside the form!)
function computeIncomingAutoStatus(rec) {
  const t = (v) => String(v || "").trim();
  if (rec.archived === true || rec.archived === "true") return "Archived";
  if (t(rec.returnedAs) || t(rec.dateReturnedBy) || t(rec.dateReturnedAt) || t(rec.releasedBy)) return "Completed / Returned to Records";
  if (t(rec.dateActed) || t(rec.recordsDispatchMode)) return "For Dispatch";
  if (t(rec.divActionTaken) || t(rec.divDateTime) || t(rec.divReceivedBy)) return "In Progress";
  if (t(rec.ardInstructionsTo) || t(rec.ardInstructions)) return "Routed to Division";
  const rdTo = t(rec.rdInstructionsTo);
  if (rdTo) {
    if (rdTo === "ARDO" || rdTo === "ARDA") return "For ARD Action";
    if (rdTo === "RD") return "For RD Action";
    return "Routed to Division";
  }
  if (t(rec.rdDateTime) || t(rec.rdReceivedBy) || t(rec.rdInstructions) || t(rec.rdTimeFrame)) return "For RD Action";
  return "Received by Records";
}

function resolveAssignedDivision(rec) {
  const t = (v) => String(v || "").trim();
  if (t(rec.ardInstructionsTo)) return t(rec.ardInstructionsTo);
  const rdTo = t(rec.rdInstructionsTo);
  if (rdTo && rdTo !== "ARDO" && rdTo !== "ARDA") return rdTo;
  return t(rec.assignedDivision) || rdTo || "";
}

function divisionMatches(userDiv, docDiv) {
  const u = String(userDiv || "").trim().toUpperCase();
  const d = String(docDiv || "").trim().toUpperCase();
  if (!u || !d) return false;
  if (u === d) return true;
  if (u === "STO" && (d === "STO" || d.startsWith("STO -"))) return true;
  if ((u === "DARAB" || u === "RARAD") && (d === "DARAB" || d === "RARAD")) return true;
  return false;
}

function canUserViewIncoming(user, doc) {
  if (!user || !doc) return false;
  if (user.role === "ADMIN" || user.role === "RECORDS" || user.role === "RD_SECRETARY") return true;
  if (user.role === "ARD_SECRETARY") {
    const rdTo = String(doc.rdInstructionsTo || "").trim().toUpperCase();
    const uDiv = String(user.division || "").trim().toUpperCase();
    if (uDiv === "ARDO" || uDiv === "ARDA") return rdTo === uDiv;
    return rdTo === "ARDO" || rdTo === "ARDA";
  }
  if (user.role === "DIVISION_CHIEF") {
    const rdTo = String(doc.rdInstructionsTo || "").trim();
    const ardTo = String(doc.ardInstructionsTo || "").trim();
    const assigned = resolveAssignedDivision(doc);
    return (
      divisionMatches(user.division, assigned) ||
      divisionMatches(user.division, rdTo) ||
      divisionMatches(user.division, ardTo)
    );
  }
  return false;
}

function getBoxPermissions(user, doc, isNew = false) {
  if (!user) return { canCreateIncoming: false, boxA: false, boxB: false, boxC: false, boxD: false, boxE: false };
  if (user.role === "ADMIN") {
    return { canCreateIncoming: true, boxA: true, boxB: true, boxC: true, boxD: true, boxE: true };
  }
  if (isNew) {
    return { canCreateIncoming: user.role === "RECORDS", boxA: user.role === "RECORDS", boxB: false, boxC: false, boxD: false, boxE: false };
  }
  const assignedDiv = doc ? resolveAssignedDivision(doc) : "";
  const isMyDiv = doc ? divisionMatches(user.division, assignedDiv) : false;
  const canView = doc ? canUserViewIncoming(user, doc) : false;
  return {
    canCreateIncoming: user.role === "RECORDS",
    boxA: user.role === "RECORDS",
    boxB: user.role === "RD_SECRETARY",
    boxC: user.role === "ARD_SECRETARY" && canView,
    boxD: user.role === "DIVISION_CHIEF" && isMyDiv,
    boxE: user.role === "RECORDS",
  };
}

function computeDueDate(doc) {
  if (!doc.dateReceived) return "";
  const base = new Date(doc.dateReceived + "T00:00:00");
  if (isNaN(base)) return "";
  const tf = doc.ardTimeFrame || doc.rdTimeFrame || "";
  let addDays = 15;
  if (tf === "URGENT (WITHIN THE DAY)") addDays = 0;
  else if (tf === "AS INDICATED IN THE DOC. DUE DATE") addDays = 7;
  base.setDate(base.getDate() + addDays);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(base.getDate()).padStart(2, "0")}`;
}

function computeSLA(doc) {
  if (doc.status === "Completed / Returned to Records" || doc.status === "Archived") {
    return { label: "COMPLETED", key: "COMPLETED", cls: "badge-completed" };
  }
  const due = computeDueDate(doc);
  if (!due) return { label: "PENDING", key: "PENDING", cls: "badge-neutral" };
  const today = new Date(todayISO() + "T00:00:00");
  const dueD = new Date(due + "T00:00:00");
  const diff = Math.round((dueD - today) / 86400000);
  if (diff < 0) return { label: `OVERDUE (${Math.abs(diff)}d)`, key: "OVERDUE", cls: "badge-overdue" };
  if (diff === 0) return { label: "DUE TODAY", key: "DUE", cls: "badge-due" };
  if (diff <= 3) return { label: `DUE SOON (${diff}d)`, key: "DUE", cls: "badge-due" };
  return { label: "ON TIME", key: "ON TIME", cls: "badge-ontime" };
}

function statusBadgeClass(status) {
  if (status === "Completed / Returned to Records" || status === "Dispatched / Released" || status === "Archived") return "badge-completed";
  if (status === "For RD Action" || status === "For ARD Action" || status === "For Approval" || status === "For Counter-Signature" || status === "For Dispatch") return "badge-pending";
  if (status === "In Progress" || status === "Routed to Division" || status === "Received by Records") return "badge-ontime";
  return "badge-neutral";
}

function statusBadge(status) {
  return `<span class="badge ${statusBadgeClass(status)}">${esc(status)}</span>`;
}

function showToast(msg, isError = false) {
  const wrap = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// ----------------- Global Action Loading Overlay -----------------
let loaderCount = 0;
let loaderShownAt = 0;
let loaderHideTimer = null;

function showLoading(title = "Processing...", sub = "DAR Eastern Visayas Regional Office VIII") {
  if (loaderHideTimer) {
    clearTimeout(loaderHideTimer);
    loaderHideTimer = null;
  }
  loaderCount++;
  const el = document.getElementById("global-loader");
  if (!el) return;
  const tEl = document.getElementById("loader-title");
  const sEl = document.getElementById("loader-sub");
  if (tEl) tEl.textContent = title;
  if (sEl) sEl.textContent = sub;
  if (el.classList.contains("hidden")) {
    loaderShownAt = Date.now();
    el.classList.remove("hidden");
  }
}

function hideLoading(minVisibleMs = 180) {
  loaderCount = Math.max(0, loaderCount - 1);
  if (loaderCount > 0) return;
  const el = document.getElementById("global-loader");
  if (!el) return;
  const elapsed = Date.now() - loaderShownAt;
  const wait = Math.max(0, minVisibleMs - elapsed);
  if (wait === 0) {
    el.classList.add("hidden");
  } else {
    loaderHideTimer = setTimeout(() => {
      loaderHideTimer = null;
      if (loaderCount === 0) el.classList.add("hidden");
    }, wait);
  }
}

async function withLoading(title, fn, sub = "Please wait a moment...") {
  showLoading(title, sub);
  try {
    return await fn();
  } finally {
    hideLoading();
  }
}

function pulseLoading(title, fn, sub = "DAR Eastern Visayas Regional Office VIII", durationMs = 200) {
  showLoading(title, sub);
  let result;
  try {
    result = fn();
  } finally {
    hideLoading(durationMs);
  }
  return result;
}

function inferApiLoadingMeta(url, method = "GET") {
  const m = String(method || "GET").toUpperCase();
  if (url.startsWith("/api/state")) return { title: "Loading Documents...", sub: "Syncing DAR RO VIII DTS workspace" };
  if (url.startsWith("/api/upload-pdf")) return { title: "Uploading PDF Attachment...", sub: "Saving file & syncing to Google Drive folder" };
  if (url.startsWith("/api/incoming/send-email")) return { title: "Sending Reply / Action Email...", sub: "Emailing selected RO VIII / DARPO offices" };
  if (url.startsWith("/api/incoming")) {
    if (m === "DELETE") return { title: "Deleting Incoming Document...", sub: "Updating records & Google Sheet" };
    return { title: "Saving Incoming Document...", sub: "Computing tracking status & syncing to Google Sheet" };
  }
  if (url.startsWith("/api/outgoing/send-email")) return { title: "Sending Furnished Copy Emails...", sub: "Emailing selected RO VIII / DARPO offices" };
  if (url.startsWith("/api/outgoing")) {
    if (m === "DELETE") return { title: "Deleting Outgoing Document...", sub: "Updating records & Google Sheet" };
    return { title: "Saving Outgoing Document...", sub: "Updating records & syncing to Google Sheet" };
  }
  if (url.startsWith("/api/issuances/send-email")) return { title: "Sending Issuance Email...", sub: "Emailing selected RO VIII / DARPO offices" };
  if (url.startsWith("/api/issuances/sync-sheets")) return { title: "Syncing Issuances to Google Sheet...", sub: "Creating & updating separate Issuance tabs" };
  if (url.startsWith("/api/issuances")) {
    if (m === "DELETE") return { title: "Deleting Issuance...", sub: "Updating official issuances registry" };
    return { title: "Saving Issuance...", sub: "Updating official issuances registry & Google Sheet" };
  }
  if (url.startsWith("/api/mailings/sync-sheets")) return { title: "Syncing Mailings to Google Sheet...", sub: "Updating PhilPost & JRS sheet tabs" };
  if (url.startsWith("/api/mailings")) {
    if (m === "DELETE") return { title: "Deleting Mailing Record...", sub: "Updating mailing process log" };
    return { title: "Saving Mailing Record...", sub: "Updating PhilPost / JRS log & Google Sheet" };
  }
  if (url.startsWith("/api/users/") && url.endsWith("/status")) return { title: "Updating Account Status...", sub: "Applying administrator confirmation" };
  if (url.startsWith("/api/users/") && url.endsWith("/email")) return { title: "Updating Account Email...", sub: "Saving Login OTP email address" };
  if (url.startsWith("/api/users/")) return { title: "Removing User Account...", sub: "Updating user directory" };
  if (url.startsWith("/api/settings")) return { title: "Saving System Settings...", sub: "Updating DAR RO VIII configuration" };
  if (url.startsWith("/api/test-drive")) return { title: "Testing Google Drive Upload...", sub: "Verifying Drive folder connection" };
  if (url.startsWith("/api/test-email")) return { title: "Sending Test Email...", sub: "Testing official DAR RO VIII sender email" };
  if (url.startsWith("/api/next-number")) return { title: "Generating DTS Control No...", sub: "Checking annual sequence" };
  if (url.startsWith("/api/auth/logout")) return { title: "Signing Out...", sub: "Ending your DTS session" };
  return { title: "Processing Request...", sub: "DAR Eastern Visayas Regional Office VIII" };
}

// ----------------- Authenticated Fetch Wrapper -----------------
async function apiFetch(url, opts = {}) {
  const { loadingText, loadingSub, silentLoading, ...fetchOpts } = opts;
  const headers = { ...(fetchOpts.headers || {}) };
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
  const meta = inferApiLoadingMeta(url, fetchOpts.method);
  if (!silentLoading) showLoading(loadingText || meta.title, loadingSub || meta.sub);
  try {
    const res = await fetch(url, { ...fetchOpts, headers });
    if (res.status === 401 && !url.startsWith("/api/auth/")) {
      handleSignedOut();
      throw new Error("Session expired. Please sign in again.");
    }
    return res;
  } finally {
    if (!silentLoading) hideLoading();
  }
}

// ----------------- Auth Lifecycle -----------------
function showAuthError(elId, msg) {
  const el = document.getElementById(elId);
  el.textContent = msg || "";
  el.classList.toggle("show", !!msg);
}

function handleSignedOut() {
  authToken = "";
  currentUser = null;
  incProgressFilter = "ALL";
  localStorage.removeItem("dar_dts_token");
  document.getElementById("app-shell").classList.add("hidden");
  document.getElementById("auth-screen").classList.remove("hidden");
}

function canEditIssuanceOrMailing() {
  return !!(currentUser && (currentUser.role === "ADMIN" || currentUser.role === "RECORDS"));
}

function applyUserSessionUI() {
  document.getElementById("auth-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");

  const rInfo = ROLE_INFO[currentUser.role] || ROLE_INFO.DIVISION_CHIEF;
  document.getElementById("user-avatar").textContent = (currentUser.fullName || currentUser.username || "U").slice(0, 1).toUpperCase();
  document.getElementById("user-fullname").textContent = currentUser.fullName;
  document.getElementById("user-role-label").textContent =
    currentUser.role === "DIVISION_CHIEF"
      ? `Division Chief • ${currentUser.division}`
      : currentUser.role === "ARD_SECRETARY" && currentUser.division
      ? `ARD Secretary • ${currentUser.division}`
      : rInfo.short;

  const extraDiv =
    (currentUser.role === "DIVISION_CHIEF" || currentUser.role === "ARD_SECRETARY") && currentUser.division
      ? ` (<strong>${esc(currentUser.division)}</strong>)`
      : "";
  document.getElementById("role-banner").innerHTML = `
    <span class="role-banner-text">🔐 ${rInfo.banner}${extraDiv}</span>
    <div class="role-banner-right" id="role-banner-right">
      <span class="role-banner-note" id="role-banner-note">Tracking Status is automated from Box A → Box E</span>
    </div>
  `;

  // Only RECORDS and ADMIN can encode new Incoming documents (Box A), Issuances, and Mailing Process
  const canCreateInc = currentUser.role === "RECORDS" || currentUser.role === "ADMIN";
  const canManageIssMail = canEditIssuanceOrMailing();
  document.getElementById("btn-new-incoming").classList.toggle("hidden", !canCreateInc);
  document.getElementById("btn-add-inc-2").classList.toggle("hidden", !canCreateInc);
  const btnAddIss = document.getElementById("btn-add-issuance");
  if (btnAddIss) btnAddIss.classList.toggle("hidden", !canManageIssMail);
  const btnSyncIss = document.getElementById("btn-sync-iss-sheets");
  if (btnSyncIss) btnSyncIss.classList.toggle("hidden", !canManageIssMail);
  const btnAddMail = document.getElementById("btn-add-mailing");
  if (btnAddMail) btnAddMail.classList.toggle("hidden", !canManageIssMail);
  const btnSyncMail = document.getElementById("btn-sync-mail-sheets");
  if (btnSyncMail) btnSyncMail.classList.toggle("hidden", !canManageIssMail);

  // Settings & Accounts, Linked Sheet/Drive sidebar links, Issuance Categories, Signatories, Email Directory & User Directory are Admin ONLY
  const isAdmin = currentUser.role === "ADMIN";
  const navSettings = document.getElementById("nav-settings");
  if (navSettings) navSettings.classList.toggle("hidden", !isAdmin);
  const adminLinks = document.getElementById("sidebar-admin-links");
  if (adminLinks) adminLinks.classList.toggle("hidden", !isAdmin);
  document.getElementById("btn-save-settings").classList.toggle("hidden", !isAdmin);
  document.getElementById("admin-issuance-cats-card").classList.toggle("hidden", !isAdmin);
  const btnManageIssCols = document.getElementById("btn-manage-iss-cols");
  if (btnManageIssCols) btnManageIssCols.classList.toggle("hidden", !isAdmin);
  document.getElementById("admin-signatories-card").classList.toggle("hidden", !isAdmin);
  document.getElementById("admin-emails-card").classList.toggle("hidden", !isAdmin);
  document.getElementById("admin-users-card").classList.toggle("hidden", !isAdmin);
  if (!isAdmin && currentView === "settings") {
    switchView("dashboard", true);
  }

  if ((currentUser.role === "DIVISION_CHIEF" || currentUser.role === "ARD_SECRETARY") && currentUser.division) {
    selectedPortalDiv = currentUser.division;
  }
}

async function initPublicRegistrationDivisions() {
  try {
    const res = await fetch("/api/public/divisions");
    const data = await res.json();
    if (Array.isArray(data.divisions)) {
      state.divisions = data.divisions;
      updateRegisterDivisionOptions();
    }
  } catch (e) {
    console.error(e);
  }
}

function updateRegisterDivisionOptions() {
  const role = document.getElementById("reg-role").value;
  const wrap = document.getElementById("reg-division-wrap");
  const sel = document.getElementById("reg-division");
  const lbl = document.getElementById("reg-division-label");
  const hint = document.getElementById("reg-role-hint");
  hint.innerHTML = (ROLE_INFO[role] && ROLE_INFO[role].hint) || "";

  if (role === "DIVISION_CHIEF") {
    wrap.style.display = "flex";
    lbl.textContent = "Select Your Division / STO Section (Box D Ownership) *";
    const opts = state.divisions.filter((d) => !["RD", "ARDO", "ARDA"].includes(d.code));
    sel.innerHTML = opts.map((d) => `<option value="${esc(d.code)}">${esc(d.code)} — ${esc(d.name)}</option>`).join("");
  } else if (role === "ARD_SECRETARY") {
    wrap.style.display = "flex";
    lbl.textContent = "ARD Office *";
    sel.innerHTML = `
      <option value="ARDO">ARDO — Asst. Regional Director for Operations</option>
      <option value="ARDA">ARDA — Asst. Regional Director for Administration</option>
    `;
  } else {
    wrap.style.display = "none";
    sel.innerHTML = "";
  }
}

async function loadState() {
  const res = await apiFetch("/api/state");
  if (!res.ok) return handleSignedOut();
  state = await res.json();
  currentUser = state.user;
  applyUserSessionUI();
  populateSelects();
  renderAll();
}

async function fetchNextNumber(type, dateStr, category = "External", year = "", division = "") {
  const res = await apiFetch(
    `/api/next-number?type=${encodeURIComponent(type)}&date=${encodeURIComponent(dateStr || todayISO())}&category=${encodeURIComponent(category)}&year=${encodeURIComponent(year)}&division=${encodeURIComponent(division)}`
  );
  const data = await res.json();
  return data.number;
}

// ----------------- Populate Select Options -----------------
function fillSelect(el, options, includeAllLabel = null) {
  const prev = el.value;
  el.innerHTML = "";
  if (includeAllLabel) {
    const opt = document.createElement("option");
    opt.value = "ALL";
    opt.textContent = includeAllLabel;
    el.appendChild(opt);
  }
  options.forEach((o) => {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o || "— Select —";
    el.appendChild(opt);
  });
  if (prev && [...el.options].some((o) => o.value === prev)) el.value = prev;
}

function extractDocYear(dateStr, codeStr, explicitYear) {
  const exp = String(explicitYear || "").trim();
  if (/^(?:19|20)\d{2}$/.test(exp)) return exp;
  const codeMatch = String(codeStr || "").match(/(?:^|-)((?:19|20)\d{2})(?:-|$)/);
  if (codeMatch) return codeMatch[1];
  if (dateStr && /^(?:19|20)\d{2}/.test(String(dateStr).trim())) return String(dateStr).trim().slice(0, 4);
  const m = String(codeStr || "").match(/((?:19|20)\d{2})/);
  return m ? m[1] : "";
}

function getAvailableYears(list, dateKey, codeKey, altCodeKey = "") {
  const curYr = new Date().getFullYear();
  const years = new Set();
  for (let y = curYr + 2; y >= curYr - 5; y--) years.add(String(y));
  (list || []).forEach((item) => {
    const y = extractDocYear(item[dateKey], item[codeKey] || (altCodeKey ? item[altCodeKey] : ""), item.dtsYear);
    if (y) years.add(y);
  });
  return [...years].sort((a, b) => Number(b) - Number(a));
}

let sortState = {
  inc: { key: "", dir: 1 },
  out: { key: "", dir: 1 },
  iss: { key: "", dir: 1 },
  mail: { key: "", dir: 1 },
};

// Header dropdown filter state per table & column: { [col]: { query: "", selected: Set<string> | null } }
let hdrFilters = { inc: {}, out: {}, iss: {}, mail: {} };
let incProgressFilter = "ALL"; // "ALL" | "PENDING" | "ACTED"
let openPopoverCtx = null;

function isIncomingActed(d) {
  return (
    !!String(d.dateActed || "").trim() ||
    d.status === "For Dispatch" ||
    d.status === "Completed / Returned to Records" ||
    d.status === "Archived"
  );
}

// Per-user Pending for Action rules across Box B, Box C, Box D, and Box E!
function isPendingForUser(user, d) {
  if (!user) return false;
  if (user.role === "RD_SECRETARY") {
    // Box B: Waiting for RD Secretary routing/instructions
    return d.status === "Received by Records" || d.status === "For RD Action";
  }
  if (user.role === "ARD_SECRETARY") {
    // Box C: Routed by RD to ARDO/ARDA and waiting for ARD assignment to Division Chief
    if (d.status !== "For ARD Action") return false;
    if (user.division === "ARDO" || user.division === "ARDA") {
      const rdTo = String(d.rdInstructionsTo || "").trim().toUpperCase();
      return !rdTo || rdTo === user.division.toUpperCase();
    }
    return true;
  }
  if (user.role === "DIVISION_CHIEF") {
    // Box D: Assigned to this user's Division (STO, LTS, LEGAL, ARBDSP, RARAD/DARAB, or STO Section) & not yet acted
    if (isIncomingActed(d)) return false;
    const assigned = resolveAssignedDivision(d);
    return divisionMatches(user.division, assigned);
  }
  if (user.role === "RECORDS") {
    // Box E: Acted by Division and waiting for Records dispatch/return receipt
    return d.status === "For Dispatch";
  }
  // ADMIN: All office-wide pending documents
  return !isIncomingActed(d);
}

function getUserActionMeta(user) {
  if (!user) return { badge: "My Box", sub: "Pending for your action" };
  if (user.role === "RD_SECRETARY") return { badge: "Box B • RD", sub: "Waiting for RD instructions" };
  if (user.role === "ARD_SECRETARY") return { badge: `Box C • ${user.division || "ARD"}`, sub: "Waiting for ARD assignment" };
  if (user.role === "DIVISION_CHIEF") return { badge: `Box D • ${user.division}`, sub: `Pending for ${user.division} action` };
  if (user.role === "RECORDS") return { badge: "Box E • Records", sub: "Ready for Records dispatch" };
  return { badge: "All Boxes", sub: "All pending across DAR RO VIII" };
}

function isOutgoingPending(d) {
  return d.status !== "Dispatched / Released" && d.status !== "Archived";
}

function getColDisplayValue(tbl, col, d) {
  if (tbl === "inc") {
    if (col === "controlNo") return d.controlNo || "";
    if (col === "dateRecv") return formatDateShort(d.dateReceived) || d.dateReceived || "(Blank)";
    if (col === "sender") return d.senderOffice || d.senderName || "(Blank)";
    if (col === "subject") return d.docType || "(Blank)";
    if (col === "division") return resolveAssignedDivision(d) || "Pending Routing";
    if (col === "timeframe") return d.ardTimeFrame || d.rdTimeFrame || "(Not Set)";
    if (col === "status") return d.status || "";
    if (col === "sla") return computeSLA(d).key;
  } else if (tbl === "iss") {
    const cols = getIssuanceColumnsFor(selectedIssuanceCategory || "ALL");
    const colDef = cols.find((c) => c.key === col) || { key: col, builtin: false, type: "text" };
    if (col === "issuanceNo") return d.issuanceNo || "(Blank)";
    if (col === "category") return d.category || "(Blank)";
    if (col === "dateIssued") return formatDateShort(d.dateIssued) || d.dateIssued || "(Blank)";
    if (col === "originatingDivision") return d.originatingDivision || "(Blank)";
    if (col === "subject") return d.subject || "(Blank)";
    if (col === "issuedBy") return d.issuedBy || "(Blank)";
    if (col === "remarks") return d.remarks || "(Blank)";
    if (col === "pdfFile") return (d.attachmentFile && d.attachmentFile.url) ? "PDF Attached" : "(No PDF)";
    const raw = (d.customFields && d.customFields[col]) || "";
    if (!raw) return "(Blank)";
    if (colDef.type === "datetime") return formatDateTimeDisplay(raw) || raw;
    if (colDef.type === "date") return formatDateShort(raw) || raw;
    if (colDef.type === "date_range") {
      const parts = String(raw).split(/\s+to\s+/i).map((s) => s.trim()).filter(Boolean);
      return parts.length >= 2 ? `${formatDateShort(parts[0]) || parts[0]} to ${formatDateShort(parts[1]) || parts[1]}` : (formatDateShort(parts[0]) || raw);
    }
    if (colDef.type === "multi_names") {
      return String(raw).split(/\r?\n|;/).map((s) => s.trim()).filter(Boolean).join(", ") || "(Blank)";
    }
    return String(raw);
  } else if (tbl === "mail") {
    if (col === "mailingNo") return d.mailingNo || "(Blank)";
    if (col === "courier") return d.courier || "(Blank)";
    if (col === "docType") return d.docType || "(Blank)";
    if (col === "dateMailed") return formatDateShort(d.dateMailed) || d.dateMailed || "(Blank)";
    if (col === "trackingNo") return d.trackingNo ? d.trackingNo.replace(/\r?\n/g, ", ") : "(Blank)";
    if (col === "recipientName") return d.recipientName ? d.recipientName.replace(/\r?\n/g, ", ") : "(Blank)";
    if (col === "province") return d.province || d.recipientAddress || "(Blank)";
    if (col === "subject") return d.subject || "(Blank)";
    if (col === "mailedBy") return d.mailedBy || d.originatingDivision || "(Blank)";
    if (col === "amount") return d.amount || "(Blank)";
    if (col === "status") return d.status || "(Blank)";
    if (col === "dateReceived") return d.dateReceived ? d.dateReceived.split(/\r?\n/).map((v) => formatDateShort(v) || v).join(", ") : "(Pending)";
    if (col === "remarks") return d.remarks || "(Blank)";
  } else {
    if (col === "recNo") return d.recNo || d.userDocNo || "(Pending Records)";
    if (col === "dateOrig") return formatDateShort(d.dateOriginated) || d.dateOriginated || "(Blank)";
    if (col === "division") return d.originatingDivision || "(Blank)";
    if (col === "subject") return d.docDescription || "(Blank)";
    if (col === "recipient") return d.recipientOffice || d.recipientTo || "(Blank)";
    if (col === "mode") return d.finalDispatchMode || d.transmissionMode || "(Not Set)";
    if (col === "status") return d.status || "";
  }
  return "";
}

function getColSearchHaystack(tbl, col, d) {
  if (tbl === "inc") {
    const sla = computeSLA(d);
    const due = computeDueDate(d);
    const assigned = resolveAssignedDivision(d) || "Pending Routing";
    const cat = d.docCategory || (String(d.controlNo || "").toUpperCase().startsWith("I-") ? "Internal" : "External");
    if (col === "controlNo") return `${d.controlNo} ${d.refNo || ""} ${cat}`;
    if (col === "dateRecv") return `${d.dateReceived || ""} ${formatDateShort(d.dateReceived)} ${d.timeReceived || ""} ${d.receivedBy || ""}`;
    if (col === "sender") return `${d.senderName || ""} ${d.senderOffice || ""}`;
    if (col === "subject") return `${d.docType || ""} ${d.subject || ""} ${d.thru || ""} ${d.attachments || ""}`;
    if (col === "division") return assigned;
    if (col === "timeframe") return `${d.ardTimeFrame || ""} ${d.rdTimeFrame || ""} ${due} ${formatDateShort(due)}`;
    if (col === "status") return d.status || "";
    if (col === "sla") return `${sla.label} ${sla.key}`;
  } else if (tbl === "iss") {
    const disp = getColDisplayValue("iss", col, d);
    if (col === "subject") return `${disp} ${d.refNo || ""} ${d.remarks || ""}`;
    if (col === "dateIssued") return `${d.dateIssued || ""} ${disp}`;
    const raw = (d.customFields && d.customFields[col]) || "";
    return `${disp} ${raw}`;
  } else if (tbl === "mail") {
    const disp = getColDisplayValue("mail", col, d);
    if (col === "province") return `${d.province || ""} ${d.recipientAddress || ""}`;
    if (col === "subject") return `${d.subject || ""} ${d.docRefNo || ""}`;
    if (col === "mailedBy") return `${d.mailedBy || ""} ${d.originatingDivision || ""}`;
    if (col === "dateReceived") return `${d.dateReceived || ""} ${disp} ${d.receivedBy || ""}`;
    return `${disp} ${d[col] || ""}`;
  } else {
    if (col === "recNo") return `${d.userDocNo || ""} ${d.recNo || "Pending Records"}`;
    if (col === "dateOrig") return `${d.dateOriginated || ""} ${formatDateShort(d.dateOriginated)} ${d.preparedBy || ""}`;
    if (col === "division") return d.originatingDivision || "";
    if (col === "subject") return `${d.docDescription || ""} ${d.subject || ""} ${d.attachments || ""}`;
    if (col === "recipient") return `${d.recipientTo || ""} ${d.recipientOffice || ""} ${d.recipientAddress || ""}`;
    if (col === "mode") return `${d.finalDispatchMode || ""} ${d.transmissionMode || ""} ${d.dateDispatched || ""} ${formatDateShort(d.dateDispatched)}`;
    if (col === "status") return d.status || "";
  }
  return "";
}

function updateHeaderDropIndicators(tbl) {
  document.querySelectorAll(`.th-drop-btn[data-hdr-filter="${tbl}"]`).forEach((btn) => {
    const col = btn.getAttribute("data-col");
    const f = hdrFilters[tbl][col];
    const hasFilter = !!(f && ((f.query && f.query.trim()) || f.selected !== null));
    const isSorted = sortState[tbl].key === col;
    btn.classList.toggle("active", hasFilter || isSorted);
    btn.textContent = isSorted ? (sortState[tbl].dir === 1 ? "▲" : "▼") : hasFilter ? "⧩" : "▾";
  });
}

function closeHeaderPopover() {
  const pop = document.getElementById("hdr-filter-popover");
  if (pop) pop.classList.add("hidden");
  openPopoverCtx = null;
}

function openHeaderPopover(btn, tbl, col) {
  const pop = document.getElementById("hdr-filter-popover");
  if (openPopoverCtx && openPopoverCtx.tbl === tbl && openPopoverCtx.col === col && !pop.classList.contains("hidden")) {
    return closeHeaderPopover();
  }
  openPopoverCtx = { tbl, col };
  const incYrVal = document.getElementById("inc-filter-year")?.value || "ALL";
  const outYrVal = document.getElementById("out-filter-year")?.value || "ALL";
  const issYrVal = document.getElementById("iss-filter-year")?.value || "ALL";
  const mailYrVal = document.getElementById("mail-filter-year")?.value || "ALL";
  const rows =
    tbl === "inc"
      ? state.incoming.filter((d) => incYrVal === "ALL" || extractDocYear(d.dateReceived, d.controlNo, d.dtsYear) === incYrVal)
      : tbl === "iss"
      ? (state.issuances || []).filter((r) => (selectedIssuanceCategory === "ALL" || r.category === selectedIssuanceCategory) && (issYrVal === "ALL" || extractDocYear(r.dateIssued, r.issuanceNo) === issYrVal))
      : tbl === "mail"
      ? (state.mailings || []).filter((r) => (selectedMailingCourier === "ALL" || r.courier === selectedMailingCourier) && (mailYrVal === "ALL" || extractDocYear(r.dateMailed, r.mailingNo) === mailYrVal))
      : state.outgoing.filter((d) => outYrVal === "ALL" || extractDocYear(d.dateOriginated, d.recNo || d.userDocNo, d.dtsYear) === outYrVal);
  const uniqueVals = [...new Set(rows.map((d) => getColDisplayValue(tbl, col, d)))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
  const existing = hdrFilters[tbl][col] || { query: "", selected: null };
  const labelEl = btn.parentElement.querySelector("[data-hdr-label]") || btn.parentElement.querySelector("span");
  const label = labelEl ? labelEl.textContent : col;

  pop.innerHTML = `
    <div class="hdr-pop-title">
      <span>Filter: ${esc(label)}</span>
      <button type="button" class="btn btn-sm btn-ghost" id="hdr-pop-close" style="padding:2px 6px;">✕</button>
    </div>
    <div class="hdr-pop-sort">
      <button type="button" id="hdr-sort-asc" class="${sortState[tbl].key === col && sortState[tbl].dir === 1 ? "active" : ""}">▲ Sort A → Z</button>
      <button type="button" id="hdr-sort-desc" class="${sortState[tbl].key === col && sortState[tbl].dir === -1 ? "active" : ""}">▼ Sort Z → A</button>
    </div>
    <input type="text" id="hdr-pop-search" class="input" style="padding:6px 8px;font-size:12px;" value="${esc(existing.query || "")}" placeholder="Type to search / filter..." />
    <div class="hdr-pop-quick">
      <button type="button" id="hdr-sel-all">Select All</button>
      <button type="button" id="hdr-sel-none">Clear All</button>
    </div>
    <div class="hdr-pop-list" id="hdr-pop-list">
      ${uniqueVals
        .map((v) => {
          const checked = existing.selected === null || existing.selected.has(v);
          return `<label class="hdr-pop-item"><input type="checkbox" value="${esc(v)}" ${checked ? "checked" : ""} /><span>${esc(v)}</span></label>`;
        })
        .join("")}
    </div>
    <div class="hdr-pop-actions">
      <button type="button" class="btn btn-sm btn-outline" id="hdr-pop-reset">Reset</button>
      <button type="button" class="btn btn-sm btn-primary" id="hdr-pop-apply">Apply Filter</button>
    </div>
  `;

  pop.classList.remove("hidden");
  const rect = btn.getBoundingClientRect();
  const popW = 270;
  let left = rect.right - popW;
  if (left < 12) left = rect.left;
  if (left + popW > window.innerWidth - 12) left = window.innerWidth - popW - 12;
  let top = rect.bottom + 6;
  if (top + 360 > window.innerHeight) top = Math.max(12, window.innerHeight - 370);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  const searchInput = document.getElementById("hdr-pop-search");
  searchInput.focus();

  // Filter checkbox list dynamically as user types in popover search
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    pop.querySelectorAll(".hdr-pop-item").forEach((lbl) => {
      const txt = lbl.querySelector("span").textContent.toLowerCase();
      lbl.style.display = !q || txt.includes(q) ? "flex" : "none";
    });
  });

  document.getElementById("hdr-pop-close").addEventListener("click", closeHeaderPopover);
  document.getElementById("hdr-sel-all").addEventListener("click", () => {
    pop.querySelectorAll('.hdr-pop-item input[type="checkbox"]').forEach((c) => {
      if (c.closest(".hdr-pop-item").style.display !== "none") c.checked = true;
    });
  });
  document.getElementById("hdr-sel-none").addEventListener("click", () => {
    pop.querySelectorAll('.hdr-pop-item input[type="checkbox"]').forEach((c) => {
      if (c.closest(".hdr-pop-item").style.display !== "none") c.checked = false;
    });
  });

  const refreshTbl = () => {
    if (tbl === "inc") renderIncomingTable();
    else if (tbl === "iss") renderIssuancesView();
    else if (tbl === "mail") renderMailingView();
    else renderOutgoingTable();
  };

  const applyAndRefresh = () => {
    const q = searchInput.value.trim();
    const checks = [...pop.querySelectorAll('.hdr-pop-item input[type="checkbox"]')];
    const checkedVals = new Set(checks.filter((c) => c.checked).map((c) => c.value));
    const allChecked = checkedVals.size === checks.length;
    if (!q && allChecked) delete hdrFilters[tbl][col];
    else hdrFilters[tbl][col] = { query: q, selected: allChecked ? null : checkedVals };
    updateHeaderDropIndicators(tbl);
    refreshTbl();
    closeHeaderPopover();
  };

  document.getElementById("hdr-pop-apply").addEventListener("click", applyAndRefresh);
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); applyAndRefresh(); }
    if (e.key === "Escape") closeHeaderPopover();
  });

  document.getElementById("hdr-pop-reset").addEventListener("click", () => {
    delete hdrFilters[tbl][col];
    if (sortState[tbl].key === col) sortState[tbl] = { key: "", dir: 1 };
    updateHeaderDropIndicators(tbl);
    refreshTbl();
    closeHeaderPopover();
  });

  document.getElementById("hdr-sort-asc").addEventListener("click", () => {
    sortState[tbl] = { key: col, dir: 1 };
    updateHeaderDropIndicators(tbl);
    refreshTbl();
    closeHeaderPopover();
  });
  document.getElementById("hdr-sort-desc").addEventListener("click", () => {
    sortState[tbl] = { key: col, dir: -1 };
    updateHeaderDropIndicators(tbl);
    refreshTbl();
    closeHeaderPopover();
  });
}

function populateSelects() {
  const divCodes = state.divisions.map((d) => d.code);
  const map = {
    divisions: divCodes,
    divisionsBlank: ["", ...divCodes],
    divisionsOthers: [...divCodes, "Others"],
    ...LISTS,
  };
  document.querySelectorAll("select[data-list]").forEach((sel) => {
    const key = sel.getAttribute("data-list");
    if (map[key]) fillSelect(sel, map[key]);
  });

  fillSelect(document.getElementById("inc-filter-year"), getAvailableYears(state.incoming, "dateReceived", "controlNo"), "All Years");
  fillSelect(document.getElementById("out-filter-year"), getAvailableYears(state.outgoing, "dateOriginated", "recNo", "userDocNo"), "All Years");
  const issYrSel = document.getElementById("iss-filter-year");
  if (issYrSel) fillSelect(issYrSel, getAvailableYears(state.issuances || [], "dateIssued", "issuanceNo"), "All Years");
  const mailYrSel = document.getElementById("mail-filter-year");
  if (mailYrSel) fillSelect(mailYrSel, getAvailableYears(state.mailings || [], "dateMailed", "mailingNo"), "All Years");
  const curYr = new Date().getFullYear();
  const dtsYears = [];
  for (let y = curYr + 4; y >= curYr - 5; y--) dtsYears.push(String(y));
  const dtsYearListEl = document.getElementById("inc-dts-year-list");
  if (dtsYearListEl) dtsYearListEl.innerHTML = dtsYears.map((y) => `<option value="${esc(y)}"></option>`).join("");
  const dtsYearInp = document.getElementById("inc-dts-year");
  if (dtsYearInp && !dtsYearInp.value) dtsYearInp.value = String(curYr);

  const sheetUrl = state.meta.spreadsheetUrl || "#";
  const driveUrl = state.meta.driveFolderUrl || "https://drive.google.com/drive/folders/1JJwNkttWowxao0UIhR7k_hKXWI1L_eQC?usp=sharing";
  document.getElementById("sidebar-sheet-link").href = sheetUrl;
  document.getElementById("sidebar-drive-link").href = driveUrl;
  document.getElementById("boxa-drive-link").href = driveUrl;
  document.getElementById("settings-sheet-link").href = sheetUrl;
  document.getElementById("set-rd").value = state.meta.regionalDirector || "";
  document.getElementById("set-form-code").value = state.meta.incomingFormCode || "";
  document.getElementById("set-address").value = state.meta.address || "";
  document.getElementById("set-telefax").value = state.meta.telefax || "";
  document.getElementById("set-website").value = state.meta.website || "";
  document.getElementById("set-sheet-url").value = sheetUrl;
  document.getElementById("set-drive-url").value = driveUrl;
  document.getElementById("set-apps-script").value = state.meta.appsScriptUrl || "";
  const senderEmailVal = state.meta.senderEmail || "darrec8@gmail.com";
  document.getElementById("set-sender-email").value = senderEmailVal;
  const smtpPassWrap = document.getElementById("set-smtp-pass-wrap");
  const smtpPassInput = document.getElementById("set-smtp-pass");
  if (smtpPassWrap) smtpPassWrap.classList.toggle("hidden", !currentUser || currentUser.role !== "ADMIN");
  if (smtpPassInput) {
    smtpPassInput.value = "";
    smtpPassInput.placeholder = state.meta.hasSmtpPassword
      ? "•••••••••••• (Saved — leave blank to keep current)"
      : "Paste 16-char Google App Password for " + senderEmailVal;
  }

  const otpChk = document.getElementById("set-login-otp-enabled");
  const otpWrap = document.getElementById("set-login-otp-wrap");
  if (otpChk) otpChk.checked = state.meta.loginOtpEnabled !== false;
  if (otpWrap) otpWrap.classList.toggle("hidden", !currentUser || currentUser.role !== "ADMIN");

  const eBox = document.getElementById("email-sender-status-box");
  if (eBox) {
    if (state.meta.emailMode === "gmail_smtp") {
      eBox.innerHTML = `✅ <strong>Direct Gmail SMTP Active:</strong> Emails are sent directly from <code>${esc(senderEmailVal)}</code> over encrypted TLS (smtp.gmail.com).`;
    } else if (state.meta.emailMode === "apps_script") {
      eBox.innerHTML = `📧 <strong>Official Sender Email:</strong> <code>${esc(senderEmailVal)}</code>. To send directly from <code>${esc(senderEmailVal)}</code>, either paste its <strong>16-character Gmail App Password</strong> above (Admin → Google Account → Security → App Passwords) OR deploy <code>Code.gs</code> while signed into <code>${esc(senderEmailVal)}</code>.`;
    } else {
      eBox.innerHTML = `⚠️ <strong>Sender Email (${esc(senderEmailVal)}):</strong> Paste a 16-character Gmail App Password above and click <strong>Save Settings</strong> to enable automatic email sending.`;
    }
  }

  const dBox = document.getElementById("drive-sync-status-box");
  if (dBox) {
    if (state.meta.driveMode === "service_account") {
      dBox.innerHTML = `✅ <strong>Direct Google Drive API v3 Active (up to 100 MB):</strong> Service Account <code>${esc(state.meta.serviceAccountEmail)}</code> will upload every PDF directly into your Google Drive folder.`;
    } else if (state.meta.driveMode === "apps_script") {
      dBox.innerHTML = `✅ <strong>Google Apps Script Bridge Active (up to 35 MB):</strong> Every uploaded PDF will be relayed straight into your Google Drive folder.`;
    } else {
      dBox.innerHTML = `⚠️ <strong>Local Storage Only:</strong> PDFs currently save to <code>uploads/</code> on this PC. To auto-upload into your Google Drive folder from localhost, paste your deployed <strong>Google Apps Script Web App URL</strong> above (or add <code>google-credentials.json</code> for 100 MB direct Drive API uploads), save, and click <strong>Test Google Drive Upload</strong>.`;
    }
  }
}

// ----------------- Render All -----------------
function renderAll() {
  const isBoxRole = currentUser && ["RD_SECRETARY", "ARD_SECRETARY", "DIVISION_CHIEF"].includes(currentUser.role);
  const myPendingCount = state.incoming.filter((d) => isPendingForUser(currentUser, d)).length;
  const allPendingCount = state.incoming.filter((d) => !isIncomingActed(d)).length;
  const outPendingRecNoCount = state.outgoing.filter((d) => !String(d.recNo || "").trim()).length;

  const incBadge = document.getElementById("badge-incoming");
  incBadge.textContent = isBoxRole ? myPendingCount : allPendingCount;
  incBadge.title = isBoxRole
    ? `Pending for your action (${getUserActionMeta(currentUser).badge})`
    : "Total Pending Incoming Documents";
  incBadge.classList.toggle("badge-alert", isBoxRole && myPendingCount > 0);
  const outBadge = document.getElementById("badge-outgoing");
  outBadge.textContent = outPendingRecNoCount;
  outBadge.title = "Outgoing Documents Pending DAR8 Rec. No.";

  // Show clickable "Pending for Your Action" notification pill right at the top-right of the Role Banner (same position across all offices!)
  const bannerRight = document.getElementById("role-banner-right") || document.getElementById("role-banner");
  const bannerNote = document.getElementById("role-banner-note");
  const oldMyBtn = document.getElementById("banner-my-pending-btn");
  if (oldMyBtn) oldMyBtn.remove();
  if (currentUser && myPendingCount > 0 && currentUser.role !== "ADMIN") {
    const meta = getUserActionMeta(currentUser);
    const btn = document.createElement("button");
    btn.id = "banner-my-pending-btn";
    btn.className = "pending-admin-alert";
    btn.textContent = `🔔 ${myPendingCount} Pending for Your Action (${meta.badge}) — Open Queue`;
    btn.addEventListener("click", () => {
      incProgressFilter = "MY_PENDING";
      document.getElementById("inc-filter-cat").value = "ALL";
      switchView("incoming");
      renderIncomingTable();
    });
    bannerRight.insertBefore(btn, bannerRight.firstChild);
    if (bannerNote) bannerNote.classList.add("hidden");
  } else if (bannerNote) {
    bannerNote.classList.remove("hidden");
  }

  renderDashboard();
  renderIncomingTable();
  renderOutgoingTable();
  renderIssuanceSidebar();
  renderIssuancesView();
  renderMailingSidebar();
  renderMailingView();
  renderDivisionPortal();
  renderTrackerChips();
  renderAdminIssuanceCategories();
  renderAdminSignatories();
  renderAdminEmailDirectory();
  renderAdminUsers();
}

// ----------------- Issuances (ALI Case, Memo, Notice & Admin Custom Sub-Categories) -----------------
function getIssuanceCategories() {
  const cats = state.meta && Array.isArray(state.meta.issuanceCategories) ? state.meta.issuanceCategories : [];
  return cats.length ? cats : ["ALI Case", "Memo", "Notice"];
}

function getIssuanceIcon(cat) {
  const s = String(cat || "").toLowerCase();
  if (s.includes("ali") || s.includes("case") || s.includes("finality") || s.includes("writ") || s.includes("interlocutory")) return "⚖️";
  if (s.includes("resolution")) return "📜";
  if (s.includes("erratum")) return "✏️";
  if (s.includes("rcluppi")) return "🏛️";
  if (s.includes("memo")) return "📝";
  if (s.includes("notice")) return "📢";
  if (s.includes("order")) return "📋";
  if (s.includes("circular")) return "🔁";
  return "📄";
}

function renderIssuanceSidebar() {
  const allList = state.issuances || [];
  const badge = document.getElementById("badge-issuances");
  if (badge) badge.textContent = allList.length;

  const container = document.getElementById("sidebar-issuance-subs");
  if (!container) return;
  const cats = getIssuanceCategories();
  if (selectedIssuanceCategory !== "ALL" && !cats.includes(selectedIssuanceCategory)) {
    selectedIssuanceCategory = "ALL";
  }

  let html = `
    <button type="button" class="nav-subitem ${currentView === "issuances" && selectedIssuanceCategory === "ALL" ? "active" : ""}" data-iss-cat="ALL">
      <span class="sub-label">📚 All Issuances</span>
      <span class="sub-count">${allList.length}</span>
    </button>
  `;

  const isAdmin = currentUser && currentUser.role === "ADMIN";
  cats.forEach((cat, idx) => {
    const cnt = allList.filter((r) => r.category === cat).length;
    const isAct = currentView === "issuances" && selectedIssuanceCategory === cat;
    const editBtn = isAdmin
      ? `<button type="button" class="nav-sub-edit-btn" data-edit-iss-idx="${idx}" title="Admin: Rename '${esc(cat)}' sub-category" aria-label="Edit ${esc(cat)}">✎</button>`
      : "";
    const delBtn =
      isAdmin && cats.length > 1
        ? `<button type="button" class="nav-sub-del-btn" data-del-iss-idx="${idx}" title="Admin: Delete '${esc(cat)}' sub-category" aria-label="Delete ${esc(cat)}">✕</button>`
        : "";
    html += `
      <div class="nav-subitem-row ${isAct ? "active" : ""}">
        <button type="button" class="nav-subitem ${isAct ? "active" : ""}" data-iss-cat="${esc(cat)}">
          <span class="sub-label">${getIssuanceIcon(cat)} ${esc(cat)}</span>
          <span class="sub-count">${cnt}</span>
        </button>
        ${editBtn}${delBtn}
      </div>
    `;
  });

  if (isAdmin) {
    html += `
      <button type="button" class="nav-subitem add-sub-btn" id="btn-sidebar-add-iss-cat" title="Admin: Add new sub-category under Issuance">
        <span>＋ Add Sub-Category</span>
      </button>
    `;
  }

  container.innerHTML = html;

  container.querySelectorAll(".nav-subitem[data-iss-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedIssuanceCategory = btn.getAttribute("data-iss-cat") || "ALL";
      hdrFilters.iss = {};
      sortState.iss = { key: "", dir: 1 };
      closeHeaderPopover();
      const filterCat = document.getElementById("iss-filter-cat");
      if (filterCat) filterCat.value = selectedIssuanceCategory;
      switchView("issuances");
      renderIssuancesView();
      renderIssuanceSidebar();
    });
  });

  container.querySelectorAll(".nav-sub-edit-btn[data-edit-iss-idx]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute("data-edit-iss-idx"), 10);
      if (isNaN(idx)) return;
      const list = [...getIssuanceCategories()];
      const oldVal = list[idx];
      if (!oldVal) return;
      const entered = prompt(`Rename Issuance sub-category "${oldVal}":`, oldVal);
      if (entered === null) return;
      const nextVal = entered.trim();
      if (!nextVal) return showToast("Sub-category name cannot be empty.", true);
      if (nextVal === oldVal) return;
      if (list.some((c, i) => i !== idx && c.toLowerCase() === nextVal.toLowerCase())) {
        return showToast(`"${nextVal}" already exists.`, true);
      }
      list[idx] = nextVal;
      const res = await apiFetch("/api/settings", {
        method: "PUT",
        loadingText: "Renaming Sub-Category...",
        loadingSub: `${oldVal} → ${nextVal}`,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          issuanceCategories: list,
          renameIssuanceCategory: { from: oldVal, to: nextVal },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return showToast(data.error || "Failed to rename sub-category", true);
      if (selectedIssuanceCategory === oldVal) selectedIssuanceCategory = nextVal;
      showToast(`Renamed "${oldVal}" to "${nextVal}".`);
      await loadState();
    });
  });

  container.querySelectorAll(".nav-sub-del-btn[data-del-iss-idx]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute("data-del-iss-idx"), 10);
      if (!isNaN(idx)) window.deleteIssCat(idx);
    });
  });

  const quickAddBtn = document.getElementById("btn-sidebar-add-iss-cat");
  if (quickAddBtn) {
    quickAddBtn.addEventListener("click", async () => {
      const name = prompt("Enter new Issuance sub-category name (e.g. Special Order, Circular, Resolution):");
      if (!name || !name.trim()) return;
      await addIssuanceCategory(name.trim());
    });
  }
}

async function addIssuanceCategory(rawName) {
  const val = String(rawName || "").trim();
  if (!val) return showToast("Please enter a sub-category name.", true);
  const list = [...getIssuanceCategories()];
  if (list.some((c) => c.toLowerCase() === val.toLowerCase())) {
    return showToast(`"${val}" is already in the Issuance sidebar.`, true);
  }
  list.push(val);
  const res = await apiFetch("/api/settings", {
    method: "PUT",
    loadingText: "Adding Issuance Sub-Category...",
    loadingSub: val,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ issuanceCategories: list }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) return showToast(data.error || "Failed to add sub-category", true);
  showToast(`Added "${val}" under Issuance in the sidebar!`);
  await loadState();
}

let editingIssCatIdx = -1;

function renderAdminIssuanceCategories() {
  const tbody = document.getElementById("admin-iss-cats-tbody");
  if (!tbody || !currentUser || currentUser.role !== "ADMIN") return;
  const list = getIssuanceCategories();
  const allIss = state.issuances || [];
  tbody.innerHTML = list
    .map((cat, idx) => {
      const cnt = allIss.filter((r) => r.category === cat).length;
      if (editingIssCatIdx === idx) {
        return `
        <tr>
          <td>${idx + 1}</td>
          <td><input type="text" id="edit-iss-cat-input-${idx}" class="input" value="${esc(cat)}" style="padding:6px 10px;font-size:13px;" /></td>
          <td><span class="badge">${cnt}</span></td>
          <td class="actions-col">
            <button type="button" class="btn btn-sm btn-primary" onclick="saveIssCatEdit(${idx})">Save</button>
            <button type="button" class="btn btn-sm btn-outline" onclick="cancelIssCatEdit()">Cancel</button>
          </td>
        </tr>`;
      }
      return `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${getIssuanceIcon(cat)} ${esc(cat)}</strong></td>
        <td><span class="badge">${cnt}</span></td>
        <td class="actions-col">
          <button type="button" class="btn btn-sm btn-outline" onclick="startIssCatEdit(${idx})">Edit</button>
          <button type="button" class="btn btn-sm btn-danger" onclick="deleteIssCat(${idx})" ${list.length <= 1 ? "disabled" : ""}>Delete</button>
        </td>
      </tr>`;
    })
    .join("");

  if (editingIssCatIdx >= 0) {
    const inp = document.getElementById(`edit-iss-cat-input-${editingIssCatIdx}`);
    if (inp) {
      inp.focus();
      inp.select();
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); window.saveIssCatEdit(editingIssCatIdx); }
        if (e.key === "Escape") window.cancelIssCatEdit();
      });
    }
  }
}

window.startIssCatEdit = function (idx) {
  editingIssCatIdx = idx;
  renderAdminIssuanceCategories();
};

window.cancelIssCatEdit = function () {
  editingIssCatIdx = -1;
  renderAdminIssuanceCategories();
};

window.saveIssCatEdit = async function (idx) {
  const inp = document.getElementById(`edit-iss-cat-input-${idx}`);
  const nextVal = (inp && inp.value || "").trim();
  if (!nextVal) return showToast("Sub-category name cannot be empty.", true);
  const list = [...getIssuanceCategories()];
  const oldVal = list[idx];
  if (oldVal === undefined) return;
  if (list.some((c, i) => i !== idx && c.toLowerCase() === nextVal.toLowerCase())) {
    return showToast(`"${nextVal}" already exists.`, true);
  }
  list[idx] = nextVal;
  const res = await apiFetch("/api/settings", {
    method: "PUT",
    loadingText: "Renaming Sub-Category...",
    loadingSub: `${oldVal} → ${nextVal}`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      issuanceCategories: list,
      renameIssuanceCategory: { from: oldVal, to: nextVal },
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) return showToast(data.error || "Failed to rename sub-category", true);
  if (selectedIssuanceCategory === oldVal) selectedIssuanceCategory = nextVal;
  editingIssCatIdx = -1;
  showToast(`Renamed "${oldVal}" to "${nextVal}".`);
  await loadState();
};

window.deleteIssCat = async function (idx) {
  const list = [...getIssuanceCategories()];
  if (list.length <= 1) return showToast("At least one Issuance sub-category is required.", true);
  const target = list[idx];
  if (!target) return;
  const cnt = (state.issuances || []).filter((r) => r.category === target).length;
  const msg = cnt > 0
    ? `Remove "${target}" from the Issuance sidebar? (${cnt} existing record(s) will remain visible under All Issuances.)`
    : `Remove "${target}" from the Issuance sidebar?`;
  if (!confirm(msg)) return;
  list.splice(idx, 1);
  const res = await apiFetch("/api/settings", {
    method: "PUT",
    loadingText: "Removing Sub-Category...",
    loadingSub: target,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ issuanceCategories: list }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) return showToast(data.error || "Failed to remove sub-category", true);
  if (selectedIssuanceCategory === target) selectedIssuanceCategory = "ALL";
  editingIssCatIdx = -1;
  showToast(`Removed "${target}" from Issuance sub-categories.`);
  await loadState();
};

const DEFAULT_ISSUANCE_COLUMNS = [
  { key: "issuanceNo", label: "Issuance No.", builtin: true, type: "text" },
  { key: "category", label: "Sub-Category", builtin: true, type: "text" },
  { key: "dateIssued", label: "Date Issued", builtin: true, type: "date" },
  { key: "originatingDivision", label: "Originating Unit", builtin: true, type: "text" },
  { key: "subject", label: "Subject / Title & Ref.", builtin: true, type: "text" },
  { key: "issuedBy", label: "Issued By", builtin: true, type: "text" },
  { key: "pdfFile", label: "PDF file", builtin: true, type: "pdf" },
];

const DEFAULT_ALI_CASE_COLUMNS = [
  { key: "issuanceNo", label: "Control Number", builtin: true, type: "text" },
  { key: "col_date_time_released", label: "Date and Time Released", builtin: false, type: "datetime" },
  { key: "col_released_by", label: "Released by", builtin: false, type: "text" },
  { key: "subject", label: "Subject", builtin: true, type: "text" },
  { key: "dateIssued", label: "Date of Document", builtin: true, type: "date" },
  { key: "issuedBy", label: "Signatory", builtin: true, type: "text" },
  { key: "col_concerned_parties", label: "Concerned Parties", builtin: false, type: "multi_names" },
  { key: "col_province", label: "Province", builtin: false, type: "select_or_custom", options: ["Biliran", "Eastern Samar", "Leyte", "Northern Samar", "Samar", "Southern Leyte"] },
  { key: "col_date_mailed", label: "Date Mailed", builtin: false, type: "date" },
  { key: "remarks", label: "Remarks", builtin: true, type: "text" },
  { key: "pdfFile", label: "PDF file", builtin: true, type: "pdf" },
];

const DEFAULT_MEMO_NOTICE_COLUMNS = [
  { key: "issuanceNo", label: "Control Number", builtin: true, type: "text" },
  { key: "col_date_released", label: "Date Released", builtin: false, type: "date" },
  { key: "col_released_by", label: "Released By", builtin: false, type: "text" },
  { key: "subject", label: "Subject", builtin: true, type: "text" },
  { key: "dateIssued", label: "Date of Document", builtin: true, type: "date" },
  { key: "col_date_of_activity", label: "Date of Activity", builtin: false, type: "date_range" },
  { key: "col_place_venue", label: "Place / Venue", builtin: false, type: "text" },
  { key: "col_concerned_parties", label: "Concerned Parties", builtin: false, type: "multi_names" },
];

function getDefaultIssuanceColumnsFor(catKey) {
  const k = String(catKey || "ALL").trim().toLowerCase();
  if (k === "memo" || k === "notice") {
    return DEFAULT_MEMO_NOTICE_COLUMNS.map((c) => ({ ...c }));
  }
  if (["ali case", "order", "finality", "rcluppi", "resolution", "erratum", "writ of execution", "interlocutory"].includes(k)) {
    return DEFAULT_ALI_CASE_COLUMNS.map((c) => ({ ...c, ...(c.options ? { options: [...c.options] } : {}) }));
  }
  return DEFAULT_ISSUANCE_COLUMNS.map((c) => ({ ...c }));
}

let managingIssColsCat = "ALL";
let editingIssColIdx = -1;

function getIssuanceColumnsFor(catKey) {
  const k = String(catKey || "ALL").trim() || "ALL";
  const map = (state.meta && state.meta.issuanceColumns) || {};
  const arr = map[k];
  if (Array.isArray(arr) && arr.length > 0) {
    return arr.map((c) => ({ ...c, ...(c.options ? { options: [...c.options] } : {}) }));
  }
  return getDefaultIssuanceColumnsFor(k);
}

function makeCustomColumnKey(label, existingCols) {
  const base =
    "col_" +
    String(label || "field")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 28) || "col_field";
  let key = base;
  let n = 2;
  const used = new Set((existingCols || []).map((c) => c.key));
  while (used.has(key)) {
    key = `${base}_${n++}`;
  }
  return key;
}

async function saveIssuanceColumnsFor(catKey, colsList, loadingSub = "") {
  const k = String(catKey || "ALL").trim() || "ALL";
  const res = await apiFetch("/api/settings", {
    method: "PUT",
    loadingText: "Updating Issuance Columns...",
    loadingSub: loadingSub || k,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ issuanceColumns: { [k]: colsList } }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) {
    showToast(data.error || "Failed to update columns", true);
    return false;
  }
  await loadState();
  if (document.getElementById("modal-iss-columns")?.classList.contains("open")) {
    renderIssuanceColumnsModal();
  }
  return true;
}

window.quickAddIssuanceColumn = async function (catKey) {
  if (!currentUser || currentUser.role !== "ADMIN") return;
  const targetCat = catKey || selectedIssuanceCategory || "ALL";
  const labelCat = targetCat === "ALL" ? "All Issuances" : targetCat;
  const name = prompt(`Add a new column to "${labelCat}" (e.g. Petitioner, Respondent, Docket No., Effectivity Date):`);
  if (!name || !name.trim()) return;
  const cleanName = name.trim();
  const cols = getIssuanceColumnsFor(targetCat);
  if (cols.some((c) => c.label.toLowerCase() === cleanName.toLowerCase())) {
    return showToast(`Column "${cleanName}" already exists in ${labelCat}.`, true);
  }
  cols.push({
    key: makeCustomColumnKey(cleanName, cols),
    label: cleanName,
    builtin: false,
    type: "text",
  });
  const ok = await saveIssuanceColumnsFor(targetCat, cols, `Adding "${cleanName}" to ${labelCat}`);
  if (ok) showToast(`Added column "${cleanName}" to ${labelCat}!`);
};

window.quickDeleteIssuanceColumn = async function (catKey, colKey) {
  if (!currentUser || currentUser.role !== "ADMIN") return;
  const targetCat = catKey || selectedIssuanceCategory || "ALL";
  const labelCat = targetCat === "ALL" ? "All Issuances" : targetCat;
  const cols = getIssuanceColumnsFor(targetCat);
  if (cols.length <= 1) return showToast("At least one column must remain in the table.", true);
  const col = cols.find((c) => c.key === colKey);
  if (!col) return;
  if (!confirm(`Delete column "${col.label}" from "${labelCat}"?`)) return;
  const next = cols.filter((c) => c.key !== colKey);
  const ok = await saveIssuanceColumnsFor(targetCat, next, `Removing "${col.label}" from ${labelCat}`);
  if (ok) showToast(`Deleted column "${col.label}" from ${labelCat}.`);
};

function openIssuanceColumnsModal(catKey) {
  if (!currentUser || currentUser.role !== "ADMIN") return;
  managingIssColsCat = catKey || selectedIssuanceCategory || "ALL";
  editingIssColIdx = -1;
  renderIssuanceColumnsModal();
  openModal("modal-iss-columns");
}

function renderIssuanceColumnsModal() {
  const catSel = document.getElementById("iss-cols-cat-select");
  if (catSel) {
    const cats = getIssuanceCategories();
    catSel.innerHTML =
      `<option value="ALL">All Issuances (Combined View)</option>` +
      cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    if (managingIssColsCat !== "ALL" && !cats.includes(managingIssColsCat)) managingIssColsCat = "ALL";
    catSel.value = managingIssColsCat;
  }

  const labelCat = managingIssColsCat === "ALL" ? "All Issuances" : managingIssColsCat;
  const titleEl = document.getElementById("iss-cols-modal-title");
  if (titleEl) titleEl.textContent = `Manage Columns — ${labelCat}`;

  const cols = getIssuanceColumnsFor(managingIssColsCat);
  const presentKeys = new Set(cols.map((c) => c.key));
  const defaultColsForCat = getDefaultIssuanceColumnsFor(managingIssColsCat);
  const missingBuiltins = defaultColsForCat.filter((b) => !presentKeys.has(b.key));

  const restoreWrap = document.getElementById("iss-cols-restore-wrap");
  if (restoreWrap) {
    if (missingBuiltins.length) {
      restoreWrap.classList.remove("hidden");
      restoreWrap.innerHTML =
        `<span>Re-add removed default column:</span>` +
        missingBuiltins
          .map(
            (b) =>
              `<button type="button" class="iss-col-restore-chip" onclick="restoreBuiltinIssCol('${esc(b.key)}')">＋ ${esc(b.label)}</button>`
          )
          .join("");
    } else {
      restoreWrap.classList.add("hidden");
      restoreWrap.innerHTML = "";
    }
  }

  const tbody = document.getElementById("iss-cols-tbody");
  if (!tbody) return;
  const colTypeLabel = (c) => {
    if (c.type === "datetime") return "Date & Time";
    if (c.type === "date_range") return "Date Range (From–To)";
    if (c.type === "select_or_custom") return "Dropdown / Encode";
    if (c.type === "multi_names") return "Names (Up to 10)";
    if (c.type === "pdf") return "PDF File";
    if (c.type === "date") return "Date";
    return "Text";
  };
  tbody.innerHTML = cols
    .map((c, idx) => {
      const typeTag = c.builtin
        ? `<span class="badge">${colTypeLabel(c)}</span>`
        : `<span class="badge badge-completed">${colTypeLabel(c)}</span>`;
      if (editingIssColIdx === idx) {
        return `
        <tr>
          <td>${idx + 1}</td>
          <td><input type="text" id="edit-iss-col-input-${idx}" class="input" value="${esc(c.label)}" style="padding:6px 10px;font-size:13px;" /></td>
          <td>${typeTag}</td>
          <td class="actions-col">
            <button type="button" class="btn btn-sm btn-primary" onclick="saveIssColRename(${idx})">Save</button>
            <button type="button" class="btn btn-sm btn-outline" onclick="cancelIssColRename()">Cancel</button>
          </td>
        </tr>`;
      }
      return `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${esc(c.label)}</strong></td>
        <td>${typeTag}</td>
        <td class="actions-col">
          <button type="button" class="btn btn-sm btn-outline" onclick="moveIssCol(${idx}, -1)" ${idx === 0 ? "disabled" : ""} title="Move Left / Up">↑</button>
          <button type="button" class="btn btn-sm btn-outline" onclick="moveIssCol(${idx}, 1)" ${idx === cols.length - 1 ? "disabled" : ""} title="Move Right / Down">↓</button>
          <button type="button" class="btn btn-sm btn-outline" onclick="startIssColRename(${idx})">Rename</button>
          <button type="button" class="btn btn-sm btn-danger" onclick="deleteIssColByIdx(${idx})" ${cols.length <= 1 ? "disabled" : ""}>Delete</button>
        </td>
      </tr>`;
    })
    .join("");

  if (editingIssColIdx >= 0) {
    const inp = document.getElementById(`edit-iss-col-input-${editingIssColIdx}`);
    if (inp) {
      inp.focus();
      inp.select();
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); window.saveIssColRename(editingIssColIdx); }
        if (e.key === "Escape") window.cancelIssColRename();
      });
    }
  }
}

window.restoreBuiltinIssCol = async function (key) {
  const b = getDefaultIssuanceColumnsFor(managingIssColsCat).find((x) => x.key === key);
  if (!b) return;
  const cols = getIssuanceColumnsFor(managingIssColsCat);
  if (cols.some((c) => c.key === b.key)) return;
  cols.push({ ...b });
  const ok = await saveIssuanceColumnsFor(managingIssColsCat, cols, `Restoring "${b.label}"`);
  if (ok) showToast(`Re-added column "${b.label}".`);
};

window.moveIssCol = async function (idx, dir) {
  const cols = getIssuanceColumnsFor(managingIssColsCat);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= cols.length) return;
  const tmp = cols[idx];
  cols[idx] = cols[swapIdx];
  cols[swapIdx] = tmp;
  await saveIssuanceColumnsFor(managingIssColsCat, cols, "Reordering columns");
};

window.startIssColRename = function (idx) {
  editingIssColIdx = idx;
  renderIssuanceColumnsModal();
};

window.cancelIssColRename = function () {
  editingIssColIdx = -1;
  renderIssuanceColumnsModal();
};

window.saveIssColRename = async function (idx) {
  const inp = document.getElementById(`edit-iss-col-input-${idx}`);
  const nextLabel = (inp && inp.value || "").trim();
  if (!nextLabel) return showToast("Column name cannot be empty.", true);
  const cols = getIssuanceColumnsFor(managingIssColsCat);
  if (!cols[idx]) return;
  if (cols.some((c, i) => i !== idx && c.label.toLowerCase() === nextLabel.toLowerCase())) {
    return showToast(`Column "${nextLabel}" already exists.`, true);
  }
  cols[idx].label = nextLabel;
  editingIssColIdx = -1;
  const ok = await saveIssuanceColumnsFor(managingIssColsCat, cols, `Renaming column to "${nextLabel}"`);
  if (ok) showToast(`Renamed column to "${nextLabel}".`);
};

window.deleteIssColByIdx = async function (idx) {
  const cols = getIssuanceColumnsFor(managingIssColsCat);
  if (cols.length <= 1) return showToast("At least one column must remain.", true);
  const target = cols[idx];
  if (!target) return;
  const labelCat = managingIssColsCat === "ALL" ? "All Issuances" : managingIssColsCat;
  if (!confirm(`Delete column "${target.label}" from "${labelCat}"?`)) return;
  cols.splice(idx, 1);
  editingIssColIdx = -1;
  const ok = await saveIssuanceColumnsFor(managingIssColsCat, cols, `Deleting "${target.label}"`);
  if (ok) showToast(`Deleted column "${target.label}" from ${labelCat}.`);
};

function renderIssuanceCellHtml(r, col, activeCols = []) {
  const k = col.key;
  if (k === "issuanceNo") return `<td><span class="code-chip">${esc(r.issuanceNo)}</span></td>`;
  if (k === "category") return `<td><span class="badge">${getIssuanceIcon(r.category)} ${esc(r.category)}</span></td>`;
  if (k === "dateIssued") return `<td>${esc(formatDateShort(r.dateIssued) || r.dateIssued || "—")}</td>`;
  if (k === "originatingDivision") return `<td><span class="div-tag">${esc(r.originatingDivision || "—")}</span></td>`;
  if (k === "subject") {
    const hasPdfCol = activeCols.some((c) => c.key === "pdfFile");
    const hasRemarksCol = activeCols.some((c) => c.key === "remarks");
    const pdfPill = hasPdfCol ? "" : pdfBadgeHtml(r);
    const dockets = String(r.refNo || "").split(/\r?\n|;/).map((s) => s.trim()).filter(Boolean);
    const refText = dockets.length > 1
      ? `Case Nos. (${dockets.length}): ${dockets.slice(0, 3).map((d, i) => `${i + 1}. ${d}`).join(" • ")}${dockets.length > 3 ? ` (+${dockets.length - 3} more)` : ""}`
      : (dockets[0] ? `Ref: ${dockets[0]}` : "");
    const metaSub = [refText, !hasRemarksCol && r.remarks ? r.remarks : ""].filter(Boolean).join(" • ");
    return `<td><strong>${esc(r.subject)}</strong> ${pdfPill}${metaSub ? `<div class="sub-line">${esc(metaSub)}</div>` : ""}</td>`;
  }
  if (k === "issuedBy") return `<td>${esc(r.issuedBy || "—")}</td>`;
  if (k === "status") return `<td><span class="badge ${getIssStatusBadgeClass(r.status)}">${esc(r.status || "Issued / Effective")}</span></td>`;
  if (k === "remarks") return `<td>${esc(r.remarks || "—")}</td>`;
  if (k === "pdfFile") {
    const pill = pdfBadgeHtml(r);
    return `<td>${pill || `<span class="muted-text">—</span>`}</td>`;
  }
  const val = (r.customFields && r.customFields[k]) || "";
  if (col.type === "datetime" && val) return `<td>${esc(formatDateTimeDisplay(val) || val)}</td>`;
  if (col.type === "date_range" && val) {
    const parts = String(val).split(/\s+to\s+/i).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return `<td>${esc(formatDateShort(parts[0]) || parts[0])} <strong>to</strong> ${esc(formatDateShort(parts[1]) || parts[1])}</td>`;
    }
    return `<td>${esc(formatDateShort(parts[0]) || val)}</td>`;
  }
  if (col.type === "date" && val) return `<td>${esc(formatDateShort(val) || val)}</td>`;
  if (col.type === "select_or_custom" && val) return `<td><span class="badge">${esc(val)}</span></td>`;
  if (col.type === "multi_names" && val) {
    const names = String(val).split(/\r?\n|;/).map((s) => s.trim()).filter(Boolean);
    if (!names.length) return `<td>—</td>`;
    return `<td><div class="multi-names-cell">${names.map((n, i) => `<div class="multi-names-cell-item"><strong>${i + 1}.</strong> ${esc(n)}</div>`).join("")}</div></td>`;
  }
  return `<td>${esc(val || "—")}</td>`;
}

function getIssuanceCellPlainValue(r, col) {
  const k = col.key;
  if (k === "pdfFile") return (r.attachmentFile && (r.attachmentFile.driveUrl || r.attachmentFile.url || r.attachmentFile.name)) || "";
  if (col.builtin) return r[k] ?? "";
  const v = (r.customFields && r.customFields[k]) || "";
  if (col.type === "multi_names") {
    return String(v).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).join("; ");
  }
  return v;
}

const ISS_PROVINCE_PRESETS = ["Biliran", "Eastern Samar", "Leyte", "Northern Samar", "Samar", "Southern Leyte"];

function setIssProvinceInModal(val = "") {
  const sel = document.getElementById("iss-province-select");
  const oth = document.getElementById("iss-province-other");
  if (!sel || !oth) return;
  const clean = String(val || "").trim();
  if (!clean || ISS_PROVINCE_PRESETS.includes(clean)) {
    sel.value = clean;
    oth.value = "";
    oth.classList.add("hidden");
  } else {
    sel.value = "__CUSTOM__";
    oth.value = clean;
    oth.classList.remove("hidden");
  }
}

function readIssProvinceFromModal() {
  const sel = document.getElementById("iss-province-select");
  const oth = document.getElementById("iss-province-other");
  if (!sel) return "";
  if (sel.value === "__CUSTOM__") return (oth && oth.value || "").trim();
  return String(sel.value || "").trim();
}

function renderIssDocketsEditor(rawVal = "") {
  const grid = document.getElementById("iss-dockets-grid");
  const addBtn = document.getElementById("btn-iss-docket-add");
  const cntEl = document.getElementById("iss-dockets-count");
  if (!grid) return;

  const MAX_DOCKETS = 50;
  const parsed = String(rawVal || "")
    .split(/\r?\n|;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_DOCKETS);
  const initialList = parsed.length ? parsed : [""];

  const syncRows = () => {
    const rows = [...grid.querySelectorAll(".multi-name-row")];
    rows.forEach((row, i) => {
      const num = row.querySelector(".multi-name-num");
      const inp = row.querySelector(".iss-docket-input");
      const rm = row.querySelector(".multi-name-rm");
      if (num) num.textContent = String(i + 1);
      if (inp) inp.placeholder = `Case / Docket No. ${i + 1}...`;
      if (rm) {
        rm.title = `Remove Case No. ${i + 1}`;
        rm.disabled = rows.length <= 1;
        rm.style.opacity = rows.length <= 1 ? "0.4" : "1";
      }
    });
    if (cntEl) cntEl.textContent = `${rows.length} / ${MAX_DOCKETS}`;
    if (addBtn) addBtn.disabled = rows.length >= MAX_DOCKETS;
  };

  const addDocketRow = (val = "", focusNew = true) => {
    const currentCount = grid.querySelectorAll(".multi-name-row").length;
    if (currentCount >= MAX_DOCKETS) {
      if (focusNew) showToast(`Maximum of ${MAX_DOCKETS} Case / Docket Numbers reached.`, true);
      return null;
    }
    const row = document.createElement("div");
    row.className = "multi-name-row";
    row.innerHTML = `
      <span class="multi-name-num">${currentCount + 1}</span>
      <input type="text" class="input iss-docket-input" value="${esc(val)}" placeholder="Case / Docket No. ${currentCount + 1}..." />
      <button type="button" class="multi-name-rm" title="Remove Case No. ${currentCount + 1}">✕</button>
    `;
    grid.appendChild(row);
    bindRowEvents(row);
    syncRows();
    if (focusNew) {
      const inp = row.querySelector(".iss-docket-input");
      inp.focus();
      row.scrollIntoView({ block: "nearest" });
    }
    return row;
  };

  const bindRowEvents = (row) => {
    const inp = row.querySelector(".iss-docket-input");
    const rm = row.querySelector(".multi-name-rm");
    if (inp) {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          const rows = [...grid.querySelectorAll(".multi-name-row")];
          const idx = rows.indexOf(row);
          if (idx >= 0 && idx < rows.length - 1) {
            rows[idx + 1].querySelector(".iss-docket-input").focus();
          } else if (rows.length < MAX_DOCKETS) {
            addDocketRow("", true);
          }
        }
      });
      // Smart multi-line paste: pasting multiple docket numbers fills consecutive rows up to 50!
      inp.addEventListener("paste", (e) => {
        const text = (e.clipboardData && e.clipboardData.getData("text")) || "";
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (lines.length > 1) {
          e.preventDefault();
          inp.value = lines[0];
          for (let i = 1; i < lines.length; i++) {
            if (grid.querySelectorAll(".multi-name-row").length >= MAX_DOCKETS) break;
            addDocketRow(lines[i], false);
          }
          syncRows();
        }
      });
    }
    if (rm) {
      rm.addEventListener("click", () => {
        if (grid.querySelectorAll(".multi-name-row").length <= 1) {
          if (inp) inp.value = "";
          return;
        }
        row.remove();
        syncRows();
      });
    }
  };

  grid.innerHTML = "";
  initialList.forEach((v) => addDocketRow(v, false));
  syncRows();

  if (addBtn) {
    addBtn.onclick = () => addDocketRow("", true);
  }
}

function readIssDocketsFromModal() {
  const grid = document.getElementById("iss-dockets-grid");
  if (!grid) return "";
  return [...grid.querySelectorAll(".iss-docket-input")]
    .map((inp) => inp.value.trim())
    .filter(Boolean)
    .slice(0, 50)
    .join("\n");
}

function readIssCustomFieldsFromModal() {
  const customFields = {};
  const provVal = readIssProvinceFromModal();
  if (provVal !== undefined) customFields.col_province = provVal;
  const wrap = document.getElementById("iss-custom-fields-wrap");
  if (!wrap) return customFields;
  wrap.querySelectorAll("[data-iss-custom-key]").forEach((el) => {
    const k = el.getAttribute("data-iss-custom-key");
    const cType = el.getAttribute("data-iss-custom-type") || "text";
    if (cType === "multi_names") {
      const names = [...el.querySelectorAll(".multi-name-input")]
        .map((inp) => inp.value.trim())
        .filter(Boolean)
        .slice(0, 10);
      customFields[k] = names.join("\n");
    } else if (cType === "select_or_custom") {
      if (el.value === "__CUSTOM__") {
        const custInp = wrap.querySelector(`[data-iss-custom-other="${CSS.escape(k)}"]`);
        customFields[k] = (custInp && custInp.value || "").trim();
      } else {
        customFields[k] = String(el.value || "").trim();
      }
    } else if (cType === "date_range") {
      const fromInp = el.querySelector("[data-dr-from]");
      const toInp = el.querySelector("[data-dr-to]");
      const f = (fromInp && fromInp.value || "").trim();
      const t = (toInp && toInp.value || "").trim();
      customFields[k] = f && t ? `${f} to ${t}` : (f || t || "");
    } else if (cType === "datetime") {
      customFields[k] = el.value ? fromDatetimeLocalValue(el.value) : "";
    } else {
      customFields[k] = String(el.value || "").trim();
    }
  });
  return customFields;
}

function updateIssuanceModalLabels(category) {
  const catLower = String(category || "").trim().toLowerCase();
  const isCaseLike = ["ali case", "order", "finality", "rcluppi", "resolution", "erratum", "writ of execution", "interlocutory", "memo", "notice"].includes(catLower);
  const isMemoOrNotice = catLower === "memo" || catLower === "notice";
  const setTxt = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setTxt("iss-lbl-no", isCaseLike ? "Control Number *" : "Issuance No. *");
  setTxt("iss-lbl-date", isCaseLike ? "Date of Document *" : "Date Issued *");
  setTxt("iss-lbl-by", isCaseLike ? "Signatory" : "Issued By / Signatory");
  setTxt("iss-lbl-subject", isCaseLike ? "Subject *" : "Subject / Title *");
  setTxt("iss-lbl-remarks", isCaseLike ? "Remarks / Distribution Notes" : "Remarks / Distribution Notes");
  const docketsWrap = document.getElementById("iss-dockets-field-wrap");
  const provWrap = document.getElementById("iss-province-field-wrap");
  if (docketsWrap) docketsWrap.classList.toggle("hidden", isMemoOrNotice);
  if (provWrap) provWrap.classList.toggle("hidden", isMemoOrNotice);
}

function renderIssCustomFieldsInModal(category, valuesOverride = null) {
  updateIssuanceModalLabels(category);
  const wrap = document.getElementById("iss-custom-fields-wrap");
  if (!wrap) return;
  const existingVals = valuesOverride !== null ? valuesOverride : readIssCustomFieldsFromModal();
  if (valuesOverride !== null) {
    setIssProvinceInModal(existingVals.col_province || "");
  }
  // Exclude col_province here since Province is rendered right beside Case No. / Reference No.
  const cols = getIssuanceColumnsFor(category).filter((c) => !c.builtin && c.key !== "col_province");
  if (!cols.length) {
    wrap.classList.add("hidden");
    wrap.innerHTML = "";
    return;
  }
  wrap.classList.remove("hidden");
  wrap.innerHTML = `
    <div class="iss-custom-fields-title">📋 ${esc(category)} Fields</div>
    <div class="form-grid-3">
      ${cols
        .map((c) => {
          let val = existingVals[c.key] ?? "";
          if (editingIssuanceIsNew && !val && c.key === "col_released_by" && currentUser && currentUser.fullName) {
            val = currentUser.fullName;
          }
          if (c.type === "multi_names") {
            const parsedNames = String(val)
              .split(/\r?\n|;/)
              .map((s) => s.trim())
              .filter(Boolean)
              .slice(0, 10);
            const initialList = parsedNames.length ? parsedNames : [""];
            return `
            <div class="field col-span-3">
              <div class="multi-names-box" data-iss-custom-key="${esc(c.key)}" data-iss-custom-type="multi_names">
                <div class="multi-names-head">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <span style="font-weight:700;color:var(--dar-dark);">${esc(c.label)}</span>
                    <span class="multi-names-count" data-mn-count="${esc(c.key)}">${initialList.length} / 10</span>
                    <span class="muted-text" style="font-size:11.5px;">(Press Enter or click + Add Person — up to 10 names)</span>
                  </div>
                  <div style="display:flex;gap:6px;">
                    <button type="button" class="btn btn-sm btn-primary" data-mn-add="${esc(c.key)}" ${initialList.length >= 10 ? "disabled" : ""}>+ Add Person</button>
                  </div>
                </div>
                <div class="multi-names-grid" data-mn-grid="${esc(c.key)}">
                  ${initialList
                    .map(
                      (nm, idx) => `
                    <div class="multi-name-row">
                      <span class="multi-name-num">${idx + 1}</span>
                      <input type="text" class="input multi-name-input" value="${esc(nm)}" placeholder="Person ${idx + 1} full name..." />
                      <button type="button" class="multi-name-rm" title="Remove person ${idx + 1}">✕</button>
                    </div>`
                    )
                    .join("")}
                </div>
              </div>
            </div>`;
          }
          if (c.type === "date_range") {
            const parts = String(val || "").split(/\s+to\s+/i).map((s) => s.trim());
            const fromVal = /^\d{4}-\d{2}-\d{2}$/.test(parts[0] || "") ? parts[0] : "";
            const toVal = /^\d{4}-\d{2}-\d{2}$/.test(parts[1] || "") ? parts[1] : "";
            return `
            <div class="field col-span-2">
              <span>${esc(c.label)} <small class="muted-text">(Single date or From – To date range)</small></span>
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;" data-iss-custom-key="${esc(c.key)}" data-iss-custom-type="date_range">
                <input type="date" class="input" style="flex:1;min-width:140px;" data-dr-from value="${esc(fromVal)}" title="Start Date" />
                <span style="font-weight:700;color:var(--muted);font-size:12.5px;">to</span>
                <input type="date" class="input" style="flex:1;min-width:140px;" data-dr-to value="${esc(toVal)}" title="End Date (optional for single-day activity)" />
              </div>
            </div>`;
          }
          if (c.type === "datetime") {
            const dtVal = toDatetimeLocalValue(val);
            return `
            <div class="field">
              <span>${esc(c.label)}</span>
              <div style="display:flex;gap:6px;align-items:center;">
                <input type="datetime-local" class="input" style="flex:1;min-width:0;" data-iss-custom-key="${esc(c.key)}" data-iss-custom-type="datetime" value="${esc(dtVal)}" />
                <button type="button" class="btn btn-sm btn-outline" data-stamp-iss-dt="${esc(c.key)}" title="Stamp current date &amp; time" style="white-space:nowrap;">⏱️ Now</button>
              </div>
            </div>`;
          }
          if (c.type === "select_or_custom") {
            const opts = Array.isArray(c.options) && c.options.length ? c.options : ["Order", "Certificate of Finality"];
            const isPreset = !val || opts.includes(val);
            const selVal = isPreset ? val : "__CUSTOM__";
            return `
            <div class="field">
              <span>${esc(c.label)}</span>
              <select class="select" data-iss-custom-key="${esc(c.key)}" data-iss-custom-type="select_or_custom">
                <option value="">— Select ${esc(c.label)} —</option>
                ${opts.map((o) => `<option value="${esc(o)}" ${selVal === o ? "selected" : ""}>${esc(o)}</option>`).join("")}
                <option value="__CUSTOM__" ${selVal === "__CUSTOM__" ? "selected" : ""}>✏️ Other (Encode Custom)...</option>
              </select>
              <input type="text" class="input ${selVal === "__CUSTOM__" ? "" : "hidden"}" style="margin-top:6px;" data-iss-custom-other="${esc(c.key)}" value="${esc(isPreset ? "" : val)}" placeholder="Encode custom ${esc(c.label)}..." />
            </div>`;
          }
          const inputType = c.type === "date" ? "date" : "text";
          return `
          <label class="field">
            <span>${esc(c.label)}</span>
            <input type="${inputType}" class="input" data-iss-custom-key="${esc(c.key)}" data-iss-custom-type="${inputType}" value="${esc(val)}" placeholder="Enter ${esc(c.label)}..." />
          </label>`;
        })
        .join("")}
    </div>
  `;

  // Wire Multi-Names (up to 10 persons) add/remove/Enter handlers
  wrap.querySelectorAll('.multi-names-box[data-iss-custom-type="multi_names"]').forEach((box) => {
    const k = box.getAttribute("data-iss-custom-key");
    const grid = box.querySelector(`[data-mn-grid="${CSS.escape(k)}"]`);
    const addBtn = box.querySelector(`[data-mn-add="${CSS.escape(k)}"]`);
    const cntEl = box.querySelector(`[data-mn-count="${CSS.escape(k)}"]`);

    const syncRows = () => {
      const rows = [...grid.querySelectorAll(".multi-name-row")];
      rows.forEach((row, i) => {
        const num = row.querySelector(".multi-name-num");
        const inp = row.querySelector(".multi-name-input");
        const rm = row.querySelector(".multi-name-rm");
        if (num) num.textContent = String(i + 1);
        if (inp) inp.placeholder = `Person ${i + 1} full name...`;
        if (rm) {
          rm.title = `Remove person ${i + 1}`;
          rm.disabled = rows.length <= 1;
          rm.style.opacity = rows.length <= 1 ? "0.4" : "1";
        }
      });
      if (cntEl) cntEl.textContent = `${rows.length} / 10`;
      if (addBtn) addBtn.disabled = rows.length >= 10;
    };

    const addPersonRow = (focusNew = true) => {
      const currentCount = grid.querySelectorAll(".multi-name-row").length;
      if (currentCount >= 10) return showToast("Maximum of 10 Concerned Parties reached.", true);
      const row = document.createElement("div");
      row.className = "multi-name-row";
      row.innerHTML = `
        <span class="multi-name-num">${currentCount + 1}</span>
        <input type="text" class="input multi-name-input" value="" placeholder="Person ${currentCount + 1} full name..." />
        <button type="button" class="multi-name-rm" title="Remove person ${currentCount + 1}">✕</button>
      `;
      grid.appendChild(row);
      bindRowEvents(row);
      syncRows();
      if (focusNew) row.querySelector(".multi-name-input").focus();
    };

    const bindRowEvents = (row) => {
      const inp = row.querySelector(".multi-name-input");
      const rm = row.querySelector(".multi-name-rm");
      if (inp) {
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const rows = [...grid.querySelectorAll(".multi-name-row")];
            const idx = rows.indexOf(row);
            if (idx >= 0 && idx < rows.length - 1) {
              rows[idx + 1].querySelector(".multi-name-input").focus();
            } else if (rows.length < 10) {
              addPersonRow(true);
            }
          }
        });
      }
      if (rm) {
        rm.addEventListener("click", () => {
          if (grid.querySelectorAll(".multi-name-row").length <= 1) {
            if (inp) inp.value = "";
            return;
          }
          row.remove();
          syncRows();
        });
      }
    };

    grid.querySelectorAll(".multi-name-row").forEach(bindRowEvents);
    syncRows();
    if (addBtn) addBtn.addEventListener("click", () => addPersonRow(true));
  });

  wrap.querySelectorAll('select[data-iss-custom-type="select_or_custom"]').forEach((sel) => {
    sel.addEventListener("change", () => {
      const k = sel.getAttribute("data-iss-custom-key");
      const otherInp = wrap.querySelector(`[data-iss-custom-other="${CSS.escape(k)}"]`);
      if (!otherInp) return;
      const showOther = sel.value === "__CUSTOM__";
      otherInp.classList.toggle("hidden", !showOther);
      if (showOther) otherInp.focus();
    });
  });

  wrap.querySelectorAll("[data-stamp-iss-dt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.getAttribute("data-stamp-iss-dt");
      const inp = wrap.querySelector(`[data-iss-custom-key="${CSS.escape(k)}"]`);
      if (inp) inp.value = nowDateTimeLocal();
    });
  });
}

function getFilteredIssuances() {
  const all = state.issuances || [];
  const q = (document.getElementById("iss-search")?.value || "").trim().toLowerCase();
  const yr = document.getElementById("iss-filter-year")?.value || "ALL";
  const cat = selectedIssuanceCategory || "ALL";
  const list = all.filter((r) => {
    if (cat !== "ALL" && r.category !== cat) return false;
    if (yr !== "ALL" && extractDocYear(r.dateIssued, r.issuanceNo) !== yr) return false;
    if (q) {
      const customVals = r.customFields && typeof r.customFields === "object" ? Object.values(r.customFields) : [];
      const hay = [r.issuanceNo, r.category, r.subject, r.refNo, r.originatingDivision, r.issuedBy, r.remarks, r.status, ...customVals]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    // Apply per-column header dropdown filters
    for (const [col, f] of Object.entries(hdrFilters.iss || {})) {
      if (!f) continue;
      if (f.query && !getColSearchHaystack("iss", col, r).toLowerCase().includes(f.query.toLowerCase())) {
        return false;
      }
      if (f.selected !== null && !f.selected.has(getColDisplayValue("iss", col, r))) {
        return false;
      }
    }
    return true;
  });

  const { key, dir } = sortState.iss || { key: "", dir: 1 };
  if (key) {
    list.sort((a, b) =>
      getColDisplayValue("iss", key, a).localeCompare(getColDisplayValue("iss", key, b), undefined, {
        numeric: true,
        sensitivity: "base",
      }) * dir
    );
  }
  return list;
}

function getIssStatusBadgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("issued") || s.includes("disseminated")) return "badge-completed";
  if (s.includes("signature")) return "badge-due";
  if (s.includes("superseded") || s.includes("archived")) return "badge-archived";
  return "badge-progress";
}

function renderIssuancesView() {
  const all = state.issuances || [];
  const cats = getIssuanceCategories();
  const isAdmin = currentUser && currentUser.role === "ADMIN";

  // Populate sub-category filter dropdown
  const catSel = document.getElementById("iss-filter-cat");
  if (catSel) {
    catSel.innerHTML =
      `<option value="ALL">All Sub-Categories</option>` +
      cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    catSel.value = cats.includes(selectedIssuanceCategory) ? selectedIssuanceCategory : "ALL";
  }

  // Summary cards (All + each sub-category)
  const cardsWrap = document.getElementById("iss-summary-cards");
  if (cardsWrap) {
    const cardsHtml = [
      `<div class="inc-stat-card ${selectedIssuanceCategory === "ALL" ? "active" : ""}" data-iss-card="ALL">
         <div class="inc-stat-label">📚 All Issuances</div>
         <div class="inc-stat-val">${all.length}</div>
         <div class="inc-stat-sub">Total logged issuances</div>
       </div>`,
      ...cats.map((cat) => {
        const cnt = all.filter((r) => r.category === cat).length;
        const isAct = selectedIssuanceCategory === cat;
        return `<div class="inc-stat-card ${isAct ? "active" : ""}" data-iss-card="${esc(cat)}">
          <div class="inc-stat-label">${getIssuanceIcon(cat)} ${esc(cat)}</div>
          <div class="inc-stat-val">${cnt}</div>
          <div class="inc-stat-sub">Click to filter ${esc(cat)}</div>
        </div>`;
      }),
    ].join("");
    cardsWrap.innerHTML = cardsHtml;
    cardsWrap.querySelectorAll(".inc-stat-card[data-iss-card]").forEach((card) => {
      card.addEventListener("click", () => {
        selectedIssuanceCategory = card.getAttribute("data-iss-card") || "ALL";
        renderIssuancesView();
        renderIssuanceSidebar();
      });
    });
  }

  // Heading & Auto-Sync status badge
  const heading = document.getElementById("iss-view-heading");
  if (heading) {
    heading.textContent =
      selectedIssuanceCategory === "ALL"
        ? "Issuances Log — All Categories"
        : `Issuances Log — ${selectedIssuanceCategory}`;
  }
  const canEdit = canEditIssuanceOrMailing();
  const syncLine = document.getElementById("iss-sync-status-line");
  if (syncLine) {
    if (!canEdit) {
      const divLbl = (currentUser && currentUser.division) ? ` (${esc(currentUser.division)})` : "";
      syncLine.innerHTML = `👁️ <strong>View-Only Access${divLbl}</strong> — Showing only Issuances addressed to your office in Recipient (To).`;
    } else {
      const ss = state.meta && state.meta.issuanceSheetSync;
      if (ss && ss.lastSyncedAt && !ss.lastError) {
        syncLine.innerHTML = `✅ <strong>Auto-Sync Active</strong> — Last synced to Google Sheet (${esc((ss.syncedTabs || []).join(", ") || "Issuance tabs")}) on ${esc(ss.lastSyncedAt)}.`;
      } else if (ss && ss.lastError) {
        syncLine.innerHTML = `⏳ <strong>Auto-Sync Waiting:</strong> ${esc(ss.lastError)} — retries automatically every 2 min.`;
      } else {
        syncLine.innerHTML = `☁️ <strong>Auto-Sync Active</strong> — Automatically syncs each Issuance sub-category to its own Google Sheet tab.`;
      }
    }
  }

  // Dynamic Columns for the selected Issuance sub-category
  const activeCatKey = selectedIssuanceCategory || "ALL";
  const cols = getIssuanceColumnsFor(activeCatKey);

  const thead = document.getElementById("issuances-thead");
  if (thead) {
    const catEscAttr = esc(activeCatKey).replace(/'/g, "&#39;");
    thead.innerHTML = `
      <tr>
        ${cols
          .map((col) => {
            return `<th><div class="th-filter-wrap"><span data-hdr-label>${esc(col.label)}</span><button type="button" class="th-drop-btn" data-hdr-filter="iss" data-col="${esc(col.key)}" title="Sort &amp; Filter ${esc(col.label)}">▾</button></div></th>`;
          })
          .join("")}
        <th class="actions-col">
          <span>Actions</span>
          ${isAdmin ? `<button type="button" class="iss-th-add-btn" title="Admin: Add a new column to this Issuance" onclick="quickAddIssuanceColumn('${catEscAttr}')">+ Col</button>` : ""}
        </th>
      </tr>`;
    thead.querySelectorAll('.th-drop-btn[data-hdr-filter="iss"]').forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        openHeaderPopover(btn, "iss", btn.getAttribute("data-col"));
      });
    });
    updateHeaderDropIndicators("iss");
  }

  // Table rows
  const tbody = document.getElementById("issuances-tbody");
  if (!tbody) return;
  const rows = getFilteredIssuances();
  const canDelete = canEditIssuanceOrMailing();
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" style="text-align:center;padding:28px;color:#5a6a62;">No issuances found${selectedIssuanceCategory !== "ALL" ? ` under <strong>${esc(selectedIssuanceCategory)}</strong>` : ""}${canEdit ? `. Click <strong>+ New Issuance</strong> above to log one.` : "."}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((r) => {
      return `
      <tr>
        ${cols.map((col) => renderIssuanceCellHtml(r, col, cols)).join("")}
        <td class="actions-col">
          <button type="button" class="btn btn-sm btn-outline" onclick="openEditIssuance('${esc(r.id)}')">${canEdit ? "View / Edit" : "👁️ View"}</button>
          ${canDelete ? `<button type="button" class="btn btn-sm btn-danger" onclick="deleteIssuanceRecord('${esc(r.id)}')">Delete</button>` : ""}
        </td>
      </tr>`;
    })
    .join("");
}

function populateIssuanceModalSelects(catVal = "", issuedByVal = "") {
  const catSel = document.getElementById("iss-category-select");
  if (catSel) {
    const cats = [...getIssuanceCategories()];
    if (catVal && !cats.includes(catVal)) cats.push(catVal);
    catSel.innerHTML = cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    catSel.value = catVal || cats[0] || "Memo";
  }
  const bySel = document.getElementById("iss-issued-by");
  if (bySel) {
    const sigs = [...getPreparedSignatoriesList()];
    const cur = String(issuedByVal || "").trim();
    if (cur && !sigs.includes(cur)) sigs.push(cur);
    bySel.innerHTML =
      `<option value="">— Select Issued By / Signatory —</option>` +
      sigs.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("");
    bySel.value = cur;
  }
}

function renderIssPdfAttachmentBar() {
  const bar = document.getElementById("iss-pdf-viewer-bar");
  const statusEl = document.getElementById("iss-pdf-status");
  if (!bar || !statusEl) return;
  if (currentIssAttachmentFile && (currentIssAttachmentFile.url || currentIssAttachmentFile.localUrl)) {
    const syncTag = currentIssAttachmentFile.driveSynced
      ? `<span class="badge badge-completed" style="margin-left:6px;">☁️ Saved in Google Drive</span>`
      : `<span class="badge badge-due" style="margin-left:6px;" title="${esc(currentIssAttachmentFile.driveNote || "Local copy only")}">💻 Local Copy</span>`;
    statusEl.innerHTML = `✅ <strong>Issuance PDF Uploaded</strong> (${esc(formatFileSize(currentIssAttachmentFile.size))}) ${syncTag}`;
    bar.classList.remove("hidden");
    const openHref = currentIssAttachmentFile.driveUrl || currentIssAttachmentFile.url || currentIssAttachmentFile.localUrl;
    const embedSrc = getPdfEmbedUrl(currentIssAttachmentFile);
    bar.innerHTML = `
      <div class="pdf-viewer-bar">
        <div title="${esc(currentIssAttachmentFile.name)}">
          <strong>📄 Scanned Issuance PDF</strong>
          <span class="muted-text">(${esc(formatFileSize(currentIssAttachmentFile.size))} • Uploaded by ${esc(currentIssAttachmentFile.uploadedBy || "User")})</span>
          ${syncTag}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm btn-outline" id="btn-toggle-iss-pdf-preview">${issPdfPreviewExpanded ? "🙈 Hide PDF Preview" : "👁️ Show PDF Preview"}</button>
          <a class="btn btn-sm btn-primary" href="${esc(openHref)}" target="_blank" rel="noopener">${currentIssAttachmentFile.driveUrl ? "Open in Google Drive ↗" : "Open Full Tab ↗"}</a>
          ${currentIssAttachmentFile.driveUrl && currentIssAttachmentFile.localUrl ? `<a class="btn btn-sm btn-outline" href="${esc(currentIssAttachmentFile.localUrl)}" target="_blank" rel="noopener">Local Copy</a>` : ""}
          ${canEditIssuanceOrMailing() ? `<button type="button" class="btn btn-sm btn-danger" id="btn-remove-iss-pdf">✕ Remove</button>` : ""}
        </div>
      </div>
      <div class="pdf-embed-wrap ${issPdfPreviewExpanded ? "" : "collapsed"}" id="iss-pdf-embed-wrap">
        <iframe class="pdf-embed-frame" src="${esc(embedSrc)}" title="Scanned Issuance PDF Preview"></iframe>
      </div>
    `;
    const toggleBtn = document.getElementById("btn-toggle-iss-pdf-preview");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        issPdfPreviewExpanded = !issPdfPreviewExpanded;
        const wrap = document.getElementById("iss-pdf-embed-wrap");
        if (wrap) wrap.classList.toggle("collapsed", !issPdfPreviewExpanded);
        toggleBtn.textContent = issPdfPreviewExpanded ? "🙈 Hide PDF Preview" : "👁️ Show PDF Preview";
      });
    }
    const rmBtn = document.getElementById("btn-remove-iss-pdf");
    if (rmBtn) {
      rmBtn.addEventListener("click", () => {
        currentIssAttachmentFile = null;
        document.getElementById("iss-pdf-input").value = "";
        renderIssPdfAttachmentBar();
        renderIssRecipientChipsAndSummary();
      });
    }
  } else {
    statusEl.textContent = "No scanned PDF uploaded yet";
    bar.classList.add("hidden");
    bar.innerHTML = "";
  }
}

function renderIssRecipientPicker() {
  const listEl = document.getElementById("iss-recip-list");
  const addCustomBtn = document.getElementById("btn-iss-recip-add-custom");
  if (!listEl) return;
  const rawSearch = (document.getElementById("iss-recip-search")?.value || "").trim();
  const q = rawSearch.toLowerCase();
  const emailMap = (state.meta && state.meta.officeEmails) || {};
  const { roDivs, darpos, all } = getAllFurnishedCopyOptions();

  if (addCustomBtn) {
    const exactExists = all.some((o) => o.code.toLowerCase() === q);
    addCustomBtn.classList.toggle("hidden", !rawSearch || exactExists);
  }

  const renderGroup = (title, items) => {
    const filtered = items.filter((o) => !q || o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q));
    if (!filtered.length) return "";
    return `
      <div class="multi-drop-group">${esc(title)}</div>
      ${filtered
        .map((o) => {
          const checked = selectedIssRecipients.has(o.code);
          const email = String(emailMap[o.code] || "").trim();
          const emailBadge = email
            ? `<span class="multi-drop-item-email" title="${esc(email)}">📧 ${esc(email)}</span>`
            : `<span class="multi-drop-item-email missing">No admin email set</span>`;
          return `
          <label class="multi-drop-item">
            <span class="multi-drop-item-left">
              <input type="checkbox" data-iss-recip-code="${esc(o.code)}" ${checked ? "checked" : ""} />
              <span><strong>${esc(o.code)}</strong></span>
            </span>
            ${emailBadge}
          </label>`;
        })
        .join("")}
    `;
  };

  listEl.innerHTML =
    renderGroup("Regional Office VIII Divisions & STO Sections", roDivs) +
    renderGroup("DARPO Provincial Offices (Region VIII)", darpos) ||
    `<div style="padding:12px;text-align:center;font-size:12px;color:#5a6a62;">No matching office — click <strong>+ Add</strong> above to include "${esc(rawSearch)}".</div>`;

  listEl.querySelectorAll("input[data-iss-recip-code]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const code = cb.getAttribute("data-iss-recip-code");
      if (cb.checked) selectedIssRecipients.add(code);
      else selectedIssRecipients.delete(code);
      renderIssRecipientChipsAndSummary();
    });
  });
}

function renderIssRecipientChipsAndSummary(lastDispatchLog = null) {
  const triggerText = document.getElementById("iss-recip-trigger-text");
  const chipsEl = document.getElementById("iss-recip-chips");
  const statusBox = document.getElementById("iss-email-status-box");
  const list = [...selectedIssRecipients];
  const emailMap = (state.meta && state.meta.officeEmails) || {};
  const sender = (state.meta && state.meta.senderEmail) || "darrec8@gmail.com";

  if (triggerText) {
    triggerText.textContent = list.length
      ? `${list.length} recipient${list.length > 1 ? "s" : ""} selected`
      : "Select RO VIII Sections & DARPO Offices...";
  }
  if (chipsEl) {
    const canEditRecip = canEditIssuanceOrMailing();
    chipsEl.innerHTML = list
      .map((code) => {
        const isDirect = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(code);
        const em = isDirect ? code : String(emailMap[code] || "").trim();
        return `<span class="fc-chip ${em ? "" : "no-email"}" title="${em ? "Email: " + esc(em) : "No Admin email configured"}">${esc(code)}${canEditRecip ? `<button type="button" data-rm-iss-recip="${esc(code)}" aria-label="Remove ${esc(code)}">×</button>` : ""}</span>`;
      })
      .join("");
    if (canEditRecip) {
      chipsEl.querySelectorAll("button[data-rm-iss-recip]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedIssRecipients.delete(btn.getAttribute("data-rm-iss-recip"));
          renderIssRecipientPicker();
          renderIssRecipientChipsAndSummary();
        });
      });
    }
  }
  if (statusBox) {
    if (!list.length) {
      statusBox.innerHTML = `Select Recipient (To) offices above and upload a scanned PDF to email them from <code>${esc(sender)}</code>.`;
      return;
    }
    const withEmail = [];
    const noEmail = [];
    list.forEach((c) => {
      const isDirect = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c);
      const em = isDirect ? c : String(emailMap[c] || "").trim();
      if (em) withEmail.push(`${c} (${em})`);
      else noEmail.push(c);
    });
    const pdfLine = currentIssAttachmentFile
      ? `📄 <strong>PDF ready to email:</strong> ${esc(currentIssAttachmentFile.name)}`
      : `ℹ️ Optional: Upload a scanned Issuance PDF above to attach it to the email.`;
    const sentLine = lastDispatchLog && lastDispatchLog.sent
      ? `<div style="margin-top:6px;color:#1b5e20;">✅ <strong>Last Emailed:</strong> ${esc(lastDispatchLog.sentAt)} via ${esc(lastDispatchLog.via || sender)} to ${lastDispatchLog.recipients.length} recipient(s).</div>`
      : lastDispatchLog && lastDispatchLog.error
      ? `<div style="margin-top:6px;color:#b7410e;">⚠️ ${esc(lastDispatchLog.error)} ${lastDispatchLog.mailtoUrl ? `<a href="${esc(lastDispatchLog.mailtoUrl)}" target="_blank" rel="noopener">Open Email Client ↗</a>` : ""}</div>`
      : "";
    statusBox.innerHTML = `
      <div>📧 <strong>From:</strong> <code>${esc(sender)}</code> → <strong>${withEmail.length}</strong> recipient(s) ready${noEmail.length ? ` • <span style="color:#b7410e;">No admin email set for: ${esc(noEmail.join(", "))}</span>` : ""}</div>
      <div style="margin-top:4px;">${pdfLine}</div>
      ${sentLine}
    `;
  }
}

async function refreshNewIssuanceNo() {
  if (!editingIssuanceIsNew) return;
  const form = document.getElementById("form-issuance");
  if (!form) return;
  const cat = form.elements.category.value || getIssuanceCategories()[0] || "Memo";
  const dt = form.elements.dateIssued.value || todayISO();
  const yr = String((form.elements.issuanceYear && form.elements.issuanceYear.value) || "").trim();
  form.elements.issuanceNo.value = await fetchNextNumber("issuance", dt, cat, /^\d{4}$/.test(yr) ? yr : "");
}

function applyIssuanceModalReadOnly(isReadOnly) {
  const form = document.getElementById("form-issuance");
  if (!form) return;
  const banner = document.getElementById("iss-readonly-banner");
  if (banner) banner.classList.toggle("hidden", !isReadOnly);

  form.querySelectorAll("input, select, textarea").forEach((el) => {
    if (el.type === "hidden") return;
    el.disabled = isReadOnly;
  });

  ["btn-iss-docket-add", "btn-pick-iss-pdf", "btn-send-iss-email", "btn-save-issuance"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("hidden", isReadOnly);
  });
  const recipDrop = document.getElementById("iss-recip-dropdown");
  if (recipDrop) recipDrop.classList.toggle("hidden", isReadOnly);

  form.querySelectorAll(".multi-name-rm, [data-stamp-iss-dt], [data-multi-add]").forEach((btn) => {
    btn.classList.toggle("hidden", isReadOnly);
  });

  const cancelBtn = document.getElementById("btn-cancel-issuance");
  if (cancelBtn) cancelBtn.textContent = isReadOnly ? "Close" : "Cancel";
}

async function openNewIssuance() {
  if (!canEditIssuanceOrMailing()) {
    return showToast("View-only access: Only Records Section or System Admin can encode Issuances.", true);
  }
  editingIssuanceIsNew = true;
  currentIssAttachmentFile = null;
  issPdfPreviewExpanded = true;
  selectedIssRecipients = new Set();
  const form = document.getElementById("form-issuance");
  form.reset();
  const pdfInp = document.getElementById("iss-pdf-input");
  if (pdfInp) pdfInp.value = "";
  const recipPanel = document.getElementById("iss-recip-panel");
  if (recipPanel) recipPanel.classList.add("hidden");
  const recipSearch = document.getElementById("iss-recip-search");
  if (recipSearch) recipSearch.value = "";
  form.elements.id.value = "";
  const defaultCat = selectedIssuanceCategory !== "ALL" ? selectedIssuanceCategory : (getIssuanceCategories()[0] || "Memo");
  const sigs = getPreparedSignatoriesList();
  const defaultBy = (state.meta && state.meta.regionalDirector) || sigs[0] || "";
  populateIssuanceModalSelects(defaultCat, defaultBy);
  const today = todayISO();
  const curYr = today.slice(0, 4);
  form.elements.dateIssued.value = today;
  if (form.elements.issuanceYear) form.elements.issuanceYear.value = curYr;
  form.elements.originatingDivision.value = (currentUser && currentUser.division) || "RD";
  form.elements.issuanceNo.value = await fetchNextNumber("issuance", today, defaultCat, curYr);
  document.getElementById("iss-modal-title").textContent = `Encode New Issuance (${defaultCat})`;
  renderIssDocketsEditor("");
  setIssProvinceInModal("");
  renderIssCustomFieldsInModal(defaultCat, {});
  renderIssRecipientPicker();
  renderIssRecipientChipsAndSummary(null);
  renderIssPdfAttachmentBar();
  applyIssuanceModalReadOnly(false);
  openModal("modal-issuance");
}

window.openEditIssuance = function (id) {
  const rec = (state.issuances || []).find((r) => r.id === id);
  if (!rec) return showToast("Issuance record not found.", true);
  const isReadOnly = !canEditIssuanceOrMailing();
  editingIssuanceIsNew = false;
  currentIssAttachmentFile = rec.attachmentFile || null;
  issPdfPreviewExpanded = true;
  selectedIssRecipients = new Set(Array.isArray(rec.recipients) ? rec.recipients : []);
  const form = document.getElementById("form-issuance");
  form.reset();
  const pdfInp = document.getElementById("iss-pdf-input");
  if (pdfInp) pdfInp.value = "";
  const recipPanel = document.getElementById("iss-recip-panel");
  if (recipPanel) recipPanel.classList.add("hidden");
  const recipSearch = document.getElementById("iss-recip-search");
  if (recipSearch) recipSearch.value = "";
  form.elements.id.value = rec.id;
  populateIssuanceModalSelects(rec.category, rec.issuedBy);
  form.elements.issuanceNo.value = rec.issuanceNo || "";
  form.elements.dateIssued.value = rec.dateIssued || "";
  if (form.elements.issuanceYear) form.elements.issuanceYear.value = extractDocYear(rec.dateIssued, rec.issuanceNo) || todayISO().slice(0, 4);
  form.elements.originatingDivision.value = rec.originatingDivision || "RD";
  form.elements.subject.value = rec.subject || "";
  form.elements.remarks.value = rec.remarks || "";
  document.getElementById("iss-modal-title").textContent = isReadOnly
    ? `View Issuance — ${rec.issuanceNo} (View Only)`
    : `Edit Issuance — ${rec.issuanceNo}`;
  renderIssDocketsEditor(rec.refNo || "");
  setIssProvinceInModal((rec.customFields && rec.customFields.col_province) || "");
  renderIssCustomFieldsInModal(rec.category, rec.customFields || {});
  renderIssRecipientPicker();
  renderIssRecipientChipsAndSummary(rec.emailDispatchLog || null);
  renderIssPdfAttachmentBar();
  applyIssuanceModalReadOnly(isReadOnly);
  openModal("modal-issuance");
};

window.deleteIssuanceRecord = async function (id) {
  const rec = (state.issuances || []).find((r) => r.id === id);
  if (!rec) return;
  if (!confirm(`Delete issuance "${rec.issuanceNo}" (${rec.category})? This cannot be undone.`)) return;
  const res = await apiFetch(`/api/issuances/${encodeURIComponent(id)}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok || !data.ok) return showToast(data.error || "Failed to delete issuance", true);
  showToast(`Deleted issuance ${rec.issuanceNo}.`);
  await loadState();
};

// ----------------- Mailing Process (PhilPost, JRS & Custom Couriers) -----------------
function getMailingCouriers() {
  const list = state.meta && Array.isArray(state.meta.mailingCouriers) ? state.meta.mailingCouriers : [];
  return list.length ? list : ["PhilPost", "JRS"];
}

function getMailingCourierIcon(courier) {
  const s = String(courier || "").toLowerCase();
  if (s.includes("philpost") || s.includes("post")) return "✉️";
  if (s.includes("jrs") || s.includes("lbc") || s.includes("dhl")) return "🚚";
  return "📦";
}

function renderMailingSidebar() {
  const allList = state.mailings || [];
  const badge = document.getElementById("badge-mailing");
  if (badge) badge.textContent = allList.length;

  const container = document.getElementById("sidebar-mailing-subs");
  if (!container) return;
  const couriers = getMailingCouriers();
  if (selectedMailingCourier !== "ALL" && !couriers.includes(selectedMailingCourier)) {
    selectedMailingCourier = "ALL";
  }

  let html = `
    <button type="button" class="nav-subitem ${currentView === "mailing" && selectedMailingCourier === "ALL" ? "active" : ""}" data-mail-courier="ALL">
      <span class="sub-label">📦 All Mailings</span>
      <span class="sub-count">${allList.length}</span>
    </button>
  `;

  const isAdmin = currentUser && currentUser.role === "ADMIN";
  couriers.forEach((c, idx) => {
    const cnt = allList.filter((r) => r.courier === c).length;
    const isAct = currentView === "mailing" && selectedMailingCourier === c;
    const editBtn = isAdmin
      ? `<button type="button" class="nav-sub-edit-btn" data-edit-mail-idx="${idx}" title="Admin: Rename '${esc(c)}'" aria-label="Edit ${esc(c)}">✎</button>`
      : "";
    const delBtn =
      isAdmin && couriers.length > 1
        ? `<button type="button" class="nav-sub-del-btn" data-del-mail-idx="${idx}" title="Admin: Delete '${esc(c)}'" aria-label="Delete ${esc(c)}">✕</button>`
        : "";
    html += `
      <div class="nav-subitem-row ${isAct ? "active" : ""}">
        <button type="button" class="nav-subitem ${isAct ? "active" : ""}" data-mail-courier="${esc(c)}">
          <span class="sub-label">${getMailingCourierIcon(c)} ${esc(c)}</span>
          <span class="sub-count">${cnt}</span>
        </button>
        ${editBtn}${delBtn}
      </div>
    `;
  });

  if (isAdmin) {
    html += `
      <button type="button" class="nav-subitem add-sub-btn" id="btn-sidebar-add-mail-courier" title="Admin: Add new Mailing courier">
        <span>＋ Add Courier</span>
      </button>
    `;
  }

  container.innerHTML = html;

  container.querySelectorAll(".nav-subitem[data-mail-courier]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedMailingCourier = btn.getAttribute("data-mail-courier") || "ALL";
      hdrFilters.mail = {};
      sortState.mail = { key: "", dir: 1 };
      closeHeaderPopover();
      const sel = document.getElementById("mail-filter-courier");
      if (sel) sel.value = selectedMailingCourier;
      switchView("mailing");
      renderMailingView();
      renderMailingSidebar();
    });
  });

  container.querySelectorAll(".nav-sub-edit-btn[data-edit-mail-idx]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute("data-edit-mail-idx"), 10);
      const list = [...getMailingCouriers()];
      const oldVal = list[idx];
      if (!oldVal) return;
      const entered = prompt(`Rename Mailing courier "${oldVal}":`, oldVal);
      if (entered === null) return;
      const nextVal = entered.trim();
      if (!nextVal) return showToast("Courier name cannot be empty.", true);
      if (nextVal === oldVal) return;
      if (list.some((x, i) => i !== idx && x.toLowerCase() === nextVal.toLowerCase())) {
        return showToast(`"${nextVal}" already exists.`, true);
      }
      list[idx] = nextVal;
      const res = await apiFetch("/api/settings", {
        method: "PUT",
        loadingText: "Renaming Courier...",
        loadingSub: `${oldVal} → ${nextVal}`,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailingCouriers: list, renameMailingCourier: { from: oldVal, to: nextVal } }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return showToast(data.error || "Failed to rename courier", true);
      if (selectedMailingCourier === oldVal) selectedMailingCourier = nextVal;
      showToast(`Renamed "${oldVal}" to "${nextVal}".`);
      await loadState();
    });
  });

  container.querySelectorAll(".nav-sub-del-btn[data-del-mail-idx]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.getAttribute("data-del-mail-idx"), 10);
      const list = [...getMailingCouriers()];
      if (list.length <= 1) return showToast("At least one courier is required.", true);
      const target = list[idx];
      if (!target) return;
      if (!confirm(`Remove "${target}" from Mailing Process?`)) return;
      list.splice(idx, 1);
      const res = await apiFetch("/api/settings", {
        method: "PUT",
        loadingText: "Removing Courier...",
        loadingSub: target,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailingCouriers: list }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return showToast(data.error || "Failed to remove courier", true);
      if (selectedMailingCourier === target) selectedMailingCourier = "ALL";
      showToast(`Removed "${target}" from Mailing Process.`);
      await loadState();
    });
  });

  const addBtn = document.getElementById("btn-sidebar-add-mail-courier");
  if (addBtn) {
    addBtn.addEventListener("click", async () => {
      const name = prompt("Enter new Mailing courier name (e.g. LBC, DHL, Pouch, Flash Express):");
      if (!name || !name.trim()) return;
      const val = name.trim();
      const list = [...getMailingCouriers()];
      if (list.some((x) => x.toLowerCase() === val.toLowerCase())) {
        return showToast(`"${val}" already exists.`, true);
      }
      list.push(val);
      const res = await apiFetch("/api/settings", {
        method: "PUT",
        loadingText: "Adding Mailing Courier...",
        loadingSub: val,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mailingCouriers: list }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return showToast(data.error || "Failed to add courier", true);
      showToast(`Added "${val}" to Mailing Process!`);
      await loadState();
    });
  }
}

function getFilteredMailings() {
  const all = state.mailings || [];
  const q = (document.getElementById("mail-search")?.value || "").trim().toLowerCase();
  const yr = document.getElementById("mail-filter-year")?.value || "ALL";
  const st = document.getElementById("mail-filter-status")?.value || "ALL";
  const c = selectedMailingCourier || "ALL";
  const list = all.filter((r) => {
    if (c !== "ALL" && r.courier !== c) return false;
    if (st !== "ALL" && r.status !== st) return false;
    if (yr !== "ALL" && extractDocYear(r.dateMailed, r.mailingNo) !== yr) return false;
    if (q) {
      const addrsText = getMailingAddresseesList(r).map((a) => `${a.name} ${a.trackingNo} ${a.dateReceived}`).join(" ");
      const hay = [
        r.mailingNo, r.courier, r.docType, r.trackingNo, r.docRefNo, r.recipientName, addrsText, r.province,
        r.recipientAddress, r.subject, r.originatingDivision, r.mailedBy, r.receivedBy, r.remarks, r.status,
      ].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    for (const [col, f] of Object.entries(hdrFilters.mail || {})) {
      if (!f) continue;
      if (f.query && !getColSearchHaystack("mail", col, r).toLowerCase().includes(f.query.toLowerCase())) return false;
      if (f.selected !== null && !f.selected.has(getColDisplayValue("mail", col, r))) return false;
    }
    return true;
  });

  const { key, dir } = sortState.mail || { key: "", dir: 1 };
  if (key) {
    list.sort((a, b) =>
      getColDisplayValue("mail", key, a).localeCompare(getColDisplayValue("mail", key, b), undefined, {
        numeric: true,
        sensitivity: "base",
      }) * dir
    );
  }
  return list;
}

function getMailStatusBadgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (s.includes("delivered") || s.includes("received")) return "badge-completed";
  if (s.includes("returned")) return "badge-overdue";
  if (s.includes("transit") || s.includes("mailed")) return "badge-due";
  return "badge-progress";
}

function getMailingAddresseesList(r) {
  if (r && Array.isArray(r.addressees) && r.addressees.length) {
    return r.addressees.map((a) => ({
      name: String((a && a.name) || "").trim(),
      dtsNumber: String((a && a.dtsNumber) || "").trim(),
      trackingNo: String((a && a.trackingNo) || "").trim(),
      dateReceived: String((a && a.dateReceived) || "").trim(),
    }));
  }
  if (r && (r.recipientName || r.trackingNo || r.dateReceived)) {
    return [{
      name: String(r.recipientName || "").trim(),
      dtsNumber: String(r.docRefNo || "").trim(),
      trackingNo: String(r.trackingNo || "").trim(),
      dateReceived: String(r.dateReceived || "").trim(),
    }];
  }
  return [];
}

function renderMailingAddresseesEditor(items = []) {
  const rowsWrap = document.getElementById("mail-addressees-rows");
  const addBtn = document.getElementById("btn-mail-add-addressee");
  const cntEl = document.getElementById("mail-addressees-count");
  const numMailsInp = document.getElementById("mail-num-mails");
  if (!rowsWrap) return;

  const initial = Array.isArray(items) && items.length
    ? items
    : [{ name: "", dtsNumber: "", trackingNo: "", dateReceived: "" }];

  const syncRows = () => {
    const rows = [...rowsWrap.querySelectorAll(".mail-addr-row")];
    let filledCount = 0;
    rows.forEach((row, i) => {
      const num = row.querySelector(".multi-name-num");
      const rm = row.querySelector(".multi-name-rm");
      if (num) num.textContent = String(i + 1);
      if (rm) {
        rm.title = `Remove addressee ${i + 1}`;
        rm.disabled = rows.length <= 1;
        rm.style.opacity = rows.length <= 1 ? "0.4" : "1";
      }
      const n = (row.querySelector(".mail-addr-name")?.value || "").trim();
      const t = (row.querySelector(".mail-addr-track")?.value || "").trim();
      const d = (row.querySelector(".mail-addr-dts")?.value || "").trim();
      if (n || t || d) filledCount++;
    });
    const showCnt = filledCount || rows.length;
    if (cntEl) cntEl.textContent = `${showCnt} mail${showCnt > 1 ? "s" : ""}`;
    if (numMailsInp) numMailsInp.value = String(filledCount || 0);
  };

  const addRow = (item = {}, focusNew = true) => {
    const idx = rowsWrap.querySelectorAll(".mail-addr-row").length + 1;
    const row = document.createElement("div");
    row.className = "mail-addr-row";
    row.innerHTML = `
      <span class="multi-name-num">${idx}</span>
      <input type="text" class="input mail-addr-name" value="${esc(item.name || "")}" placeholder="Name of Addressee..." />
      <input type="text" class="input mail-addr-dts" value="${esc(item.dtsNumber || "")}" placeholder="e.g. E-2910 / I-3137" />
      <input type="text" class="input mail-addr-track" value="${esc(item.trackingNo || "")}" placeholder="Tracking / Waybill No." />
      <input type="date" class="input mail-addr-recv" value="${esc(item.dateReceived || "")}" title="Date Received / Return Card" />
      <button type="button" class="multi-name-rm" title="Remove addressee ${idx}">✕</button>
    `;
    rowsWrap.appendChild(row);
    const nameInp = row.querySelector(".mail-addr-name");
    row.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", syncRows));
    const rmBtn = row.querySelector(".multi-name-rm");
    if (rmBtn) {
      rmBtn.addEventListener("click", () => {
        if (rowsWrap.querySelectorAll(".mail-addr-row").length <= 1) {
          row.querySelectorAll("input").forEach((inp) => (inp.value = ""));
          syncRows();
          return;
        }
        row.remove();
        syncRows();
      });
    }
    syncRows();
    if (focusNew && nameInp) {
      nameInp.focus();
      row.scrollIntoView({ block: "nearest" });
    }
  };

  rowsWrap.innerHTML = "";
  initial.forEach((it) => addRow(it, false));
  syncRows();
  if (addBtn) addBtn.onclick = () => addRow({}, true);
}

function readMailingAddresseesFromModal() {
  const rowsWrap = document.getElementById("mail-addressees-rows");
  if (!rowsWrap) return [];
  return [...rowsWrap.querySelectorAll(".mail-addr-row")]
    .map((row) => ({
      name: (row.querySelector(".mail-addr-name")?.value || "").trim(),
      dtsNumber: (row.querySelector(".mail-addr-dts")?.value || "").trim(),
      trackingNo: (row.querySelector(".mail-addr-track")?.value || "").trim(),
      dateReceived: (row.querySelector(".mail-addr-recv")?.value || "").trim(),
    }))
    .filter((a) => a.name || a.dtsNumber || a.trackingNo || a.dateReceived);
}

function renderMailingView() {
  const all = state.mailings || [];
  const couriers = getMailingCouriers();

  const courierSel = document.getElementById("mail-filter-courier");
  if (courierSel) {
    courierSel.innerHTML =
      `<option value="ALL">All Couriers</option>` +
      couriers.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    courierSel.value = couriers.includes(selectedMailingCourier) ? selectedMailingCourier : "ALL";
  }

  const cardsWrap = document.getElementById("mail-summary-cards");
  if (cardsWrap) {
    const delivered = all.filter((r) => String(r.status || "").toLowerCase().includes("delivered")).length;
    const inTransit = all.filter((r) => String(r.status || "").toLowerCase().includes("transit") || r.status === "For Mailing").length;
    const cardsHtml = [
      `<div class="inc-stat-card ${selectedMailingCourier === "ALL" ? "active" : ""}" data-mail-card="ALL">
         <div class="inc-stat-label">📦 All Mailings</div>
         <div class="inc-stat-val">${all.length}</div>
         <div class="inc-stat-sub">${inTransit} active • ${delivered} delivered</div>
       </div>`,
      ...couriers.map((c) => {
        const cnt = all.filter((r) => r.courier === c).length;
        const isAct = selectedMailingCourier === c;
        return `<div class="inc-stat-card ${isAct ? "active" : ""}" data-mail-card="${esc(c)}">
          <div class="inc-stat-label">${getMailingCourierIcon(c)} ${esc(c)}</div>
          <div class="inc-stat-val">${cnt}</div>
          <div class="inc-stat-sub">Click to filter ${esc(c)}</div>
        </div>`;
      }),
    ].join("");
    cardsWrap.innerHTML = cardsHtml;
    cardsWrap.querySelectorAll(".inc-stat-card[data-mail-card]").forEach((card) => {
      card.addEventListener("click", () => {
        selectedMailingCourier = card.getAttribute("data-mail-card") || "ALL";
        hdrFilters.mail = {};
        sortState.mail = { key: "", dir: 1 };
        closeHeaderPopover();
        renderMailingView();
        renderMailingSidebar();
      });
    });
  }

  const heading = document.getElementById("mail-view-heading");
  if (heading) {
    heading.textContent =
      selectedMailingCourier === "ALL"
        ? "Mailing Process Log — All Couriers (PhilPost & JRS)"
        : `Mailing Process Log — ${selectedMailingCourier}`;
  }
  const canEdit = canEditIssuanceOrMailing();
  const syncLine = document.getElementById("mail-sync-status-line");
  if (syncLine) {
    if (!canEdit) {
      const divLbl = (currentUser && currentUser.division) ? ` (${esc(currentUser.division)})` : "";
      syncLine.innerHTML = `👁️ <strong>View-Only Access${divLbl}</strong> — Showing only Mailing Process records addressed to your office in Recipient (To).`;
    } else {
      const ms = state.meta && state.meta.mailingSheetSync;
      if (ms && ms.lastSyncedAt && !ms.lastError) {
        syncLine.innerHTML = `✅ <strong>Auto-Sync Active</strong> — Last synced to Google Sheet (${esc((ms.syncedTabs || []).join(", ") || "Mailing tabs")}) on ${esc(ms.lastSyncedAt)}.`;
      } else if (ms && ms.lastError) {
        syncLine.innerHTML = `⏳ <strong>Auto-Sync Waiting:</strong> ${esc(ms.lastError)} — retries automatically every 2 min.`;
      } else {
        syncLine.innerHTML = `☁️ <strong>Auto-Sync Active</strong> — Syncs PhilPost &amp; JRS mailings to separate Google Sheet tabs (<code>Mailing_PhilPost</code>, <code>Mailing_JRS</code>).`;
      }
    }
  }

  updateHeaderDropIndicators("mail");

  const tbody = document.getElementById("mailing-tbody");
  if (!tbody) return;
  const rows = getFilteredMailings();
  const canDelete = canEdit;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="14" style="text-align:center;padding:28px;color:#5a6a62;">No mailing records found${selectedMailingCourier !== "ALL" ? ` under <strong>${esc(selectedMailingCourier)}</strong>` : ""}${canEdit ? `. Click <strong>+ New Mailing</strong> above to log one.` : "."}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((r) => {
      const pdfPill = pdfBadgeHtml(r);
      const addrs = getMailingAddresseesList(r);
      const isMulti = addrs.length > 1;
      const namesHtml = isMulti
        ? `<div class="multi-names-cell">${addrs.map((a, i) => `<div class="multi-names-cell-item"><strong>${i + 1}.</strong> ${esc(a.name || "—")}</div>`).join("")}</div>`
        : `<strong>${esc((addrs[0] && addrs[0].name) || r.recipientName || "—")}</strong>`;
      const trackHtml = isMulti
        ? `<div class="multi-names-cell">${addrs.map((a, i) => `<div class="multi-names-cell-item"><strong>${i + 1}.</strong> ${esc(a.trackingNo || "—")}</div>`).join("")}</div>`
        : ((addrs[0] && addrs[0].trackingNo) ? `<strong>${esc(addrs[0].trackingNo)}</strong>` : "—");
      const recvHtml = isMulti
        ? `<div class="multi-names-cell">${addrs.map((a, i) => `<div class="multi-names-cell-item"><strong>${i + 1}.</strong> ${a.dateReceived ? esc(formatDateShort(a.dateReceived) || a.dateReceived) : `<span class="muted-text">Pending</span>`}</div>`).join("")}</div>`
        : (() => {
            const dt = (addrs[0] && addrs[0].dateReceived) || r.dateReceived || "";
            const line = [formatDateShort(dt) || dt, r.receivedBy ? `By: ${r.receivedBy}` : ""].filter(Boolean).join(" • ");
            return line ? esc(line) : `<span class="muted-text">Pending</span>`;
          })();
      return `
      <tr>
        <td>
          <span class="code-chip">${esc(r.mailingNo)}</span>
          ${r.pouchControlNo ? `<div class="sub-line">Pouch No.: <strong style="color:#b71c1c;">${esc(r.pouchControlNo)}</strong></div>` : ""}
        </td>
        <td><span class="badge">${getMailingCourierIcon(r.courier)} ${esc(r.courier)}</span></td>
        <td>${r.docType ? `<span class="badge">${esc(r.docType)}</span>` : "—"}</td>
        <td>${esc(formatDateShort(r.dateMailed) || r.dateMailed || "—")}</td>
        <td>${trackHtml}</td>
        <td>${namesHtml}</td>
        <td>
          ${r.province ? `<span class="div-tag">${esc(r.province)}</span>` : ""}
          ${r.recipientAddress ? `<div class="sub-line">${esc(r.recipientAddress)}</div>` : (!r.province ? "—" : "")}
        </td>
        <td>
          <strong>${esc(r.subject || (r.pouchControlNo ? "Pouch Transmittal #" + r.pouchControlNo : "Pouch Transmittal"))}</strong> ${pdfPill}
          ${r.docRefNo ? `<div class="sub-line">Ref: ${esc(r.docRefNo)}</div>` : ""}
        </td>
        <td>
          ${esc(r.mailedBy || "—")}
          ${r.originatingDivision ? `<div class="sub-line">${esc(r.originatingDivision)}</div>` : ""}
        </td>
        <td>${r.amount ? `₱${esc(r.amount)}` : "—"}</td>
        <td><span class="badge ${getMailStatusBadgeClass(r.status)}">${esc(r.status || "Mailed / In Transit")}</span></td>
        <td>${recvHtml}</td>
        <td>${esc(r.remarks || "—")}</td>
        <td class="actions-col">
          <button type="button" class="btn btn-sm btn-primary" onclick="openPrintMailingSlip('${esc(r.id)}')">🖨️ Slip</button>
          <button type="button" class="btn btn-sm btn-outline" onclick="openEditMailing('${esc(r.id)}')">${canEdit ? "View / Edit" : "👁️ View"}</button>
          ${canDelete ? `<button type="button" class="btn btn-sm btn-danger" onclick="deleteMailingRecord('${esc(r.id)}')">Delete</button>` : ""}
        </td>
      </tr>`;
    })
    .join("");
}

function renderMailPdfAttachmentBar() {
  const bar = document.getElementById("mail-pdf-viewer-bar");
  const statusEl = document.getElementById("mail-pdf-status");
  if (!bar || !statusEl) return;
  if (currentMailAttachmentFile && (currentMailAttachmentFile.url || currentMailAttachmentFile.localUrl)) {
    const syncTag = currentMailAttachmentFile.driveSynced
      ? `<span class="badge badge-completed" style="margin-left:6px;">☁️ Saved in Google Drive</span>`
      : `<span class="badge badge-due" style="margin-left:6px;">💻 Local Copy</span>`;
    statusEl.innerHTML = `✅ <strong>Receipt / Return Card PDF Uploaded</strong> (${esc(formatFileSize(currentMailAttachmentFile.size))}) ${syncTag}`;
    bar.classList.remove("hidden");
    const openHref = currentMailAttachmentFile.driveUrl || currentMailAttachmentFile.url || currentMailAttachmentFile.localUrl;
    const embedSrc = getPdfEmbedUrl(currentMailAttachmentFile);
    bar.innerHTML = `
      <div class="pdf-viewer-bar">
        <div>
          <strong>📄 Scanned Mailing Receipt / Return Card PDF</strong>
          <span class="muted-text">(${esc(formatFileSize(currentMailAttachmentFile.size))})</span>
          ${syncTag}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm btn-outline" id="btn-toggle-mail-pdf-preview">${mailPdfPreviewExpanded ? "🙈 Hide PDF Preview" : "👁️ Show PDF Preview"}</button>
          <a class="btn btn-sm btn-primary" href="${esc(openHref)}" target="_blank" rel="noopener">${currentMailAttachmentFile.driveUrl ? "Open in Google Drive ↗" : "Open Full Tab ↗"}</a>
          ${canEditIssuanceOrMailing() ? `<button type="button" class="btn btn-sm btn-danger" id="btn-remove-mail-pdf">✕ Remove</button>` : ""}
        </div>
      </div>
      <div class="pdf-embed-wrap ${mailPdfPreviewExpanded ? "" : "collapsed"}" id="mail-pdf-embed-wrap">
        <iframe class="pdf-embed-frame" src="${esc(embedSrc)}" title="Mailing Receipt PDF Preview"></iframe>
      </div>
    `;
    const toggleBtn = document.getElementById("btn-toggle-mail-pdf-preview");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        mailPdfPreviewExpanded = !mailPdfPreviewExpanded;
        const wrap = document.getElementById("mail-pdf-embed-wrap");
        if (wrap) wrap.classList.toggle("collapsed", !mailPdfPreviewExpanded);
        toggleBtn.textContent = mailPdfPreviewExpanded ? "🙈 Hide PDF Preview" : "👁️ Show PDF Preview";
      });
    }
    const rmBtn = document.getElementById("btn-remove-mail-pdf");
    if (rmBtn) {
      rmBtn.addEventListener("click", () => {
        currentMailAttachmentFile = null;
        document.getElementById("mail-pdf-input").value = "";
        renderMailPdfAttachmentBar();
      });
    }
  } else {
    statusEl.textContent = "No scanned PDF uploaded yet";
    bar.classList.add("hidden");
    bar.innerHTML = "";
  }
}

async function refreshNewMailingNo() {
  if (!editingMailingIsNew) return;
  const form = document.getElementById("form-mailing");
  if (!form) return;
  const c = form.elements.courier.value || getMailingCouriers()[0] || "PhilPost";
  const dt = form.elements.dateMailed.value || todayISO();
  const yr = String((form.elements.mailingYear && form.elements.mailingYear.value) || "").trim();
  form.elements.mailingNo.value = await fetchNextNumber("mailing", dt, c, /^\d{4}$/.test(yr) ? yr : "");
}

function populateMailingCourierSelect(val = "") {
  const sel = document.getElementById("mail-courier-select");
  if (!sel) return;
  const list = [...getMailingCouriers()];
  if (val && !list.includes(val)) list.push(val);
  sel.innerHTML = list.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  sel.value = val || list[0] || "PhilPost";
}

let selectedMailRecipients = new Set();

function renderMailRecipientPicker() {
  const listEl = document.getElementById("mail-recip-list");
  const addCustomBtn = document.getElementById("btn-mail-recip-add-custom");
  if (!listEl) return;
  const rawSearch = (document.getElementById("mail-recip-search")?.value || "").trim();
  const q = rawSearch.toLowerCase();
  const emailMap = (state.meta && state.meta.officeEmails) || {};
  const { roDivs, darpos, all } = getAllFurnishedCopyOptions();

  if (addCustomBtn) {
    const exactExists = all.some((o) => o.code.toLowerCase() === q);
    addCustomBtn.classList.toggle("hidden", !rawSearch || exactExists);
  }

  const renderGroup = (title, items) => {
    const filtered = items.filter((o) => !q || o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q));
    if (!filtered.length) return "";
    return `
      <div class="multi-drop-group">${esc(title)}</div>
      ${filtered
        .map((o) => {
          const checked = selectedMailRecipients.has(o.code);
          const email = String(emailMap[o.code] || "").trim();
          const emailBadge = email
            ? `<span class="multi-drop-item-email" title="${esc(email)}">📧 ${esc(email)}</span>`
            : `<span class="multi-drop-item-email missing">Office / Unit</span>`;
          return `
          <label class="multi-drop-item">
            <span class="multi-drop-item-left">
              <input type="checkbox" data-mail-recip-code="${esc(o.code)}" ${checked ? "checked" : ""} />
              <span><strong>${esc(o.code)}</strong></span>
            </span>
            ${emailBadge}
          </label>`;
        })
        .join("")}
    `;
  };

  listEl.innerHTML =
    renderGroup("Regional Office VIII Divisions & STO Sections", roDivs) +
    renderGroup("DARPO Provincial Offices (Region VIII)", darpos) ||
    `<div style="padding:12px;text-align:center;font-size:12px;color:#5a6a62;">No matching office — click <strong>+ Add</strong> above to include "${esc(rawSearch)}".</div>`;

  listEl.querySelectorAll("input[data-mail-recip-code]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const code = cb.getAttribute("data-mail-recip-code");
      if (cb.checked) selectedMailRecipients.add(code);
      else selectedMailRecipients.delete(code);
      renderMailRecipientChips();
    });
  });
}

function renderMailRecipientChips() {
  const triggerText = document.getElementById("mail-recip-trigger-text");
  const chipsEl = document.getElementById("mail-recip-chips");
  const list = [...selectedMailRecipients];
  if (triggerText) {
    triggerText.textContent = list.length
      ? `${list.length} office${list.length > 1 ? "s" : ""} selected`
      : "Select RO VIII Sections & DARPO Offices...";
  }
  if (chipsEl) {
    const canEditRecip = canEditIssuanceOrMailing();
    chipsEl.innerHTML = list
      .map(
        (code) =>
          `<span class="fc-chip">${esc(code)}${canEditRecip ? `<button type="button" data-rm-mail-recip="${esc(code)}" aria-label="Remove ${esc(code)}">×</button>` : ""}</span>`
      )
      .join("");
    if (canEditRecip) {
      chipsEl.querySelectorAll("button[data-rm-mail-recip]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedMailRecipients.delete(btn.getAttribute("data-rm-mail-recip"));
          renderMailRecipientPicker();
          renderMailRecipientChips();
        });
      });
    }
  }
}

function applyMailingModalReadOnly(isReadOnly) {
  const form = document.getElementById("form-mailing");
  if (!form) return;
  const banner = document.getElementById("mail-readonly-banner");
  if (banner) banner.classList.toggle("hidden", !isReadOnly);

  form.querySelectorAll("input, select, textarea").forEach((el) => {
    if (el.type === "hidden") return;
    el.disabled = isReadOnly;
  });

  ["btn-mail-add-addressee", "btn-pick-mail-pdf", "btn-save-mailing"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("hidden", isReadOnly);
  });
  const recipDrop = document.getElementById("mail-recip-dropdown");
  if (recipDrop) recipDrop.classList.toggle("hidden", isReadOnly);

  form.querySelectorAll(".multi-name-rm").forEach((btn) => {
    btn.classList.toggle("hidden", isReadOnly);
  });

  const cancelBtn = document.getElementById("btn-cancel-mailing");
  if (cancelBtn) cancelBtn.textContent = isReadOnly ? "Close" : "Cancel";
}

async function openNewMailing() {
  if (!canEditIssuanceOrMailing()) {
    return showToast("View-only access: Only Records Section or System Admin can encode Mailing records.", true);
  }
  editingMailingIsNew = true;
  currentMailAttachmentFile = null;
  mailPdfPreviewExpanded = true;
  selectedMailRecipients = new Set();
  const form = document.getElementById("form-mailing");
  form.reset();
  const pdfInp = document.getElementById("mail-pdf-input");
  if (pdfInp) pdfInp.value = "";
  const recipPanel = document.getElementById("mail-recip-panel");
  if (recipPanel) recipPanel.classList.add("hidden");
  const recipSearch = document.getElementById("mail-recip-search");
  if (recipSearch) recipSearch.value = "";
  form.elements.id.value = "";
  const defaultCourier = selectedMailingCourier !== "ALL" ? selectedMailingCourier : (getMailingCouriers()[0] || "PhilPost");
  populateMailingCourierSelect(defaultCourier);
  const today = todayISO();
  const curYr = today.slice(0, 4);
  form.elements.dateMailed.value = today;
  if (form.elements.mailingYear) form.elements.mailingYear.value = curYr;
  if (form.elements.fromOffice) form.elements.fromOffice.value = "DAR RO VIII - Records Section";
  if (form.elements.instruction) form.elements.instruction.value = "";
  if (form.elements.toCc) form.elements.toCc.value = "";
  if (form.elements.pouchControlNo) form.elements.pouchControlNo.value = "";
  if (form.elements.transDateReceived) form.elements.transDateReceived.value = today;
  if (form.elements.transTimeReceived) form.elements.transTimeReceived.value = "";
  if (form.elements.transReceivedBy) form.elements.transReceivedBy.value = (currentUser && currentUser.fullName) || "";
  if (form.elements.transDateReleased) form.elements.transDateReleased.value = today;
  if (form.elements.transReleaseDateTime) form.elements.transReleaseDateTime.value = "";
  form.elements.originatingDivision.value = (currentUser && currentUser.division) || "STO - Records";
  form.elements.mailedBy.value = (currentUser && currentUser.fullName) || "";
  form.elements.status.value = "Mailed / In Transit";
  form.elements.mailingNo.value = await fetchNextNumber("mailing", today, defaultCourier, curYr);
  document.getElementById("mail-modal-title").textContent = `Encode New Mailing — Pouch Transmittal Slip (${defaultCourier})`;
  renderMailingAddresseesEditor([]);
  renderMailRecipientPicker();
  renderMailRecipientChips();
  renderMailPdfAttachmentBar();
  applyMailingModalReadOnly(false);
  openModal("modal-mailing");
}

window.openEditMailing = function (id) {
  const rec = (state.mailings || []).find((r) => r.id === id);
  if (!rec) return showToast("Mailing record not found.", true);
  const isReadOnly = !canEditIssuanceOrMailing();
  editingMailingIsNew = false;
  currentMailAttachmentFile = rec.attachmentFile || null;
  mailPdfPreviewExpanded = true;
  selectedMailRecipients = new Set(Array.isArray(rec.recipients) ? rec.recipients : []);
  const form = document.getElementById("form-mailing");
  form.reset();
  const pdfInp = document.getElementById("mail-pdf-input");
  if (pdfInp) pdfInp.value = "";
  const recipPanel = document.getElementById("mail-recip-panel");
  if (recipPanel) recipPanel.classList.add("hidden");
  const recipSearch = document.getElementById("mail-recip-search");
  if (recipSearch) recipSearch.value = "";
  form.elements.id.value = rec.id;
  populateMailingCourierSelect(rec.courier);
  form.elements.mailingNo.value = rec.mailingNo || "";
  form.elements.docType.value = rec.docType || "";
  form.elements.dateMailed.value = rec.dateMailed || "";
  if (form.elements.mailingYear) form.elements.mailingYear.value = extractDocYear(rec.dateMailed, rec.mailingNo) || todayISO().slice(0, 4);
  if (form.elements.pouchControlNo) form.elements.pouchControlNo.value = rec.pouchControlNo || "";
  if (form.elements.fromOffice) form.elements.fromOffice.value = rec.fromOffice || "";
  if (form.elements.instruction) form.elements.instruction.value = rec.instruction || "";
  if (form.elements.toCc) form.elements.toCc.value = rec.toCc || "";
  if (form.elements.transDateReceived) form.elements.transDateReceived.value = rec.transDateReceived || rec.dateMailed || "";
  if (form.elements.transTimeReceived) form.elements.transTimeReceived.value = rec.transTimeReceived || "";
  if (form.elements.transReceivedBy) form.elements.transReceivedBy.value = rec.transReceivedBy || rec.receivedBy || "";
  if (form.elements.transDateReleased) form.elements.transDateReleased.value = rec.transDateReleased || rec.dateMailed || "";
  if (form.elements.transReleaseDateTime) form.elements.transReleaseDateTime.value = rec.transReleaseDateTime || "";
  form.elements.docRefNo.value = rec.docRefNo || "";
  form.elements.status.value = rec.status || "Mailed / In Transit";
  form.elements.province.value = rec.province || "";
  form.elements.recipientAddress.value = rec.recipientAddress || "";
  form.elements.subject.value = rec.subject || "";
  form.elements.originatingDivision.value = rec.originatingDivision || "STO - Records";
  form.elements.mailedBy.value = rec.mailedBy || "";
  form.elements.amount.value = rec.amount || "";
  form.elements.remarks.value = rec.remarks || "";
  document.getElementById("mail-modal-title").textContent = isReadOnly
    ? `View Mailing — ${rec.mailingNo} (View Only)`
    : `Edit Mailing — ${rec.mailingNo}`;
  renderMailingAddresseesEditor(getMailingAddresseesList(rec));
  if (form.elements.numberOfMails && rec.numberOfMails !== undefined && String(rec.numberOfMails).trim() !== "") {
    form.elements.numberOfMails.value = String(rec.numberOfMails);
  }
  renderMailRecipientPicker();
  renderMailRecipientChips();
  renderMailPdfAttachmentBar();
  applyMailingModalReadOnly(isReadOnly);
  openModal("modal-mailing");
};

function formatDateSlipDash(iso) {
  if (!iso) return "";
  const m = String(iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mo = months[parseInt(m[2], 10) - 1] || m[2];
  return `${m[3]}-${mo}-${m[1].slice(-2)}`;
}

function renderPouchTransmittalSlipHtml(rec) {
  const addrs = getMailingAddresseesList(rec);
  const totalRows = Math.max(18, addrs.length);
  const numMails = (rec.numberOfMails !== undefined && String(rec.numberOfMails).trim() !== "")
    ? String(rec.numberOfMails)
    : String(addrs.filter((a) => a.name || a.dtsNumber || a.trackingNo).length);
  const pouchNo = rec.pouchControlNo || rec.mailingNo || "";
  const courierTag = rec.courier ? ` (${String(rec.courier).toUpperCase()})` : "";
  const slipDate = formatDateSlipDash(rec.dateMailed || "");
  const dtRecv = formatDateSlipDash(rec.transDateReceived || rec.dateMailed || "");
  const dtRel = formatDateSlipDash(rec.transDateReleased || rec.dateMailed || "");

  let tableRowsHtml = "";
  for (let i = 0; i < totalRows; i++) {
    const item = addrs[i];
    const nameCell = item && item.name ? `${i + 1}. ${esc(item.name)}` : "&nbsp;";
    const dtsCell = item && item.dtsNumber ? `${i + 1}. ${esc(item.dtsNumber)}` : "&nbsp;";
    const trackCell = item && item.trackingNo ? esc(item.trackingNo) : "&nbsp;";
    tableRowsHtml += `
      <tr>
        <td style="width:36%;">${nameCell}</td>
        <td style="width:34%;">${dtsCell}</td>
        <td class="p-track" style="width:30%;">${trackCell}</td>
      </tr>`;
  }

  return `
    <div class="pouch-slip">
      <div class="pouch-hdr">
        <img src="/dar-ro8-logo.jpg" alt="DAR Logo" class="pouch-logo" />
        <div class="pouch-hdr-text">
          <div class="p-rep">REPUBLIC OF THE PHILIPPINES</div>
          <div class="p-dept">DEPARTMENT OF AGRARIAN REFORM</div>
          <div class="p-tag">Tunay na Pagbabago sa Repormang Agraryo</div>
        </div>
      </div>

      <div class="pouch-title-block">
        <h2>POUCH SERVICE FOR MAILS${esc(courierTag)}</h2>
        <div class="p-sub">(Transmittal Slip Form)</div>
      </div>

      <div style="display:flex;justify-content:flex-end;margin-bottom:4px;">
        <div style="text-align:center;min-width:210px;">
          <div style="border-bottom:1.5px solid #111;font-weight:700;padding:0 8px 2px;min-height:18px;">${esc(slipDate)}</div>
          <div style="font-size:11px;margin-top:2px;">Date</div>
        </div>
      </div>

      <div class="pouch-meta-line">
        <div><strong>From:</strong> <span class="pouch-uline" style="min-width:190px;">${esc(rec.fromOffice || rec.originatingDivision || "")}</span></div>
        <div></div>
      </div>

      <div class="pouch-meta-line">
        <div></div>
        <div><strong>Pouch Control No.</strong> <span class="pouch-uline" style="min-width:190px;text-align:center;color:#c62828;font-size:13px;">${esc(pouchNo)}</span></div>
      </div>

      <div class="pouch-meta-line">
        <div><strong>Instruction:</strong> <span class="pouch-uline" style="min-width:240px;">${esc(rec.instruction || "")}</span></div>
      </div>

      <div class="pouch-meta-line" style="margin-bottom:8px;">
        <div><strong>To/Cc:</strong> <span style="margin-left:6px;font-weight:700;">${esc(rec.toCc || "")}</span></div>
      </div>

      <table class="pouch-table">
        <thead>
          <tr>
            <th>Name of Addressee</th>
            <th>DTS Number</th>
            <th class="p-red">Tracking Number.</th>
          </tr>
        </thead>
        <tbody>${tableRowsHtml}</tbody>
      </table>

      <div class="pouch-heavy-rule"></div>

      <div class="pouch-footer-grid">
        <div>
          <div class="pouch-f-row">
            <span class="pouch-f-lbl">Date Received:</span>
            <span class="pouch-f-val">${esc(dtRecv)}</span>
          </div>
          <div class="pouch-f-row">
            <span class="pouch-f-lbl">Time Received:</span>
            <span class="pouch-f-val">${esc(rec.transTimeReceived || "")}</span>
          </div>
          <div class="pouch-f-row">
            <span class="pouch-f-lbl">By:</span>
            <span class="pouch-f-val">${esc(rec.transReceivedBy || rec.receivedBy || rec.mailedBy || "")}</span>
          </div>
        </div>
        <div>
          <div class="pouch-f-row">
            <span class="pouch-f-lbl">Date Released :</span>
            <span class="pouch-f-val">${esc(dtRel)}</span>
          </div>
          <div class="pouch-f-row">
            <span class="pouch-f-lbl">Date/ Time:</span>
            <span class="pouch-f-val">${esc(rec.transReleaseDateTime || "")}</span>
          </div>
          <div class="pouch-f-row">
            <span class="pouch-f-lbl p-red">Number of Mails :</span>
            <span class="pouch-f-val p-red">${esc(numMails)}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

window.openPrintMailingSlip = function (idOrRec) {
  const rec = typeof idOrRec === "object" && idOrRec !== null
    ? idOrRec
    : (state.mailings || []).find((r) => r.id === idOrRec);
  if (!rec) return showToast("Mailing record not found.", true);
  document.getElementById("print-modal-title").textContent = `Pouch Service Transmittal Slip — ${rec.courier || "Mail"} ${rec.pouchControlNo || rec.mailingNo || ""}`;
  document.getElementById("print-canvas").innerHTML = renderPouchTransmittalSlipHtml(rec);
  openModal("modal-print");
};

window.deleteMailingRecord = async function (id) {
  const rec = (state.mailings || []).find((r) => r.id === id);
  if (!rec) return;
  if (!confirm(`Delete mailing record "${rec.mailingNo}" (${rec.courier})? This cannot be undone.`)) return;
  const res = await apiFetch(`/api/mailings/${encodeURIComponent(id)}`, { method: "DELETE" });
  const data = await res.json();
  if (!res.ok || !data.ok) return showToast(data.error || "Failed to delete mailing record", true);
  showToast(`Deleted mailing record ${rec.mailingNo}.`);
  await loadState();
};

function getPreparedSignatoriesList() {
  return Array.isArray(state.meta && state.meta.preparedSignatories) ? state.meta.preparedSignatories : [];
}

function populatePreparedBySelect(currentVal = "") {
  const sel = document.getElementById("out-prepared-by");
  if (!sel) return;
  const list = [...getPreparedSignatoriesList()];
  const cur = String(currentVal || "").trim();
  if (cur && !list.includes(cur)) list.push(cur);
  sel.innerHTML =
    `<option value="">— Select Prepared / Signed By —</option>` +
    list.map((name) => `<option value="${esc(name)}">${esc(name)}</option>`).join("");
  sel.value = cur;
}

let editingSignatoryIdx = -1;

function renderAdminSignatories() {
  const tbody = document.getElementById("admin-signatories-tbody");
  if (!tbody || !currentUser || currentUser.role !== "ADMIN") return;
  const list = getPreparedSignatoriesList();
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;padding:18px;color:#5a6a62;">No Prepared / Signed By options yet. Use <strong>+ Add Option</strong> above.</td></tr>`;
    return;
  }
  tbody.innerHTML = list
    .map((name, idx) => {
      if (editingSignatoryIdx === idx) {
        return `
        <tr>
          <td>${idx + 1}</td>
          <td><input type="text" id="edit-signatory-input-${idx}" class="input" value="${esc(name)}" style="padding:6px 10px;font-size:13px;" /></td>
          <td class="actions-col">
            <button type="button" class="btn btn-sm btn-primary" onclick="savePreparedSignatoryEdit(${idx})">Save</button>
            <button type="button" class="btn btn-sm btn-outline" onclick="cancelPreparedSignatoryEdit()">Cancel</button>
          </td>
        </tr>`;
      }
      return `
      <tr>
        <td>${idx + 1}</td>
        <td><strong>${esc(name)}</strong></td>
        <td class="actions-col">
          <button type="button" class="btn btn-sm btn-outline" onclick="startPreparedSignatoryEdit(${idx})">Edit</button>
          <button type="button" class="btn btn-sm btn-danger" onclick="deletePreparedSignatory(${idx})">Delete</button>
        </td>
      </tr>`;
    })
    .join("");

  if (editingSignatoryIdx >= 0) {
    const inp = document.getElementById(`edit-signatory-input-${editingSignatoryIdx}`);
    if (inp) {
      inp.focus();
      inp.select();
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); window.savePreparedSignatoryEdit(editingSignatoryIdx); }
        if (e.key === "Escape") window.cancelPreparedSignatoryEdit();
      });
    }
  }
}

window.startPreparedSignatoryEdit = function (idx) {
  editingSignatoryIdx = idx;
  renderAdminSignatories();
};

window.cancelPreparedSignatoryEdit = function () {
  editingSignatoryIdx = -1;
  renderAdminSignatories();
};

window.savePreparedSignatoryEdit = async function (idx) {
  const inp = document.getElementById(`edit-signatory-input-${idx}`);
  const nextVal = (inp && inp.value || "").trim();
  if (!nextVal) return showToast("Signatory name cannot be empty.", true);
  const list = [...getPreparedSignatoriesList()];
  if (list[idx] === undefined) return;
  if (list.some((s, i) => i !== idx && s.toLowerCase() === nextVal.toLowerCase())) {
    return showToast(`"${nextVal}" is already in the Prepared / Signed By list.`, true);
  }
  list[idx] = nextVal;
  const res = await apiFetch("/api/settings", {
    method: "PUT",
    loadingText: "Updating Signatory...",
    loadingSub: nextVal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preparedSignatories: list }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) return showToast(data.error || "Failed to update signatory", true);
  editingSignatoryIdx = -1;
  showToast(`Updated signatory to "${nextVal}".`);
  await loadState();
};

window.deletePreparedSignatory = async function (idx) {
  const list = [...getPreparedSignatoriesList()];
  const target = list[idx];
  if (target === undefined) return;
  if (!confirm(`Delete "${target}" from the Prepared / Signed By dropdown?`)) return;
  list.splice(idx, 1);
  editingSignatoryIdx = -1;
  const res = await apiFetch("/api/settings", {
    method: "PUT",
    loadingText: "Updating Signatories...",
    loadingSub: `Removing ${target}`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preparedSignatories: list }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) return showToast(data.error || "Failed to delete signatory", true);
  showToast(`Removed "${target}" from Prepared / Signed By dropdown.`);
  await loadState();
};

function renderAdminEmailDirectory() {
  const tbody = document.getElementById("admin-emails-tbody");
  if (!tbody || !currentUser || currentUser.role !== "ADMIN") return;
  const emailMap = (state.meta && state.meta.officeEmails) || {};
  const { all } = getAllFurnishedCopyOptions();
  tbody.innerHTML = all
    .map((o) => {
      const val = emailMap[o.code] || "";
      const tagCls = o.group === "DARPO" ? "badge badge-ontime" : "div-tag";
      return `
      <tr>
        <td><strong>${esc(o.code)}</strong></td>
        <td>${esc(o.name)}</td>
        <td><span class="${tagCls}">${esc(o.group)}</span></td>
        <td><input type="email" class="input" data-office-email="${esc(o.code)}" value="${esc(val)}" placeholder="e.g. ${esc(o.code.toLowerCase().replace(/[^a-z0-9]+/g, "."))}@dar.gov.ph" style="padding:6px 10px;font-size:12.5px;" /></td>
      </tr>`;
    })
    .join("");
}

function renderAdminUsers() {
  const badge = document.getElementById("badge-pending-users");
  if (!currentUser || currentUser.role !== "ADMIN") {
    badge.classList.add("hidden");
    return;
  }
  const users = [...(state.users || [])];
  const pendingCount = users.filter((u) => (u.approvalStatus || "APPROVED") === "PENDING").length;

  badge.textContent = pendingCount;
  badge.classList.toggle("hidden", pendingCount === 0);

  const pendingPill = document.getElementById("admin-pending-pill");
  pendingPill.textContent = `${pendingCount} Pending Confirmation`;
  pendingPill.classList.toggle("hidden", pendingCount === 0);

  // Add clickable pending alert right in the top-right role banner for Admin
  const bannerRight = document.getElementById("role-banner-right") || document.getElementById("role-banner");
  const bannerNote = document.getElementById("role-banner-note");
  const existingAlert = document.getElementById("admin-banner-pending-btn");
  if (existingAlert) existingAlert.remove();
  if (pendingCount > 0) {
    const btn = document.createElement("button");
    btn.id = "admin-banner-pending-btn";
    btn.className = "pending-admin-alert";
    btn.textContent = `⚠️ ${pendingCount} Registration${pendingCount > 1 ? "s" : ""} Pending Confirmation — Review Now`;
    btn.addEventListener("click", () => switchView("settings"));
    bannerRight.insertBefore(btn, bannerRight.firstChild);
    if (bannerNote) bannerNote.classList.add("hidden");
  } else if (bannerNote && !document.getElementById("banner-my-pending-btn")) {
    bannerNote.classList.remove("hidden");
  }

  // Sort PENDING first, then APPROVED, then REJECTED
  const order = { PENDING: 0, APPROVED: 1, REJECTED: 2 };
  users.sort((a, b) => (order[a.approvalStatus || "APPROVED"] ?? 1) - (order[b.approvalStatus || "APPROVED"] ?? 1));

  const tbody = document.getElementById("admin-users-tbody");
  tbody.innerHTML = users
    .map((u) => {
      const st = u.approvalStatus || "APPROVED";
      const stBadge =
        st === "PENDING"
          ? `<span class="badge badge-due">PENDING CONFIRMATION</span>`
          : st === "REJECTED"
          ? `<span class="badge badge-overdue">REJECTED</span>`
          : `<span class="badge badge-completed">APPROVED</span>`;

      let actions = `<span class="muted-text">Current Admin</span>`;
      if (u.id !== currentUser.id) {
        const btns = [];
        if (st === "PENDING") {
          btns.push(`<button class="btn btn-sm btn-primary" onclick="setUserApproval('${esc(u.id)}','APPROVED','${esc(u.fullName)}')">✓ Confirm</button>`);
          btns.push(`<button class="btn btn-sm btn-danger" onclick="setUserApproval('${esc(u.id)}','REJECTED','${esc(u.fullName)}')">✕ Reject</button>`);
        } else if (st === "REJECTED") {
          btns.push(`<button class="btn btn-sm btn-primary" onclick="setUserApproval('${esc(u.id)}','APPROVED','${esc(u.fullName)}')">✓ Approve</button>`);
          btns.push(`<button class="btn btn-sm btn-danger" onclick="deleteUserAccount('${esc(u.id)}','${esc(u.username)}')">Remove</button>`);
        } else {
          btns.push(`<button class="btn btn-sm btn-outline" onclick="setUserApproval('${esc(u.id)}','REJECTED','${esc(u.fullName)}')">Suspend</button>`);
          btns.push(`<button class="btn btn-sm btn-danger" onclick="deleteUserAccount('${esc(u.id)}','${esc(u.username)}')">Remove</button>`);
        }
        actions = btns.join(" ");
      }

      const officeFallback = (state.meta && state.meta.officeEmails && state.meta.officeEmails[u.division]) || "";
      const verifiedTag = u.emailVerified ? ` <span class="badge badge-completed" style="font-size:10px;padding:1px 6px;">✓ Verified</span>` : "";
      const emailDisplay = u.email
        ? `<code>${esc(u.email)}</code>${verifiedTag}`
        : officeFallback
        ? `<span class="muted-text" title="Using Office Email Directory fallback">${esc(officeFallback)} <em>(Office)</em></span>`
        : `<span class="muted-text" style="color:#b7410e;">Not set (no OTP)</span>`;
      return `
      <tr>
        <td><code>${esc(u.username)}</code></td>
        <td><strong>${esc(u.fullName)}</strong>${u.approvedBy ? `<div class="sub-line">By ${esc(u.approvedBy)} • ${esc(u.approvedAt || "")}</div>` : ""}</td>
        <td>
          ${emailDisplay}
          <button type="button" class="btn btn-sm btn-ghost" style="padding:2px 6px;margin-left:4px;font-size:11px;" onclick="editUserEmail('${esc(u.id)}','${esc(u.username)}','${esc(u.email || "")}')">✏️</button>
        </td>
        <td><span class="div-tag">${esc(u.role)}</span></td>
        <td>${esc(u.division || "—")}</td>
        <td>${stBadge}</td>
        <td class="actions-col">${actions}</td>
      </tr>`;
    })
    .join("");
}

window.editUserEmail = async function (uid, uname, currentEmail) {
  const next = prompt(`Set Login OTP Email Address for "${uname}" (leave blank to clear):`, currentEmail || "");
  if (next === null) return;
  const res = await apiFetch(`/api/users/${encodeURIComponent(uid)}/email`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: next.trim() }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) return showToast(data.error || "Failed to update email", true);
  showToast(next.trim() ? `Updated Login OTP email for "${uname}" to ${next.trim()}` : `Cleared personal email for "${uname}"`);
  await loadState();
};

window.setUserApproval = async function (uid, approvalStatus, fullName) {
  const res = await apiFetch(`/api/users/${encodeURIComponent(uid)}/status`, {
    method: "PUT",
    loadingText: approvalStatus === "APPROVED" ? "Confirming Account & Notifying User..." : "Updating Account Status...",
    loadingSub: `Sending email notification to ${fullName}`,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ approvalStatus }),
  });
  const data = await res.json();
  if (!res.ok || !data.ok) return showToast(data.error || "Failed to update account status", true);
  const verb = approvalStatus === "APPROVED" ? "confirmed & approved" : "declined / suspended";
  const em = data.emailNotification;
  if (em && em.sent) {
    showToast(`Account for ${fullName} ${verb} — emailed ${em.to}!`);
  } else if (em && em.attempted && em.error) {
    showToast(`Account for ${fullName} ${verb} (email note: ${em.error})`);
  } else {
    showToast(`Account for ${fullName} has been ${verb}.`);
  }
  await loadState();
};

window.deleteUserAccount = async function (uid, uname) {
  if (!confirm(`Remove user account "${uname}"?`)) return;
  const res = await apiFetch(`/api/users/${encodeURIComponent(uid)}`, { method: "DELETE" });
  const data = await res.json();
  if (!data.ok) return showToast(data.error || "Failed to remove user", true);
  showToast(`Removed user "${uname}"`);
  await loadState();
};

function getIncomingCategory(d) {
  return d.docCategory || (String(d.controlNo || "").toUpperCase().startsWith("I-") ? "Internal" : "External");
}

function computeNiceYAxis(rawMax) {
  const m = Math.max(1, Number(rawMax) || 1);
  if (m <= 5) return { axisMax: m, steps: m };
  const steps = 4;
  const stepSize = Math.ceil(m / steps);
  return { axisMax: stepSize * steps, steps };
}

function getSelectedDashboardYear() {
  const yrInp = document.getElementById("dash-q-year");
  const yrList = document.getElementById("dash-q-year-list");
  const curYr = new Date().getFullYear();
  const yearsSet = new Set([String(curYr), String(curYr - 1), String(curYr + 1)]);
  (state.incoming || []).forEach((d) => { const y = extractDocYear(d.dateReceived, d.controlNo, d.dtsYear); if (y) yearsSet.add(y); });
  (state.outgoing || []).forEach((d) => { const y = extractDocYear(d.dateOriginated, d.recNo || d.userDocNo, d.dtsYear); if (y) yearsSet.add(y); });
  (state.issuances || []).forEach((d) => { const y = extractDocYear(d.dateIssued, d.issuanceNo); if (y) yearsSet.add(y); });
  (state.mailings || []).forEach((d) => { const y = extractDocYear(d.dateMailed, d.mailingNo); if (y) yearsSet.add(y); });
  const years = [...yearsSet].sort((a, b) => Number(b) - Number(a));
  if (yrList) {
    yrList.innerHTML =
      `<option value="All Years"></option>` +
      years.map((y) => `<option value="${esc(y)}"></option>`).join("");
  }
  if (!yrInp) return String(curYr);
  const typed = String(yrInp.value || "").trim();
  if (!typed) {
    yrInp.value = String(curYr);
    return String(curYr);
  }
  if (/^all(\s+years?)?$/i.test(typed)) return "ALL";
  if (/^\d{4}$/.test(typed)) return typed;
  return String(curYr);
}

function renderDashboard() {
  const activeYr = getSelectedDashboardYear();
  const isAllYears = activeYr === "ALL";
  const incRows = isAllYears
    ? (state.incoming || [])
    : (state.incoming || []).filter((d) => extractDocYear(d.dateReceived, d.controlNo, d.dtsYear) === activeYr);
  const outRows = isAllYears
    ? (state.outgoing || [])
    : (state.outgoing || []).filter((d) => extractDocYear(d.dateOriginated, d.recNo || d.userDocNo, d.dtsYear) === activeYr);
  const mailRows = isAllYears
    ? (state.mailings || [])
    : (state.mailings || []).filter((d) => extractDocYear(d.dateMailed, d.mailingNo) === activeYr);

  const summaryEl = document.getElementById("dash-year-summary");
  if (summaryEl) {
    summaryEl.textContent = isAllYears
      ? `Showing All Years data — ${incRows.length} Incoming, ${outRows.length} Outgoing, and ${mailRows.length} Mailing records.`
      : `Showing Calendar Year ${activeYr} data — ${incRows.length} Incoming, ${outRows.length} Outgoing, and ${mailRows.length} Mailing records.`;
  }
  const allYrBtn = document.getElementById("btn-dash-all-years");
  if (allYrBtn) {
    allYrBtn.classList.toggle("active", isAllYears);
    allYrBtn.textContent = isAllYears ? `CY ${new Date().getFullYear()}` : "All Years";
  }

  const incTotal = incRows.length;
  const incExt = incRows.filter((d) => getIncomingCategory(d) === "External").length;
  const incInt = incRows.filter((d) => getIncomingCategory(d) === "Internal").length;
  const incDone = incRows.filter((d) => d.status === "Completed / Returned to Records" || d.status === "Archived").length;
  const incActive = incTotal - incDone;
  const incOverdue = incRows.filter((d) => computeSLA(d).key === "OVERDUE").length;

  const outTotal = outRows.length;
  const outDisp = outRows.filter((d) => d.status === "Dispatched / Released" || d.status === "Archived").length;
  const outRec = outRows.filter((d) => d.status === "Received by Records").length;
  const outRouting = outTotal - outDisp - outRec;

  document.getElementById("kpi-inc-total").textContent = incTotal;
  document.getElementById("kpi-inc-external").textContent = incExt;
  document.getElementById("kpi-inc-internal").textContent = incInt;
  document.getElementById("kpi-inc-active").textContent = incActive;
  document.getElementById("kpi-inc-overdue").textContent = incOverdue;
  document.getElementById("kpi-inc-done").textContent = incDone;
  document.getElementById("kpi-out-total").textContent = outTotal;
  document.getElementById("kpi-out-routing").textContent = outRouting;
  document.getElementById("kpi-out-records").textContent = outRec;
  document.getElementById("kpi-out-dispatched").textContent = outDisp;

  const pct = incTotal ? ((incDone / incTotal) * 100).toFixed(1) : "0.0";
  document.getElementById("dash-completion-rate").textContent = `${pct}% Incoming Completed`;

  const tbody = document.getElementById("dash-division-tbody");
  let rowsHtml = "";
  const divStats = state.divisions.map((div) => {
    const incList = incRows.filter((d) => resolveAssignedDivision(d) === div.code);
    const iDone = incList.filter((d) => d.status === "Completed / Returned to Records" || d.status === "Archived").length;
    const iAct = incList.length - iDone;
    const iOver = incList.filter((d) => computeSLA(d).key === "OVERDUE").length;

    const outList = outRows.filter((d) => d.originatingDivision === div.code);
    const oDisp = outList.filter((d) => d.status === "Dispatched / Released" || d.status === "Archived").length;
    const oPend = outList.length - oDisp;
    const tot = incList.length + outList.length;
    const comp = tot ? (((iDone + oDisp) / tot) * 100).toFixed(1) + "%" : "0.0%";
    return { ...div, iTot: incList.length, iAct, iOver, iDone, oTot: outList.length, oPend, oDisp, tot, comp };
  });

  const isScopedRole = currentUser && (currentUser.role === "ARD_SECRETARY" || currentUser.role === "DIVISION_CHIEF");
  const visibleDivStats = isScopedRole
    ? divStats.filter((s) => s.tot > 0 || divisionMatches(currentUser.division, s.code))
    : divStats;

  visibleDivStats.forEach((s) => {
    const cls = s.group === "STO" ? "clickable sto-row" : "clickable";
    rowsHtml += `
      <tr class="${cls}" data-jump-div="${esc(s.code)}">
        <td><strong>${esc(s.code)}</strong><div class="sub-line">${esc(s.name)}</div></td>
        <td><span class="div-tag">${esc(s.group)}</span></td>
        <td class="num">${s.iTot}</td>
        <td class="num">${s.iAct}</td>
        <td class="num">${s.iOver > 0 ? `<span class="badge badge-overdue">${s.iOver}</span>` : "0"}</td>
        <td class="num">${s.iDone}</td>
        <td class="num">${s.oTot}</td>
        <td class="num">${s.oPend}</td>
        <td class="num">${s.oDisp}</td>
        <td class="num"><strong>${s.tot}</strong></td>
        <td class="num"><strong>${s.comp}</strong></td>
      </tr>
    `;
  });

  const grandTot = incTotal + outTotal;
  const grandComp = grandTot ? (((incDone + outDisp) / grandTot) * 100).toFixed(1) + "%" : "0.0%";
  const totalTitle = isScopedRole
    ? `TOTAL — ${currentUser.division || "MY OFFICE"} (${isAllYears ? "All Years" : "CY " + activeYr})`
    : `TOTAL — DAR EASTERN VISAYAS (${isAllYears ? "All Years" : "CY " + activeYr})`;
  const totalUnit = isScopedRole ? "Forwarded Docs" : "All Units";
  rowsHtml += `
    <tr class="total-row">
      <td>${esc(totalTitle)}</td>
      <td>${esc(totalUnit)}</td>
      <td class="num">${incTotal}</td>
      <td class="num">${incActive}</td>
      <td class="num">${incOverdue}</td>
      <td class="num">${incDone}</td>
      <td class="num">${outTotal}</td>
      <td class="num">${outTotal - outDisp}</td>
      <td class="num">${outDisp}</td>
      <td class="num">${grandTot}</td>
      <td class="num">${grandComp}</td>
    </tr>
  `;
  tbody.innerHTML = rowsHtml;

  tbody.querySelectorAll("tr[data-jump-div]").forEach((tr) => {
    tr.addEventListener("click", () => {
      selectedPortalDiv = tr.getAttribute("data-jump-div");
      switchView("divisions");
    });
  });

  // Chart 1: SVG Bar Chart with exact figures above bars & clean integer Y-axis
  const activeDivs = divStats.filter((s) => s.tot > 0);
  const chartData = activeDivs.length >= 6 ? activeDivs : divStats.slice(0, 10);
  const rawMax = Math.max(1, ...chartData.map((s) => Math.max(s.iTot, s.oTot)));
  const { axisMax, steps } = computeNiceYAxis(rawMax);
  const chartW = 580, chartH = 248, padL = 34, padB = 72, padT = 24;
  const plotW = chartW - padL - 14, plotH = chartH - padT - padB;
  const step = plotW / Math.max(1, chartData.length);
  const barW = Math.min(18, step * 0.34);

  let svg = `<svg viewBox="0 0 ${chartW} ${chartH}" width="100%" height="248">`;
  for (let g = 0; g <= steps; g++) {
    const y = padT + (plotH * g) / steps;
    const lbl = Math.round(axisMax * (1 - g / steps));
    svg += `<line x1="${padL}" y1="${y}" x2="${chartW - 10}" y2="${y}" stroke="#e4ebe7" stroke-width="1"/>`;
    svg += `<text x="${padL - 7}" y="${y + 4}" text-anchor="end" font-size="10.5" font-weight="600" fill="#5a6a62">${lbl}</text>`;
  }
  chartData.forEach((s, idx) => {
    const cx = padL + idx * step + step / 2;
    const x1 = cx - barW - 2;
    const x2 = cx + 2;
    const h1 = (s.iTot / axisMax) * plotH;
    const h2 = (s.oTot / axisMax) * plotH;
    const y1 = padT + plotH - h1;
    const y2 = padT + plotH - h2;
    svg += `<rect x="${x1}" y="${y1}" width="${barW}" height="${h1}" rx="3" fill="#2e7d32"><title>${esc(s.code)} Incoming: ${s.iTot}</title></rect>`;
    if (s.iTot > 0) {
      svg += `<text x="${x1 + barW / 2}" y="${y1 - 5}" text-anchor="middle" font-size="10.5" font-weight="800" fill="#1b5e20">${s.iTot}</text>`;
    }
    svg += `<rect x="${x2}" y="${y2}" width="${barW}" height="${h2}" rx="3" fill="#1565c0"><title>${esc(s.code)} Outgoing: ${s.oTot}</title></rect>`;
    if (s.oTot > 0) {
      svg += `<text x="${x2 + barW / 2}" y="${y2 - 5}" text-anchor="middle" font-size="10.5" font-weight="800" fill="#0d47a1">${s.oTot}</text>`;
    }
    const shortLbl = s.code.replace("STO - ", "STO:");
    svg += `<text x="${cx}" y="${padT + plotH + 14}" text-anchor="end" font-size="9.5" font-weight="600" fill="#2c3a32" transform="rotate(-32 ${cx} ${padT + plotH + 14})">${esc(shortLbl)}</text>`;
  });
  svg += `</svg>`;
  document.getElementById("chart-divisions").innerHTML = svg;

  // Chart 2: Status Bars (filtered by selected Dashboard Year)
  const statusEl = document.getElementById("chart-status");
  const statusCounts = LISTS.incStatuses.map((st) => ({ st, cnt: incRows.filter((d) => d.status === st).length }));
  const maxSt = Math.max(1, ...statusCounts.map((s) => s.cnt));
  statusEl.innerHTML = statusCounts
    .map(
      (s) => `
      <div class="bar-row">
        <div class="bar-row-label" title="${esc(s.st)}">${esc(s.st)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${(s.cnt / maxSt) * 100}%"></div></div>
        <div class="bar-row-val">${s.cnt}</div>
      </div>`
    )
    .join("");

  renderQuarterlyDashboard(activeYr);
}

function extractQuarterAndYear(dateStr, codeStr, explicitYear) {
  const resolvedYr = extractDocYear(dateStr, codeStr, explicitYear);
  const s = String(dateStr || "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) {
    const mo = parseInt(iso[2], 10);
    if (mo >= 1 && mo <= 12) return { year: resolvedYr || iso[1], q: Math.ceil(mo / 3) };
  }
  const codeMatch = String(codeStr || "").match(/(?:^|-)(\d{2})-\d{2}-((?:19|20)\d{2})-/);
  if (codeMatch) {
    const mo = parseInt(codeMatch[1], 10);
    if (mo >= 1 && mo <= 12) return { year: resolvedYr || codeMatch[2], q: Math.ceil(mo / 3) };
  }
  return { year: resolvedYr, q: 0 };
}

function buildQuarterlyReportData(year) {
  const yr = String(year || new Date().getFullYear());
  const isAll = yr === "ALL";
  const quarters = [
    { q: 1, label: "Q1 (Jan – Mar)", incTotal: 0, incExt: 0, incInt: 0, incDone: 0, outTotal: 0, outDisp: 0, outPend: 0, mailTotal: 0, mailPhilpost: 0, mailJrs: 0, mailDelivered: 0 },
    { q: 2, label: "Q2 (Apr – Jun)", incTotal: 0, incExt: 0, incInt: 0, incDone: 0, outTotal: 0, outDisp: 0, outPend: 0, mailTotal: 0, mailPhilpost: 0, mailJrs: 0, mailDelivered: 0 },
    { q: 3, label: "Q3 (Jul – Sep)", incTotal: 0, incExt: 0, incInt: 0, incDone: 0, outTotal: 0, outDisp: 0, outPend: 0, mailTotal: 0, mailPhilpost: 0, mailJrs: 0, mailDelivered: 0 },
    { q: 4, label: "Q4 (Oct – Dec)", incTotal: 0, incExt: 0, incInt: 0, incDone: 0, outTotal: 0, outDisp: 0, outPend: 0, mailTotal: 0, mailPhilpost: 0, mailJrs: 0, mailDelivered: 0 },
  ];

  (state.incoming || []).forEach((d) => {
    const info = extractQuarterAndYear(d.dateReceived, d.controlNo, d.dtsYear);
    if ((!isAll && info.year !== yr) || info.q < 1 || info.q > 4) return;
    const row = quarters[info.q - 1];
    row.incTotal++;
    const isInt = (d.docCategory || "").toLowerCase() === "internal" || String(d.controlNo || "").toUpperCase().startsWith("I-");
    if (isInt) row.incInt++;
    else row.incExt++;
    if (d.status === "Completed / Returned to Records" || d.status === "Archived") row.incDone++;
  });

  (state.outgoing || []).forEach((d) => {
    const info = extractQuarterAndYear(d.dateOriginated, d.recNo || d.userDocNo, d.dtsYear);
    if ((!isAll && info.year !== yr) || info.q < 1 || info.q > 4) return;
    const row = quarters[info.q - 1];
    row.outTotal++;
    if (d.status === "Dispatched / Released" || d.status === "Archived") row.outDisp++;
    else row.outPend++;
  });

  (state.mailings || []).forEach((d) => {
    const info = extractQuarterAndYear(d.dateMailed, d.mailingNo);
    if ((!isAll && info.year !== yr) || info.q < 1 || info.q > 4) return;
    const row = quarters[info.q - 1];
    row.mailTotal++;
    const cLow = String(d.courier || "").toLowerCase();
    if (cLow.includes("philpost")) row.mailPhilpost++;
    else if (cLow.includes("jrs")) row.mailJrs++;
    if (String(d.status || "").toLowerCase().includes("delivered")) row.mailDelivered++;
  });

  const totals = quarters.reduce(
    (acc, r) => {
      acc.incTotal += r.incTotal;
      acc.incExt += r.incExt;
      acc.incInt += r.incInt;
      acc.incDone += r.incDone;
      acc.outTotal += r.outTotal;
      acc.outDisp += r.outDisp;
      acc.outPend += r.outPend;
      acc.mailTotal += r.mailTotal;
      acc.mailPhilpost += r.mailPhilpost;
      acc.mailJrs += r.mailJrs;
      acc.mailDelivered += r.mailDelivered;
      return acc;
    },
    { label: isAll ? "ALL YEARS TOTAL" : `ANNUAL TOTAL (${yr})`, incTotal: 0, incExt: 0, incInt: 0, incDone: 0, outTotal: 0, outDisp: 0, outPend: 0, mailTotal: 0, mailPhilpost: 0, mailJrs: 0, mailDelivered: 0 }
  );

  return { year: yr, quarters, totals };
}

function renderQuarterlyDashboard(forcedYear) {
  const tbody = document.getElementById("dash-quarterly-tbody");
  const chartEl = document.getElementById("chart-quarterly");
  if (!tbody || !chartEl) return;

  const activeYr = forcedYear || getSelectedDashboardYear();
  const isAll = activeYr === "ALL";
  const badgeEl = document.getElementById("dash-q-year-badge");
  if (badgeEl) badgeEl.textContent = isAll ? "ALL YEARS" : `CY ${activeYr}`;

  const report = buildQuarterlyReportData(activeYr);
  const subEl = document.getElementById("dash-quarterly-sub");
  if (subEl) {
    const labelPrefix = isAll ? "All Years" : `CY ${report.year}`;
    subEl.textContent = `${labelPrefix} Quarterly Summary — Incoming DTS (${report.totals.incTotal}), Outgoing DTS (${report.totals.outTotal}), and Mailing Process (${report.totals.mailTotal}).`;
  }

  // Grouped SVG Bar Chart (Q1-Q4: Incoming vs Outgoing vs Mailing) with clean integer Y-axis & bold figures
  const rawMax = Math.max(1, ...report.quarters.map((q) => Math.max(q.incTotal, q.outTotal, q.mailTotal)));
  const { axisMax, steps } = computeNiceYAxis(rawMax);
  const chartW = 720, chartH = 210, padL = 36, padB = 34, padT = 24;
  const plotW = chartW - padL - 16, plotH = chartH - padT - padB;
  const step = plotW / 4;
  const barW = Math.min(28, step * 0.2);

  let svg = `<svg viewBox="0 0 ${chartW} ${chartH}" width="100%" height="210">`;
  for (let g = 0; g <= steps; g++) {
    const y = padT + (plotH * g) / steps;
    const lbl = Math.round(axisMax * (1 - g / steps));
    svg += `<line x1="${padL}" y1="${y}" x2="${chartW - 10}" y2="${y}" stroke="#e4ebe7" stroke-width="1"/>`;
    svg += `<text x="${padL - 7}" y="${y + 4}" text-anchor="end" font-size="10.5" font-weight="600" fill="#5a6a62">${lbl}</text>`;
  }
  report.quarters.forEach((q, idx) => {
    const cx = padL + idx * step + step / 2;
    const bars = [
      { val: q.incTotal, color: "#2e7d32", textColor: "#1b5e20", dx: -barW * 1.5 - 4, name: "Incoming" },
      { val: q.outTotal, color: "#1565c0", textColor: "#0d47a1", dx: -barW * 0.5, name: "Outgoing" },
      { val: q.mailTotal, color: "#d4a017", textColor: "#8c5e00", dx: barW * 0.5 + 4, name: "Mailing" },
    ];
    bars.forEach((b) => {
      const h = (b.val / axisMax) * plotH;
      const y = padT + plotH - h;
      svg += `<rect x="${cx + b.dx}" y="${y}" width="${barW}" height="${h}" rx="3" fill="${b.color}"><title>${esc(q.label)} ${b.name}: ${b.val}</title></rect>`;
      if (b.val > 0) {
        svg += `<text x="${cx + b.dx + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="10.5" font-weight="800" fill="${b.textColor}">${b.val}</text>`;
      }
    });
    svg += `<text x="${cx}" y="${chartH - 12}" text-anchor="middle" font-size="11.5" font-weight="700" fill="#1c2420">${esc(q.label)}</text>`;
  });
  svg += `</svg>`;
  chartEl.innerHTML = svg;

  const renderRow = (r, isTotal = false) => {
    const grand = r.incTotal + r.outTotal + r.mailTotal;
    return `
      <tr class="${isTotal ? "total-row" : ""}">
        <td><strong>${esc(r.label)}</strong></td>
        <td class="num"><strong>${r.incTotal}</strong></td>
        <td class="num">${r.incExt}</td>
        <td class="num">${r.incInt}</td>
        <td class="num">${r.incDone}</td>
        <td class="num"><strong>${r.outTotal}</strong></td>
        <td class="num">${r.outDisp}</td>
        <td class="num">${r.outPend}</td>
        <td class="num"><strong>${r.mailTotal}</strong></td>
        <td class="num">${r.mailPhilpost}</td>
        <td class="num">${r.mailJrs}</td>
        <td class="num">${r.mailDelivered}</td>
        <td class="num"><strong>${grand}</strong></td>
      </tr>`;
  };

  tbody.innerHTML = report.quarters.map((q) => renderRow(q, false)).join("") + renderRow(report.totals, true);
}

function openPrintQuarterlyReport() {
  const yr = getSelectedDashboardYear();
  const yrHeading = yr === "ALL" ? "ALL YEARS" : `CY ${yr}`;
  const report = buildQuarterlyReportData(yr);
  const meta = state.meta || {};
  const rowHtml = (r, bold = false) => {
    const grand = r.incTotal + r.outTotal + r.mailTotal;
    const style = bold ? "font-weight:800;background:#e8f5e9;" : "";
    return `<tr style="${style}">
      <td style="padding:7px 8px;border:1px solid #333;">${esc(r.label)}</td>
      <td style="padding:7px 8px;border:1px solid #333;text-align:right;">${r.incTotal}</td>
      <td style="padding:7px 8px;border:1px solid #333;text-align:right;">${r.incExt}</td>
      <td style="padding:7px 8px;border:1px solid #333;text-align:right;">${r.incInt}</td>
      <td style="padding:7px 8px;border:1px solid #333;text-align:right;">${r.incDone}</td>
      <td style="padding:7px 8px;border:1px solid #333;text-align:right;">${r.outTotal}</td>
      <td style="padding:7px 8px;border:1px solid #333;text-align:right;">${r.outDisp}</td>
      <td style="padding:7px 8px;border:1px solid #333;text-align:right;">${r.outPend}</td>
      <td style="padding:7px 8px;border:1px solid #333;text-align:right;">${r.mailTotal}</td>
      <td style="padding:7px 8px;border:1px solid #333;text-align:right;">${r.mailPhilpost}</td>
      <td style="padding:7px 8px;border:1px solid #333;text-align:right;">${r.mailJrs}</td>
      <td style="padding:7px 8px;border:1px solid #333;text-align:right;">${r.mailDelivered}</td>
      <td style="padding:7px 8px;border:1px solid #333;text-align:right;font-weight:800;">${grand}</td>
    </tr>`;
  };
  document.getElementById("print-modal-title").textContent = `${yrHeading} Quarterly Report — DAR Eastern Visayas DTS`;
  document.getElementById("print-canvas").innerHTML = `
    <div class="slip-page">
      <div style="display:flex;align-items:center;gap:14px;border-bottom:3px solid #1b5e20;padding-bottom:10px;margin-bottom:14px;">
        <img src="/dar-ro8-logo.jpg" alt="DAR Eastern Visayas" class="slip-logo-img" />
        <div>
          <div style="font-size:11px;font-weight:700;color:#1b5e20;">REPUBLIC OF THE PHILIPPINES • DEPARTMENT OF AGRARIAN REFORM</div>
          <div style="font-size:17px;font-weight:900;color:#0d3b1e;">DAR Eastern Visayas Regional Office VIII</div>
          <div style="font-size:11.5px;color:#444;">${esc(meta.address || "Sto. Niño Extension, Tacloban City")}</div>
        </div>
      </div>
      <h2 style="text-align:center;margin:0 0 4px;font-size:16px;color:#0d3b1e;">${esc(yrHeading)} QUARTERLY DOCUMENT TRACKING &amp; MAILING REPORT</h2>
      <p style="text-align:center;margin:0 0 14px;font-size:12px;color:#555;">Incoming DTS • Outgoing DTS • Mailing Process (PhilPost &amp; JRS) — Generated ${esc(nowDateTimeStamp())}</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead>
          <tr style="background:#0d3b1e;color:#fff;">
            <th rowspan="2" style="padding:7px;border:1px solid #333;">Quarter</th>
            <th colspan="4" style="padding:6px;border:1px solid #333;background:#1b5e20;">INCOMING DTS</th>
            <th colspan="3" style="padding:6px;border:1px solid #333;background:#0d47a1;">OUTGOING DTS</th>
            <th colspan="4" style="padding:6px;border:1px solid #333;background:#b28704;">MAILING PROCESS</th>
            <th rowspan="2" style="padding:7px;border:1px solid #333;">Grand Total</th>
          </tr>
          <tr style="background:#f2f6f3;color:#1c2420;">
            <th style="padding:5px;border:1px solid #333;">Total</th>
            <th style="padding:5px;border:1px solid #333;">Ext</th>
            <th style="padding:5px;border:1px solid #333;">Int</th>
            <th style="padding:5px;border:1px solid #333;">Done</th>
            <th style="padding:5px;border:1px solid #333;">Total</th>
            <th style="padding:5px;border:1px solid #333;">Disp.</th>
            <th style="padding:5px;border:1px solid #333;">Pend.</th>
            <th style="padding:5px;border:1px solid #333;">Total</th>
            <th style="padding:5px;border:1px solid #333;">PhilPost</th>
            <th style="padding:5px;border:1px solid #333;">JRS</th>
            <th style="padding:5px;border:1px solid #333;">Deliv.</th>
          </tr>
        </thead>
        <tbody>
          ${report.quarters.map((q) => rowHtml(q, false)).join("")}
          ${rowHtml(report.totals, true)}
        </tbody>
      </table>
      <div style="margin-top:26px;display:flex;justify-content:space-between;font-size:12px;">
        <div>Prepared by:<br/><br/><strong>${esc((currentUser && currentUser.fullName) || "DAR RO VIII Staff")}</strong></div>
        <div style="text-align:right;">Noted by:<br/><br/><strong>${esc(meta.regionalDirector || "ATTY. ROBERT ANTHONY P. YU")}</strong><br/>Regional Director</div>
      </div>
    </div>
  `;
  openModal("modal-print");
}

function getActionBtnLabel(doc) {
  const perms = getBoxPermissions(currentUser, doc, false);
  if (perms.boxB) return "Box B";
  if (perms.boxC) return "Box C";
  if (perms.boxD) return "Act (Box D)";
  if (perms.boxA || perms.boxE) return "Box A / E";
  return "View";
}

function applyHdrFiltersAndSort(tbl, rows) {
  const activeCols = Object.entries(hdrFilters[tbl]);
  const filtered = rows.filter((d) => {
    for (const [col, f] of activeCols) {
      if (f.query && !getColSearchHaystack(tbl, col, d).toLowerCase().includes(f.query.toLowerCase())) return false;
      if (f.selected !== null && !f.selected.has(getColDisplayValue(tbl, col, d))) return false;
    }
    return true;
  });
  if (sortState[tbl].key) {
    const { key, dir } = sortState[tbl];
    filtered.sort((a, b) =>
      getColDisplayValue(tbl, key, a).localeCompare(getColDisplayValue(tbl, key, b), undefined, { numeric: true, sensitivity: "base" }) * dir
    );
  }
  return filtered;
}

function getFilteredIncoming() {
  const q = (document.getElementById("inc-search")?.value || "").trim().toLowerCase();
  const fYear = document.getElementById("inc-filter-year").value || "ALL";
  const fCat = document.getElementById("inc-filter-cat").value || "ALL";
  const base = state.incoming.filter((d) => {
    const cat = getIncomingCategory(d);
    const docYear = extractDocYear(d.dateReceived, d.controlNo, d.dtsYear);
    if (fYear !== "ALL" && docYear !== fYear) return false;
    if (fCat !== "ALL" && cat !== fCat) return false;
    if (incProgressFilter === "MY_PENDING" && !isPendingForUser(currentUser, d)) return false;
    if (incProgressFilter === "PENDING" && isIncomingActed(d)) return false;
    if (incProgressFilter === "ACTED" && !isIncomingActed(d)) return false;
    if (q) {
      const assigned = resolveAssignedDivision(d) || "";
      const hay = [d.controlNo, docYear, cat, d.dateReceived, formatDateShort(d.dateReceived), d.receivedBy, d.senderName, d.senderOffice, d.docType, d.thru, d.refNo, d.subject, d.attachments, assigned, d.status].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return applyHdrFiltersAndSort("inc", base);
}

function renderIncomingSummaryCards() {
  const fYear = document.getElementById("inc-filter-year")?.value || "ALL";
  const fCat = document.getElementById("inc-filter-cat")?.value || "ALL";
  const yearList = state.incoming.filter((d) => fYear === "ALL" || extractDocYear(d.dateReceived, d.controlNo, d.dtsYear) === fYear);
  const extCnt = yearList.filter((d) => getIncomingCategory(d) === "External").length;
  const intCnt = yearList.filter((d) => getIncomingCategory(d) === "Internal").length;
  const myPendCnt = yearList.filter((d) => isPendingForUser(currentUser, d)).length;
  const actedCnt = yearList.filter((d) => isIncomingActed(d)).length;
  const pendCnt = yearList.length - actedCnt;

  const meta = getUserActionMeta(currentUser);
  document.getElementById("inc-card-total").textContent = yearList.length;
  document.getElementById("inc-card-external").textContent = extCnt;
  document.getElementById("inc-card-internal").textContent = intCnt;
  document.getElementById("inc-card-my-pending").textContent = myPendCnt;
  document.getElementById("inc-my-box-badge").textContent = meta.badge;
  document.getElementById("inc-my-box-sub").textContent = meta.sub;
  document.getElementById("inc-card-pending").textContent = pendCnt;
  document.getElementById("inc-card-acted").textContent = actedCnt;
  document.getElementById("inc-stat-year-lbl").textContent = fYear === "ALL" ? "All Years" : `Year ${fYear}`;

  document.getElementById("card-inc-total").classList.toggle("active", fCat === "ALL" && incProgressFilter === "ALL");
  document.getElementById("card-inc-external").classList.toggle("active", fCat === "External");
  document.getElementById("card-inc-internal").classList.toggle("active", fCat === "Internal");
  document.getElementById("card-inc-my-pending").classList.toggle("active", incProgressFilter === "MY_PENDING");
  document.getElementById("card-inc-pending").classList.toggle("active", incProgressFilter === "PENDING");
  document.getElementById("card-inc-acted").classList.toggle("active", incProgressFilter === "ACTED");
}

const paginationState = {
  inc: { page: 1, pageSize: 15 },
  out: { page: 1, pageSize: 15 },
};

function paginateRows(tbl, rows) {
  const st = paginationState[tbl] || { page: 1, pageSize: 15 };
  const total = rows.length;
  const pageSize = st.pageSize === "ALL" ? Math.max(1, total) : Number(st.pageSize) || 15;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (st.page > totalPages) st.page = totalPages;
  if (st.page < 1) st.page = 1;
  const startIdx = (st.page - 1) * pageSize;
  const endIdx = Math.min(total, startIdx + pageSize);
  return {
    slice: rows.slice(startIdx, endIdx),
    total,
    start: total ? startIdx + 1 : 0,
    end: endIdx,
    page: st.page,
    totalPages,
    pageSize: st.pageSize,
  };
}

function renderPaginationBar(tbl, containerId, info, rerenderFn) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (info.total === 0) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.classList.remove("hidden");

  const sizes = [10, 15, 25, 50, 100, "ALL"];
  const curPage = info.page;
  const totalPages = info.totalPages;

  // Build page number list with ellipsis when > 7 pages
  const pages = [];
  if (totalPages <= 7) {
    for (let p = 1; p <= totalPages; p++) pages.push(p);
  } else {
    pages.push(1);
    if (curPage > 3) pages.push("...");
    const startP = Math.max(2, curPage - 1);
    const endP = Math.min(totalPages - 1, curPage + 1);
    for (let p = startP; p <= endP; p++) pages.push(p);
    if (curPage < totalPages - 2) pages.push("...");
    pages.push(totalPages);
  }

  el.innerHTML = `
    <div class="pg-left">
      <span>Showing <strong>${info.start}–${info.end}</strong> of <strong>${info.total}</strong> records</span>
      <label class="pg-size-wrap">
        <span>Rows:</span>
        <select class="pg-size-select" data-pg-size="${tbl}">
          ${sizes
            .map((sz) => `<option value="${sz}" ${String(info.pageSize) === String(sz) ? "selected" : ""}>${sz === "ALL" ? "All" : sz}</option>`)
            .join("")}
        </select>
      </label>
    </div>
    <div class="pg-btns">
      <button type="button" class="pg-btn" data-pg-go="1" ${curPage <= 1 ? "disabled" : ""} title="First Page">«</button>
      <button type="button" class="pg-btn" data-pg-go="${curPage - 1}" ${curPage <= 1 ? "disabled" : ""}>‹ Prev</button>
      ${pages
        .map((p) =>
          p === "..."
            ? `<span class="pg-ellipsis">…</span>`
            : `<button type="button" class="pg-btn ${p === curPage ? "active" : ""}" data-pg-go="${p}">${p}</button>`
        )
        .join("")}
      <button type="button" class="pg-btn" data-pg-go="${curPage + 1}" ${curPage >= totalPages ? "disabled" : ""}>Next ›</button>
      <button type="button" class="pg-btn" data-pg-go="${totalPages}" ${curPage >= totalPages ? "disabled" : ""} title="Last Page">»</button>
    </div>
  `;

  el.querySelector(`[data-pg-size="${tbl}"]`)?.addEventListener("change", (e) => {
    const val = e.target.value;
    paginationState[tbl].pageSize = val === "ALL" ? "ALL" : Number(val) || 15;
    paginationState[tbl].page = 1;
    rerenderFn();
  });
  el.querySelectorAll("[data-pg-go]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = Number(btn.getAttribute("data-pg-go"));
      if (!isNaN(target) && target >= 1 && target <= totalPages && target !== curPage) {
        paginationState[tbl].page = target;
        rerenderFn();
      }
    });
  });
}

function renderIncomingTable() {
  renderIncomingSummaryCards();
  const filtered = getFilteredIncoming();
  const pageInfo = paginateRows("inc", filtered);

  const tbody = document.getElementById("incoming-tbody");
  if (!filtered.length) {
    const fYear = document.getElementById("inc-filter-year")?.value || "ALL";
    const emptyMsg =
      state.incoming.length === 0 && currentUser && (currentUser.role === "ARD_SECRETARY" || currentUser.role === "DIVISION_CHIEF")
        ? `No incoming documents have been forwarded to ${esc(currentUser.division)} from the RD Office yet.`
        : fYear !== "ALL"
        ? `No incoming documents found for Year <strong>${esc(fYear)}</strong>.`
        : "No incoming documents match your current filters.";
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:28px;color:#5a6a62;">${emptyMsg}</td></tr>`;
    renderPaginationBar("inc", "inc-pagination", pageInfo, renderIncomingTable);
    return;
  }

  tbody.innerHTML = pageInfo.slice
    .map((d) => {
      const sla = computeSLA(d);
      const due = computeDueDate(d);
      const assigned = resolveAssignedDivision(d) || "Pending Routing";
      const actLabel = getActionBtnLabel(d);
      const cat = d.docCategory || (String(d.controlNo || "").toUpperCase().startsWith("I-") ? "Internal" : "External");
      const catBadge = cat === "Internal" ? `<span class="cat-tag int">INT</span>` : `<span class="cat-tag ext">EXT</span>`;
      return `
        <tr>
          <td><span class="code-pill">${esc(d.controlNo)}</span>${catBadge}<div class="sub-line">Ref: ${esc(d.refNo || "NONE")}</div></td>
          <td>${esc(formatDateShort(d.dateReceived))}<div class="sub-line">${esc(d.timeReceived || "")} • ${esc(d.receivedBy || "")}</div></td>
          <td><strong>${esc(d.senderName)}</strong><div class="sub-line">${esc(d.senderOffice)}</div></td>
          <td><strong>${esc(d.subject)}</strong>${pdfBadgeHtml(d)}<div class="sub-line">${esc(d.docType)} • Thru ${esc(d.thru)}</div></td>
          <td><span class="div-tag">${esc(assigned)}</span></td>
          <td>${esc(d.ardTimeFrame || d.rdTimeFrame || "—")}<div class="sub-line">Due: ${esc(formatDateShort(due))}</div></td>
          <td>${statusBadge(d.status)}</td>
          <td><span class="badge ${sla.cls}">${esc(sla.label)}</span></td>
          <td class="actions-col">
            <button class="btn btn-sm btn-outline" onclick="openTrack('${esc(d.controlNo)}')">Track</button>
            <button class="btn btn-sm btn-outline" onclick="openEditIncoming('${esc(d.controlNo)}')">${esc(actLabel)}</button>
            <button class="btn btn-sm btn-primary" onclick="openPrintIncoming('${esc(d.controlNo)}')">🖨️ Slip</button>
          </td>
        </tr>`;
    })
    .join("");

  renderPaginationBar("inc", "inc-pagination", pageInfo, renderIncomingTable);
}

function getFilteredOutgoing() {
  const q = (document.getElementById("out-search")?.value || "").trim().toLowerCase();
  const fYear = document.getElementById("out-filter-year").value || "ALL";
  const base = state.outgoing.filter((d) => {
    const docYear = extractDocYear(d.dateOriginated, d.recNo || d.userDocNo, d.dtsYear);
    if (fYear !== "ALL" && docYear !== fYear) return false;
    if (q) {
      const hay = [d.userDocNo, d.recNo || "pending records", docYear, d.dateOriginated, formatDateShort(d.dateOriginated), d.originatingDivision, d.docDescription, d.subject, d.recipientTo, d.recipientOffice, d.preparedBy, d.status].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  return applyHdrFiltersAndSort("out", base);
}

function getOutgoingKey(d) {
  return d.id || d.recNo || d.userDocNo || "";
}

function renderOutgoingNoCell(d) {
  const userNoHtml = d.userDocNo ? `<div class="sub-line" style="margin-top:4px;">User No.: <strong>${esc(d.userDocNo)}</strong></div>` : "";
  const recPill = d.recNo
    ? `<span class="code-pill out" title="DAR8 Rec. No. (Assigned by Records)">${esc(d.recNo)}</span>`
    : `<span class="badge badge-due" title="DAR8 Rec. No. will be assigned by Records Unit in Box E">⏳ Pending DAR8 Rec. No.</span>`;
  return `${recPill}${userNoHtml}`;
}

function renderOutgoingTable() {
  const filtered = getFilteredOutgoing();
  const pageInfo = paginateRows("out", filtered);
  const isRecordsOrAdmin = currentUser && (currentUser.role === "RECORDS" || currentUser.role === "ADMIN");

  const tbody = document.getElementById("outgoing-tbody");
  if (!filtered.length) {
    const fYear = document.getElementById("out-filter-year")?.value || "ALL";
    const emptyMsg =
      state.outgoing.length === 0 && currentUser && (currentUser.role === "ARD_SECRETARY" || currentUser.role === "DIVISION_CHIEF")
        ? `No outgoing documents for ${esc(currentUser.division)} yet.`
        : fYear !== "ALL"
        ? `No outgoing documents found for Year <strong>${esc(fYear)}</strong>.`
        : "No outgoing documents match your current filters.";
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:28px;color:#5a6a62;">${emptyMsg}</td></tr>`;
    renderPaginationBar("out", "out-pagination", pageInfo, renderOutgoingTable);
    return;
  }

  tbody.innerHTML = pageInfo.slice
    .map((d) => {
      const key = getOutgoingKey(d);
      const trackKey = d.recNo || d.userDocNo || key;
      const editLabel = isRecordsOrAdmin ? (d.recNo ? "Box D / E" : "Assign DAR8 No.") : "Edit (Box A–C)";
      const fcArr = Array.isArray(d.furnishedCopy) ? d.furnishedCopy : [];
      const fcHtml = fcArr.length
        ? `<div class="fc-table-tags">${fcArr.map((f) => `<span class="fc-mini-tag ${f.startsWith("DARPO") ? "darpo" : ""}">${esc(f)}</span>`).join("")}</div>`
        : "";
      const cleanAtt = d.attachments && !/\.pdf$/i.test(String(d.attachments).trim()) && String(d.attachments).trim().toUpperCase() !== "NONE"
        ? ` • Att: ${esc(String(d.attachments).length > 48 ? String(d.attachments).slice(0, 45) + "…" : d.attachments)}`
        : "";
      return `
      <tr>
        <td>${renderOutgoingNoCell(d)}</td>
        <td>${esc(formatDateShort(d.dateOriginated))}<div class="sub-line">By: ${esc(d.preparedBy || "—")}</div></td>
        <td><span class="div-tag">${esc(d.originatingDivision)}</span></td>
        <td><strong>${esc(d.subject)}</strong>${pdfBadgeHtml(d)}<div class="sub-line">${esc(d.docDescription)}${cleanAtt}</div>${fcHtml}</td>
        <td><strong>${esc(d.recipientTo || "—")}</strong><div class="sub-line">${esc(d.recipientOffice || "")}</div></td>
        <td>${esc(d.finalDispatchMode || d.transmissionMode || "—")}<div class="sub-line">${d.dateDispatched ? "Released: " + esc(formatDateTimeDisplay(d.dateDispatched)) : "Pending release"}</div></td>
        <td>${statusBadge(d.status)}</td>
        <td class="actions-col">
          <button class="btn btn-sm btn-outline" onclick="openTrack('${esc(trackKey)}')">Track</button>
          <button class="btn btn-sm ${isRecordsOrAdmin && !d.recNo ? "btn-primary" : "btn-outline"}" onclick="openEditOutgoing('${esc(key)}')">${esc(editLabel)}</button>
          <button class="btn btn-sm btn-blue" onclick="openPrintOutgoing('${esc(key)}')">🖨️ Slip</button>
        </td>
      </tr>`;
    })
    .join("");

  renderPaginationBar("out", "out-pagination", pageInfo, renderOutgoingTable);
}

function renderDivisionPortal() {
  const pillsEl = document.getElementById("division-pills");
  const isScopedRole = currentUser && (currentUser.role === "ARD_SECRETARY" || currentUser.role === "DIVISION_CHIEF");
  const portalDivs = isScopedRole
    ? state.divisions.filter((div) => {
        if (divisionMatches(currentUser.division, div.code)) return true;
        if (currentUser.role === "ARD_SECRETARY") {
          return state.incoming.some((d) => divisionMatches(div.code, resolveAssignedDivision(d)));
        }
        return false;
      })
    : state.divisions;
  if (portalDivs.length && !portalDivs.some((d) => d.code === selectedPortalDiv)) {
    selectedPortalDiv = portalDivs[0].code;
  }
  pillsEl.innerHTML = portalDivs
    .map((div) => {
      const cnt =
        state.incoming.filter((d) => divisionMatches(div.code, resolveAssignedDivision(d))).length +
        state.outgoing.filter((d) => divisionMatches(div.code, d.originatingDivision)).length;
      const active = selectedPortalDiv === div.code ? "active" : "";
      return `<button class="div-pill ${active}" data-div="${esc(div.code)}">${esc(div.code)}<span class="pill-cnt">${cnt}</span></button>`;
    })
    .join("");

  pillsEl.querySelectorAll(".div-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedPortalDiv = btn.getAttribute("data-div");
      renderDivisionPortal();
    });
  });

  const divObj = state.divisions.find((d) => d.code === selectedPortalDiv) || { code: selectedPortalDiv, name: selectedPortalDiv };
  const incList = state.incoming.filter((d) => divisionMatches(selectedPortalDiv, resolveAssignedDivision(d)));
  const outList = state.outgoing.filter((d) => divisionMatches(selectedPortalDiv, d.originatingDivision));
  const incDone = incList.filter((d) => d.status === "Completed / Returned to Records" || d.status === "Archived").length;
  const incOver = incList.filter((d) => computeSLA(d).key === "OVERDUE").length;
  const outDisp = outList.filter((d) => d.status === "Dispatched / Released" || d.status === "Archived").length;

  document.getElementById("portal-summary-strip").innerHTML = `
    <div class="portal-stat"><div class="lbl">Incoming Total</div><div class="val">${incList.length}</div></div>
    <div class="portal-stat"><div class="lbl">Incoming Active</div><div class="val text-amber">${incList.length - incDone}</div></div>
    <div class="portal-stat"><div class="lbl">Incoming Overdue</div><div class="val text-red">${incOver}</div></div>
    <div class="portal-stat"><div class="lbl">Incoming Done</div><div class="val text-green">${incDone}</div></div>
    <div class="portal-stat"><div class="lbl">Outgoing Total</div><div class="val text-blue">${outList.length}</div></div>
    <div class="portal-stat"><div class="lbl">Outgoing Dispatched</div><div class="val text-green">${outDisp}</div></div>
  `;

  document.getElementById("portal-inc-title").textContent = `Incoming Documents Routed to ${divObj.code} (${divObj.name})`;
  document.getElementById("portal-out-title").textContent = `Outgoing Documents Originating from ${divObj.code}`;

  document.getElementById("portal-inc-tbody").innerHTML = incList.length
    ? incList
        .map((d) => {
          const sla = computeSLA(d);
          return `
          <tr>
            <td><span class="code-pill">${esc(d.controlNo)}</span></td>
            <td>${esc(formatDateShort(d.dateReceived))}</td>
            <td><strong>${esc(d.senderName)}</strong><div class="sub-line">${esc(d.senderOffice)}</div></td>
            <td><strong>${esc(d.subject)}</strong>${pdfBadgeHtml(d)}</td>
            <td>${esc(d.ardTimeFrame || d.rdTimeFrame || "—")}</td>
            <td>${statusBadge(d.status)}</td>
            <td><span class="badge ${sla.cls}">${esc(sla.label)}</span></td>
            <td class="actions-col">
              <button class="btn btn-sm btn-outline" onclick="openEditIncoming('${esc(d.controlNo)}')">${esc(getActionBtnLabel(d))}</button>
              <button class="btn btn-sm btn-primary" onclick="openPrintIncoming('${esc(d.controlNo)}')">🖨️ Slip</button>
            </td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="8" style="text-align:center;padding:20px;color:#5a6a62;">No incoming documents routed to ${esc(divObj.code)} yet.</td></tr>`;

  document.getElementById("portal-out-tbody").innerHTML = outList.length
    ? outList
        .map((d) => {
          const key = getOutgoingKey(d);
          return `
          <tr>
            <td>${renderOutgoingNoCell(d)}</td>
            <td>${esc(formatDateShort(d.dateOriginated))}</td>
            <td>${esc(d.docDescription)}</td>
            <td><strong>${esc(d.subject)}</strong>${pdfBadgeHtml(d)}</td>
            <td>${esc(d.recipientTo)}<div class="sub-line">${esc(d.recipientOffice)}</div></td>
            <td>${statusBadge(d.status)}</td>
            <td class="actions-col">
              <button class="btn btn-sm btn-outline" onclick="openEditOutgoing('${esc(key)}')">Update</button>
              <button class="btn btn-sm btn-blue" onclick="openPrintOutgoing('${esc(key)}')">🖨️ Slip</button>
            </td>
          </tr>`;
        })
        .join("")
    : `<tr><td colspan="7" style="text-align:center;padding:20px;color:#5a6a62;">No outgoing documents originating from ${esc(divObj.code)} yet.</td></tr>`;
}

// ----------------- Tracker Timeline + Audit History -----------------
function renderTrackerChips() {
  const chips = [
    ...state.incoming.slice(0, 3).map((d) => d.controlNo),
    ...state.outgoing.slice(0, 2).map((d) => d.recNo || d.userDocNo).filter(Boolean),
  ];
  document.getElementById("tracker-recent-chips").innerHTML = chips
    .map((id) => `<button class="tracker-chip" onclick="openTrack('${esc(id)}')">${esc(id)}</button>`)
    .join("");
}

window.openTrack = function (code) {
  pulseLoading(`Tracking ${code}...`, () => {
    switchView("tracker", true);
    document.getElementById("tracker-input").value = code;
    runTrackerLookup(code);
  }, "Loading routing timeline & audit trail");
};

function runTrackerLookup(query) {
  const q = (query || "").trim().toLowerCase();
  const container = document.getElementById("tracker-result");
  if (!q) { container.innerHTML = ""; return; }

  const inc = state.incoming.find((d) => d.controlNo.toLowerCase() === q || d.subject.toLowerCase().includes(q));
  if (inc) {
    const sla = computeSLA(inc);
    const due = computeDueDate(inc);
    const assigned = resolveAssignedDivision(inc) || "Pending Routing";
    const steps = [
      { box: "Box A • Records", title: "Records Unit Received", done: !!inc.dateReceived, meta: `${formatDateShort(inc.dateReceived)} ${inc.timeReceived || ""}<br>By: ${esc(inc.receivedBy || "—")}<br>Thru: ${esc(inc.thru || "—")}` },
      { box: "Box B • RD Sec.", title: "RD / RD's Secretary", done: !!inc.rdDateTime || !!inc.rdInstructionsTo || !!inc.rdInstructions, meta: `${esc(inc.rdDateTime || "Pending")}<br>To: <strong>${esc(inc.rdInstructionsTo || "—")}</strong><br>${esc(inc.rdInstructions || "")}` },
      { box: "Box C • ARD", title: "ARD Assignment", done: !!inc.ardInstructionsTo || !!inc.ardInstructions, meta: `${esc(inc.ardDateTime || "N/A / Direct from RD")}<br>Assigned: <strong>${esc(inc.ardInstructionsTo || "—")}</strong><br>${esc(inc.ardInstructions || "")}` },
      { box: "Box D • Div. Chief", title: `Action: ${assigned}`, done: !!inc.dateActed, current: !inc.dateActed && (inc.status === "Routed to Division" || inc.status === "In Progress"), meta: `Recv: ${esc(inc.divDateTime || "Pending")}<br>Action: ${esc(inc.divActionTaken || "Awaiting action")}<br>Acted: ${inc.dateActed ? formatDateShort(inc.dateActed) : "Pending"}` },
      { box: "Box E • Records", title: "Dispatch & Return", done: inc.status === "Completed / Returned to Records" || inc.status === "Archived", current: inc.status === "For Dispatch", meta: `Mode: ${esc(inc.recordsDispatchMode || "Pending")}<br>Returned: ${esc(inc.returnedAs || "Not yet returned")}<br>${esc(inc.dateReturnedBy || "")}` },
    ];
    const historyHtml = (inc.history && inc.history.length)
      ? `<div class="audit-box"><h4 style="margin:0 0 10px;color:var(--dar-dark);">Routing &amp; Status Audit Trail</h4>${inc.history.slice().reverse().map((h) => `
          <div class="audit-item">
            <div><strong>${esc(h.box)}</strong> — ${esc(h.by)} <span class="muted-text">(${esc(h.role)})</span>: ${esc(h.note)}</div>
            <div>${statusBadge(h.status)} <span class="muted-text" style="margin-left:6px;">${esc(h.at)}</span></div>
          </div>`).join("")}</div>`
      : "";

    const trackerPdfHtml = inc.attachmentFile && inc.attachmentFile.url
      ? `<div class="pdf-viewer-shell" style="margin-top:16px;">
          <div class="pdf-viewer-bar">
            <div><strong>📄 Attached PDF Document:</strong> ${esc(inc.attachmentFile.name)} <span class="muted-text">(${esc(formatFileSize(inc.attachmentFile.size))})</span></div>
            <div style="display:flex;gap:8px;">
              <a class="btn btn-sm btn-primary" href="${esc(inc.attachmentFile.driveUrl || inc.attachmentFile.url)}" target="_blank" rel="noopener">Open Full Screen ↗</a>
            </div>
          </div>
          <div class="pdf-embed-wrap"><iframe class="pdf-embed-frame" src="${esc(getPdfEmbedUrl(inc.attachmentFile))}" title="Attached PDF Preview"></iframe></div>
        </div>`
      : "";

    const trackerReplyPdfHtml = inc.replyAttachmentFile && (inc.replyAttachmentFile.url || inc.replyAttachmentFile.localUrl)
      ? `<div class="pdf-viewer-shell" style="margin-top:16px;">
          <div class="pdf-viewer-bar">
            <div title="${esc(inc.replyAttachmentFile.name)}"><strong>📄 Reply / Action Taken PDF</strong> <span class="muted-text">(${esc(formatFileSize(inc.replyAttachmentFile.size))})</span></div>
            <div style="display:flex;gap:8px;">
              <a class="btn btn-sm btn-primary" href="${esc(inc.replyAttachmentFile.driveUrl || inc.replyAttachmentFile.url)}" target="_blank" rel="noopener">Open Full Screen ↗</a>
            </div>
          </div>
          <div class="pdf-embed-wrap"><iframe class="pdf-embed-frame" src="${esc(getPdfEmbedUrl(inc.replyAttachmentFile))}" title="Reply Action PDF Preview"></iframe></div>
        </div>`
      : "";

    container.innerHTML = `
      <div class="card timeline-card">
        <div class="timeline-header">
          <div>
            <span class="code-pill">${esc(inc.controlNo)}</span>
            <span class="badge ${sla.cls}" style="margin-left:6px">${esc(sla.label)}</span>
            <span style="margin-left:6px">${statusBadge(inc.status)}</span>
            <h3 style="margin:10px 0 4px">${esc(inc.subject)}</h3>
            <div class="sub-line">From: <strong>${esc(inc.senderName)}</strong> (${esc(inc.senderOffice)}) • Type: ${esc(inc.docType)} • Target Due: <strong>${esc(formatDateShort(due))}</strong></div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${inc.attachmentFile && inc.attachmentFile.url ? `<a class="btn btn-outline" href="${esc(inc.attachmentFile.driveUrl || inc.attachmentFile.url)}" target="_blank" rel="noopener">📄 Open PDF ↗</a>` : ""}
            ${inc.replyAttachmentFile && inc.replyAttachmentFile.url ? `<a class="btn btn-outline" href="${esc(inc.replyAttachmentFile.driveUrl || inc.replyAttachmentFile.url)}" target="_blank" rel="noopener">📄 Open Reply PDF ↗</a>` : ""}
            <button class="btn btn-outline" onclick="openEditIncoming('${esc(inc.controlNo)}')">${esc(getActionBtnLabel(inc))}</button>
            <button class="btn btn-primary" onclick="openPrintIncoming('${esc(inc.controlNo)}')">🖨️ Print DR08-STOR-F-001-REV-01</button>
          </div>
        </div>
        <div class="timeline-steps">
          ${steps.map((s) => `
            <div class="t-step ${s.done ? "done" : s.current ? "current" : ""}">
              <div class="t-step-num">${s.done ? "✓ " : ""}${esc(s.box)}</div>
              <div class="t-step-title">${esc(s.title)}</div>
              <div class="t-step-meta">${s.meta}</div>
            </div>`).join("")}
        </div>
        ${trackerPdfHtml}
        ${trackerReplyPdfHtml}
        ${historyHtml}
      </div>`;
    return;
  }

  const out = state.outgoing.find(
    (d) =>
      String(d.recNo || "").toLowerCase() === q ||
      String(d.userDocNo || "").toLowerCase() === q ||
      String(d.id || "").toLowerCase() === q ||
      String(d.subject || "").toLowerCase().includes(q)
  );
  if (out) {
    const outKey = getOutgoingKey(out);
    const fcList = Array.isArray(out.furnishedCopy) && out.furnishedCopy.length ? out.furnishedCopy.join(", ") : "None";
    const steps = [
      { box: "Box A • Source", title: `Originated: ${out.originatingDivision}`, done: !!out.dateOriginated, meta: `User No.: <strong>${esc(out.userDocNo || "—")}</strong><br>${formatDateShort(out.dateOriginated)} • To: ${esc(out.recipientTo || "—")}` },
      { box: "Box B • Type", title: out.docDescription || "Doc Description", done: !!out.docDescription, meta: `Mode: ${esc(out.transmissionMode || "—")}<br>Furnished Copy: <strong>${esc(fcList)}</strong>` },
      { box: "Box C • Approval", title: "Counter-Sign & Approval", done: !!out.approvedBy && out.status !== "For Counter-Signature" && out.status !== "For Approval", current: out.status === "For Approval" || out.status === "For Counter-Signature", meta: `Counter-Sign: ${esc(out.counterSignBy || "—")}<br>Approved: ${esc(out.approvedBy || "Pending")}` },
      { box: "Box D • Records Release", title: out.recNo ? `DAR8 Rec. No.: ${out.recNo}` : "Pending DAR8 Rec. No.", done: out.status === "Dispatched / Released" || !!out.dateDispatched || out.status === "Returned to Originating Office" || out.status === "Archived", current: !!out.recNo && !out.dateDispatched, meta: `Mode: ${esc(out.finalDispatchMode || "Pending")}<br>Released: ${out.dateDispatched ? esc(formatDateTimeDisplay(out.dateDispatched)) : "Pending"}<br>${esc(out.dispatchDetails || "")}` },
      { box: "Box E • Return", title: "Returned to Originating Office", done: !!out.dateReceivedBack || !!out.returnedToOffice, current: !!out.dateDispatched && !out.dateReceivedBack, meta: `Office: ${esc(out.returnedToOffice || "Pending")}<br>Recv Back: ${esc(out.dateReceivedBack || "Pending")}` },
    ];
    const outPdfHtml = out.attachmentFile && out.attachmentFile.url
      ? `<div class="pdf-viewer-shell" style="margin-top:16px;">
          <div class="pdf-viewer-bar">
            <div title="${esc(out.attachmentFile.name)}"><strong>📄 Scanned PDF</strong> <span class="muted-text">(${esc(formatFileSize(out.attachmentFile.size))})</span></div>
            <div style="display:flex;gap:8px;">
              <a class="btn btn-sm btn-primary" href="${esc(out.attachmentFile.driveUrl || out.attachmentFile.url)}" target="_blank" rel="noopener">Open Full Screen ↗</a>
            </div>
          </div>
          <div class="pdf-embed-wrap"><iframe class="pdf-embed-frame" src="${esc(getPdfEmbedUrl(out.attachmentFile))}" title="Scanned Outgoing PDF Preview"></iframe></div>
        </div>`
      : "";
    container.innerHTML = `
      <div class="card timeline-card">
        <div class="timeline-header">
          <div>
            ${out.recNo ? `<span class="code-pill out">${esc(out.recNo)}</span>` : `<span class="badge badge-due">⏳ Pending DAR8 Rec. No.</span>`}
            ${out.userDocNo ? `<span class="code-pill" style="margin-left:6px;background:#eceff1;color:#37474f;">User No.: ${esc(out.userDocNo)}</span>` : ""}
            <span style="margin-left:6px">${statusBadge(out.status)}</span>
            <h3 style="margin:10px 0 4px">${esc(out.subject)}</h3>
            <div class="sub-line">Originating: <strong>${esc(out.originatingDivision)}</strong> • To: <strong>${esc(out.recipientTo)}</strong> (${esc(out.recipientOffice)})</div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            ${out.attachmentFile && out.attachmentFile.url ? `<a class="btn btn-outline" href="${esc(out.attachmentFile.driveUrl || out.attachmentFile.url)}" target="_blank" rel="noopener">📄 Open Scanned PDF ↗</a>` : ""}
            <button class="btn btn-outline" onclick="openEditOutgoing('${esc(outKey)}')">Update Routing</button>
            <button class="btn btn-blue" onclick="openPrintOutgoing('${esc(outKey)}')">🖨️ Print DTS-OUTGOING</button>
          </div>
        </div>
        <div class="timeline-steps">
          ${steps.map((s) => `
            <div class="t-step ${s.done ? "done" : s.current ? "current" : ""}">
              <div class="t-step-num">${s.done ? "✓ " : ""}${esc(s.box)}</div>
              <div class="t-step-title">${esc(s.title)}</div>
              <div class="t-step-meta">${s.meta}</div>
            </div>`).join("")}
        </div>
        ${outPdfHtml}
      </div>`;
    return;
  }

  container.innerHTML = `<div class="card" style="padding:28px;text-align:center;color:#c62828;font-weight:600;">No document found matching "${esc(query)}". Check the Control No. or DAR8 Rec. No. and try again.</div>`;
}

// ----------------- Modals, Role-Based Box Locks & Live Auto-Status -----------------
function openModal(id) {
  document.getElementById(id).classList.add("open");
  document.getElementById(id).setAttribute("aria-hidden", "false");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
  document.getElementById(id).setAttribute("aria-hidden", "true");
}

function activateTab(tabBarId, tabId) {
  const bar = document.getElementById(tabBarId);
  const modal = bar.closest(".modal");
  bar.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.getAttribute("data-tab") === tabId));
  modal.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.id === tabId));
}

function readIncomingFormSnapshot() {
  const form = document.getElementById("form-incoming");
  const snap = {};
  form.querySelectorAll("input, select, textarea").forEach((el) => {
    if (!el.name) return;
    if (el.type === "checkbox") snap[el.name] = el.checked;
    else if (el.type === "datetime-local") snap[el.name] = fromDatetimeLocalValue(el.value);
    else snap[el.name] = el.value;
  });
  snap.attachmentFile = currentAttachmentFile;
  snap.replyAttachmentFile = currentIncReplyAttachmentFile;
  snap.boxERecipients = [...selectedIncBoxERecipients];
  const dtRet = String(snap.dateReturnedAt || "").trim();
  const relBy = String(snap.releasedBy || "").trim();
  if (dtRet || relBy) snap.dateReturnedBy = [dtRet, relBy].filter(Boolean).join(" / ");
  return snap;
}

function renderIncReplyPdfBar() {
  const bar = document.getElementById("inc-reply-pdf-viewer-bar");
  const statusEl = document.getElementById("inc-reply-pdf-status");
  if (!bar || !statusEl) return;
  const canRemove = currentIncomingPerms.boxE;
  if (currentIncReplyAttachmentFile && (currentIncReplyAttachmentFile.url || currentIncReplyAttachmentFile.localUrl || currentIncReplyAttachmentFile.driveUrl)) {
    const syncTag = currentIncReplyAttachmentFile.driveSynced
      ? `<span class="badge badge-completed" style="margin-left:6px;">☁️ Saved in Google Drive</span>`
      : `<span class="badge badge-due" style="margin-left:6px;" title="${esc(currentIncReplyAttachmentFile.driveNote || "Local copy only")}">💻 Local Copy</span>`;
    statusEl.innerHTML = `✅ <strong>Reply / Action PDF Uploaded</strong> (${esc(formatFileSize(currentIncReplyAttachmentFile.size))}) ${syncTag}`;
    bar.classList.remove("hidden");
    const openHref = currentIncReplyAttachmentFile.driveUrl || currentIncReplyAttachmentFile.url || currentIncReplyAttachmentFile.localUrl;
    const embedSrc = getPdfEmbedUrl(currentIncReplyAttachmentFile);
    bar.innerHTML = `
      <div class="pdf-viewer-bar">
        <div title="${esc(currentIncReplyAttachmentFile.name)}">
          <strong>📄 Reply / Action Taken PDF</strong>
          <span class="muted-text">(${esc(formatFileSize(currentIncReplyAttachmentFile.size))} • Uploaded by ${esc(currentIncReplyAttachmentFile.uploadedBy || "Records")})</span>
          ${syncTag}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm btn-outline" id="btn-toggle-inc-reply-pdf">${incReplyPdfPreviewExpanded ? "🙈 Hide PDF Preview" : "👁️ Show PDF Preview"}</button>
          <a class="btn btn-sm btn-primary" href="${esc(openHref)}" target="_blank" rel="noopener">${currentIncReplyAttachmentFile.driveUrl ? "Open in Google Drive ↗" : "Open Full Tab ↗"}</a>
          ${currentIncReplyAttachmentFile.driveUrl && currentIncReplyAttachmentFile.localUrl ? `<a class="btn btn-sm btn-outline" href="${esc(currentIncReplyAttachmentFile.localUrl)}" target="_blank" rel="noopener">Local Copy</a>` : ""}
          ${canRemove ? `<button type="button" class="btn btn-sm btn-danger" id="btn-remove-inc-reply-pdf">✕ Remove</button>` : ""}
        </div>
      </div>
      <div class="pdf-embed-wrap ${incReplyPdfPreviewExpanded ? "" : "collapsed"}" id="inc-reply-pdf-embed-wrap">
        <iframe class="pdf-embed-frame" src="${esc(embedSrc)}" title="Reply Action PDF Preview"></iframe>
      </div>
    `;
    const toggleBtn = document.getElementById("btn-toggle-inc-reply-pdf");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        incReplyPdfPreviewExpanded = !incReplyPdfPreviewExpanded;
        const wrap = document.getElementById("inc-reply-pdf-embed-wrap");
        if (wrap) wrap.classList.toggle("collapsed", !incReplyPdfPreviewExpanded);
        toggleBtn.textContent = incReplyPdfPreviewExpanded ? "🙈 Hide PDF Preview" : "👁️ Show PDF Preview";
      });
    }
    const rmBtn = document.getElementById("btn-remove-inc-reply-pdf");
    if (rmBtn) {
      rmBtn.addEventListener("click", () => {
        currentIncReplyAttachmentFile = null;
        document.getElementById("inc-reply-pdf-input").value = "";
        renderIncReplyPdfBar();
        renderIncBoxERecipientChipsAndSummary();
      });
    }
  } else {
    statusEl.textContent = "No reply / action PDF uploaded yet";
    bar.classList.add("hidden");
    bar.innerHTML = "";
  }
}

function renderIncBoxERecipientPicker() {
  const listEl = document.getElementById("inc-boxe-recip-list");
  const addCustomBtn = document.getElementById("btn-inc-recip-add-custom");
  if (!listEl) return;
  const rawSearch = (document.getElementById("inc-boxe-recip-search")?.value || "").trim();
  const q = rawSearch.toLowerCase();
  const emailMap = (state.meta && state.meta.officeEmails) || {};
  const { roDivs, darpos, all } = getAllFurnishedCopyOptions();

  if (addCustomBtn) {
    const exactExists = all.some((o) => o.code.toLowerCase() === q);
    addCustomBtn.classList.toggle("hidden", !rawSearch || exactExists);
  }

  const renderGroup = (title, items) => {
    const filtered = items.filter((o) => !q || o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q));
    if (!filtered.length) return "";
    return `
      <div class="multi-drop-group">${esc(title)}</div>
      ${filtered
        .map((o) => {
          const checked = selectedIncBoxERecipients.has(o.code);
          const email = String(emailMap[o.code] || "").trim();
          const emailBadge = email
            ? `<span class="multi-drop-item-email" title="${esc(email)}">📧 ${esc(email)}</span>`
            : `<span class="multi-drop-item-email missing">No admin email set</span>`;
          return `
          <label class="multi-drop-item">
            <span class="multi-drop-item-left">
              <input type="checkbox" data-inc-recip-code="${esc(o.code)}" ${checked ? "checked" : ""} />
              <span><strong>${esc(o.code)}</strong></span>
            </span>
            ${emailBadge}
          </label>`;
        })
        .join("")}
    `;
  };

  listEl.innerHTML =
    renderGroup("Regional Office VIII Divisions & STO Sections", roDivs) +
    renderGroup("DAR Provincial Offices (DARPO Region VIII)", darpos) ||
    `<div style="padding:10px;text-align:center;color:#5a6a62;font-size:12px;">No preset match — click <strong>+ Add</strong> above to add "${esc(rawSearch)}".</div>`;

  listEl.querySelectorAll('input[type="checkbox"][data-inc-recip-code]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const code = cb.getAttribute("data-inc-recip-code");
      if (cb.checked) selectedIncBoxERecipients.add(code);
      else selectedIncBoxERecipients.delete(code);
      renderIncBoxERecipientChipsAndSummary();
    });
  });

  renderIncBoxERecipientChipsAndSummary();
}

function renderIncBoxERecipientChipsAndSummary(recLog = null) {
  const chipsEl = document.getElementById("inc-boxe-recip-chips");
  const summaryEl = document.getElementById("inc-boxe-recip-summary");
  const emailBox = document.getElementById("inc-boxe-email-status-box");
  const selected = [...selectedIncBoxERecipients];
  const emailMap = (state.meta && state.meta.officeEmails) || {};
  const canEditE = currentIncomingPerms.boxE;

  if (summaryEl) {
    summaryEl.textContent = selected.length
      ? `${selected.length} recipient${selected.length > 1 ? "s" : ""} selected`
      : "Select RO VIII sections / DARPOs or type custom recipient / email...";
  }
  if (chipsEl) {
    chipsEl.innerHTML = selected
      .map((code) => {
        const isDarpo = code.startsWith("DARPO");
        const em = emailMap[code] ? ` (${emailMap[code]})` : "";
        return `<span class="fc-chip ${isDarpo ? "darpo" : ""}" title="${esc(code + em)}">${esc(code)}${canEditE ? `<button type="button" data-inc-recip-remove="${esc(code)}" aria-label="Remove">×</button>` : ""}</span>`;
      })
      .join("");
    chipsEl.querySelectorAll("[data-inc-recip-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedIncBoxERecipients.delete(btn.getAttribute("data-inc-recip-remove"));
        renderIncBoxERecipientPicker();
      });
    });
  }

  if (emailBox) {
    if (!selected.length) {
      emailBox.innerHTML = `ℹ️ <strong>Box E Email Dispatch:</strong> Select Recipient (To) offices above and upload a Reply / Action PDF to email them from <code>${esc((state.meta && state.meta.senderEmail) || "darrec8@gmail.com")}</code>.`;
    } else {
      const resolveEm = (c) => emailMap[c] || (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c) ? c : "");
      const ready = selected.filter((c) => resolveEm(c));
      const missing = selected.filter((c) => !resolveEm(c));
      const readyText = ready.length
        ? `✅ <strong>Ready to Email (${ready.length}):</strong> ${ready.map((c) => `${esc(c)} (<code>${esc(resolveEm(c))}</code>)`).join(", ")}`
        : "";
      const missText = missing.length
        ? `<div style="margin-top:4px;color:#b7410e;">⚠️ <strong>No Admin Email Set Yet (${missing.length}):</strong> ${missing.map((c) => esc(c)).join(", ")}</div>`
        : "";
      const attNote = currentIncReplyAttachmentFile
        ? `<div style="margin-top:5px;color:#1b5e20;">📎 <strong>Reply / Action PDF Ready to Send</strong> (${esc(formatFileSize(currentIncReplyAttachmentFile.size))})</div>`
        : "";
      const logLine =
        recLog && recLog.attempted
          ? recLog.sent
            ? `<div style="margin-top:6px;color:#1b5e20;">📨 <strong>Last Sent:</strong> ${esc(recLog.sentAt)} via ${esc(recLog.via)} by ${esc(recLog.sentBy)}${recLog.attachedFile ? " • 📎 Reply PDF" : ""}</div>`
            : `<div style="margin-top:6px;color:#b7410e;">⚠️ <strong>Last Dispatch Attempt (${esc(recLog.sentAt || "")}):</strong> ${esc(recLog.error || "Check Apps Script settings")}${recLog.mailtoUrl ? ` &nbsp;<a href="${esc(recLog.mailtoUrl)}" class="btn btn-sm btn-outline" style="padding:2px 8px;">📧 Open Email Client</a>` : ""}</div>`
          : "";
      emailBox.innerHTML = `${readyText}${missText}${attNote}${logLine}`;
    }
  }
}

function renderPdfAttachmentBar() {
  const bar = document.getElementById("inc-pdf-viewer-bar");
  const statusEl = document.getElementById("inc-pdf-status");
  if (currentAttachmentFile && (currentAttachmentFile.url || currentAttachmentFile.localUrl || currentAttachmentFile.driveUrl)) {
    const syncTag = currentAttachmentFile.driveSynced
      ? `<span class="badge badge-completed" style="margin-left:6px;">Saved to Google Drive</span>`
      : `<span class="badge badge-neutral" style="margin-left:6px;">Saved Locally</span>`;
    const embedSrc = getPdfEmbedUrl(currentAttachmentFile);
    const openHref = currentAttachmentFile.driveUrl || currentAttachmentFile.url || currentAttachmentFile.localUrl;
    statusEl.textContent = `Uploaded: ${currentAttachmentFile.name} (${formatFileSize(currentAttachmentFile.size)})`;
    bar.classList.remove("hidden");
    const canRemove = !!currentIncomingPerms.boxA;
    bar.innerHTML = `
      <div class="pdf-viewer-bar">
        <div>
          <strong>📄 Attached PDF (Box A):</strong> ${esc(currentAttachmentFile.name)} ${syncTag}
          <span class="muted-text">(${esc(formatFileSize(currentAttachmentFile.size))}${currentAttachmentFile.uploadedAt ? " • " + esc(currentAttachmentFile.uploadedAt) : ""})</span>
          ${currentAttachmentFile.driveNote ? `<div class="sub-line" style="color:#b7410e;">${esc(currentAttachmentFile.driveNote)}</div>` : ""}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm btn-outline" id="btn-toggle-pdf-preview">${pdfPreviewExpanded ? "🙈 Hide PDF Preview" : "👁️ Show PDF Preview"}</button>
          <a class="btn btn-sm btn-primary" href="${esc(openHref)}" target="_blank" rel="noopener">${currentAttachmentFile.driveUrl ? "Open in Google Drive ↗" : "Open Full Tab ↗"}</a>
          ${currentAttachmentFile.driveUrl && currentAttachmentFile.localUrl ? `<a class="btn btn-sm btn-outline" href="${esc(currentAttachmentFile.localUrl)}" target="_blank" rel="noopener">Local Copy</a>` : ""}
          ${canRemove ? `<button type="button" class="btn btn-sm btn-danger" id="btn-remove-pdf">✕ Remove</button>` : ""}
        </div>
      </div>
      <div class="pdf-embed-wrap ${pdfPreviewExpanded ? "" : "collapsed"}" id="inc-pdf-embed-wrap">
        <iframe class="pdf-embed-frame" src="${esc(embedSrc)}" title="Attached PDF Preview"></iframe>
      </div>
    `;
    const toggleBtn = document.getElementById("btn-toggle-pdf-preview");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        pdfPreviewExpanded = !pdfPreviewExpanded;
        const wrap = document.getElementById("inc-pdf-embed-wrap");
        if (wrap) wrap.classList.toggle("collapsed", !pdfPreviewExpanded);
        toggleBtn.textContent = pdfPreviewExpanded ? "🙈 Hide PDF Preview" : "👁️ Show PDF Preview";
      });
    }
    const rmBtn = document.getElementById("btn-remove-pdf");
    if (rmBtn) {
      rmBtn.addEventListener("click", () => {
        currentAttachmentFile = null;
        document.getElementById("inc-pdf-input").value = "";
        renderPdfAttachmentBar();
      });
    }
  } else {
    statusEl.textContent = "No PDF uploaded yet";
    bar.classList.add("hidden");
    bar.innerHTML = "";
  }
}

function syncDateFromControlNo() {
  const ctrl = document.getElementById("inc-control-no").value.trim();
  const m = ctrl.match(/^([EI])-(\d{2})-(\d{2})-(\d{4})-\d+$/i);
  if (!m) return;
  const letter = m[1].toUpperCase();
  const iso = `${m[4]}-${m[2]}-${m[3]}`;
  const dtInput = document.getElementById("inc-date-received");
  if (dtInput && dtInput.value !== iso) dtInput.value = iso;
  const catSel = document.getElementById("inc-doc-category");
  if (catSel) catSel.value = letter === "I" ? "Internal" : "External";
}

function refreshLiveAutoStatus() {
  const snap = readIncomingFormSnapshot();
  // Auto-sync assignedDivision preview when RD/ARD routes
  const resolvedDiv = resolveAssignedDivision(snap);
  const divSel = document.getElementById("form-incoming").elements.assignedDivision;
  if (divSel && resolvedDiv && (currentIncomingPerms.boxB || currentIncomingPerms.boxC)) {
    divSel.value = resolvedDiv;
  }
  const autoStat = computeIncomingAutoStatus(snap);
  const cls = statusBadgeClass(autoStat);
  ["inc-live-auto-status", "inc-boxe-auto-status"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = autoStat;
      el.className = `badge ${cls}`;
    }
  });
}

function applyIncomingBoxLocks(doc, isNew) {
  const perms = getBoxPermissions(currentUser, doc, isNew);
  currentIncomingPerms = perms;
  const assignedDiv = doc ? resolveAssignedDivision(doc) : "";

  const boxMeta = [
    { key: "boxA", fs: "fs-boxA", bar: "perm-bar-boxA", tab: "inc-box-a", owner: "Records Section account ONLY", label: "Box A: Records Staff" },
    { key: "boxB", fs: "fs-boxB", bar: "perm-bar-boxB", tab: "inc-box-b", owner: "RD's Secretary account ONLY", label: "Box B: RD Secretary" },
    { key: "boxC", fs: "fs-boxC", bar: "perm-bar-boxC", tab: "inc-box-c", owner: "ARD / ARD's Secretary account ONLY (assigns Division Chief)", label: "Box C: ARD Assignment" },
    { key: "boxD", fs: "fs-boxD", bar: "perm-bar-boxD", tab: "inc-box-d", owner: assignedDiv ? `Assigned Division Chief (${assignedDiv}) ONLY` : "Assigned Division Chief (once routed in Box B/C)", label: "Box D: Division Chief" },
    { key: "boxE", fs: "fs-boxE", bar: "perm-bar-boxE", tab: "inc-box-e", owner: "Records Section account ONLY", label: "Box E: Records Dispatch" },
  ];

  boxMeta.forEach((b) => {
    const allowed = !!perms[b.key];
    document.getElementById(b.fs).disabled = !allowed;
    const barEl = document.getElementById(b.bar);
    barEl.className = "box-perm-bar " + (allowed ? "editable" : "locked");
    barEl.innerHTML = allowed
      ? `🔓 <strong>Editable by your account</strong> (${esc(currentUser.fullName)} — ${esc(currentUser.role)}). Changes will automatically update the Tracking Status.`
      : `🔒 <strong>Read-Only:</strong> Editable by ${esc(b.owner)}.`;

    const tabBtn = document.querySelector(`#inc-form-tabs .tab-btn[data-box="${b.key}"]`);
    if (tabBtn) tabBtn.textContent = `${allowed ? "🔓 " : "🔒 "}${b.label}`;
  });

  // Hide Save button if user has zero editable boxes on this document
  const canSaveAny = perms.boxA || perms.boxB || perms.boxC || perms.boxD || perms.boxE;
  document.getElementById("btn-save-incoming").classList.toggle("hidden", !canSaveAny);

  // Automatically focus the user's primary editable Box!
  if (isNew) activateTab("inc-form-tabs", "inc-box-a");
  else if (perms.boxB) activateTab("inc-form-tabs", "inc-box-b");
  else if (perms.boxC) activateTab("inc-form-tabs", "inc-box-c");
  else if (perms.boxD) activateTab("inc-form-tabs", "inc-box-d");
  else if (perms.boxE && doc && (doc.status === "For Dispatch" || doc.status === "Completed / Returned to Records")) activateTab("inc-form-tabs", "inc-box-e");
  else activateTab("inc-form-tabs", "inc-box-a");
}

async function refreshNewIncomingControlNo() {
  if (!editingIncomingIsNew) return;
  const form = document.getElementById("form-incoming");
  const cat = form.elements.docCategory.value || "External";
  const yr = form.elements.dtsYear.value || String(new Date().getFullYear());
  // Internal & External share one continuous sequence within the selected DTS Year; resets to 0001 on a new year!
  form.elements.controlNo.value = await fetchNextNumber("incoming", todayISO(), cat, yr);
}

async function openNewIncoming() {
  if (currentUser.role !== "RECORDS" && currentUser.role !== "ADMIN") {
    return showToast("Only Records Section can encode new Incoming documents (Box A).", true);
  }
  editingIncomingIsNew = true;
  currentAttachmentFile = null;
  currentIncReplyAttachmentFile = null;
  incReplyPdfPreviewExpanded = true;
  selectedIncBoxERecipients = new Set();
  const form = document.getElementById("form-incoming");
  form.reset();
  document.getElementById("inc-pdf-input").value = "";
  const repInp = document.getElementById("inc-reply-pdf-input");
  if (repInp) repInp.value = "";
  const today = todayISO();
  const selIncYr = document.getElementById("inc-filter-year")?.value || "ALL";
  const curYr = /^\d{4}$/.test(selIncYr) ? selIncYr : String(new Date().getFullYear());
  form.elements.docCategory.value = "External";
  form.elements.dtsYear.value = curYr;
  form.elements.dateReceived.value = today;
  const nextNo = await fetchNextNumber("incoming", today, "External", curYr);
  form.elements.controlNo.value = nextNo;
  form.elements.timeReceived.value = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  form.elements.receivedBy.value = currentUser.fullName;
  form.elements.refNo.value = "NONE";
  form.elements.attachments.value = "NO ATTACHMENT";
  document.getElementById("inc-modal-title").textContent = "Encode New Incoming Document (Box A)";
  applyIncomingBoxLocks(null, true);
  renderPdfAttachmentBar();
  renderIncReplyPdfBar();
  document.getElementById("inc-boxe-recip-menu").classList.add("hidden");
  document.getElementById("inc-boxe-recip-trigger").setAttribute("aria-expanded", "false");
  renderIncBoxERecipientPicker();
  refreshLiveAutoStatus();
  openModal("modal-incoming");
}

window.openEditIncoming = function (controlNo) {
  const rec = state.incoming.find((d) => d.controlNo === controlNo);
  if (!rec) return;
  pulseLoading(`Opening ${controlNo}...`, () => {
    editingIncomingIsNew = false;
    currentAttachmentFile = rec.attachmentFile || null;
    pdfPreviewExpanded = true;
    currentIncReplyAttachmentFile = rec.replyAttachmentFile || null;
    incReplyPdfPreviewExpanded = true;
    selectedIncBoxERecipients = new Set(Array.isArray(rec.boxERecipients) ? rec.boxERecipients : []);
    const form = document.getElementById("form-incoming");
    form.reset();
    document.getElementById("inc-pdf-input").value = "";
    const repInp = document.getElementById("inc-reply-pdf-input");
    if (repInp) repInp.value = "";
    Object.keys(rec).forEach((k) => {
      const el = form.elements[k];
      if (!el || typeof rec[k] === "object") return;
      if (el.type === "checkbox") el.checked = !!rec[k];
      else if (el.type === "datetime-local") el.value = toDatetimeLocalValue(rec[k]);
      else el.value = rec[k] || "";
    });
    // Backwards-compatibility: split legacy "YYYY-MM-DD / Name" in dateReturnedBy into dateReturnedAt + releasedBy
    if (!rec.dateReturnedAt && !rec.releasedBy && rec.dateReturnedBy) {
      const parts = String(rec.dateReturnedBy).split("/").map((s) => s.trim());
      const parsedDt = toDatetimeLocalValue(parts[0] || "");
      if (parsedDt && form.elements.dateReturnedAt) {
        form.elements.dateReturnedAt.value = parsedDt;
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0] || "") && form.elements.dateReturnedAt) {
        form.elements.dateReturnedAt.value = `${parts[0]}T08:00`;
      }
      if (parts[1] && form.elements.releasedBy) form.elements.releasedBy.value = parts.slice(1).join(" / ");
    }
    const yrFromRec = extractDocYear(rec.dateReceived, rec.controlNo, rec.dtsYear) || String(new Date().getFullYear());
    if (form.elements.dtsYear) form.elements.dtsYear.value = yrFromRec;
    document.getElementById("inc-modal-title").textContent = `Incoming DTS: ${controlNo}`;
    applyIncomingBoxLocks(rec, false);
    renderPdfAttachmentBar();
    renderIncReplyPdfBar();
    document.getElementById("inc-boxe-recip-menu").classList.add("hidden");
    document.getElementById("inc-boxe-recip-trigger").setAttribute("aria-expanded", "false");
    renderIncBoxERecipientPicker();
    renderIncBoxERecipientChipsAndSummary(rec.boxEEmailLog || null);
    refreshLiveAutoStatus();
    openModal("modal-incoming");
  }, rec.attachmentFile ? "Loading document details & PDF attachment" : "Loading document details");
};

// ----------------- Multi-Select Recipient (To) Picker & Email Preview -----------------
function renderFurnishedCopyPicker() {
  const listEl = document.getElementById("out-furnished-list");
  const chipsEl = document.getElementById("out-furnished-chips");
  const summaryEl = document.getElementById("out-furnished-summary");
  const addCustomBtn = document.getElementById("btn-fc-add-custom");
  if (!listEl || !chipsEl || !summaryEl) return;

  const rawSearch = (document.getElementById("out-furnished-search")?.value || "").trim();
  const q = rawSearch.toLowerCase();
  const emailMap = (state.meta && state.meta.officeEmails) || {};
  const { roDivs, darpos, all } = getAllFurnishedCopyOptions();

  if (addCustomBtn) {
    const exactExists = all.some((o) => o.code.toLowerCase() === q);
    addCustomBtn.classList.toggle("hidden", !rawSearch || exactExists);
  }

  const renderGroup = (title, items) => {
    const filtered = items.filter((o) => !q || o.code.toLowerCase().includes(q) || o.name.toLowerCase().includes(q));
    if (!filtered.length) return "";
    return `
      <div class="multi-drop-group">${esc(title)}</div>
      ${filtered
        .map((o) => {
          const checked = selectedFurnishedCopy.has(o.code);
          const email = String(emailMap[o.code] || "").trim();
          const emailBadge = email
            ? `<span class="multi-drop-item-email" title="${esc(email)}">📧 ${esc(email)}</span>`
            : `<span class="multi-drop-item-email missing">No admin email set</span>`;
          return `
          <label class="multi-drop-item">
            <span class="multi-drop-item-left">
              <input type="checkbox" data-fc-code="${esc(o.code)}" ${checked ? "checked" : ""} />
              <span><strong>${esc(o.code)}</strong></span>
            </span>
            ${emailBadge}
          </label>`;
        })
        .join("")}
    `;
  };

  listEl.innerHTML =
    renderGroup("Regional Office VIII Divisions & STO Sections", roDivs) +
    renderGroup("DAR Provincial Offices (DARPO Region VIII)", darpos) ||
    `<div style="padding:10px;text-align:center;color:#5a6a62;font-size:12px;">No preset match — click <strong>+ Add</strong> above to add "${esc(rawSearch)}" as a custom recipient.</div>`;

  listEl.querySelectorAll('input[type="checkbox"][data-fc-code]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const code = cb.getAttribute("data-fc-code");
      if (cb.checked) selectedFurnishedCopy.add(code);
      else selectedFurnishedCopy.delete(code);
      renderFurnishedCopyChipsAndSummary();
    });
  });

  renderFurnishedCopyChipsAndSummary();
}

function renderFurnishedCopyChipsAndSummary(recLog = null) {
  const chipsEl = document.getElementById("out-furnished-chips");
  const summaryEl = document.getElementById("out-furnished-summary");
  const emailBox = document.getElementById("out-email-status-box");
  const hiddenRecip = document.getElementById("out-recipient-to");
  const selected = [...selectedFurnishedCopy];
  const emailMap = (state.meta && state.meta.officeEmails) || {};

  if (hiddenRecip) hiddenRecip.value = selected.join(", ");

  if (summaryEl) {
    summaryEl.textContent = selected.length
      ? `${selected.length} recipient${selected.length > 1 ? "s" : ""} selected`
      : "Select RO VIII sections / DARPOs or type custom recipient...";
  }
  if (chipsEl) {
    chipsEl.innerHTML = selected
      .map((code) => {
        const isDarpo = code.startsWith("DARPO");
        const em = emailMap[code] ? ` (${emailMap[code]})` : " (no email yet)";
        return `<span class="fc-chip ${isDarpo ? "darpo" : ""}" title="${esc(code + em)}">${esc(code)}<button type="button" data-fc-remove="${esc(code)}" aria-label="Remove">×</button></span>`;
      })
      .join("");
    chipsEl.querySelectorAll("[data-fc-remove]").forEach((btn) => {
      btn.addEventListener("click", () => {
        selectedFurnishedCopy.delete(btn.getAttribute("data-fc-remove"));
        renderFurnishedCopyPicker();
      });
    });
  }

  if (emailBox) {
    if (!selected.length) {
      emailBox.innerHTML = `ℹ️ <strong>Recipient Email Dispatch:</strong> No offices selected in Recipient (To) yet. Select RO VIII Sections or DARPO Provincial Offices in Box A &amp; B to email them automatically upon release.`;
    } else {
      const ready = selected.filter((c) => emailMap[c]);
      const missing = selected.filter((c) => !emailMap[c]);
      const readyText = ready.length
        ? `✅ <strong>Ready to Email (${ready.length}):</strong> ${ready.map((c) => `${esc(c)} (<code>${esc(emailMap[c])}</code>)`).join(", ")}`
        : "";
      const missText = missing.length
        ? `<div style="margin-top:4px;color:#b7410e;">⚠️ <strong>No Admin Email Set Yet (${missing.length}):</strong> ${missing.map((c) => esc(c)).join(", ")} — Admin can add them in <em>Settings &amp; Accounts → Office &amp; DARPO Email Directory</em>.</div>`
        : "";
      const attNote = currentOutAttachmentFile
        ? `<div style="margin-top:5px;color:#1b5e20;">📎 <strong>Scanned PDF Ready to Send</strong> (${esc(formatFileSize(currentOutAttachmentFile.size))})</div>`
        : "";
      const logLine =
        recLog && recLog.attempted
          ? recLog.sent
            ? `<div style="margin-top:6px;color:#1b5e20;">📨 <strong>Last Sent:</strong> ${esc(recLog.sentAt)} via ${esc(recLog.via)} by ${esc(recLog.sentBy)}${recLog.attachedFile ? " • 📎 Scanned PDF" : ""}</div>`
            : `<div style="margin-top:6px;color:#b7410e;">⚠️ <strong>Last Dispatch Attempt (${esc(recLog.sentAt || "")}):</strong> ${esc(recLog.error || "Pending Apps Script MailApp authorization")}${recLog.mailtoUrl ? ` &nbsp;<a href="${esc(recLog.mailtoUrl)}" class="btn btn-sm btn-outline" style="padding:2px 8px;">📧 Open Email Client</a>` : ""}</div>`
          : "";
      emailBox.innerHTML = `${readyText}${missText}${attNote}${logLine}`;
    }
  }
}

function applyOutgoingBoxLocks(rec, isNew) {
  const isRecordsOrAdmin = currentUser && (currentUser.role === "RECORDS" || currentUser.role === "ADMIN");
  const tabD = document.getElementById("out-tab-box-d");
  const tabE = document.getElementById("out-tab-box-e");
  const fsD = document.getElementById("out-fs-boxD");
  const barD = document.getElementById("out-perm-bar-boxD");
  const fsE = document.getElementById("out-fs-boxE");
  const barE = document.getElementById("out-perm-bar-boxE");
  const quickD = document.getElementById("out-boxd-quick-actions");
  const stampReturnBtn = document.getElementById("btn-stamp-out-return");
  const subtitle = document.querySelector("#modal-outgoing .modal-header p");

  // Non-Records users can ONLY access Box A & B and Box C!
  // Records / Admin access Box D (Release & DAR8 Rec. No. FIRST) and Box E (Returned to Originating Office AFTER Release)!
  if (tabD) tabD.classList.toggle("hidden", !isRecordsOrAdmin);
  if (tabE) tabE.classList.toggle("hidden", !isRecordsOrAdmin);
  if (fsD) fsD.disabled = !isRecordsOrAdmin;
  if (fsE) fsE.disabled = !isRecordsOrAdmin;
  if (quickD) quickD.classList.toggle("hidden", !isRecordsOrAdmin);
  if (stampReturnBtn) stampReturnBtn.classList.toggle("hidden", !isRecordsOrAdmin);
  if (subtitle) {
    subtitle.textContent = isRecordsOrAdmin
      ? "DAR Regional Office VIII — DTS-OUTGOING (Box A–C → Box D Release → Box E Return)"
      : "DAR Regional Office VIII — DTS-OUTGOING (Boxes A through C — Release & Return handled by Records Unit)";
  }

  if (barD) {
    barD.className = "box-perm-bar " + (isRecordsOrAdmin ? "editable" : "locked");
    barD.innerHTML = isRecordsOrAdmin
      ? `🔓 <strong>Box D — Records Release FIRST (Records Unit):</strong> Assign the official <strong>DAR8 Rec. No.</strong>, record dispatch/release, and email Furnished Copy offices before returning the slip in Box E.`
      : `🔒 <strong>Read-Only (Records Unit Only):</strong> Box D (Release &amp; DAR8 Rec. No.) is handled by the Records Unit.`;
  }
  if (barE) {
    barE.className = "box-perm-bar " + (isRecordsOrAdmin ? "editable" : "locked");
    barE.innerHTML = isRecordsOrAdmin
      ? `🔓 <strong>Box E — Returned to Originating Office (AFTER Release):</strong> Complete this section once the outgoing document has been released/dispatched in Box D.`
      : `🔒 <strong>Read-Only (Records Unit Only):</strong> Box E (Return to Originating Office) is completed by the Records Unit after release.`;
  }
  if (tabD) tabD.textContent = `${isRecordsOrAdmin ? "🔓 " : "🔒 "}Box D: Records Release & DAR8 Rec. No.`;
  if (tabE) tabE.textContent = `${isRecordsOrAdmin ? "🔓 " : "🔒 "}Box E: Returned to Originating Office`;

  if (!isNew && isRecordsOrAdmin && rec && !rec.recNo) {
    activateTab("out-form-tabs", "out-box-d");
  } else {
    activateTab("out-form-tabs", "out-box-ab");
  }
}

async function refreshNewOutgoingUserNo() {
  if (!editingOutgoingIsNew) return;
  const form = document.getElementById("form-outgoing");
  const dt = form.elements.dateOriginated.value || todayISO();
  const yr = String((form.elements.dtsYear && form.elements.dtsYear.value) || "").trim();
  const div = form.elements.originatingDivision.value || (currentUser && currentUser.division) || "";
  form.elements.userDocNo.value = await fetchNextNumber("outgoing-user", dt, "", /^\d{4}$/.test(yr) ? yr : "", div);
}

function renderOutPdfAttachmentBar() {
  const bar = document.getElementById("out-pdf-viewer-bar");
  const statusEl = document.getElementById("out-pdf-status");
  if (!bar || !statusEl) return;
  const canRemove = currentUser && (currentUser.role === "RECORDS" || currentUser.role === "ADMIN");
  if (currentOutAttachmentFile && (currentOutAttachmentFile.url || currentOutAttachmentFile.localUrl)) {
    const syncTag = currentOutAttachmentFile.driveSynced
      ? `<span class="badge badge-completed" style="margin-left:6px;">☁️ Saved in Google Drive</span>`
      : `<span class="badge badge-due" style="margin-left:6px;" title="${esc(currentOutAttachmentFile.driveNote || "Local copy only")}">💻 Local Copy</span>`;
    statusEl.innerHTML = `✅ <strong>Scanned PDF Uploaded</strong> (${esc(formatFileSize(currentOutAttachmentFile.size))}) ${syncTag}`;
    bar.classList.remove("hidden");
    const openHref = currentOutAttachmentFile.driveUrl || currentOutAttachmentFile.url || currentOutAttachmentFile.localUrl;
    const embedSrc = getPdfEmbedUrl(currentOutAttachmentFile);
    bar.innerHTML = `
      <div class="pdf-viewer-bar">
        <div title="${esc(currentOutAttachmentFile.name)}">
          <strong>📄 Scanned PDF</strong>
          <span class="muted-text">(${esc(formatFileSize(currentOutAttachmentFile.size))} • Uploaded by ${esc(currentOutAttachmentFile.uploadedBy || "Records")})</span>
          ${syncTag}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button type="button" class="btn btn-sm btn-outline" id="btn-toggle-out-pdf-preview">${outPdfPreviewExpanded ? "🙈 Hide PDF Preview" : "👁️ Show PDF Preview"}</button>
          <a class="btn btn-sm btn-primary" href="${esc(openHref)}" target="_blank" rel="noopener">${currentOutAttachmentFile.driveUrl ? "Open in Google Drive ↗" : "Open Full Tab ↗"}</a>
          ${currentOutAttachmentFile.driveUrl && currentOutAttachmentFile.localUrl ? `<a class="btn btn-sm btn-outline" href="${esc(currentOutAttachmentFile.localUrl)}" target="_blank" rel="noopener">Local Copy</a>` : ""}
          ${canRemove ? `<button type="button" class="btn btn-sm btn-danger" id="btn-remove-out-pdf">✕ Remove</button>` : ""}
        </div>
      </div>
      <div class="pdf-embed-wrap ${outPdfPreviewExpanded ? "" : "collapsed"}" id="out-pdf-embed-wrap">
        <iframe class="pdf-embed-frame" src="${esc(embedSrc)}" title="Scanned Outgoing PDF Preview"></iframe>
      </div>
    `;
    const toggleBtn = document.getElementById("btn-toggle-out-pdf-preview");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        outPdfPreviewExpanded = !outPdfPreviewExpanded;
        const wrap = document.getElementById("out-pdf-embed-wrap");
        if (wrap) wrap.classList.toggle("collapsed", !outPdfPreviewExpanded);
        toggleBtn.textContent = outPdfPreviewExpanded ? "🙈 Hide PDF Preview" : "👁️ Show PDF Preview";
      });
    }
    const rmBtn = document.getElementById("btn-remove-out-pdf");
    if (rmBtn) {
      rmBtn.addEventListener("click", () => {
        currentOutAttachmentFile = null;
        document.getElementById("out-pdf-input").value = "";
        renderOutPdfAttachmentBar();
        renderFurnishedCopyChipsAndSummary();
      });
    }
  } else {
    statusEl.textContent = "No scanned file uploaded yet";
    bar.classList.add("hidden");
    bar.innerHTML = "";
  }
}

let selectedOutDispatchModes = new Set();

function parseDispatchModes(val) {
  if (Array.isArray(val)) return val.map((s) => String(s || "").trim()).filter(Boolean);
  return String(val || "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function renderOutDispatchModePicker() {
  const listEl = document.getElementById("out-dispatch-list");
  const triggerText = document.getElementById("out-dispatch-trigger-text");
  const chipsEl = document.getElementById("out-dispatch-chips");
  const hiddenEl = document.getElementById("out-dispatch-hidden");
  const canEdit = !!(currentUser && (currentUser.role === "RECORDS" || currentUser.role === "ADMIN"));

  const baseModes = LISTS.dispatchModes.filter(Boolean);
  const allModes = [...baseModes];
  selectedOutDispatchModes.forEach((m) => {
    if (m && !allModes.includes(m)) allModes.push(m);
  });

  if (listEl) {
    listEl.innerHTML = allModes
      .map((mode) => {
        const checked = selectedOutDispatchModes.has(mode);
        return `
          <label class="multi-drop-item">
            <span class="multi-drop-item-left">
              <input type="checkbox" data-dispatch-mode="${esc(mode)}" ${checked ? "checked" : ""} ${canEdit ? "" : "disabled"} />
              <span><strong>${esc(mode)}</strong></span>
            </span>
          </label>`;
      })
      .join("");
    listEl.querySelectorAll("input[data-dispatch-mode]").forEach((cb) => {
      cb.addEventListener("change", () => {
        const mode = cb.getAttribute("data-dispatch-mode");
        if (cb.checked) selectedOutDispatchModes.add(mode);
        else selectedOutDispatchModes.delete(mode);
        renderOutDispatchModePicker();
      });
    });
  }

  const chosen = [...selectedOutDispatchModes];
  if (hiddenEl) hiddenEl.value = chosen.join(", ");
  if (triggerText) {
    triggerText.textContent = chosen.length
      ? chosen.length <= 2
        ? chosen.join(", ")
        : `${chosen.length} dispatch modes selected`
      : "— Select Dispatch Mode(s) —";
  }
  if (chipsEl) {
    chipsEl.innerHTML = chosen
      .map(
        (mode) =>
          `<span class="fc-chip">${esc(mode)}${canEdit ? `<button type="button" data-rm-dispatch="${esc(mode)}" aria-label="Remove ${esc(mode)}">×</button>` : ""}</span>`
      )
      .join("");
    if (canEdit) {
      chipsEl.querySelectorAll("button[data-rm-dispatch]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedOutDispatchModes.delete(btn.getAttribute("data-rm-dispatch"));
          renderOutDispatchModePicker();
        });
      });
    }
  }
}

async function openNewOutgoing() {
  editingOutgoingIsNew = true;
  selectedFurnishedCopy = new Set();
  selectedOutDispatchModes = new Set();
  currentOutAttachmentFile = null;
  outPdfPreviewExpanded = true;
  const form = document.getElementById("form-outgoing");
  form.reset();
  const outPdfInp = document.getElementById("out-pdf-input");
  if (outPdfInp) outPdfInp.value = "";
  form.elements.id.value = "";
  const today = todayISO();
  const selOutYr = document.getElementById("out-filter-year")?.value || "ALL";
  const curYr = /^\d{4}$/.test(selOutYr) ? selOutYr : today.slice(0, 4);
  form.elements.dateOriginated.value = today;
  if (form.elements.dtsYear) form.elements.dtsYear.value = curYr;
  if (currentUser && currentUser.division) form.elements.originatingDivision.value = currentUser.division;
  const chosenDiv = form.elements.originatingDivision.value || (currentUser && currentUser.division) || "";
  const nextUserNo = await fetchNextNumber("outgoing-user", today, "", curYr, chosenDiv);
  form.elements.userDocNo.value = nextUserNo;
  form.elements.recNo.value = "";
  const sigList = getPreparedSignatoriesList();
  const defaultPrep = currentUser && sigList.includes(currentUser.fullName) ? currentUser.fullName : "";
  populatePreparedBySelect(defaultPrep);
  form.elements.attachments.value = "NONE";
  form.elements.status.value = "Draft / Originating";
  document.getElementById("out-modal-title").textContent = "Encode New Outgoing Document";
  document.getElementById("out-furnished-menu").classList.add("hidden");
  document.getElementById("out-furnished-trigger").setAttribute("aria-expanded", "false");
  const dispMenu = document.getElementById("out-dispatch-menu");
  if (dispMenu) dispMenu.classList.add("hidden");
  const dispTrig = document.getElementById("out-dispatch-trigger");
  if (dispTrig) dispTrig.setAttribute("aria-expanded", "false");
  renderOutPdfAttachmentBar();
  renderFurnishedCopyPicker();
  renderOutDispatchModePicker();
  applyOutgoingBoxLocks(null, true);
  openModal("modal-outgoing");
}

window.openEditOutgoing = function (key) {
  const rec = state.outgoing.find((d) => d.id === key || d.recNo === key || d.userDocNo === key);
  if (!rec) return;
  const label = rec.recNo || rec.userDocNo || key;
  pulseLoading(`Opening ${label}...`, () => {
    editingOutgoingIsNew = false;
    currentOutAttachmentFile = rec.attachmentFile || null;
    outPdfPreviewExpanded = true;
    const initialRecipients =
      Array.isArray(rec.furnishedCopy) && rec.furnishedCopy.length
        ? rec.furnishedCopy
        : String(rec.recipientTo || "").split(",").map((s) => s.trim()).filter(Boolean);
    selectedFurnishedCopy = new Set(initialRecipients);
    selectedOutDispatchModes = new Set(parseDispatchModes(rec.finalDispatchMode));
    const form = document.getElementById("form-outgoing");
    form.reset();
    const outPdfInp = document.getElementById("out-pdf-input");
    if (outPdfInp) outPdfInp.value = "";
    Object.keys(rec).forEach((k) => {
      const el = form.elements[k];
      if (!el || typeof rec[k] === "object") return;
      if (el.type === "datetime-local") {
        const raw = String(rec[k] || "").trim();
        el.value = toDatetimeLocalValue(raw) || (/^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T08:00` : "");
      } else {
        el.value = rec[k] || "";
      }
    });
    populatePreparedBySelect(rec.preparedBy || "");
    if (form.elements.dtsYear) form.elements.dtsYear.value = extractDocYear(rec.dateOriginated, rec.recNo || rec.userDocNo, rec.dtsYear) || todayISO().slice(0, 4);
    form.elements.id.value = rec.id || "";
    document.getElementById("out-modal-title").textContent = `Outgoing DTS: ${rec.recNo || rec.userDocNo}`;
    document.getElementById("out-furnished-menu").classList.add("hidden");
    document.getElementById("out-furnished-trigger").setAttribute("aria-expanded", "false");
    const dispMenu = document.getElementById("out-dispatch-menu");
    if (dispMenu) dispMenu.classList.add("hidden");
    const dispTrig = document.getElementById("out-dispatch-trigger");
    if (dispTrig) dispTrig.setAttribute("aria-expanded", "false");
    renderOutPdfAttachmentBar();
    renderFurnishedCopyPicker();
    renderFurnishedCopyChipsAndSummary(rec.furnishedCopyEmailLog || null);
    renderOutDispatchModePicker();
    applyOutgoingBoxLocks(rec, false);
    openModal("modal-outgoing");
  }, "Loading outgoing document details");
};

// ----------------- Official Printable Slip Renderer -----------------
const chk = (cond) => (cond ? "☑" : "☐");

window.openPrintIncoming = function (controlNo) {
  pulseLoading(`Preparing Official Slip (${controlNo})...`, () => {
    _renderPrintIncoming(controlNo);
  }, "Formatting DR08-STOR-F-001-REV-01 for printing");
};

function _renderPrintIncoming(controlNo) {
  const d = state.incoming.find((x) => x.controlNo === controlNo);
  if (!d) return;
  const m = state.meta;
  const assigned = resolveAssignedDivision(d);
  document.getElementById("print-modal-title").textContent = `Official Incoming Slip — ${d.controlNo}`;

  const tfOptions = [
    "URGENT (WITHIN THE DAY)",
    "ROUTINE (WITHIN 15 DAYS)",
    "AS INDICATED IN THE DOC. DUE DATE",
    "FOR INFORMATION AND APPROPRIATE ACTION",
  ];
  const transModes = ["Mail", "Registered Mail", "Ordinary Mail", "Pouch", "Fax", "WayBill JRS/LBC", "Personally", "Email"];
  const boxELeft = ["Pouch", "Mail", "Registered w/ret. Card", "Registered", "Ordinary"];
  const boxERight = ["Email", "Fax", "Waybill (DHL)", "Personally Received by", "Hand carried by"];

  document.getElementById("print-canvas").innerHTML = `
    <div class="slip-page">
      <div class="slip-header">
        <img src="/dar-ro8-logo.jpg" alt="DAR Eastern Visayas Logo" class="slip-logo-img" />
        <div class="slip-agency">
          <div class="rep">REPUBLIC OF THE PHILIPPINES</div>
          <div class="dept">${esc(m.agency || "DEPARTMENT OF AGRARIAN REFORM")}</div>
          <div class="tag">${esc(m.tagline || "Tunay na Pagbabago sa Repormang Agraryo")}</div>
        </div>
      </div>
      <div class="slip-title-bar">DOCUMENT TRACKING SYSTEM (DTS-INCOMING) SLIP</div>

      <div class="slip-box">
        <div class="slip-box-hdr">
          <span>Box A: To be filled by the DAR 8 Records Staff</span>
          <span>Date / Time Received: <strong>${esc(formatDateLong(d.dateReceived))} ${esc(d.timeReceived || "")}</strong></span>
          <span>Received by: <strong>${esc(d.receivedBy || "")}</strong></span>
        </div>
        <div class="slip-grid-2">
          <div class="slip-cell">
            <div class="slip-kv"><span class="k">Control No.:</span><span class="v"><strong>${esc(d.controlNo)}</strong> (${esc((d.docCategory || (String(d.controlNo || "").toUpperCase().startsWith("I-") ? "Internal" : "External")).toUpperCase())})</span></div>
            <div class="slip-kv"><span class="k">Sender:</span><span class="v">${esc(d.senderName)}</span></div>
            <div class="slip-kv"><span class="k">Office:</span><span class="v">${esc(d.senderOffice)}</span></div>
            <div class="slip-kv"><span class="k">Type:</span><span class="v">${esc(d.docType)}</span></div>
            <div class="slip-kv"><span class="k">Thru:</span><span class="v">${esc(d.thru)}</span></div>
            <div class="slip-kv"><span class="k">Date of Document:</span><span class="v">${esc(formatDateLong(d.dateOfDoc))}</span></div>
            <div class="slip-kv"><span class="k">Ref./Case/Title No.:</span><span class="v">${esc(d.refNo || "NONE")}</span></div>
          </div>
          <div class="slip-cell" style="display:flex;flex-direction:column;justify-content:space-between;">
            <div><strong>Subject:</strong><div style="margin-top:6px;font-weight:700;font-size:11.5px;">${esc(d.subject)}</div></div>
            <div style="border-top:1px solid #000;padding-top:4px;margin-top:8px;"><strong>Attachment(s) (if any):</strong> ${esc(d.attachments || "NO ATTACHMENT")}</div>
          </div>
        </div>
      </div>

      <div class="slip-box">
        <div class="slip-box-hdr"><span>Box B: To be filled-up by the RD / RD's Secretary:</span><span>TIME FRAME OF ACTION</span></div>
        <div class="slip-grid-6040">
          <div class="slip-cell">
            <div class="slip-kv"><span class="k">Date/Time/Recv by:</span><span class="v">${esc(d.rdDateTime || "")} ${d.rdReceivedBy ? "/ " + esc(d.rdReceivedBy) : ""}</span></div>
            <div class="slip-kv"><span class="k">RD's Instructions To:</span><span class="v"><strong>${esc(d.rdInstructionsTo || "")}</strong></span></div>
            <div style="min-height:46px;padding:4px 0;white-space:pre-wrap;">${esc(d.rdInstructions || "")}</div>
          </div>
          <div class="slip-cell">
            ${tfOptions.map((o) => `<div style="margin-bottom:3px;">${chk(d.rdTimeFrame === o)} ${esc(o)}</div>`).join("")}
            <div class="slip-sign">
              <div class="name">${esc(m.regionalDirector || "ATTY. ROBERT ANTHONY P. YU")}</div>
              <div class="role">Regional Director / FOR THE RD</div>
            </div>
          </div>
        </div>
      </div>

      <div class="slip-box">
        <div class="slip-box-hdr"><span>Box C: To be filled-up by the ARD / ARD's Secretary:</span><span>TIME FRAME OF ACTION</span></div>
        <div class="slip-grid-6040">
          <div class="slip-cell">
            <div class="slip-kv"><span class="k">Date/Time/Recv by:</span><span class="v">${esc(d.ardDateTime || "")} ${d.ardReceivedBy ? "/ " + esc(d.ardReceivedBy) : ""}</span></div>
            <div class="slip-kv"><span class="k">ARD's Instruction To:</span><span class="v"><strong>${esc(d.ardInstructionsTo || "")}</strong></span></div>
            <div style="min-height:42px;padding:4px 0;white-space:pre-wrap;">${esc(d.ardInstructions || "")}</div>
          </div>
          <div class="slip-cell">
            ${tfOptions.map((o) => `<div style="margin-bottom:3px;">${chk(d.ardTimeFrame === o)} ${esc(o)}</div>`).join("")}
            <div class="slip-sign">
              <div class="name">&nbsp;</div>
              <div class="role">ARD's Signature &nbsp;&nbsp;|&nbsp;&nbsp; Date: ______________</div>
            </div>
          </div>
        </div>
      </div>

      <div class="slip-box">
        <div class="slip-box-hdr"><span>Box D: Action Taken (To be filled up, dated &amp; initialed by responsible person of Respective Division / Section)</span><span>Division: <strong>${esc(assigned)}</strong></span></div>
        <div class="slip-grid-6040">
          <div class="slip-cell">
            <div class="slip-kv"><span class="k">Date/Time/Recv by:</span><span class="v">${esc(d.divDateTime || "")} ${d.divReceivedBy ? "/ " + esc(d.divReceivedBy) : ""}</span></div>
            <div style="min-height:48px;padding:4px 0;"><strong>Division Chief Instruction / Action Taken:</strong><br/>${esc(d.divActionTaken || "")}</div>
          </div>
          <div class="slip-cell">
            <div class="slip-sign" style="margin-top:26px;">
              <div class="name">${esc(d.divChiefName || "")}&nbsp;</div>
              <div class="role">Division Chief Name &amp; Signature</div>
              <div class="role">Date Acted: ${esc(formatDateLong(d.dateActed)) || "__________________"}</div>
            </div>
          </div>
        </div>
        <div class="slip-row">
          <strong>Chosen Mode of Transmission:</strong>&nbsp;
          <span class="slip-checks" style="display:inline-flex;">${transModes.map((tm) => `<span>${chk(d.transmissionMode === tm)} ${esc(tm)}</span>`).join("")}</span>
        </div>
        <div class="slip-row" style="display:flex;justify-content:space-between;gap:12px;">
          <span><strong>TO / ADDRESS:</strong> ${esc(d.addressedTo || "")}</span>
          <span><strong>Please use Pouch Service for CC:</strong> ${esc(d.pouchCC || "")}</span>
        </div>
      </div>

      <div class="slip-box">
        <div class="slip-box-hdr"><span>Box E: ACTION DOCUMENTS To be sent by Records unit by/thru</span><span>Status: ${esc(d.status)}</span></div>
        <div class="slip-grid-2">
          <div class="slip-cell">${boxELeft.map((o) => `<div>${chk(d.recordsDispatchMode === o)} ${esc(o)}</div>`).join("")}</div>
          <div class="slip-cell">${boxERight.map((o) => `<div>${chk(d.recordsDispatchMode === o)} ${esc(o)}</div>`).join("")}</div>
        </div>
        <div class="slip-row"><strong>Dispatch Details / Email / Tracking No.:</strong> ${esc(d.dispatchDetails || "")}</div>
        <div class="slip-row" style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;">
          <span><strong>Returned and Duly Received by Records Unit:</strong> &nbsp; ${chk(d.returnedAs === "DTS Slip only (no attachment)")} DTS Slip only (no attachment) &nbsp;&nbsp; ${chk(d.returnedAs === "File Copy of Action Documents with attachment")} File Copy of Action Documents with attachment</span>
          <span><strong>SIGNATURE / DATE:</strong> ${esc(d.dateReturnedBy || "__________________")}</span>
        </div>
      </div>

      <div class="slip-reminder">REMINDER: PLEASE RETURN TO RECORDS SECTION AFTER SUBJECT IS ACTED!</div>
      <div class="slip-footer">
        <span>${esc(m.address || "DAR Regional Office 08, Sto. Niño Extension, Tacloban City")}</span>
        <span>TELEFAX: ${esc(m.telefax || "(02) 325-3095")} &nbsp;|&nbsp; WEBSITE: ${esc(m.website || "www.dar.gov.ph")} &nbsp;|&nbsp; <strong>${esc(m.incomingFormCode || "DR08-STOR-F-001-REV-01")}</strong></span>
      </div>
    </div>
  `;
  openModal("modal-print");
}

window.openPrintOutgoing = function (key) {
  const d = state.outgoing.find((x) => x.id === key || x.recNo === key || x.userDocNo === key);
  const label = (d && (d.recNo || d.userDocNo)) || key;
  pulseLoading(`Preparing Outgoing Slip (${label})...`, () => {
    _renderPrintOutgoing(key);
  }, "Formatting DTS-OUTGOING slip for printing");
};

function _renderPrintOutgoing(key) {
  const d = state.outgoing.find((x) => x.id === key || x.recNo === key || x.userDocNo === key);
  if (!d) return;
  const m = state.meta;
  document.getElementById("print-modal-title").textContent = `Official Outgoing Slip — ${d.recNo || d.userDocNo}`;

  const allDivs = [...state.divisions.map((x) => x.code), "Others"];
  const docTypes = ["Special Order", "Memorandum", "Accomplishment Report", "Endorsement", "Communication", "Others"];
  const transModes = ["Mail", "Registered Mail", "Pouch", "Fax", "WayBill JRS/LBC", "Email", "Personally"];
  const boxELeft = ["Mail", "Registered w/ret. Card", "Registered", "Ordinary", "Pouch"];
  const boxERight = ["Email", "Fax", "Waybill (DHL)", "Personally Received by", "Hand carried by"];

  document.getElementById("print-canvas").innerHTML = `
    <div class="slip-page">
      <div class="slip-header">
        <img src="/dar-ro8-logo.jpg" alt="DAR Eastern Visayas Logo" class="slip-logo-img" />
        <div class="slip-agency">
          <div class="rep">REPUBLIC OF THE PHILIPPINES</div>
          <div class="dept">${esc(m.agency || "DEPARTMENT OF AGRARIAN REFORM")}</div>
          <div class="tag">${esc(m.tagline || "Tunay na Pagbabago sa Repormang Agraryo")}</div>
        </div>
      </div>
      <div class="slip-title-bar out">DTS - OUTGOING</div>

      <div class="slip-box">
        <div class="slip-box-hdr"><span>Box A: DOCUMENTS SOURCE (Originating Division / Section)</span><span>User Outgoing No.: <strong>${esc(d.userDocNo || "—")}</strong> &nbsp;|&nbsp; Date Originated: <strong>${esc(formatDateLong(d.dateOriginated))}</strong></span></div>
        <div class="slip-grid-2">
          <div class="slip-cell">
            <div class="slip-chk-grid">
              ${allDivs.map((code) => `<div>${chk(d.originatingDivision === code)} ${esc(code.replace("STO - ", ""))}</div>`).join("")}
            </div>
            <div style="border-top:1px solid #000;margin-top:8px;padding-top:4px;min-height:46px;"><strong>REMARKS:</strong><br/>${esc(d.remarks || "")}</div>
          </div>
          <div class="slip-cell" style="display:flex;flex-direction:column;justify-content:space-between;">
            <div><strong>Subject:</strong><div style="margin-top:5px;font-weight:700;font-size:11.5px;">${esc(d.subject)}</div></div>
            <div style="border-top:1px solid #000;padding-top:4px;margin-top:8px;"><strong>ATTACHMENT(S) (if any):</strong> ${esc(d.attachments || "NONE")}</div>
            <div class="slip-sign" style="margin-top:14px;"><div class="name">${esc(d.preparedBy || "")}&nbsp;</div><div class="role">Signature (Prepared / Originating Officer)</div></div>
          </div>
        </div>
      </div>

      <div class="slip-box">
        <div class="slip-box-hdr"><span>Box B: Document Description, Recipient &amp; Furnished Copy</span><span>Status: ${esc(d.status)}</span></div>
        <div class="slip-row"><div class="slip-checks">${docTypes.map((t) => `<span>${chk(d.docDescription === t)} ${esc(t)}${t === "Others" && d.otherDescription ? ": " + esc(d.otherDescription) : ""}</span>`).join("")}</div></div>
        <div class="slip-row"><strong>Chosen Mode of Transmission:</strong> &nbsp; ${transModes.map((tm) => `<span style="margin-right:10px;">${chk(d.transmissionMode === tm)} ${esc(tm)}</span>`).join("")}</div>
        <div class="slip-row"><strong>To:</strong> ${esc(d.recipientTo || "")} &nbsp;&nbsp;|&nbsp;&nbsp; <strong>Office:</strong> ${esc(d.recipientOffice || "")} &nbsp;&nbsp;|&nbsp;&nbsp; <strong>Address:</strong> ${esc(d.recipientAddress || "")}</div>
        <div class="slip-row"><strong>Furnished Copy:</strong> ${esc(Array.isArray(d.furnishedCopy) && d.furnishedCopy.length ? d.furnishedCopy.join(", ") : "NONE")}</div>
      </div>

      <div class="slip-box">
        <div class="slip-box-hdr"><span>Box C: For Counter Signature and Signature (W/ DTS form Attached)</span></div>
        <div class="slip-grid-2">
          <div class="slip-cell"><div><strong>Counter Signature by:</strong> ${esc(d.counterSignBy || "_____________________")}</div><div style="margin-top:6px;min-height:44px;"><em>With Instruction (if any) / Remarks:</em><br/>${esc(d.counterSignRemarks || "")}</div></div>
          <div class="slip-cell"><div><strong>Approved by:</strong> ${esc(d.approvedBy || "_____________________")}</div><div style="margin-top:6px;min-height:44px;"><em>With Instruction (if any) / Remarks:</em><br/>${esc(d.approvalRemarks || "")}</div></div>
        </div>
      </div>

      <div class="slip-box">
        <div class="slip-box-hdr"><span>Box D: Records Unit Release &amp; Dispatch (Released First — Records Staff Only)</span></div>
        <div class="slip-row" style="display:flex;justify-content:space-between;"><span><strong>DAR8 Rec. No.:</strong> ${esc(d.recNo || "____________________")}</span><span><strong>Date/Time Received:</strong> ${esc(formatDateLong(d.recordsDateReceived))} ${esc(d.recordsTimeReceived || "")}</span><span><strong>Received &amp; Released by:</strong> ${esc(d.recordsReceivedBy || "")}</span></div>
        <div class="slip-grid-2">
          <div class="slip-cell">${boxELeft.map((o) => `<div>${chk(parseDispatchModes(d.finalDispatchMode).includes(o))} ${esc(o)}</div>`).join("")}</div>
          <div class="slip-cell">${boxERight.map((o) => `<div>${chk(parseDispatchModes(d.finalDispatchMode).includes(o))} ${esc(o)}</div>`).join("")}</div>
        </div>
        <div class="slip-row" style="display:flex;justify-content:space-between;"><span><strong>Dispatch Details / Tracking No.:</strong> ${esc(d.dispatchDetails || "")}</span><span><strong>Date &amp; Time Dispatched / Released:</strong> ${esc(formatDateTimeDisplay(d.dateDispatched))}</span></div>
      </div>

      <div class="slip-box">
        <div class="slip-box-hdr"><span>Box E: Returned to Originating Office (After Release)</span></div>
        <div class="slip-row" style="display:flex;justify-content:space-between;"><span><strong>Returned To Originating Office:</strong> ${esc(d.returnedToOffice || "__________________")}</span><span><strong>Date / Received Back By:</strong> ${esc(d.dateReceivedBack || "__________________")}</span></div>
      </div>

      <div class="slip-reminder" style="background:#eceff1;">This DTS is for encoding/archiving at Records Unit</div>
      <div class="slip-footer">
        <span>${esc(m.address || "DAR Regional Office 08, Sto. Niño Extension, Tacloban City")}</span>
        <span>TELEFAX: ${esc(m.telefax || "(02) 325-3095")} &nbsp;|&nbsp; WEBSITE: ${esc(m.website || "www.dar.gov.ph")}</span>
      </div>
    </div>
  `;
  openModal("modal-print");
}

// ----------------- CSV Export -----------------
function downloadCsv(filename, rows) {
  if (!rows.length) return showToast("No records to export", true);
  pulseLoading("Exporting CSV Report...", () => {
    const keys = Object.keys(rows[0]).filter((k) => k !== "history");
    const escapeCsv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csv = [keys.join(","), ...rows.map((r) => keys.map((k) => escapeCsv(r[k])).join(","))].join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
  }, `Generating ${filename}`);
}

// ----------------- Navigation & Event Wiring -----------------
const VIEW_TITLES = {
  dashboard: "Executive Dashboard",
  incoming: "Incoming Document Tracking",
  outgoing: "Outgoing Document Tracking",
  issuances: "Official Issuances",
  mailing: "Mailing Process (PhilPost & JRS)",
  divisions: "Divisions & STO Sections Portal",
  tracker: "Document Routing Tracker",
  settings: "Settings, Accounts & Google Sheets Sync",
};

function switchView(viewName, skipPulse = false) {
  if (viewName === "settings" && (!currentUser || currentUser.role !== "ADMIN")) {
    viewName = "dashboard";
  }
  const apply = () => {
    currentView = viewName;
    document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
    document.getElementById(`view-${viewName}`).classList.add("active");
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.toggle("active", n.getAttribute("data-view") === viewName));
    document.getElementById("page-title").textContent = VIEW_TITLES[viewName] || "DAR Eastern Visayas DTS";
    document.getElementById("sidebar").classList.remove("open");
    if (viewName === "divisions") renderDivisionPortal();
    if (viewName === "issuances") renderIssuancesView();
    if (viewName === "mailing") renderMailingView();
    renderIssuanceSidebar();
    renderMailingSidebar();
  };
  if (skipPulse || currentView === viewName) return apply();
  const shortTitle = VIEW_TITLES[viewName] ? `Opening ${VIEW_TITLES[viewName].split(" (")[0]}...` : "Loading view...";
  pulseLoading(shortTitle, apply, "DAR Eastern Visayas Regional Office VIII", 170);
}

document.addEventListener("DOMContentLoaded", async () => {
  // Live Philippine Standard Time clock in executive topbar header
  const updateTopbarClock = () => {
    const el = document.getElementById("topbar-clock-text");
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleString("en-US", {
      timeZone: "Asia/Manila",
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  };
  updateTopbarClock();
  setInterval(updateTopbarClock, 15000);

  await initPublicRegistrationDivisions();

  let activeOtpChallengeId = "";
  let otpCountdownTimer = null;
  let activeRegOtpChallengeId = "";
  let regOtpCountdownTimer = null;

  function stopOtpTimer() {
    if (otpCountdownTimer) { clearInterval(otpCountdownTimer); otpCountdownTimer = null; }
  }
  function stopRegOtpTimer() {
    if (regOtpCountdownTimer) { clearInterval(regOtpCountdownTimer); regOtpCountdownTimer = null; }
  }

  function showAuthForm(mode) {
    stopOtpTimer();
    stopRegOtpTimer();
    document.getElementById("form-login").classList.toggle("active", mode === "login");
    document.getElementById("form-otp").classList.toggle("active", mode === "otp");
    document.getElementById("form-register").classList.toggle("active", mode === "register");
    document.getElementById("form-reg-otp").classList.toggle("active", mode === "reg-otp");
    document.querySelectorAll(".auth-tab").forEach((b) => {
      const t = b.getAttribute("data-auth-tab");
      const activeTab = mode === "otp" ? "login" : mode === "reg-otp" ? "register" : mode;
      b.classList.toggle("active", activeTab === t);
    });
  }

  function startOtpTimer(seconds = 300) {
    stopOtpTimer();
    let rem = seconds;
    const lbl = document.getElementById("otp-timer-label");
    const tick = () => {
      if (!lbl) return;
      if (rem <= 0) {
        lbl.textContent = "Code expired — click Resend OTP";
        stopOtpTimer();
        return;
      }
      const m = Math.floor(rem / 60);
      const s = String(rem % 60).padStart(2, "0");
      lbl.textContent = `Code expires in ${m}:${s}`;
      rem--;
    };
    tick();
    otpCountdownTimer = setInterval(tick, 1000);
  }

  function startRegOtpTimer(seconds = 300) {
    stopRegOtpTimer();
    let rem = seconds;
    const lbl = document.getElementById("reg-otp-timer-label");
    const tick = () => {
      if (!lbl) return;
      if (rem <= 0) {
        lbl.textContent = "Code expired — click Resend OTP";
        stopRegOtpTimer();
        return;
      }
      const m = Math.floor(rem / 60);
      const s = String(rem % 60).padStart(2, "0");
      lbl.textContent = `Code expires in ${m}:${s}`;
      rem--;
    };
    tick();
    regOtpCountdownTimer = setInterval(tick, 1000);
  }

  // Show / Hide Password toggle buttons (Sign In, Register, & Settings)
  document.querySelectorAll("[data-toggle-pw]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const inp = btn.parentElement && btn.parentElement.querySelector("input");
      if (!inp) return;
      const showing = inp.type === "text";
      inp.type = showing ? "password" : "text";
      btn.textContent = showing ? "👁️ Show" : "🙈 Hide";
      btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
    });
  });

  // Auth Tabs
  document.querySelectorAll(".auth-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeOtpChallengeId = "";
      activeRegOtpChallengeId = "";
      showAuthError("login-error", "");
      showAuthError("otp-error", "");
      showAuthError("reg-otp-error", "");
      showAuthForm(btn.getAttribute("data-auth-tab"));
    });
  });

  // Demo quick-fill buttons
  document.querySelectorAll(".demo-chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      const f = document.getElementById("form-login");
      f.elements.username.value = btn.getAttribute("data-demo");
      f.elements.password.value = btn.getAttribute("data-pass");
      f.requestSubmit();
    });
  });

  // Role dropdown change on Registration form
  document.getElementById("reg-role").addEventListener("change", updateRegisterDivisionOptions);

  // Login Submit (Step 1 — Password check + triggers Email OTP if configured for this account)
  document.getElementById("form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    showAuthError("login-error", "");
    const fd = new FormData(e.target);
    await withLoading("Signing In...", async () => {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.fromEntries(fd.entries())),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return showAuthError("login-error", data.error || "Sign in failed.");
      if (data.otpRequired) {
        activeOtpChallengeId = data.challengeId;
        showAuthError("otp-error", "");
        document.getElementById("otp-info-box").innerHTML = `🔐 <strong>Verification Code Sent!</strong><br/>A 6-digit OTP was emailed from <code>${esc(data.senderEmail || "darrec8@gmail.com")}</code> to <strong>${esc(data.maskedEmail)}</strong>. Check your inbox and enter it below.`;
        const otpInput = document.getElementById("otp-code-input");
        otpInput.value = "";
        showAuthForm("otp");
        startOtpTimer(data.expiresInSec || 300);
        setTimeout(() => otpInput.focus(), 60);
        showToast(`OTP code sent to ${data.maskedEmail}`);
        return;
      }
      authToken = data.token;
      localStorage.setItem("dar_dts_token", authToken);
      showToast(data.otpSkippedNoEmail ? `Welcome, ${data.user.fullName} (Tip: set an account email in Settings to require Login OTP)` : `Welcome, ${data.user.fullName}`);
      await loadState();
    }, "Authenticating & sending OTP if enabled");
  });

  // Login OTP Verify (Step 2)
  document.getElementById("form-otp").addEventListener("submit", async (e) => {
    e.preventDefault();
    showAuthError("otp-error", "");
    const otp = (document.getElementById("otp-code-input").value || "").replace(/\s+/g, "").trim();
    if (!activeOtpChallengeId) {
      showAuthForm("login");
      return showAuthError("login-error", "OTP session expired. Please sign in again.");
    }
    await withLoading("Verifying OTP Code...", async () => {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: activeOtpChallengeId, otp }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return showAuthError("otp-error", data.error || "Invalid OTP code.");
      stopOtpTimer();
      activeOtpChallengeId = "";
      authToken = data.token;
      localStorage.setItem("dar_dts_token", authToken);
      showAuthForm("login");
      showToast(`Verified! Welcome, ${data.user.fullName}`);
      await loadState();
    }, "Completing secure sign-in");
  });

  document.getElementById("btn-resend-otp").addEventListener("click", async () => {
    if (!activeOtpChallengeId) return showAuthForm("login");
    showAuthError("otp-error", "");
    await withLoading("Resending OTP...", async () => {
      const res = await fetch("/api/auth/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: activeOtpChallengeId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return showAuthError("otp-error", data.error || "Failed to resend OTP.");
      startOtpTimer(data.expiresInSec || 300);
      document.getElementById("otp-code-input").value = "";
      document.getElementById("otp-code-input").focus();
      showToast(`New 6-digit OTP sent to ${data.maskedEmail}`);
    }, "Sending a fresh 6-digit code");
  });

  document.getElementById("btn-otp-back").addEventListener("click", () => {
    activeOtpChallengeId = "";
    showAuthError("otp-error", "");
    showAuthForm("login");
  });

  // Register Submit (Step 1 — Sends 6-digit OTP to verify email address!)
  document.getElementById("form-register").addEventListener("submit", async (e) => {
    e.preventDefault();
    showAuthError("register-error", "");
    const okBox = document.getElementById("register-success");
    okBox.textContent = "";
    okBox.classList.remove("show");
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    if (payload.password !== payload.confirmPassword) {
      return showAuthError("register-error", "Passwords do not match.");
    }
    await withLoading("Sending Verification OTP...", async () => {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return showAuthError("register-error", data.error || "Registration failed.");
      if (data.otpRequired) {
        activeRegOtpChallengeId = data.challengeId;
        showAuthError("reg-otp-error", "");
        document.getElementById("reg-otp-info-box").innerHTML = `🔐 <strong>Verify Your Email Address!</strong><br/>A 6-digit verification code was sent from <code>${esc(data.senderEmail || "darrec8@gmail.com")}</code> to <strong>${esc(data.maskedEmail)}</strong>. Enter it below to finish submitting your registration.`;
        const inp = document.getElementById("reg-otp-code-input");
        inp.value = "";
        showAuthForm("reg-otp");
        startRegOtpTimer(data.expiresInSec || 300);
        setTimeout(() => inp.focus(), 60);
        showToast(`Verification OTP sent to ${data.maskedEmail}`);
        return;
      }
      if (data.pendingApproval) {
        e.target.reset();
        updateRegisterDivisionOptions();
        okBox.innerHTML = `✅ <strong>Registration Submitted!</strong> Account <code>${esc(data.user.username)}</code> (${esc(data.user.fullName)}) is now <strong>Pending Admin Confirmation</strong>.`;
        okBox.classList.add("show");
        showToast("Registration submitted — waiting for Admin confirmation.");
      }
    }, "Sending 6-digit email verification code");
  });

  // Register OTP Verify (Step 2 — Verifies email & submits account for Admin confirmation!)
  document.getElementById("form-reg-otp").addEventListener("submit", async (e) => {
    e.preventDefault();
    showAuthError("reg-otp-error", "");
    const otp = (document.getElementById("reg-otp-code-input").value || "").replace(/\s+/g, "").trim();
    if (!activeRegOtpChallengeId) {
      showAuthForm("register");
      return showAuthError("register-error", "Verification session expired. Please submit again.");
    }
    await withLoading("Verifying Email OTP...", async () => {
      const res = await fetch("/api/auth/register/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: activeRegOtpChallengeId, otp }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return showAuthError("reg-otp-error", data.error || "Invalid verification code.");
      stopRegOtpTimer();
      activeRegOtpChallengeId = "";
      const regForm = document.getElementById("form-register");
      regForm.reset();
      updateRegisterDivisionOptions();
      showAuthForm("register");
      const okBox = document.getElementById("register-success");
      okBox.innerHTML = `✅ <strong>Email Verified &amp; Registration Submitted!</strong> Account <code>${esc(data.user.username)}</code> (${esc(data.user.fullName)} — <code>${esc(data.user.email)}</code>) is now <strong>Pending Admin Confirmation</strong>. You can sign in once the System Administrator approves your account.`;
      okBox.classList.add("show");
      showToast("Email verified! Account submitted for Admin confirmation.");
    }, "Confirming email & creating account request");
  });

  document.getElementById("btn-resend-reg-otp").addEventListener("click", async () => {
    if (!activeRegOtpChallengeId) return showAuthForm("register");
    showAuthError("reg-otp-error", "");
    await withLoading("Resending Verification OTP...", async () => {
      const res = await fetch("/api/auth/register/resend-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ challengeId: activeRegOtpChallengeId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return showAuthError("reg-otp-error", data.error || "Failed to resend code.");
      startRegOtpTimer(data.expiresInSec || 300);
      document.getElementById("reg-otp-code-input").value = "";
      document.getElementById("reg-otp-code-input").focus();
      showToast(`New 6-digit verification code sent to ${data.maskedEmail}`);
    }, "Sending a fresh verification code");
  });

  document.getElementById("btn-reg-otp-back").addEventListener("click", () => {
    activeRegOtpChallengeId = "";
    showAuthError("reg-otp-error", "");
    showAuthForm("register");
  });

  // Logout
  document.getElementById("btn-logout").addEventListener("click", async () => {
    try { await apiFetch("/api/auth/logout", { method: "POST" }); } catch (_) {}
    handleSignedOut();
    showToast("You have been signed out.");
  });

  // Nav clicks & Sidebar Hide/Show Toggle (works on both desktop & mobile!)
  document.querySelectorAll(".nav-item").forEach((btn) => {
    if (btn.id === "nav-issuance-toggle" || btn.id === "nav-mailing-toggle") return;
    btn.addEventListener("click", () => switchView(btn.getAttribute("data-view")));
  });
  const navMailGroup = document.getElementById("nav-group-mailing");
  const navMailToggle = document.getElementById("nav-mailing-toggle");
  const navMailCaret = document.getElementById("mailing-caret");
  if (navMailCaret && navMailGroup) {
    navMailCaret.addEventListener("click", (e) => {
      e.stopPropagation();
      navMailGroup.classList.toggle("collapsed");
    });
  }
  if (navMailToggle && navMailGroup) {
    navMailToggle.addEventListener("click", () => {
      if (currentView === "mailing" && selectedMailingCourier === "ALL") {
        navMailGroup.classList.toggle("collapsed");
        return;
      }
      navMailGroup.classList.remove("collapsed");
      selectedMailingCourier = "ALL";
      hdrFilters.mail = {};
      sortState.mail = { key: "", dir: 1 };
      switchView("mailing");
      renderMailingView();
      renderMailingSidebar();
    });
  }
  const navIssGroup = document.getElementById("nav-group-issuance");
  const navIssToggle = document.getElementById("nav-issuance-toggle");
  const navIssCaret = document.getElementById("issuance-caret");
  if (navIssCaret && navIssGroup) {
    navIssCaret.addEventListener("click", (e) => {
      e.stopPropagation();
      navIssGroup.classList.toggle("collapsed");
    });
  }
  if (navIssToggle && navIssGroup) {
    navIssToggle.addEventListener("click", () => {
      if (currentView === "issuances" && selectedIssuanceCategory === "ALL") {
        navIssGroup.classList.toggle("collapsed");
        return;
      }
      navIssGroup.classList.remove("collapsed");
      selectedIssuanceCategory = "ALL";
      switchView("issuances");
      renderIssuancesView();
      renderIssuanceSidebar();
    });
  }
  const appShell = document.getElementById("app-shell");
  const menuToggleBtn = document.getElementById("menu-toggle");
  const syncSidebarToggleBtn = () => {
    const collapsed = appShell.classList.contains("sidebar-collapsed");
    menuToggleBtn.title = collapsed ? "Show Sidebar" : "Hide Sidebar";
    menuToggleBtn.setAttribute("aria-label", collapsed ? "Show Sidebar" : "Hide Sidebar");
    menuToggleBtn.textContent = collapsed ? "☰" : "☰";
  };
  if (localStorage.getItem("dar_dts_sidebar_collapsed") === "1") {
    appShell.classList.add("sidebar-collapsed");
  }
  syncSidebarToggleBtn();
  menuToggleBtn.addEventListener("click", () => {
    if (window.innerWidth <= 820) {
      document.getElementById("sidebar").classList.toggle("open");
    } else {
      const collapsed = appShell.classList.toggle("sidebar-collapsed");
      localStorage.setItem("dar_dts_sidebar_collapsed", collapsed ? "1" : "0");
      syncSidebarToggleBtn();
    }
  });

  // New Document buttons
  document.getElementById("btn-new-incoming").addEventListener("click", openNewIncoming);
  document.getElementById("btn-add-inc-2").addEventListener("click", openNewIncoming);
  document.getElementById("btn-new-outgoing").addEventListener("click", openNewOutgoing);
  document.getElementById("btn-add-out-2").addEventListener("click", openNewOutgoing);

  // Close modals
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => closeModal(btn.getAttribute("data-close")));
  });

  // Modal Tabs
  document.querySelectorAll(".modal-tabs").forEach((bar) => {
    bar.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => activateTab(bar.id, btn.getAttribute("data-tab")));
    });
  });

  // Live Auto-Status recalculation whenever any Incoming field changes
  const incForm = document.getElementById("form-incoming");
  incForm.addEventListener("input", refreshLiveAutoStatus);
  incForm.addEventListener("change", refreshLiveAutoStatus);
  // Document Classification (External/Internal) and DTS Year regenerate the DTS Control No.;
  // Internal & External share one continuous annual sequence that resets to 0001 on a new year!
  document.getElementById("inc-doc-category").addEventListener("change", refreshNewIncomingControlNo);
  document.getElementById("inc-dts-year").addEventListener("change", refreshNewIncomingControlNo);
  document.getElementById("inc-dts-year").addEventListener("input", (e) => {
    if (/^\d{4}$/.test(String(e.target.value || "").trim())) refreshNewIncomingControlNo();
  });

  // PDF Attachment File Picker & Upload
  document.getElementById("btn-pick-pdf").addEventListener("click", () => {
    document.getElementById("inc-pdf-input").click();
  });
  async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^;]+;base64,/i, ""));
      reader.onerror = () => reject(new Error("Failed to read PDF file."));
      reader.readAsDataURL(file);
    });
  }

  async function safeParseJsonResponse(res) {
    const txt = await res.text();
    try {
      return JSON.parse(txt);
    } catch (_) {
      if (res.status === 413 || /request entity too large/i.test(txt)) {
        return { ok: false, statusCode: 413, error: "File exceeds Vercel's 4.5 MB limit." };
      }
      return { ok: false, statusCode: res.status || 500, error: txt.slice(0, 180) || `HTTP ${res.status}` };
    }
  }

  async function uploadPdfDirectlyToAppsScript(file, filename, controlNo, label, folderMeta = {}) {
    const gasUrl = String((state.meta && state.meta.appsScriptUrl) || "").trim();
    if (!gasUrl) {
      throw new Error("PDF exceeds Vercel's 4.5 MB limit. Configure the Google Apps Script Web App URL in Settings to upload up to 35 MB directly to Google Drive.");
    }
    if (file.size > 35 * 1024 * 1024) {
      throw new Error("Max PDF size for direct Google Drive cloud upload is 35 MB (use localhost server for up to 100 MB).");
    }
    const base64 = await fileToBase64(file);
    return withLoading(
      `Uploading ${label} to Google Drive (${formatFileSize(file.size)})...`,
      async () => {
        const res = await fetch(gasUrl, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({
            action: "uploadPdf",
            filename,
            controlNo: controlNo || "",
            docYear: String(folderMeta.docYear || "").trim(),
            transaction: String(folderMeta.transaction || "").trim(),
            subFolder: String(folderMeta.subFolder || "").trim(),
            base64,
            folderId: (state.meta && state.meta.driveFolderId) || "1JJwNkttWowxao0UIhR7k_hKXWI1L_eQC",
            uploadedBy: (currentUser && currentUser.fullName) || "Records Staff",
          }),
        });
        const data = await safeParseJsonResponse(res);
        if (!data.ok || !data.file) throw new Error(data.error || "Direct Google Drive upload failed.");
        return data;
      },
      filename
    );
  }

  async function uploadPdfSmart(file, filename, controlNo, label = "PDF", folderMeta = {}) {
    const docYear = String(folderMeta.docYear || "").trim();
    const transaction = String(folderMeta.transaction || "").trim();
    const subFolder = String(folderMeta.subFolder || "").trim();
    const isGasRuntime = typeof google !== "undefined" && google.script && google.script.run;
    if (isGasRuntime) {
      if (file.size > 35 * 1024 * 1024) {
        throw new Error("In Google Apps Script mode, max PDF size is 35 MB (use localhost server for up to 100 MB).");
      }
      const base64 = await fileToBase64(file);
      const res = await apiFetch("/api/upload-pdf", {
        method: "POST",
        loadingText: `Uploading ${label} (${formatFileSize(file.size)})...`,
        loadingSub: filename,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, base64, controlNo: controlNo || "", docYear, transaction, subFolder }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Upload failed");
      return data;
    }

    const host = String(window.location.hostname || "").toLowerCase();
    const isLocalHost = host === "localhost" || host === "127.0.0.1" || /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[01])\./.test(host);
    const gasUrl = String((state.meta && state.meta.appsScriptUrl) || "").trim();

    // On cloud serverless hosts (e.g. Vercel's 4.5 MB payload cap), route PDFs > 3.5 MB straight to Google Drive via Apps Script
    if (!isLocalHost && file.size > 3.5 * 1024 * 1024 && gasUrl) {
      return uploadPdfDirectlyToAppsScript(file, filename, controlNo, label, { docYear, transaction, subFolder });
    }

    const res = await apiFetch("/api/upload-pdf", {
      method: "POST",
      loadingText: `Uploading ${label} (${formatFileSize(file.size)})...`,
      loadingSub: filename,
      headers: {
        "Content-Type": "application/pdf",
        "X-Filename": encodeURIComponent(filename),
        "X-Control-No": encodeURIComponent(controlNo || ""),
        "X-Doc-Year": encodeURIComponent(docYear),
        "X-Transaction": encodeURIComponent(transaction),
        "X-Subfolder": encodeURIComponent(subFolder),
      },
      body: file,
    });

    if (res.status === 413 && gasUrl) {
      return uploadPdfDirectlyToAppsScript(file, filename, controlNo, label, { docYear, transaction, subFolder });
    }
    const data = await safeParseJsonResponse(res);
    if (!res.ok || !data.ok) throw new Error(data.error || "Upload failed");
    return data;
  }

  // Incoming Box A PDF Upload
  document.getElementById("inc-pdf-input").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      e.target.value = "";
      return showToast("Please select a valid PDF (.pdf) file only.", true);
    }
    if (file.size > 100 * 1024 * 1024) {
      e.target.value = "";
      return showToast("PDF file is too large (maximum 100 MB).", true);
    }
    const statusEl = document.getElementById("inc-pdf-status");
    statusEl.textContent = `Uploading ${file.name} (${formatFileSize(file.size)})...`;
    try {
      const ctrl = incForm.elements.controlNo.value.trim();
      const docYear = (incForm.elements.dtsYear && incForm.elements.dtsYear.value.trim()) || extractDocYear(incForm.elements.dateReceived.value, ctrl);
      const data = await uploadPdfSmart(file, file.name, ctrl, "PDF", { docYear, transaction: "Incoming", subFolder: "" });
      currentAttachmentFile = data.file;
      pdfPreviewExpanded = true;
      const attText = incForm.elements.attachments;
      if (!attText.value.trim() || attText.value.trim().toUpperCase() === "NO ATTACHMENT") {
        attText.value = "PDF Attached";
      }
      renderPdfAttachmentBar();
      const fPath = data.file.folderPath ? ` (${data.file.folderPath})` : "";
      showToast(
        data.file.driveSynced
          ? `PDF uploaded to Google Drive${fPath}: ${file.name}`
          : `PDF saved locally${fPath}: ${file.name}`
      );
    } catch (err) {
      statusEl.textContent = "Upload failed";
      showToast(err.message || "PDF upload failed", true);
    }
  });

  // Stamp My Name & Current Time buttons inside Boxes B, C, D, E
  document.querySelectorAll("[data-stamp]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const box = btn.getAttribute("data-stamp");
      const dtLocal = nowDateTimeLocal();
      const name = currentUser ? currentUser.fullName : "";
      if (box === "boxB") {
        incForm.elements.rdDateTime.value = dtLocal;
        incForm.elements.rdReceivedBy.value = name;
      } else if (box === "boxC") {
        incForm.elements.ardDateTime.value = dtLocal;
        incForm.elements.ardReceivedBy.value = name;
      } else if (box === "boxD") {
        incForm.elements.divDateTime.value = dtLocal;
        incForm.elements.divReceivedBy.value = name;
        if (!incForm.elements.divChiefName.value) incForm.elements.divChiefName.value = name;
      } else if (box === "boxE") {
        if (incForm.elements.dateReturnedAt) incForm.elements.dateReturnedAt.value = dtLocal;
        if (incForm.elements.releasedBy) incForm.elements.releasedBy.value = name;
      }
      refreshLiveAutoStatus();
    });
  });

  // Incoming Box E: Reply / Action PDF Upload
  document.getElementById("btn-pick-inc-reply-pdf").addEventListener("click", () => {
    document.getElementById("inc-reply-pdf-input").click();
  });
  document.getElementById("inc-reply-pdf-input").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      e.target.value = "";
      return showToast("Please select a valid PDF (.pdf) file only.", true);
    }
    if (file.size > 100 * 1024 * 1024) {
      e.target.value = "";
      return showToast("PDF file is too large (maximum 100 MB).", true);
    }
    const ctrl = (incForm.elements.controlNo.value || "INC").trim();
    const statusEl = document.getElementById("inc-reply-pdf-status");
    statusEl.textContent = `Uploading Reply PDF (${formatFileSize(file.size)})...`;
    try {
      const docYear = (incForm.elements.dtsYear && incForm.elements.dtsYear.value.trim()) || extractDocYear(incForm.elements.dateReceived.value, ctrl);
      const data = await uploadPdfSmart(file, `${ctrl}_REPLY.pdf`, ctrl, "Reply PDF", { docYear, transaction: "Incoming", subFolder: "Replies" });
      currentIncReplyAttachmentFile = data.file;
      incReplyPdfPreviewExpanded = true;
      renderIncReplyPdfBar();
      renderIncBoxERecipientChipsAndSummary();
      const fPath = data.file.folderPath ? ` (${data.file.folderPath})` : "";
      showToast(data.file.driveSynced ? `Reply / Action PDF uploaded to Google Drive${fPath} & ready to email!` : `Reply / Action PDF saved locally${fPath}.`);
    } catch (err) {
      statusEl.textContent = "Upload failed";
      showToast(err.message || "Reply PDF upload failed", true);
    }
  });

  // Incoming Box E: Multi-Select Recipient (To) Dropdown Events
  const incRecipTrigger = document.getElementById("inc-boxe-recip-trigger");
  const incRecipMenu = document.getElementById("inc-boxe-recip-menu");
  const incRecipSearch = document.getElementById("inc-boxe-recip-search");
  incRecipTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!currentIncomingPerms.boxE) return;
    const isOpen = !incRecipMenu.classList.contains("hidden");
    incRecipMenu.classList.toggle("hidden", isOpen);
    incRecipTrigger.setAttribute("aria-expanded", String(!isOpen));
    if (!isOpen) {
      renderIncBoxERecipientPicker();
      incRecipSearch.focus();
    }
  });
  incRecipSearch.addEventListener("input", renderIncBoxERecipientPicker);
  const addCustomIncRecip = () => {
    const val = incRecipSearch.value.trim();
    if (!val) return;
    selectedIncBoxERecipients.add(val);
    incRecipSearch.value = "";
    renderIncBoxERecipientPicker();
  };
  document.getElementById("btn-inc-recip-add-custom").addEventListener("click", addCustomIncRecip);
  incRecipSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addCustomIncRecip(); }
  });
  document.getElementById("btn-inc-recip-all-darpo").addEventListener("click", () => {
    getAllFurnishedCopyOptions().darpos.forEach((d) => selectedIncBoxERecipients.add(d.code));
    renderIncBoxERecipientPicker();
  });
  document.getElementById("btn-inc-recip-all-ro").addEventListener("click", () => {
    getAllFurnishedCopyOptions().roDivs.forEach((d) => selectedIncBoxERecipients.add(d.code));
    renderIncBoxERecipientPicker();
  });
  document.getElementById("btn-inc-recip-clear").addEventListener("click", () => {
    selectedIncBoxERecipients.clear();
    renderIncBoxERecipientPicker();
  });
  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("inc-boxe-recip-wrap");
    if (wrap && !incRecipMenu.classList.contains("hidden") && !wrap.contains(e.target)) {
      incRecipMenu.classList.add("hidden");
      incRecipTrigger.setAttribute("aria-expanded", "false");
    }
  });

  // Incoming Box E: Manual Send Email to Recipients
  document.getElementById("btn-send-inc-boxe-email").addEventListener("click", async () => {
    const ctrl = (incForm.elements.controlNo.value || "").trim();
    const recips = [...selectedIncBoxERecipients];
    if (!recips.length) return showToast("Please select at least one Recipient (To) in Box E first.", true);
    if (!ctrl || editingIncomingIsNew) return showToast("Please save the Incoming document first before sending emails.", true);
    const res = await apiFetch("/api/incoming/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ controlNo: ctrl, boxERecipients: recips, replyAttachmentFile: currentIncReplyAttachmentFile }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return showToast(data.error || "Failed to send email", true);
    const d = data.emailDispatch;
    renderIncBoxERecipientChipsAndSummary(d);
    if (d && d.sent) {
      showToast(`📧 Reply emailed to ${d.recipients.length} recipient office(s)${d.attachedFile ? " with PDF!" : "!"}`);
    } else if (d && d.mailtoUrl) {
      showToast(d.error ? `Email relay note: ${d.error} — click Open Email Client below.` : "Prepared email recipients.", true);
    } else {
      showToast((d && d.error) || "No Admin email addresses configured yet for the selected offices.", true);
    }
    await loadState();
  });

  // Incoming Save (sends snapshot; server strictly validates & merges only authorized Box fields + auto-status!)
  incForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = readIncomingFormSnapshot();
    const res = await apiFetch("/api/incoming", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return showToast(data.error || "Failed to save", true);
    closeModal("modal-incoming");
    const em = data.emailDispatch;
    if (em && em.sent) {
      showToast(`Saved ${data.record.controlNo} & emailed ${em.recipients.length} recipient office(s)!`);
    } else {
      showToast(`Saved ${data.record.controlNo} — Auto-Status: ${data.record.status}`);
    }
    await loadState();
  });

  // Outgoing: regenerate per-user/office Outgoing No. when Originating Division changes on a new doc
  document.getElementById("out-originating-div").addEventListener("change", refreshNewOutgoingUserNo);

  // Outgoing Multi-Select Furnished Copy Dropdown Events
  const fcTrigger = document.getElementById("out-furnished-trigger");
  const fcMenu = document.getElementById("out-furnished-menu");
  const fcSearch = document.getElementById("out-furnished-search");
  fcTrigger.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = !fcMenu.classList.contains("hidden");
    fcMenu.classList.toggle("hidden", isOpen);
    fcTrigger.setAttribute("aria-expanded", String(!isOpen));
    if (!isOpen) {
      renderFurnishedCopyPicker();
      fcSearch.focus();
    }
  });
  fcSearch.addEventListener("input", renderFurnishedCopyPicker);
  const addCustomRecipient = () => {
    const val = fcSearch.value.trim();
    if (!val) return;
    selectedFurnishedCopy.add(val);
    fcSearch.value = "";
    renderFurnishedCopyPicker();
  };
  document.getElementById("btn-fc-add-custom").addEventListener("click", addCustomRecipient);
  fcSearch.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addCustomRecipient();
    }
  });
  document.getElementById("btn-fc-all-darpo").addEventListener("click", () => {
    getAllFurnishedCopyOptions().darpos.forEach((d) => selectedFurnishedCopy.add(d.code));
    renderFurnishedCopyPicker();
  });
  document.getElementById("btn-fc-all-ro").addEventListener("click", () => {
    getAllFurnishedCopyOptions().roDivs.forEach((d) => selectedFurnishedCopy.add(d.code));
    renderFurnishedCopyPicker();
  });
  document.getElementById("btn-fc-clear").addEventListener("click", () => {
    selectedFurnishedCopy.clear();
    renderFurnishedCopyPicker();
  });
  document.addEventListener("click", (e) => {
    const wrap = document.getElementById("out-furnished-wrap");
    if (wrap && !fcMenu.classList.contains("hidden") && !wrap.contains(e.target)) {
      fcMenu.classList.add("hidden");
      fcTrigger.setAttribute("aria-expanded", "false");
    }
  });

  // Outgoing Box D Multi-Select Final Dispatch Mode Dropdown Events
  const dispTrigger = document.getElementById("out-dispatch-trigger");
  const dispMenu = document.getElementById("out-dispatch-menu");
  if (dispTrigger && dispMenu) {
    dispTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (dispTrigger.disabled) return;
      const isOpen = !dispMenu.classList.contains("hidden");
      dispMenu.classList.toggle("hidden", isOpen);
      dispTrigger.setAttribute("aria-expanded", String(!isOpen));
      if (!isOpen) renderOutDispatchModePicker();
    });
    const btnDispClear = document.getElementById("btn-dispatch-clear");
    if (btnDispClear) {
      btnDispClear.addEventListener("click", () => {
        selectedOutDispatchModes.clear();
        renderOutDispatchModePicker();
      });
    }
    document.addEventListener("click", (e) => {
      const wrap = document.getElementById("out-dispatch-wrap");
      if (wrap && !dispMenu.classList.contains("hidden") && !wrap.contains(e.target)) {
        dispMenu.classList.add("hidden");
        dispTrigger.setAttribute("aria-expanded", "false");
      }
    });
  }

  // Outgoing Box D (Records Unit ONLY): Assign Next DAR8 Rec. No. based on last Outgoing DTS Rec. No.
  document.getElementById("btn-assign-dar8-recno").addEventListener("click", async () => {
    if (!currentUser || (currentUser.role !== "RECORDS" && currentUser.role !== "ADMIN")) {
      return showToast("Only Records Section can assign DAR8 Rec. No.", true);
    }
    const outForm = document.getElementById("form-outgoing");
    const dt = outForm.elements.recordsDateReceived.value || todayISO();
    const nextRecNo = await fetchNextNumber("outgoing", dt);
    outForm.elements.recNo.value = nextRecNo;
    if (!outForm.elements.recordsDateReceived.value) outForm.elements.recordsDateReceived.value = todayISO();
    if (!outForm.elements.recordsTimeReceived.value) {
      outForm.elements.recordsTimeReceived.value = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    }
    if (!outForm.elements.recordsReceivedBy.value) outForm.elements.recordsReceivedBy.value = currentUser.fullName;
    if (["Draft / Originating", "For Counter-Signature", "For Approval", "Returned to Originating Office"].includes(outForm.elements.status.value)) {
      outForm.elements.status.value = "Received by Records";
    }
    showToast(`Assigned DAR8 Rec. No.: ${nextRecNo}`);
  });

  document.getElementById("btn-stamp-out-records").addEventListener("click", () => {
    const outForm = document.getElementById("form-outgoing");
    outForm.elements.recordsDateReceived.value = todayISO();
    outForm.elements.recordsTimeReceived.value = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    outForm.elements.recordsReceivedBy.value = currentUser ? currentUser.fullName : "";
    if (!outForm.elements.dateDispatched.value) outForm.elements.dateDispatched.value = nowDateTimeLocal();
  });

  document.getElementById("btn-stamp-out-return").addEventListener("click", () => {
    const outForm = document.getElementById("form-outgoing");
    if (!outForm.elements.returnedToOffice.value && outForm.elements.originatingDivision.value) {
      outForm.elements.returnedToOffice.value = outForm.elements.originatingDivision.value;
    }
    outForm.elements.dateReceivedBack.value = `${todayISO()} / ${currentUser ? currentUser.fullName : ""}`;
    outForm.elements.status.value = "Returned to Originating Office";
  });

  // Outgoing Box D Scanned PDF Upload (Saves to Google Drive & attaches to Recipient Email!)
  document.getElementById("btn-pick-out-pdf").addEventListener("click", () => {
    document.getElementById("out-pdf-input").click();
  });
  document.getElementById("out-pdf-input").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      e.target.value = "";
      return showToast("Please select a valid PDF (.pdf) scanned file only.", true);
    }
    if (file.size > 100 * 1024 * 1024) {
      e.target.value = "";
      return showToast("Scanned PDF file is too large (maximum 100 MB).", true);
    }
    const outForm = document.getElementById("form-outgoing");
    const docCode = (outForm.elements.recNo.value || outForm.elements.userDocNo.value || "OUT").trim();
    const statusEl = document.getElementById("out-pdf-status");
    statusEl.textContent = `Uploading ${file.name} (${formatFileSize(file.size)})...`;
    try {
      const docYear = (outForm.elements.dtsYear && outForm.elements.dtsYear.value.trim()) || extractDocYear(outForm.elements.dateOriginated.value, docCode);
      const data = await uploadPdfSmart(file, file.name, docCode, "Scanned PDF", { docYear, transaction: "Outgoing", subFolder: "" });
      currentOutAttachmentFile = data.file;
      outPdfPreviewExpanded = true;
      if (!outForm.elements.attachments.value.trim() || outForm.elements.attachments.value.trim().toUpperCase() === "NONE") {
        outForm.elements.attachments.value = "PDF Attached";
      }
      renderOutPdfAttachmentBar();
      renderFurnishedCopyChipsAndSummary();
      const fPath = data.file.folderPath ? ` (${data.file.folderPath})` : "";
      showToast(
        data.file.driveSynced
          ? `Scanned PDF uploaded to Google Drive${fPath} & ready to email: ${file.name}`
          : `Scanned PDF saved locally${fPath}: ${file.name}`
      );
    } catch (err) {
      statusEl.textContent = "Upload failed";
      showToast(err.message || "Scanned PDF upload failed", true);
    }
  });

  // Manual trigger: Send Email to Recipients (includes uploaded Scanned PDF!)
  document.getElementById("btn-send-furnished-email").addEventListener("click", async () => {
    const outForm = document.getElementById("form-outgoing");
    const recId = outForm.elements.id.value.trim();
    const fc = [...selectedFurnishedCopy];
    if (!fc.length) return showToast("Please select at least one office in Recipient (To) (Box A & B) first.", true);
    if (!recId) return showToast("Please save the Outgoing document first before sending emails.", true);
    const res = await apiFetch("/api/outgoing/send-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: recId, furnishedCopy: fc, attachmentFile: currentOutAttachmentFile }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return showToast(data.error || "Failed to send emails", true);
    const d = data.emailDispatch;
    renderFurnishedCopyChipsAndSummary(d);
    if (d && d.sent) {
      showToast(`📧 Sent to ${d.recipients.length} recipient office(s)${d.attachedFile ? " with scanned PDF!" : "!"}`);
    } else if (d && d.mailtoUrl) {
      showToast(d.error ? `Email relay note: ${d.error} — click Open Email Client below.` : "Prepared email recipients.", true);
    } else {
      showToast((d && d.error) || "No Admin email addresses configured yet for the selected offices.", true);
    }
    await loadState();
  });

  // Outgoing Save
  document.getElementById("form-outgoing").addEventListener("submit", async (e) => {
    e.preventDefault();
    const selectedRecips = [...selectedFurnishedCopy];
    if (!selectedRecips.length) {
      activateTab("out-form-tabs", "out-box-ab");
      return showToast("Please select or add at least one Recipient (To) in Box A & B.", true);
    }
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    if (payload.dateDispatched) payload.dateDispatched = fromDatetimeLocalValue(payload.dateDispatched);
    payload.recipientTo = selectedRecips.join(", ");
    payload.furnishedCopy = selectedRecips;
    payload.finalDispatchMode = [...selectedOutDispatchModes].join(", ");
    payload.attachmentFile = currentOutAttachmentFile;
    const res = await apiFetch("/api/outgoing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return showToast(data.error || "Failed to save", true);
    closeModal("modal-outgoing");
    const recLabel = data.record.recNo ? `DAR8 Rec. No.: ${data.record.recNo}` : `User No.: ${data.record.userDocNo} (Pending Records DAR8 Rec. No.)`;
    const em = data.emailDispatch;
    if (em && em.sent) {
      showToast(`Saved Outgoing (${recLabel}) & emailed ${em.recipients.length} recipient office(s)!`);
    } else if (em && em.attempted && em.error) {
      showToast(`Saved Outgoing (${recLabel}). Email note: ${em.error}`);
    } else {
      showToast(`Saved Outgoing — ${recLabel}`);
    }
    await loadState();
  });

  // Admin Add Issuance Sub-Category
  const addIssCatHandler = async () => {
    const inp = document.getElementById("admin-new-iss-cat");
    const val = (inp.value || "").trim();
    if (!val) return showToast("Please enter an Issuance sub-category name.", true);
    await addIssuanceCategory(val);
    inp.value = "";
  };
  document.getElementById("btn-add-iss-cat").addEventListener("click", addIssCatHandler);
  document.getElementById("admin-new-iss-cat").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addIssCatHandler(); }
  });

  // Issuances View Controls & Modal Handlers
  document.getElementById("btn-add-issuance").addEventListener("click", openNewIssuance);
  document.getElementById("btn-manage-iss-cols").addEventListener("click", () => {
    openIssuanceColumnsModal(selectedIssuanceCategory || "ALL");
  });
  document.getElementById("iss-cols-cat-select").addEventListener("change", (e) => {
    managingIssColsCat = e.target.value || "ALL";
    editingIssColIdx = -1;
    renderIssuanceColumnsModal();
  });
  const addIssColFromModal = async () => {
    const inp = document.getElementById("iss-cols-new-name");
    const typeSel = document.getElementById("iss-cols-new-type");
    const label = (inp.value || "").trim();
    if (!label) return showToast("Please enter a column header name.", true);
    const cols = getIssuanceColumnsFor(managingIssColsCat);
    if (cols.some((c) => c.label.toLowerCase() === label.toLowerCase())) {
      return showToast(`Column "${label}" already exists.`, true);
    }
    cols.push({
      key: makeCustomColumnKey(label, cols),
      label,
      builtin: false,
      type: typeSel && ["date", "date_range", "datetime", "multi_names"].includes(typeSel.value) ? typeSel.value : "text",
    });
    const ok = await saveIssuanceColumnsFor(managingIssColsCat, cols, `Adding column "${label}"`);
    if (ok) {
      inp.value = "";
      showToast(`Added column "${label}"!`);
    }
  };
  document.getElementById("btn-iss-col-add").addEventListener("click", addIssColFromModal);
  document.getElementById("iss-cols-new-name").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addIssColFromModal(); }
  });
  document.getElementById("btn-iss-cols-reset").addEventListener("click", async () => {
    const labelCat = managingIssColsCat === "ALL" ? "All Issuances" : managingIssColsCat;
    const defCols = getDefaultIssuanceColumnsFor(managingIssColsCat);
    if (!confirm(`Reset columns for "${labelCat}" back to the default ${defCols.length} columns?`)) return;
    const ok = await saveIssuanceColumnsFor(managingIssColsCat, defCols, `Resetting ${labelCat} columns`);
    if (ok) showToast(`Reset columns for "${labelCat}" to defaults.`);
  });
  document.getElementById("iss-search").addEventListener("input", renderIssuancesView);
  document.getElementById("iss-filter-year").addEventListener("change", renderIssuancesView);
  document.getElementById("btn-clear-iss-filters").addEventListener("click", () => {
    document.getElementById("iss-search").value = "";
    document.getElementById("iss-filter-year").value = "ALL";
    hdrFilters.iss = {};
    sortState.iss = { key: "", dir: 1 };
    updateHeaderDropIndicators("iss");
    closeHeaderPopover();
    renderIssuancesView();
  });
  document.getElementById("iss-filter-cat").addEventListener("change", (e) => {
    selectedIssuanceCategory = e.target.value || "ALL";
    hdrFilters.iss = {};
    sortState.iss = { key: "", dir: 1 };
    closeHeaderPopover();
    renderIssuancesView();
    renderIssuanceSidebar();
  });
  document.getElementById("btn-sync-iss-sheets").addEventListener("click", async () => {
    const res = await apiFetch("/api/issuances/sync-sheets", { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return showToast(data.error || "Failed to sync Issuances to Google Sheet.", true);
    }
    const tabs = (data.results || []).filter((r) => r.synced).map((r) => r.sheetName).join(", ");
    showToast(`☁️ Synced ${data.syncedCount} tab(s) to Google Sheet: ${tabs}`);
  });
  document.getElementById("btn-export-iss").addEventListener("click", () => {
    const label = selectedIssuanceCategory === "ALL" ? "All" : selectedIssuanceCategory.replace(/[^A-Za-z0-9]+/g, "-");
    const cols = getIssuanceColumnsFor(selectedIssuanceCategory || "ALL");
    const exportRows = getFilteredIssuances().map((r) => {
      const obj = {};
      cols.forEach((c) => {
        obj[c.label] = getIssuanceCellPlainValue(r, c);
      });
      return obj;
    });
    downloadCsv(`DAR-RO8-Issuances-${label}-${todayISO()}.csv`, exportRows);
  });
  document.getElementById("out-dts-year").addEventListener("change", refreshNewOutgoingUserNo);
  document.getElementById("out-dts-year").addEventListener("input", (e) => {
    if (/^\d{4}$/.test(String(e.target.value || "").trim())) refreshNewOutgoingUserNo();
  });
  document.getElementById("iss-year").addEventListener("change", refreshNewIssuanceNo);
  document.getElementById("iss-year").addEventListener("input", (e) => {
    if (/^\d{4}$/.test(String(e.target.value || "").trim())) refreshNewIssuanceNo();
  });
  document.getElementById("mail-year").addEventListener("change", refreshNewMailingNo);
  document.getElementById("mail-year").addEventListener("input", (e) => {
    if (/^\d{4}$/.test(String(e.target.value || "").trim())) refreshNewMailingNo();
  });
  document.getElementById("iss-category-select").addEventListener("change", (e) => {
    refreshNewIssuanceNo();
    renderIssCustomFieldsInModal(e.target.value);
  });
  document.getElementById("form-issuance").elements.dateIssued.addEventListener("change", refreshNewIssuanceNo);
  document.getElementById("btn-pick-iss-pdf").addEventListener("click", () => {
    document.getElementById("iss-pdf-input").click();
  });
  document.getElementById("iss-pdf-input").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      e.target.value = "";
      return showToast("Please select a valid PDF (.pdf) scanned file only.", true);
    }
    if (file.size > 100 * 1024 * 1024) {
      e.target.value = "";
      return showToast("Scanned PDF file is too large (maximum 100 MB).", true);
    }
    const issForm = document.getElementById("form-issuance");
    const docCode = (issForm.elements.issuanceNo.value || "ISS").trim();
    const statusEl = document.getElementById("iss-pdf-status");
    statusEl.textContent = `Uploading ${file.name} (${formatFileSize(file.size)})...`;
    try {
      const docYear = (issForm.elements.issuanceYear && issForm.elements.issuanceYear.value.trim()) || extractDocYear(issForm.elements.dateIssued.value, docCode);
      const issCat = (issForm.elements.category && issForm.elements.category.value.trim()) || "";
      const data = await uploadPdfSmart(file, file.name, docCode, "Issuance PDF", { docYear, transaction: "Issuances", subFolder: issCat });
      currentIssAttachmentFile = data.file;
      issPdfPreviewExpanded = true;
      renderIssPdfAttachmentBar();
      renderIssRecipientChipsAndSummary();
      const fPath = data.file.folderPath ? ` (${data.file.folderPath})` : "";
      showToast(
        data.file.driveSynced
          ? `Issuance PDF uploaded to Google Drive${fPath}: ${file.name}`
          : `Issuance PDF saved locally${fPath}: ${file.name}`
      );
    } catch (err) {
      statusEl.textContent = "Upload failed";
      showToast(err.message || "Issuance PDF upload failed", true);
    }
  });
  // Issuance Multi-Select Recipient (To) Picker & Send Email
  const issRecipPanel = document.getElementById("iss-recip-panel");
  const issRecipTrigger = document.getElementById("iss-recip-trigger");
  const issRecipSearch = document.getElementById("iss-recip-search");
  if (issRecipTrigger && issRecipPanel) {
    issRecipTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = issRecipPanel.classList.contains("hidden");
      issRecipPanel.classList.toggle("hidden", !willOpen);
      if (willOpen) {
        renderIssRecipientPicker();
        if (issRecipSearch) issRecipSearch.focus();
      }
    });
    document.addEventListener("click", (e) => {
      const dd = document.getElementById("iss-recip-dropdown");
      if (dd && !dd.contains(e.target)) issRecipPanel.classList.add("hidden");
    });
  }
  if (issRecipSearch) {
    issRecipSearch.addEventListener("input", renderIssRecipientPicker);
    issRecipSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = issRecipSearch.value.trim();
        if (val) {
          selectedIssRecipients.add(val);
          issRecipSearch.value = "";
          renderIssRecipientPicker();
          renderIssRecipientChipsAndSummary();
        }
      }
    });
  }
  const addCustomIssRecipBtn = document.getElementById("btn-iss-recip-add-custom");
  if (addCustomIssRecipBtn) {
    addCustomIssRecipBtn.addEventListener("click", () => {
      const val = (issRecipSearch && issRecipSearch.value || "").trim();
      if (!val) return;
      selectedIssRecipients.add(val);
      issRecipSearch.value = "";
      renderIssRecipientPicker();
      renderIssRecipientChipsAndSummary();
    });
  }
  const issAllDarpoBtn = document.getElementById("btn-iss-recip-all-darpo");
  if (issAllDarpoBtn) {
    issAllDarpoBtn.addEventListener("click", () => {
      getAllFurnishedCopyOptions().darpos.forEach((d) => selectedIssRecipients.add(d.code));
      renderIssRecipientPicker();
      renderIssRecipientChipsAndSummary();
    });
  }
  const issAllRoBtn = document.getElementById("btn-iss-recip-all-ro");
  if (issAllRoBtn) {
    issAllRoBtn.addEventListener("click", () => {
      getAllFurnishedCopyOptions().roDivs.forEach((d) => selectedIssRecipients.add(d.code));
      renderIssRecipientPicker();
      renderIssRecipientChipsAndSummary();
    });
  }
  const issClearRecipBtn = document.getElementById("btn-iss-recip-clear");
  if (issClearRecipBtn) {
    issClearRecipBtn.addEventListener("click", () => {
      selectedIssRecipients.clear();
      renderIssRecipientPicker();
      renderIssRecipientChipsAndSummary();
    });
  }
  const btnSendIssEmail = document.getElementById("btn-send-iss-email");
  if (btnSendIssEmail) {
    btnSendIssEmail.addEventListener("click", async () => {
      const issForm = document.getElementById("form-issuance");
      const recips = [...selectedIssRecipients];
      if (!recips.length) return showToast("Please select at least one Recipient (To) office first.", true);
      let recId = issForm.elements.id.value.trim();
      if (!recId) {
        return showToast("Please click Save Issuance first, then click Send Email to Recipients.", true);
      }
      const res = await apiFetch("/api/issuances/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: recId, recipients: recips, attachmentFile: currentIssAttachmentFile }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) return showToast(data.error || "Failed to send Issuance email.", true);
      const d = data.emailDispatch;
      renderIssRecipientChipsAndSummary(d);
      if (d && d.sent) {
        showToast(`📧 Sent Issuance email to ${d.recipients.length} recipient office(s)${d.attachedFile ? " with PDF!" : "!"}`);
      } else {
        showToast((d && d.error) || "No Admin email addresses configured yet for the selected offices.", true);
      }
      await loadState();
    });
  }
  document.getElementById("iss-province-select").addEventListener("change", (e) => {
    const oth = document.getElementById("iss-province-other");
    if (!oth) return;
    const isCustom = e.target.value === "__CUSTOM__";
    oth.classList.toggle("hidden", !isCustom);
    if (isCustom) oth.focus();
  });
  document.getElementById("form-issuance").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canEditIssuanceOrMailing()) {
      return showToast("View-only access: Only Records Section or System Admin can save Issuances.", true);
    }
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    const catLower = String(payload.category || "").trim().toLowerCase();
    const isMemoOrNotice = catLower === "memo" || catLower === "notice";
    payload.refNo = isMemoOrNotice ? "" : readIssDocketsFromModal();
    payload.customFields = readIssCustomFieldsFromModal();
    if (isMemoOrNotice) delete payload.customFields.col_province;
    payload.recipients = [...selectedIssRecipients];
    payload.attachmentFile = currentIssAttachmentFile;
    const res = await apiFetch("/api/issuances", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return showToast(data.error || "Failed to save issuance", true);
    closeModal("modal-issuance");
    const syncNote = data.sync && data.sync.synced ? ` (Synced to ${data.sync.sheetName})` : "";
    showToast(`Saved ${data.record.category} — ${data.record.issuanceNo}${syncNote}`);
    await loadState();
  });

  // Mailing Process Controls & Modal Handlers (PhilPost & JRS)
  document.getElementById("btn-add-mailing").addEventListener("click", openNewMailing);
  document.getElementById("mail-search").addEventListener("input", renderMailingView);
  document.getElementById("mail-filter-status").addEventListener("change", renderMailingView);
  document.getElementById("mail-filter-year").addEventListener("change", renderMailingView);
  document.getElementById("mail-filter-courier").addEventListener("change", (e) => {
    selectedMailingCourier = e.target.value || "ALL";
    hdrFilters.mail = {};
    sortState.mail = { key: "", dir: 1 };
    closeHeaderPopover();
    renderMailingView();
    renderMailingSidebar();
  });
  document.getElementById("btn-clear-mail-filters").addEventListener("click", () => {
    document.getElementById("mail-search").value = "";
    document.getElementById("mail-filter-status").value = "ALL";
    document.getElementById("mail-filter-year").value = "ALL";
    hdrFilters.mail = {};
    sortState.mail = { key: "", dir: 1 };
    updateHeaderDropIndicators("mail");
    closeHeaderPopover();
    renderMailingView();
  });
  document.getElementById("btn-sync-mail-sheets").addEventListener("click", async () => {
    const res = await apiFetch("/api/mailings/sync-sheets", { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      return showToast(data.error || "Failed to sync Mailings to Google Sheet.", true);
    }
    const tabs = (data.results || []).filter((r) => r.synced).map((r) => r.sheetName).join(", ");
    showToast(`☁️ Synced ${data.syncedCount} Mailing tab(s): ${tabs}`);
    await loadState();
  });
  document.getElementById("btn-export-mail").addEventListener("click", () => {
    const label = selectedMailingCourier === "ALL" ? "All" : selectedMailingCourier.replace(/[^A-Za-z0-9]+/g, "-");
    downloadCsv(`DAR-RO8-Mailing-${label}-${todayISO()}.csv`, getFilteredMailings());
  });
  document.getElementById("mail-courier-select").addEventListener("change", refreshNewMailingNo);
  document.getElementById("form-mailing").elements.dateMailed.addEventListener("change", refreshNewMailingNo);
  document.getElementById("btn-pick-mail-pdf").addEventListener("click", () => {
    document.getElementById("mail-pdf-input").click();
  });
  document.getElementById("mail-pdf-input").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      e.target.value = "";
      return showToast("Please select a valid PDF (.pdf) file only.", true);
    }
    if (file.size > 100 * 1024 * 1024) {
      e.target.value = "";
      return showToast("PDF file is too large (maximum 100 MB).", true);
    }
    const mailForm = document.getElementById("form-mailing");
    const docCode = (mailForm.elements.mailingNo.value || "MAIL").trim();
    const statusEl = document.getElementById("mail-pdf-status");
    statusEl.textContent = `Uploading ${file.name} (${formatFileSize(file.size)})...`;
    try {
      const docYear = (mailForm.elements.mailingYear && mailForm.elements.mailingYear.value.trim()) || extractDocYear(mailForm.elements.dateMailed.value, docCode);
      const courier = (mailForm.elements.courier && mailForm.elements.courier.value.trim()) || "";
      const data = await uploadPdfSmart(file, file.name, docCode, "Receipt PDF", { docYear, transaction: "Mailing Process", subFolder: courier });
      currentMailAttachmentFile = data.file;
      mailPdfPreviewExpanded = true;
      renderMailPdfAttachmentBar();
      const fPath = data.file.folderPath ? ` (${data.file.folderPath})` : "";
      showToast(data.file.driveSynced ? `Receipt PDF uploaded to Google Drive${fPath}!` : `Receipt PDF saved locally${fPath}.`);
    } catch (err) {
      statusEl.textContent = "Upload failed";
      showToast(err.message || "PDF upload failed", true);
    }
  });
  // Mailing Multi-Select Recipient (To) Concerned Offices Picker
  const mailRecipPanel = document.getElementById("mail-recip-panel");
  const mailRecipTrigger = document.getElementById("mail-recip-trigger");
  const mailRecipSearch = document.getElementById("mail-recip-search");
  if (mailRecipTrigger && mailRecipPanel) {
    mailRecipTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const willOpen = mailRecipPanel.classList.contains("hidden");
      mailRecipPanel.classList.toggle("hidden", !willOpen);
      if (willOpen) {
        renderMailRecipientPicker();
        if (mailRecipSearch) mailRecipSearch.focus();
      }
    });
    document.addEventListener("click", (e) => {
      const dd = document.getElementById("mail-recip-dropdown");
      if (dd && !dd.contains(e.target)) mailRecipPanel.classList.add("hidden");
    });
  }
  if (mailRecipSearch) {
    mailRecipSearch.addEventListener("input", renderMailRecipientPicker);
    mailRecipSearch.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const val = mailRecipSearch.value.trim();
        if (val) {
          selectedMailRecipients.add(val);
          mailRecipSearch.value = "";
          renderMailRecipientPicker();
          renderMailRecipientChips();
        }
      }
    });
  }
  const addCustomMailRecipBtn = document.getElementById("btn-mail-recip-add-custom");
  if (addCustomMailRecipBtn) {
    addCustomMailRecipBtn.addEventListener("click", () => {
      const val = (mailRecipSearch && mailRecipSearch.value || "").trim();
      if (!val) return;
      selectedMailRecipients.add(val);
      mailRecipSearch.value = "";
      renderMailRecipientPicker();
      renderMailRecipientChips();
    });
  }
  const mailAllDarpoBtn = document.getElementById("btn-mail-recip-all-darpo");
  if (mailAllDarpoBtn) {
    mailAllDarpoBtn.addEventListener("click", () => {
      getAllFurnishedCopyOptions().darpos.forEach((d) => selectedMailRecipients.add(d.code));
      renderMailRecipientPicker();
      renderMailRecipientChips();
    });
  }
  const mailAllRoBtn = document.getElementById("btn-mail-recip-all-ro");
  if (mailAllRoBtn) {
    mailAllRoBtn.addEventListener("click", () => {
      getAllFurnishedCopyOptions().roDivs.forEach((d) => selectedMailRecipients.add(d.code));
      renderMailRecipientPicker();
      renderMailRecipientChips();
    });
  }
  const mailClearRecipBtn = document.getElementById("btn-mail-recip-clear");
  if (mailClearRecipBtn) {
    mailClearRecipBtn.addEventListener("click", () => {
      selectedMailRecipients.clear();
      renderMailRecipientPicker();
      renderMailRecipientChips();
    });
  }

  const btnPrintMailModal = document.getElementById("btn-print-mail-modal");
  if (btnPrintMailModal) {
    btnPrintMailModal.addEventListener("click", () => {
      const form = document.getElementById("form-mailing");
      const addressees = readMailingAddresseesFromModal();
      const draft = {
        courier: form.elements.courier?.value || "",
        mailingNo: form.elements.mailingNo?.value || "",
        pouchControlNo: form.elements.pouchControlNo?.value || "",
        dateMailed: form.elements.dateMailed?.value || "",
        fromOffice: form.elements.fromOffice?.value || "",
        originatingDivision: form.elements.originatingDivision?.value || "",
        instruction: form.elements.instruction?.value || "",
        toCc: form.elements.toCc?.value || "",
        transDateReceived: form.elements.transDateReceived?.value || "",
        transTimeReceived: form.elements.transTimeReceived?.value || "",
        transReceivedBy: form.elements.transReceivedBy?.value || "",
        transDateReleased: form.elements.transDateReleased?.value || "",
        transReleaseDateTime: form.elements.transReleaseDateTime?.value || "",
        numberOfMails: form.elements.numberOfMails?.value || "",
        mailedBy: form.elements.mailedBy?.value || "",
        addressees,
      };
      openPrintMailingSlip(draft);
    });
  }

  document.getElementById("form-mailing").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!canEditIssuanceOrMailing()) {
      return showToast("View-only access: Only Records Section or System Admin can save Mailing records.", true);
    }
    const addressees = readMailingAddresseesFromModal();
    if (!addressees.length || !addressees.some((a) => a.name)) {
      return showToast("Please enter at least one Name of Addressee.", true);
    }
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    if (!String(payload.subject || "").trim()) {
      const tag = payload.pouchControlNo ? `Pouch Control No. ${payload.pouchControlNo}` : (payload.docType || "Pouch Service Transmittal");
      payload.subject = `${payload.courier || "Mail"} — ${tag} (${addressees.length} mail${addressees.length > 1 ? "s" : ""})`;
    }
    payload.addressees = addressees;
    payload.recipientName = addressees.map((a) => a.name).filter(Boolean).join("\n");
    payload.trackingNo = addressees.map((a) => a.trackingNo).filter(Boolean).join("\n");
    payload.dateReceived = addressees.map((a) => a.dateReceived).filter(Boolean).join("\n");
    if (!String(payload.numberOfMails || "").trim()) payload.numberOfMails = String(addressees.length);
    payload.recipients = [...selectedMailRecipients];
    payload.attachmentFile = currentMailAttachmentFile;
    const res = await apiFetch("/api/mailings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return showToast(data.error || "Failed to save mailing record", true);
    closeModal("modal-mailing");
    const syncNote = data.sync && data.sync.synced ? ` (Synced to ${data.sync.sheetName})` : "";
    showToast(`Saved ${data.record.courier} — ${data.record.mailingNo}${syncNote}`);
    await loadState();
  });

  // Admin Add Prepared / Signed By Signatory Option
  const addSignatoryHandler = async () => {
    const inp = document.getElementById("admin-new-signatory");
    const val = (inp.value || "").trim();
    if (!val) return showToast("Please enter a signatory name or title to add.", true);
    const list = [...getPreparedSignatoriesList()];
    if (list.some((s) => s.toLowerCase() === val.toLowerCase())) {
      return showToast(`"${val}" is already in the Prepared / Signed By list.`, true);
    }
    list.push(val);
    const res = await apiFetch("/api/settings", {
      method: "PUT",
      loadingText: "Adding Signatory...",
      loadingSub: val,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preparedSignatories: list }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return showToast(data.error || "Failed to add signatory", true);
    inp.value = "";
    showToast(`Added "${val}" to Prepared / Signed By dropdown.`);
    await loadState();
  };
  document.getElementById("btn-add-signatory").addEventListener("click", addSignatoryHandler);
  document.getElementById("admin-new-signatory").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addSignatoryHandler(); }
  });

  // Admin Save Office & DARPO Email Directory
  document.getElementById("btn-save-office-emails").addEventListener("click", async () => {
    const officeEmails = {};
    document.querySelectorAll('#admin-emails-tbody input[data-office-email]').forEach((inp) => {
      const code = inp.getAttribute("data-office-email");
      const val = inp.value.trim();
      if (val) officeEmails[code] = val;
    });
    const res = await apiFetch("/api/settings", {
      method: "PUT",
      loadingText: "Saving Office & DARPO Emails...",
      loadingSub: "Updating Furnished Copy email directory",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ officeEmails }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return showToast(data.error || "Failed to save email directory", true);
    showToast(`Saved ${Object.keys(officeEmails).length} office/DARPO email address(es)!`);
    await loadState();
  });

  // Test Send Email Button
  document.getElementById("btn-test-email").addEventListener("click", async () => {
    const sender = document.getElementById("set-sender-email").value.trim() || "darrec8@gmail.com";
    const toEmail = prompt(`Send a live test email from ${sender} to which email address?`, sender);
    if (!toEmail || !toEmail.trim()) return;
    const res = await apiFetch("/api/test-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toEmail: toEmail.trim() }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return showToast(data.error || "Email test failed", true);
    showToast(`✅ Test email sent to ${data.to} via ${data.mode}!`);
  });

  // Test Google Drive Upload Button
  document.getElementById("btn-test-drive").addEventListener("click", async () => {
    const btn = document.getElementById("btn-test-drive");
    btn.disabled = true;
    btn.textContent = "Testing Google Drive...";
    try {
      const res = await apiFetch("/api/test-drive", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.ok) return showToast(data.error || "Google Drive test failed", true);
      showToast(`Success! Uploaded test PDF via ${data.mode}`);
      window.open(data.url, "_blank", "noopener");
    } catch (err) {
      showToast(err.message || "Google Drive test error", true);
    } finally {
      btn.disabled = false;
      btn.textContent = "☁️ Test Google Drive Upload";
    }
  });

  // Settings Save
  document.getElementById("settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const driveUrlVal = document.getElementById("set-drive-url").value.trim();
    const folderMatch = driveUrlVal.match(/folders\/([A-Za-z0-9_-]+)/);
    const meta = {
      regionalDirector: document.getElementById("set-rd").value.trim(),
      incomingFormCode: document.getElementById("set-form-code").value.trim(),
      address: document.getElementById("set-address").value.trim(),
      telefax: document.getElementById("set-telefax").value.trim(),
      website: document.getElementById("set-website").value.trim(),
      driveFolderUrl: driveUrlVal || "https://drive.google.com/drive/folders/1JJwNkttWowxao0UIhR7k_hKXWI1L_eQC?usp=sharing",
      driveFolderId: folderMatch ? folderMatch[1] : (state.meta.driveFolderId || "1JJwNkttWowxao0UIhR7k_hKXWI1L_eQC"),
      appsScriptUrl: document.getElementById("set-apps-script").value.trim(),
      senderEmail: document.getElementById("set-sender-email").value.trim() || "darrec8@gmail.com",
    };
    const smtpPassVal = (document.getElementById("set-smtp-pass")?.value || "").trim();
    if (smtpPassVal && currentUser && currentUser.role === "ADMIN") {
      meta.smtpAppPassword = smtpPassVal;
    }
    if (currentUser && currentUser.role === "ADMIN") {
      const otpEl = document.getElementById("set-login-otp-enabled");
      if (otpEl) meta.loginOtpEnabled = otpEl.checked;
    }
    const res = await apiFetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meta }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return showToast(data.error || "Error saving settings", true);
    showToast("Settings updated successfully");
    await loadState();
  });

  // Header Filter Dropdown Popovers, Search, & Year/Cat Controls
  document.getElementById("inc-search").addEventListener("input", () => { paginationState.inc.page = 1; renderIncomingTable(); });
  document.getElementById("out-search").addEventListener("input", () => { paginationState.out.page = 1; renderOutgoingTable(); });
  ["inc-filter-year", "inc-filter-cat"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => { paginationState.inc.page = 1; renderIncomingTable(); });
  });
  document.getElementById("out-filter-year").addEventListener("change", () => { paginationState.out.page = 1; renderOutgoingTable(); });

  document.getElementById("card-inc-total").addEventListener("click", () => {
    document.getElementById("inc-filter-cat").value = "ALL";
    incProgressFilter = "ALL";
    paginationState.inc.page = 1;
    renderIncomingTable();
  });
  document.querySelectorAll(".inc-stat-card[data-cat-pick]").forEach((card) => {
    card.addEventListener("click", () => {
      const picked = card.getAttribute("data-cat-pick");
      const sel = document.getElementById("inc-filter-cat");
      sel.value = sel.value === picked ? "ALL" : picked;
      paginationState.inc.page = 1;
      renderIncomingTable();
    });
  });
  document.querySelectorAll(".inc-stat-card[data-prog-pick]").forEach((card) => {
    card.addEventListener("click", () => {
      const picked = card.getAttribute("data-prog-pick");
      incProgressFilter = incProgressFilter === picked ? "ALL" : picked;
      paginationState.inc.page = 1;
      renderIncomingTable();
    });
  });

  document.querySelectorAll(".th-drop-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openHeaderPopover(btn, btn.getAttribute("data-hdr-filter"), btn.getAttribute("data-col"));
    });
  });

  document.addEventListener("click", (e) => {
    const pop = document.getElementById("hdr-filter-popover");
    if (pop && !pop.classList.contains("hidden") && !pop.contains(e.target) && !e.target.closest(".th-drop-btn")) {
      closeHeaderPopover();
    }
  });

  document.getElementById("btn-clear-inc-filters").addEventListener("click", () => {
    document.getElementById("inc-search").value = "";
    document.getElementById("inc-filter-year").value = "ALL";
    document.getElementById("inc-filter-cat").value = "ALL";
    incProgressFilter = "ALL";
    hdrFilters.inc = {};
    sortState.inc = { key: "", dir: 1 };
    paginationState.inc.page = 1;
    updateHeaderDropIndicators("inc");
    closeHeaderPopover();
    renderIncomingTable();
  });
  document.getElementById("btn-clear-out-filters").addEventListener("click", () => {
    document.getElementById("out-search").value = "";
    document.getElementById("out-filter-year").value = "ALL";
    hdrFilters.out = {};
    sortState.out = { key: "", dir: 1 };
    paginationState.out.page = 1;
    updateHeaderDropIndicators("out");
    closeHeaderPopover();
    renderOutgoingTable();
  });

  // Global & View Trackers
  document.getElementById("global-track-btn").addEventListener("click", () => {
    const val = document.getElementById("global-track-input").value.trim();
    if (val) openTrack(val);
  });
  document.getElementById("global-track-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); if (e.target.value.trim()) openTrack(e.target.value.trim()); }
  });
  document.getElementById("tracker-search-btn").addEventListener("click", () => runTrackerLookup(document.getElementById("tracker-input").value));
  document.getElementById("tracker-input").addEventListener("keydown", (e) => { if (e.key === "Enter") runTrackerLookup(e.target.value); });

  // Dashboard Top Year Filter + Export CSV & Print
  const dashQYrEl = document.getElementById("dash-q-year");
  dashQYrEl.addEventListener("change", renderDashboard);
  dashQYrEl.addEventListener("input", (e) => {
    const v = String(e.target.value || "").trim();
    if (/^\d{4}$/.test(v) || /^all(\s+years?)?$/i.test(v)) renderDashboard();
  });
  const btnDashAllYrs = document.getElementById("btn-dash-all-years");
  if (btnDashAllYrs) {
    btnDashAllYrs.addEventListener("click", () => {
      const cur = getSelectedDashboardYear();
      dashQYrEl.value = cur === "ALL" ? String(new Date().getFullYear()) : "All Years";
      renderDashboard();
    });
  }
  document.getElementById("btn-export-quarterly").addEventListener("click", () => {
    const yr = getSelectedDashboardYear();
    const report = buildQuarterlyReportData(yr);
    const rows = [...report.quarters, report.totals].map((r) => ({
      Quarter: r.label,
      Incoming_Total: r.incTotal,
      Incoming_External: r.incExt,
      Incoming_Internal: r.incInt,
      Incoming_Completed: r.incDone,
      Outgoing_Total: r.outTotal,
      Outgoing_Dispatched: r.outDisp,
      Outgoing_Pending: r.outPend,
      Mailing_Total: r.mailTotal,
      Mailing_PhilPost: r.mailPhilpost,
      Mailing_JRS: r.mailJrs,
      Mailing_Delivered: r.mailDelivered,
      Grand_Total: r.incTotal + r.outTotal + r.mailTotal,
    }));
    const suffix = yr === "ALL" ? "All-Years" : `CY${yr}`;
    downloadCsv(`DAR-Eastern-Visayas-Quarterly-Report-${suffix}.csv`, rows);
  });
  document.getElementById("btn-print-quarterly").addEventListener("click", openPrintQuarterlyReport);
  document.getElementById("btn-export-inc").addEventListener("click", () => {
    const yr = document.getElementById("inc-filter-year").value;
    downloadCsv(`DAR-RO8-Incoming-DTS-${yr === "ALL" ? todayISO() : yr}.csv`, getFilteredIncoming());
  });
  document.getElementById("btn-export-out").addEventListener("click", () => {
    const yr = document.getElementById("out-filter-year").value;
    downloadCsv(`DAR-RO8-Outgoing-DTS-${yr === "ALL" ? todayISO() : yr}.csv`, getFilteredOutgoing());
  });
  document.getElementById("btn-trigger-print").addEventListener("click", () => window.print());

  // Attempt auto-restore existing session
  if (authToken) {
    try {
      await withLoading("Loading DAR RO VIII DTS...", () => loadState(), "Restoring your session");
    } catch (_) {
      handleSignedOut();
    }
  } else {
    handleSignedOut();
  }
});
