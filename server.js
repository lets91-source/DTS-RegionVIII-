/**
 * DAR Eastern Visayas Regional Office VIII — Document Tracking System (DTS)
 * Node.js Server with Authentication (Registration/Login), Box A–E Role-Based Access Control,
 * Automated Incoming Status State Machine, Audit Trail, and Google Apps Script Sync Bridge.
 */
const http = require("http");
const https = require("https");
const tls = require("tls");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const IS_VERCEL = !!process.env.VERCEL;
const DEFAULT_APPS_SCRIPT_URL =
  process.env.APPS_SCRIPT_URL ||
  "https://script.google.com/macros/s/AKfycbwxfLa-mnY35lISPmZerof8-KF32bppJXRw-bTuqroo_sp38USS5HcDifeICzWOgE42/exec";
const SESSION_SECRET =
  process.env.SESSION_SECRET ||
  "dar-ro8-dts-hmac-1aGcUZqjCA0GSfKoxVLdNG64Q6udj2AZniRRK79r9OZE";
let lastSheetHydrateAt = 0;
let pendingSheetSavePromise = null;
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_DIR = path.join(__dirname, "public");
const UPLOADS_DIR = IS_VERCEL ? path.join("/tmp", "dar-dts-uploads") : path.join(__dirname, "uploads");
const DB_PATH = IS_VERCEL ? path.join("/tmp", "dar-dts-db.json") : path.join(__dirname, "data", "dts-db.json");
const SERVICE_ACCOUNT_PATH = path.join(__dirname, "google-credentials.json");
try { fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (_) {}
try { fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); } catch (_) {}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

// In-memory active session tokens, Login OTP challenges, & Registration OTP challenges
const sessions = new Map();
const otpChallenges = new Map(); // challengeId -> { userId, code, email, expiresAt, attempts, lastSentAt }
const regOtpChallenges = new Map(); // challengeId -> { pendingUser, code, email, expiresAt, attempts, lastSentAt }

function maskEmailAddress(email) {
  const s = String(email || "").trim();
  const [local, domain] = s.split("@");
  if (!local || !domain) return s;
  const shown = local.length <= 2 ? local[0] + "*" : local.slice(0, 2) + "***" + local.slice(-1);
  return `${shown}@${domain}`;
}

function resolveUserOtpEmail(db, user) {
  if (!user) return "";
  const direct = String(user.email || "").trim();
  if (direct && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(direct)) return direct;
  const map = (db.meta && db.meta.officeEmails) || {};
  const byDiv = String(map[user.division] || "").trim();
  if (byDiv && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(byDiv)) return byDiv;
  return "";
}

// Field groups per Box for strict server-side RBAC enforcement
const BOX_A_FIELDS = [
  "controlNo", "dtsYear", "docCategory", "dateReceived", "timeReceived", "receivedBy",
  "senderName", "senderOffice", "docType", "thru",
  "dateOfDoc", "refNo", "subject", "attachments", "attachmentFile",
];
const BOX_B_FIELDS = [
  "rdDateTime", "rdReceivedBy", "rdInstructionsTo", "rdInstructions", "rdTimeFrame",
];
const BOX_C_FIELDS = [
  "ardDateTime", "ardReceivedBy", "ardInstructionsTo", "ardInstructions", "ardTimeFrame",
];
const BOX_D_FIELDS = [
  "assignedDivision", "divDateTime", "divReceivedBy", "divActionTaken",
  "divChiefName", "dateActed", "transmissionMode", "addressedTo", "pouchCC",
];
const BOX_E_FIELDS = [
  "recordsDispatchMode", "dispatchDetails", "returnedAs", "dateReturnedBy",
  "dateReturnedAt", "releasedBy", "archived", "replyAttachmentFile", "boxERecipients",
];
const OUT_BOX_D_RECORDS_FIELDS = [
  "recNo", "recordsDateReceived", "recordsTimeReceived", "recordsReceivedBy",
  "finalDispatchMode", "dispatchDetails", "dateDispatched",
];
const OUT_BOX_E_RETURN_FIELDS = [
  "returnedToOffice", "dateReceivedBack",
];

const DARPO_PROVINCES = [
  { code: "DARPO - Biliran", name: "DAR Provincial Office — Biliran", group: "DARPO" },
  { code: "DARPO - Eastern Samar", name: "DAR Provincial Office — Eastern Samar", group: "DARPO" },
  { code: "DARPO - Leyte", name: "DAR Provincial Office — Leyte", group: "DARPO" },
  { code: "DARPO - Northern Samar", name: "DAR Provincial Office — Northern Samar", group: "DARPO" },
  { code: "DARPO - Samar", name: "DAR Provincial Office — Samar", group: "DARPO" },
  { code: "DARPO - Southern Leyte", name: "DAR Provincial Office — Southern Leyte", group: "DARPO" },
];

// ----------------- Crypto & Auth Helpers -----------------
function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, key] = stored.split(":");
  if (key.length === 64) {
    // Also accept Google Apps Script SHA-256 password hashes seamlessly
    const sha = crypto.createHash("sha256").update(`${salt}:${String(password)}`).digest();
    const keyBuf = Buffer.from(key, "hex");
    return sha.length === keyBuf.length && crypto.timingSafeEqual(sha, keyBuf);
  }
  const derived = crypto.scryptSync(String(password), salt, 64);
  const keyBuf = Buffer.from(key, "hex");
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

function createToken(userId = "") {
  if (userId) {
    const payload = Buffer.from(
      JSON.stringify({ uid: String(userId), exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }),
      "utf8"
    ).toString("base64url");
    const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
    return `v1.${payload}.${sig}`;
  }
  return crypto.randomBytes(32).toString("hex");
}

function verifyStatelessToken(token) {
  if (!token || !token.startsWith("v1.")) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [, payload, sig] = parts;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || !parsed.uid || (parsed.exp && Date.now() > parsed.exp)) return null;
    return String(parsed.uid);
  } catch (_) {
    return null;
  }
}

function sanitizeUser(u) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    email: u.email || "",
    emailVerified: !!u.emailVerified,
    role: u.role,
    division: u.division || "",
    approvalStatus: u.approvalStatus || "APPROVED",
    approvedBy: u.approvedBy || "",
    approvedAt: u.approvedAt || "",
    createdAt: u.createdAt || "",
  };
}

function getManilaNowString() {
  return new Date().toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  });
}

// ----------------- Automated Tracking Status Engine (Box A -> B -> C -> D -> E) -----------------
function computeIncomingAutoStatus(rec) {
  const t = (v) => String(v || "").trim();

  // Check Box E (Records Section completion / archive)
  if (rec.archived === true || rec.archived === "true" || rec.status === "Archived") {
    if (rec.archived === true || rec.archived === "true") return "Archived";
  }
  if (t(rec.returnedAs) || t(rec.dateReturnedBy) || t(rec.dateReturnedAt) || t(rec.releasedBy)) {
    return "Completed / Returned to Records";
  }

  // Check Box D (Division Chief Action Taken)
  if (t(rec.dateActed) || t(rec.recordsDispatchMode)) {
    return "For Dispatch";
  }
  if (t(rec.divActionTaken) || t(rec.divDateTime) || t(rec.divReceivedBy)) {
    return "In Progress";
  }

  // Check Box C (ARD Instruction To Division Chief) or Direct Box B Routing to Division
  if (t(rec.ardInstructionsTo) || t(rec.ardInstructions)) {
    return "Routed to Division";
  }
  const rdTo = t(rec.rdInstructionsTo);
  if (rdTo) {
    if (rdTo === "ARDO" || rdTo === "ARDA") return "For ARD Action";
    if (rdTo === "RD") return "For RD Action";
    return "Routed to Division";
  }

  // Check Box B (RD Secretary received / working)
  if (t(rec.rdDateTime) || t(rec.rdReceivedBy) || t(rec.rdInstructions) || t(rec.rdTimeFrame)) {
    return "For RD Action";
  }

  // Default after Box A (Records Staff encoded)
  return "Received by Records";
}

function resolveAssignedDivision(rec) {
  const t = (v) => String(v || "").trim();
  if (t(rec.ardInstructionsTo)) return t(rec.ardInstructionsTo);
  const rdTo = t(rec.rdInstructionsTo);
  if (rdTo && rdTo !== "ARDO" && rdTo !== "ARDA") return rdTo;
  return t(rec.assignedDivision) || rdTo || "";
}

// Check if a Division Chief user matches a document's assigned division
function divisionMatches(userDiv, docDiv) {
  const u = String(userDiv || "").trim().toUpperCase();
  const d = String(docDiv || "").trim().toUpperCase();
  if (!u || !d) return false;
  if (u === d) return true;
  // STO Division Chief can act on "STO" or any "STO - *" section
  if (u === "STO" && (d === "STO" || d.startsWith("STO -"))) return true;
  // RARAD / DARAB equivalence
  if ((u === "DARAB" || u === "RARAD" || u === "DARAB / RARAD") && (d === "DARAB" || d === "RARAD" || d === "DARAB / RARAD")) {
    return true;
  }
  return false;
}

// Visibility scoping:
// - Records, RD Office, and Admin see ALL incoming documents (Records & RD Office share exact same count)
// - ARD Office (ARDO / ARDA) sees ONLY documents forwarded to them from RD Office (Box B)
// - Division Chiefs see ONLY documents forwarded/assigned to their division (from RD Office or ARD Office)
function canUserViewIncoming(user, doc) {
  if (!user || !doc) return false;
  if (user.role === "ADMIN" || user.role === "RECORDS" || user.role === "RD_SECRETARY") {
    return true;
  }
  if (user.role === "ARD_SECRETARY") {
    const rdTo = String(doc.rdInstructionsTo || "").trim().toUpperCase();
    const uDiv = String(user.division || "").trim().toUpperCase();
    if (uDiv === "ARDO" || uDiv === "ARDA") {
      return rdTo === uDiv;
    }
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

// Outgoing visibility scoping:
// - Records, RD Office, and Admin see ALL outgoing documents
// - ARD Office (ARDO / ARDA) and Division Chiefs see ONLY outgoing documents where their sector is concerned
//   (originating from their sector, addressed/furnished to their sector, assigned for their counter-signature, or created by them)
function canUserViewOutgoing(user, doc) {
  if (!user || !doc) return false;
  if (user.role === "ADMIN" || user.role === "RECORDS" || user.role === "RD_SECRETARY") {
    return true;
  }
  if (doc.createdByUserId && doc.createdByUserId === user.id) return true;
  if (divisionMatches(user.division, doc.originatingDivision)) return true;
  if (divisionMatches(user.division, doc.returnedToOffice)) return true;
  const fcList = Array.isArray(doc.furnishedCopy) ? doc.furnishedCopy : [];
  if (fcList.some((r) => divisionMatches(user.division, r))) return true;
  const recipTokens = String(doc.recipientTo || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (recipTokens.some((r) => divisionMatches(user.division, r))) return true;
  if (user.role === "ARD_SECRETARY" && user.division) {
    const cs = String(doc.counterSignBy || "").toUpperCase();
    const uDiv = String(user.division).toUpperCase();
    if (cs.includes(uDiv)) return true;
    if (uDiv === "ARDO" && cs.includes("OPERATIONS")) return true;
    if (uDiv === "ARDA" && cs.includes("ADMINISTRATION")) return true;
  }
  return false;
}

// Issuance & Mailing visibility scoping:
// - System Admin and Records Section see ALL Issuances & Mailings
// - All other offices (RD Office, ARD Office, Division/Unit Chiefs) see ONLY records where
//   their office/division (or email) is selected in Recipient (To) (`rec.recipients`)
function canUserViewConcernedRecord(user, rec) {
  if (!user || !rec) return false;
  if (user.role === "ADMIN" || user.role === "RECORDS") {
    return true;
  }
  const recips = Array.isArray(rec.recipients) ? rec.recipients : [];
  if (!recips.length) return false;
  const userEmail = String(user.email || "").trim().toLowerCase();
  return recips.some((r) => {
    const tok = String(r || "").trim();
    if (!tok) return false;
    if (divisionMatches(user.division, tok)) return true;
    if (userEmail && tok.toLowerCase() === userEmail) return true;
    return false;
  });
}

function getBoxPermissions(user, doc) {
  if (!user) return { canCreateIncoming: false, boxA: false, boxB: false, boxC: false, boxD: false, boxE: false };
  if (user.role === "ADMIN") {
    return { canCreateIncoming: true, boxA: true, boxB: true, boxC: true, boxD: true, boxE: true };
  }
  const assignedDiv = doc ? resolveAssignedDivision(doc) : "";
  const isMyDiv = doc ? divisionMatches(user.division, assignedDiv) : false;
  const canView = doc ? canUserViewIncoming(user, doc) : false;
  return {
    canCreateIncoming: user.role === "RECORDS",
    boxA: user.role === "RECORDS",
    boxB: user.role === "RD_SECRETARY",
    // Box C: ARD/ARD's Secretary assigns Division Chief only on documents forwarded to their ARD office
    boxC: user.role === "ARD_SECRETARY" && canView,
    // Box D: Assigned Division Chief (STO, LTS, LEGAL, ARBDSP, RARAD/DARAB, etc.)
    boxD: user.role === "DIVISION_CHIEF" && isMyDiv,
    boxE: user.role === "RECORDS",
  };
}

// ----------------- DB Read / Seed -----------------
function buildSeedUsers() {
  const now = new Date().toISOString();
  return [
    { id: "u-records", username: "records", fullName: "Elvie (Records Staff)", role: "RECORDS", division: "STO - Records", passwordHash: hashPassword("darro8"), createdAt: now },
    { id: "u-rdsec", username: "rdsec", fullName: "RD Secretary", role: "RD_SECRETARY", division: "RD", passwordHash: hashPassword("darro8"), createdAt: now },
    { id: "u-ard", username: "ard", fullName: "ARD Secretary (ARDO/ARDA)", role: "ARD_SECRETARY", division: "ARDO", passwordHash: hashPassword("darro8"), createdAt: now },
    { id: "u-sto", username: "sto", fullName: "Chief, STO Division", role: "DIVISION_CHIEF", division: "STO", passwordHash: hashPassword("darro8"), createdAt: now },
    { id: "u-lts", username: "lts", fullName: "Chief, LTS Division", role: "DIVISION_CHIEF", division: "LTS", passwordHash: hashPassword("darro8"), createdAt: now },
    { id: "u-legal", username: "legal", fullName: "Chief, Legal Division", role: "DIVISION_CHIEF", division: "LEGAL", passwordHash: hashPassword("darro8"), createdAt: now },
    { id: "u-arbdsp", username: "arbdsp", fullName: "Chief, ARBDSP Division", role: "DIVISION_CHIEF", division: "ARBDSP", passwordHash: hashPassword("darro8"), createdAt: now },
    { id: "u-rarad", username: "rarad", fullName: "RARAD / Regional Adjudicator", role: "DIVISION_CHIEF", division: "DARAB", passwordHash: hashPassword("darro8"), createdAt: now },
    { id: "u-admin", username: "admin", fullName: "DAR RO VIII System Admin", role: "ADMIN", division: "RD", passwordHash: hashPassword("admin123"), createdAt: now },
  ];
}

function buildSeedDatabase() {
  return {
    meta: {
      agency: "DEPARTMENT OF AGRARIAN REFORM",
      tagline: "Tunay na Pagbabago sa Repormang Agraryo",
      officeName: "DAR Eastern Visayas Regional Office VIII",
      address: "DAR Regional Office 08, Sto. Niño Extension, Tacloban City",
      telefax: "(02) 325-3095",
      website: "www.dar.gov.ph",
      regionalDirector: "ATTY. ROBERT ANTHONY P. YU",
      incomingFormCode: "DR08-STOR-F-001-REV-01",
      spreadsheetId: "1aGcUZqjCA0GSfKoxVLdNG64Q6udj2AZniRRK79r9OZE",
      spreadsheetUrl: "https://docs.google.com/spreadsheets/d/1aGcUZqjCA0GSfKoxVLdNG64Q6udj2AZniRRK79r9OZE/edit",
      driveFolderId: "1JJwNkttWowxao0UIhR7k_hKXWI1L_eQC",
      driveFolderUrl: "https://drive.google.com/drive/folders/1JJwNkttWowxao0UIhR7k_hKXWI1L_eQC?usp=sharing",
      appsScriptUrl: "https://script.google.com/macros/s/AKfycbwxfLa-mnY35lISPmZerof8-KF32bppJXRw-bTuqroo_sp38USS5HcDifeICzWOgE42/exec",
      senderEmail: "darrec8@gmail.com",
      loginOtpEnabled: false,
      officeEmails: {},
      issuanceCategories: ["Order", "Finality", "RCLUPPI", "Resolution", "Erratum", "Writ of Execution", "Interlocutory", "Memo", "Notice"],
      mailingCouriers: ["PhilPost", "JRS"],
    },
    divisions: [
      { code: "RD", name: "Office of the Regional Director", group: "Executive", head: "Regional Director", focal: "RD Secretary" },
      { code: "ARDO", name: "Office of the Asst. Regional Director for Operations", group: "Executive", head: "ARDO", focal: "ARDO Secretary" },
      { code: "ARDA", name: "Office of the Asst. Regional Director for Administration", group: "Executive", head: "ARDA", focal: "ARDA Secretary" },
      { code: "LTS", name: "Land Tenure Services Division", group: "Operations", head: "Chief, LTSD", focal: "LTS Focal" },
      { code: "ARBDSP", name: "Agrarian Reform Beneficiaries Development & Sustainability", group: "Operations", head: "Chief, ARBDSP", focal: "ARBDSP Focal" },
      { code: "LEGAL", name: "Legal Division", group: "Legal", head: "Chief, Legal Division", focal: "Legal Focal" },
      { code: "DARAB", name: "DAR Adjudication Board / RARAD (Regional)", group: "Legal", head: "Regional Adjudicator", focal: "DARAB Clerk" },
      { code: "STO", name: "Support to Operations Division (STOD Chief)", group: "STO", head: "Chief, STOD", focal: "STO Secretary" },
      { code: "STO - Accounting", name: "STO — Accounting Section", group: "STO", head: "Accountant III", focal: "Accounting Staff" },
      { code: "STO - Budget", name: "STO — Budget Section", group: "STO", head: "Budget Officer", focal: "Budget Staff" },
      { code: "STO - Cashier", name: "STO — Cashier Section", group: "STO", head: "Cashier", focal: "Cashier Staff" },
      { code: "STO - HRD", name: "STO — Human Resource & Development", group: "STO", head: "HRMO", focal: "HRD Staff" },
      { code: "STO - Records", name: "STO — Records Section", group: "STO", head: "Records Officer", focal: "Records Staff" },
      { code: "STO - Supply", name: "STO — Supply Section", group: "STO", head: "Supply Officer", focal: "Supply Staff" },
      { code: "STO - GSD", name: "STO — General Services Division", group: "STO", head: "GSD Head", focal: "GSD Staff" },
      { code: "STO - Procurement", name: "STO — Procurement / BAC", group: "STO", head: "BAC Secretariat", focal: "Procurement Staff" },
      { code: "STO - Planning", name: "STO — Planning & Management", group: "STO", head: "Planning Officer", focal: "Planning Staff" },
    ],
    users: buildSeedUsers(),
    incoming: [],
    outgoing: [],
    issuances: [],
    mailings: [],
  };
}

function readDb() {
  if (!fs.existsSync(DB_PATH)) {
    const seeded = buildSeedDatabase();
    writeDbLocalOnly(seeded);
  }
  const db = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
  let dirty = false;

  // Ensure STO top-level division exists & DARAB shows RARAD alias cleanly
  if (!db.divisions.some((d) => d.code === "STO")) {
    const stoIdx = db.divisions.findIndex((d) => d.code.startsWith("STO -"));
    const stoEntry = { code: "STO", name: "Support to Operations Division (STOD Chief)", group: "STO", head: "Chief, STOD", focal: "STO Secretary" };
    if (stoIdx >= 0) db.divisions.splice(stoIdx, 0, stoEntry);
    else db.divisions.push(stoEntry);
    dirty = true;
  }
  const darab = db.divisions.find((d) => d.code === "DARAB");
  if (darab && !darab.name.includes("RARAD")) {
    darab.name = "DAR Adjudication Board / RARAD (Regional)";
    dirty = true;
  }

  // Ensure default Google Drive PDF folder & office email directory metadata are present
  if (!db.meta.driveFolderId) {
    db.meta.driveFolderId = "1JJwNkttWowxao0UIhR7k_hKXWI1L_eQC";
    db.meta.driveFolderUrl = "https://drive.google.com/drive/folders/1JJwNkttWowxao0UIhR7k_hKXWI1L_eQC?usp=sharing";
    dirty = true;
  }
  if (!db.meta.senderEmail) {
    db.meta.senderEmail = "darrec8@gmail.com";
    dirty = true;
  }
  if (db.meta.loginOtpEnabled === undefined) {
    db.meta.loginOtpEnabled = true;
    dirty = true;
  }
  if (!db.meta.officeEmails || typeof db.meta.officeEmails !== "object") {
    db.meta.officeEmails = {};
    dirty = true;
  }
  if (!Array.isArray(db.meta.issuanceCategories) || db.meta.issuanceCategories.length === 0) {
    db.meta.issuanceCategories = ["ALI Case", "Memo", "Notice"];
    dirty = true;
  }
  if (!Array.isArray(db.issuances)) {
    db.issuances = [];
    dirty = true;
  }
  if (!Array.isArray(db.meta.mailingCouriers) || db.meta.mailingCouriers.length === 0) {
    db.meta.mailingCouriers = ["PhilPost", "JRS"];
    dirty = true;
  }
  if (!Array.isArray(db.mailings)) {
    db.mailings = [];
    dirty = true;
  }
  if (!Array.isArray(db.meta.preparedSignatories)) {
    db.meta.preparedSignatories = [
      "ATTY. ROBERT ANTHONY P. YU",
      "ARD FOR OPERATIONS",
      "ARD FOR ADMINISTRATION",
      "CHIEF, STOD",
      "CHIEF, LTSD",
      "CHIEF, LEGAL DIVISION",
      "CHIEF, ARBDSP",
      "REGIONAL ADJUDICATOR (RARAD)",
      "HRMO / AO V",
      "PLANNING OFFICER",
    ];
    dirty = true;
  }

  if (!db.meta.issuanceColumns || typeof db.meta.issuanceColumns !== "object" || Array.isArray(db.meta.issuanceColumns)) {
    db.meta.issuanceColumns = {};
    dirty = true;
  }
  const hasAliOrOrder = db.meta.issuanceColumns["Order"] || db.meta.issuanceColumns["ALI Case"];
  if (!hasAliOrOrder) {
    db.meta.issuanceColumns["ALI Case"] = [
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
    dirty = true;
  }

  // Ensure default accounts are seeded if users array doesn't exist yet
  if (!Array.isArray(db.users) || db.users.length === 0) {
    db.users = buildSeedUsers();
    dirty = true;
  }
  // Ensure every existing user has an approvalStatus field (legacy/seeded users default to APPROVED)
  db.users.forEach((u) => {
    if (!u.approvalStatus) {
      u.approvalStatus = "APPROVED";
      dirty = true;
    }
  });

  // Ensure every incoming record has automated status & docCategory computed cleanly
  db.incoming.forEach((rec) => {
    if (!rec.docCategory) {
      rec.docCategory = String(rec.controlNo || "").toUpperCase().startsWith("I-") ? "Internal" : "External";
      dirty = true;
    }
    const auto = computeIncomingAutoStatus(rec);
    if (rec.status !== auto) {
      rec.status = auto;
      dirty = true;
    }
    if (!Array.isArray(rec.history)) {
      rec.history = [];
    }
  });

  // Ensure every outgoing record has a stable id, per-user/office userDocNo, and furnishedCopy array
  if (Array.isArray(db.outgoing)) {
    db.outgoing.forEach((rec, i) => {
      if (!rec.id) {
        rec.id = rec.recNo || `out-seed-${i + 1}`;
        dirty = true;
      }
      if (!rec.userDocNo) {
        const prefix = buildOutgoingUserPrefix(null, rec.originatingDivision);
        const dt = rec.dateOriginated || "";
        rec.userDocNo = generateNextOutgoingUserNo(db.outgoing, prefix, dt);
        dirty = true;
      }
      if (!Array.isArray(rec.furnishedCopy)) {
        rec.furnishedCopy = typeof rec.furnishedCopy === "string" && rec.furnishedCopy.trim()
          ? rec.furnishedCopy.split(",").map((s) => s.trim()).filter(Boolean)
          : [];
        dirty = true;
      }
    });
  }

  if (dirty) writeDb(db);
  return db;
}

function writeDbLocalOnly(db) {
  try { fs.mkdirSync(path.dirname(DB_PATH), { recursive: true }); } catch (_) {}
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function getActiveAppsScriptUrl(db = null) {
  const fromDb = db && db.meta && String(db.meta.appsScriptUrl || "").trim();
  if (fromDb) return fromDb;
  try {
    if (fs.existsSync(DB_PATH)) {
      const cur = JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
      if (cur && cur.meta && cur.meta.appsScriptUrl) return String(cur.meta.appsScriptUrl).trim();
    }
  } catch (_) {}
  return DEFAULT_APPS_SCRIPT_URL;
}

async function hydrateDbFromSheet(force = false) {
  const gasUrl = getActiveAppsScriptUrl();
  if (!gasUrl) return { ok: false, reason: "No Apps Script URL" };
  const now = Date.now();
  if (!force && fs.existsSync(DB_PATH) && now - lastSheetHydrateAt < 10000) {
    return { ok: true, cached: true };
  }
  const res = await postToAppsScript(gasUrl, { action: "getFullDb" }, 20000);
  if (res.synced && res.json && res.json.ok && res.json.db && typeof res.json.db === "object") {
    writeDbLocalOnly(res.json.db);
    lastSheetHydrateAt = Date.now();
    return { ok: true, hydrated: true };
  }
  return { ok: false, reason: (res.json && res.json.error) || res.reason || "Could not load DB from Google Sheet" };
}

function writeDb(db) {
  writeDbLocalOnly(db);
  const gasUrl = getActiveAppsScriptUrl(db);
  if (gasUrl) {
    const p = postToAppsScript(gasUrl, { action: "saveFullDb", db }, 25000).catch(() => ({ synced: false }));
    pendingSheetSavePromise = p;
  }
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  const finish = () => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(body);
  };
  if (IS_VERCEL && pendingSheetSavePromise) {
    const p = pendingSheetSavePromise;
    pendingSheetSavePromise = null;
    p.then(finish, finish);
    return;
  }
  finish();
}

const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB max PDF attachment size
const MAX_GAS_PDF_BYTES = 35 * 1024 * 1024; // Google Apps Script practical relay limit

function readRawBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("PDF exceeds maximum allowed size of " + Math.round(maxBytes / 1048576) + " MB."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseBody(req, maxBytes = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) reject(new Error("Payload too large (max " + Math.round(maxBytes / 1048576) + " MB)"));
    });
    req.on("end", () => {
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function getAuthUser(req, db) {
  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) return null;
  let userId = sessions.has(token) ? sessions.get(token) : verifyStatelessToken(token);
  if (!userId) return null;
  const u = db.users.find((x) => x.id === userId) || null;
  return u && (u.approvalStatus || "APPROVED") === "APPROVED" ? u : null;
}

function buildOutgoingUserPrefix(user, divisionOverride = "") {
  const div = String(divisionOverride || (user && user.division) || "").trim().toUpperCase();
  if (div === "STO - RECORDS") return "RECORDS";
  if (div) {
    return div.replace(/\s*-\s*/g, "-").replace(/[^A-Z0-9-]/g, "").slice(0, 16) || "USER";
  }
  return String((user && user.username) || "USER").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 16) || "USER";
}

function generateNextOutgoingUserNo(existingList, prefix, dateStr, yearOverride = "") {
  const now = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const validDate = isNaN(now.getTime()) ? new Date() : now;
  const mm = String(validDate.getMonth() + 1).padStart(2, "0");
  const dd = String(validDate.getDate()).padStart(2, "0");
  const yyyy = /^\d{4}$/.test(String(yearOverride || "").trim())
    ? String(yearOverride).trim()
    : String(validDate.getFullYear());
  const safePref = String(prefix || "USER").toUpperCase().replace(/[^A-Z0-9-]/g, "") || "USER";
  const escapedPref = safePref.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const yearPattern = new RegExp(`^${escapedPref}-\\d{2}-\\d{2}-${yyyy}-(\\d+)$`, "i");
  let maxSeq = 0;
  for (const item of existingList || []) {
    const m = String(item.userDocNo || "").match(yearPattern);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  return `${safePref}-${mm}-${dd}-${yyyy}-${String(maxSeq + 1).padStart(4, "0")}`;
}

function getServerIssuanceColumnsFor(db, category) {
  const cat = String(category || "").trim();
  const map = (db.meta && db.meta.issuanceColumns) || {};
  if (Array.isArray(map[cat]) && map[cat].length > 0) return map[cat];
  const low = cat.toLowerCase();
  if (low === "memo" || low === "notice") {
    return [
      { key: "issuanceNo", label: "Control Number", builtin: true, type: "text" },
      { key: "col_date_released", label: "Date Released", builtin: false, type: "date" },
      { key: "col_released_by", label: "Released By", builtin: false, type: "text" },
      { key: "subject", label: "Subject", builtin: true, type: "text" },
      { key: "dateIssued", label: "Date of Document", builtin: true, type: "date" },
      { key: "col_date_of_activity", label: "Date of Activity", builtin: false, type: "date_range" },
      { key: "col_place_venue", label: "Place / Venue", builtin: false, type: "text" },
      { key: "col_concerned_parties", label: "Concerned Parties", builtin: false, type: "multi_names" },
    ];
  }
  if (["order", "finality", "rcluppi", "resolution", "erratum", "writ of execution", "interlocutory", "ali case"].includes(low)) {
    return [
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
  }
  return [
    { key: "issuanceNo", label: "Issuance No.", builtin: true, type: "text" },
    { key: "category", label: "Sub-Category", builtin: true, type: "text" },
    { key: "dateIssued", label: "Date Issued", builtin: true, type: "date" },
    { key: "originatingDivision", label: "Originating Unit", builtin: true, type: "text" },
    { key: "subject", label: "Subject / Title & Ref.", builtin: true, type: "text" },
    { key: "issuedBy", label: "Issued By", builtin: true, type: "text" },
    { key: "pdfFile", label: "PDF file", builtin: true, type: "pdf" },
  ];
}

let issuanceAutoSyncState = {
  enabled: true,
  syncing: false,
  lastSyncedAt: "",
  syncedTabs: [],
  lastError: "",
};

async function syncIssuanceCategoryToSheet(db, category) {
  const cat = String(category || "").trim();
  if (!cat || !db.meta || !db.meta.appsScriptUrl) {
    return { synced: false, reason: "No Apps Script URL configured" };
  }
  const columns = getServerIssuanceColumnsFor(db, cat);
  const records = (db.issuances || []).filter((r) => r.category === cat);
  const res = await postToAppsScript(db.meta.appsScriptUrl, {
    action: "syncIssuanceTab",
    category: cat,
    columns,
    records,
  });
  const synced = !!(res.synced && res.json && res.json.ok);
  const sheetName = (res.json && res.json.sheetName) || `Issuance_${cat.replace(/\s+/g, "_")}`;
  const error = (res.json && res.json.error) || res.reason || "";
  if (synced) {
    issuanceAutoSyncState.lastSyncedAt = getManilaNowString();
    issuanceAutoSyncState.lastError = "";
    if (!issuanceAutoSyncState.syncedTabs.includes(sheetName)) {
      issuanceAutoSyncState.syncedTabs.push(sheetName);
    }
  } else if (error) {
    issuanceAutoSyncState.lastError = error.includes("Unknown action")
      ? "Deploy New Version of Code.gs in Apps Script to activate Issuance tabs"
      : error;
  }
  return {
    synced,
    sheetName,
    rowCount: records.length,
    error,
  };
}

async function syncAllIssuancesToSheet(dbOverride = null) {
  if (issuanceAutoSyncState.syncing) {
    return { ok: false, skipped: true, reason: "Sync already in progress", results: [] };
  }
  const db = dbOverride || readDb();
  if (!db.meta || !db.meta.appsScriptUrl) {
    issuanceAutoSyncState.lastError = "Apps Script URL not configured";
    return { ok: false, syncedCount: 0, totalCategories: 0, results: [], error: issuanceAutoSyncState.lastError };
  }
  issuanceAutoSyncState.syncing = true;
  try {
    const cats = [...new Set([...(db.meta.issuanceCategories || []), ...(db.issuances || []).map((r) => r.category).filter(Boolean)])];
    const results = [];
    for (const cat of cats) {
      const s = await syncIssuanceCategoryToSheet(db, cat);
      results.push({ category: cat, ...s });
    }
    const syncedTabs = results.filter((r) => r.synced).map((r) => r.sheetName);
    const firstErr = (results.find((r) => !r.synced && r.error) || {}).error || "";
    if (syncedTabs.length > 0) {
      issuanceAutoSyncState.lastSyncedAt = getManilaNowString();
      issuanceAutoSyncState.syncedTabs = syncedTabs;
      issuanceAutoSyncState.lastError = "";
    } else if (firstErr) {
      issuanceAutoSyncState.lastError = firstErr.includes("Unknown action")
        ? "Deploy New Version of Code.gs in Apps Script to activate Issuance tabs"
        : firstErr;
    }
    return {
      ok: syncedTabs.length > 0,
      syncedCount: syncedTabs.length,
      totalCategories: cats.length,
      results,
      error: syncedTabs.length === 0 ? issuanceAutoSyncState.lastError : "",
    };
  } finally {
    issuanceAutoSyncState.syncing = false;
  }
}

function generateNextMailingNo(existingList, courier, dateStr, yearOverride = "") {
  const now = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const validDate = isNaN(now.getTime()) ? new Date() : now;
  const yyyy = /^\d{4}$/.test(String(yearOverride || "").trim())
    ? String(yearOverride).trim()
    : String(validDate.getFullYear());
  const raw = String(courier || "MAIL").trim().toUpperCase();
  const pref = raw.replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 12) || "MAIL";
  const escPref = pref.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp(`^${escPref}-${yyyy}-(\\d+)$`, "i");
  let maxSeq = 0;
  for (const item of existingList || []) {
    const m = String(item.mailingNo || "").match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  return `${pref}-${yyyy}-${String(maxSeq + 1).padStart(4, "0")}`;
}

let mailingAutoSyncState = {
  enabled: true,
  syncing: false,
  lastSyncedAt: "",
  syncedTabs: [],
  lastError: "",
};

async function syncMailingCourierToSheet(db, courier) {
  const c = String(courier || "").trim();
  if (!c || !db.meta || !db.meta.appsScriptUrl) {
    return { synced: false, reason: "No Apps Script URL configured" };
  }
  const records = (db.mailings || []).filter((r) => r.courier === c);
  const res = await postToAppsScript(db.meta.appsScriptUrl, {
    action: "syncMailingTab",
    courier: c,
    records,
  });
  const synced = !!(res.synced && res.json && res.json.ok);
  const sheetName = (res.json && res.json.sheetName) || `Mailing_${c.replace(/\s+/g, "_")}`;
  const error = (res.json && res.json.error) || res.reason || "";
  if (synced) {
    mailingAutoSyncState.lastSyncedAt = getManilaNowString();
    mailingAutoSyncState.lastError = "";
    if (!mailingAutoSyncState.syncedTabs.includes(sheetName)) {
      mailingAutoSyncState.syncedTabs.push(sheetName);
    }
  } else if (error) {
    mailingAutoSyncState.lastError = error.includes("Unknown action")
      ? "Deploy New Version of Code.gs in Apps Script to activate Mailing tabs"
      : error;
  }
  return { synced, sheetName, rowCount: records.length, error };
}

async function syncAllMailingsToSheet(dbOverride = null) {
  if (mailingAutoSyncState.syncing) {
    return { ok: false, skipped: true, reason: "Sync already in progress", results: [] };
  }
  const db = dbOverride || readDb();
  if (!db.meta || !db.meta.appsScriptUrl) {
    mailingAutoSyncState.lastError = "Apps Script URL not configured";
    return { ok: false, syncedCount: 0, totalCouriers: 0, results: [], error: mailingAutoSyncState.lastError };
  }
  mailingAutoSyncState.syncing = true;
  try {
    const couriers = [...new Set([...(db.meta.mailingCouriers || ["PhilPost", "JRS"]), ...(db.mailings || []).map((r) => r.courier).filter(Boolean)])];
    const results = [];
    for (const c of couriers) {
      const s = await syncMailingCourierToSheet(db, c);
      results.push({ courier: c, ...s });
    }
    const syncedTabs = results.filter((r) => r.synced).map((r) => r.sheetName);
    const firstErr = (results.find((r) => !r.synced && r.error) || {}).error || "";
    if (syncedTabs.length > 0) {
      mailingAutoSyncState.lastSyncedAt = getManilaNowString();
      mailingAutoSyncState.syncedTabs = syncedTabs;
      mailingAutoSyncState.lastError = "";
    } else if (firstErr) {
      mailingAutoSyncState.lastError = firstErr.includes("Unknown action")
        ? "Deploy New Version of Code.gs in Apps Script to activate Mailing tabs"
        : firstErr;
    }
    return {
      ok: syncedTabs.length > 0,
      syncedCount: syncedTabs.length,
      totalCouriers: couriers.length,
      results,
      error: syncedTabs.length === 0 ? mailingAutoSyncState.lastError : "",
    };
  } finally {
    mailingAutoSyncState.syncing = false;
  }
}

function generateNextIssuanceNo(existingList, category, dateStr, yearOverride = "") {
  const now = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const validDate = isNaN(now.getTime()) ? new Date() : now;
  const yyyy = /^\d{4}$/.test(String(yearOverride || "").trim())
    ? String(yearOverride).trim()
    : String(validDate.getFullYear());
  const raw = String(category || "ISS").trim().toUpperCase();
  const pref = raw === "ALI CASE" ? "ALI" : raw.replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 12) || "ISS";
  const escPref = pref.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp(`^${escPref}-${yyyy}-(\\d+)$`, "i");
  let maxSeq = 0;
  for (const item of existingList || []) {
    const m = String(item.issuanceNo || "").match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  return `${pref}-${yyyy}-${String(maxSeq + 1).padStart(4, "0")}`;
}

function generateNextControlNo(type, existingList, dateStr, category = "External", yearOverride = "") {
  const now = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const validDate = isNaN(now.getTime()) ? new Date() : now;
  const mm = String(validDate.getMonth() + 1).padStart(2, "0");
  const dd = String(validDate.getDate()).padStart(2, "0");
  const yyyy = /^\d{4}$/.test(String(yearOverride || "").trim())
    ? String(yearOverride).trim()
    : String(validDate.getFullYear());

  if (type === "outgoing") {
    const prefix = `OUT-${mm}-${dd}-${yyyy}-`;
    const yearPattern = new RegExp(`^OUT-\\d{2}-\\d{2}-${yyyy}-(\\d+)$`, "i");
    let maxSeq = 0;
    for (const item of existingList) {
      const m = String(item.recNo || "").match(yearPattern);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > maxSeq) maxSeq = n;
      }
    }
    return prefix + String(maxSeq + 1).padStart(4, "0");
  }

  // Incoming DTS: External ("E-") and Internal ("I-") share ONE continuous sequence within the same year!
  // When the year changes, sequence resets from 0 -> starts at 0001.
  const isInternal = String(category || "").trim().toLowerCase() === "internal";
  const letter = isInternal ? "I" : "E";
  const prefix = `${letter}-${mm}-${dd}-${yyyy}-`;
  const yearPattern = new RegExp(`^[EI]-\\d{2}-\\d{2}-${yyyy}-(\\d+)$`, "i");
  let maxSeq = 0;
  for (const item of existingList) {
    const m = String(item.controlNo || "").match(yearPattern);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  }
  return prefix + String(maxSeq + 1).padStart(4, "0");
}

// ----------------- Direct Google Drive API v3 Resumable Upload (100 MB+ via Service Account) -----------------
function loadServiceAccount() {
  try {
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
      return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    }
    if (fs.existsSync(SERVICE_ACCOUNT_PATH)) {
      return JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, "utf8"));
    }
  } catch (err) {
    console.error("Error loading Google Service Account:", err.message);
  }
  return null;
}

function base64Url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function httpsReq(urlStr, opts, bodyBuf) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: opts.method || "GET",
        headers: opts.headers || {},
        timeout: opts.timeout || 120000,
      },
      (resp) => {
        const chunks = [];
        resp.on("data", (c) => chunks.push(c));
        resp.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = JSON.parse(text); } catch (_) {}
          resolve({ status: resp.statusCode, headers: resp.headers, json, text });
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Google Drive request timed out")); });
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

async function getServiceAccountToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/drive",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const sig = signer.sign(sa.private_key, "base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const form = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${claim}.${sig}`;
  const res = await httpsReq("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(form) },
    timeout: 15000,
  }, form);
  if (res.status >= 400 || !res.json || !res.json.access_token) {
    throw new Error((res.json && (res.json.error_description || res.json.error)) || "Failed to obtain Google Drive access token");
  }
  return res.json.access_token;
}

function sanitizeUploadSegment(name) {
  return String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\.{2,}/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

function resolveUploadFolderSegments(docYear, transaction, subFolder, controlNo) {
  let yr = String(docYear || "").trim();
  if (!/^(?:19|20)\d{2}$/.test(yr)) {
    const m = String(controlNo || "").match(/(?:^|-)((?:19|20)\d{2})(?:-|$)/);
    yr = m ? m[1] : String(new Date().getFullYear());
  }
  let tx = sanitizeUploadSegment(transaction);
  if (!tx) {
    const cn = String(controlNo || "").trim().toUpperCase();
    if (cn.startsWith("OUT-")) tx = "Outgoing";
    else if (cn.startsWith("PHILPOST-") || cn.startsWith("JRS-") || cn.startsWith("MAIL")) tx = "Mailing Process";
    else if (cn.startsWith("E-") || cn.startsWith("I-")) tx = "Incoming";
    else tx = "General";
  }
  const sub = sanitizeUploadSegment(subFolder);
  const segs = [yr, tx];
  if (sub && sub.toLowerCase() !== tx.toLowerCase()) segs.push(sub);
  return segs;
}

function resolveSafeLocalUploadPath(storedName) {
  const rel = String(storedName || "").replace(/\\/g, "/").replace(/^\/+/, "");
  const parts = rel.split("/").filter((p) => p && p !== "." && p !== "..");
  if (!parts.length) return "";
  const full = path.resolve(UPLOADS_DIR, ...parts);
  const rootResolved = path.resolve(UPLOADS_DIR);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) return "";
  return full;
}

async function ensureDriveSubfolderV3(parentId, folderName, accessToken) {
  const escName = String(folderName || "").replace(/'/g, "\\'");
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${escName}' and '${parentId}' in parents and trashed=false`);
  const listRes = await httpsReq(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { method: "GET", headers: { Authorization: `Bearer ${accessToken}` }, timeout: 15000 }
  );
  if (listRes.status < 400 && listRes.json && Array.isArray(listRes.json.files) && listRes.json.files.length > 0) {
    return listRes.json.files[0].id;
  }
  const createBody = Buffer.from(
    JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
    "utf8"
  );
  const createRes = await httpsReq(
    "https://www.googleapis.com/drive/v3/files?fields=id,name&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "Content-Length": createBody.length,
      },
      timeout: 15000,
    },
    createBody
  );
  if (createRes.status >= 400 || !createRes.json || !createRes.json.id) {
    throw new Error(`Could not create Drive folder "${folderName}"`);
  }
  return createRes.json.id;
}

async function uploadPdfDirectToDrive(buf, fileName, rootFolderId, sa, folderSegments = []) {
  const accessToken = await getServiceAccountToken(sa);
  let targetFolderId = rootFolderId;
  for (const seg of folderSegments || []) {
    if (seg) targetFolderId = await ensureDriveSubfolderV3(targetFolderId, seg, accessToken);
  }
  const metaBody = Buffer.from(JSON.stringify({ name: fileName, parents: [targetFolderId] }), "utf8");
  const initRes = await httpsReq(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "Content-Length": metaBody.length,
        "X-Upload-Content-Type": "application/pdf",
        "X-Upload-Content-Length": buf.length,
      },
      timeout: 20000,
    },
    metaBody
  );
  if (initRes.status >= 400 || !initRes.headers.location) {
    throw new Error((initRes.json && initRes.json.error && initRes.json.error.message) || `Drive init failed (${initRes.status})`);
  }
  const putRes = await httpsReq(
    initRes.headers.location,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/pdf",
        "Content-Length": buf.length,
      },
      timeout: 180000,
    },
    buf
  );
  if (putRes.status >= 400 || !putRes.json || !putRes.json.id) {
    throw new Error((putRes.json && putRes.json.error && putRes.json.error.message) || `Drive upload failed (${putRes.status})`);
  }
  const fileId = putRes.json.id;
  // Best-effort make viewable via link
  try {
    const permBody = Buffer.from(JSON.stringify({ role: "reader", type: "anyone" }), "utf8");
    await httpsReq(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "Content-Length": permBody.length,
        },
        timeout: 10000,
      },
      permBody
    );
  } catch (_) {}
  return { fileId, url: `https://drive.google.com/file/d/${fileId}/view`, folderUrl: `https://drive.google.com/drive/folders/${targetFolderId}` };
}

function fetchJsonFollowRedirect(urlStr, timeoutMs = 15000) {
  return new Promise((resolve) => {
    try {
      const target = new URL(urlStr);
      const req = https.request(
        { hostname: target.hostname, path: target.pathname + target.search, method: "GET", timeout: timeoutMs },
        (resp) => {
          if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
            resp.resume();
            return resolve(fetchJsonFollowRedirect(resp.headers.location, timeoutMs));
          }
          let buf = "";
          resp.on("data", (c) => (buf += c));
          resp.on("end", () => {
            let json = null;
            try { json = JSON.parse(buf); } catch (_) {}
            resolve({ synced: resp.statusCode < 400, status: resp.statusCode, json, body: buf.slice(0, 400) });
          });
        }
      );
      req.on("error", (err) => resolve({ synced: false, reason: err.message }));
      req.on("timeout", () => { req.destroy(); resolve({ synced: false, reason: "Redirect timeout" }); });
      req.end();
    } catch (err) {
      resolve({ synced: false, reason: err.message });
    }
  });
}

function postToAppsScript(scriptUrl, payload, timeoutMs = 15000) {
  return new Promise((resolve) => {
    if (!scriptUrl || !/^https:\/\/script\.google\.com\//.test(scriptUrl)) {
      return resolve({ synced: false, reason: "No valid Apps Script URL configured" });
    }
    try {
      const target = new URL(scriptUrl);
      const data = JSON.stringify(payload);
      const req = https.request(
        {
          hostname: target.hostname,
          path: target.pathname + target.search,
          method: "POST",
          headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) },
          timeout: timeoutMs,
        },
        (resp) => {
          if ([301, 302, 303, 307, 308].includes(resp.statusCode) && resp.headers.location) {
            resp.resume();
            return resolve(fetchJsonFollowRedirect(resp.headers.location, timeoutMs));
          }
          let buf = "";
          resp.on("data", (c) => (buf += c));
          resp.on("end", () => {
            let json = null;
            try { json = JSON.parse(buf); } catch (_) {}
            resolve({ synced: resp.statusCode < 400, status: resp.statusCode, json, body: buf.slice(0, 400) });
          });
        }
      );
      req.on("error", (err) => resolve({ synced: false, reason: err.message }));
      req.on("timeout", () => { req.destroy(); resolve({ synced: false, reason: "Sync timeout" }); });
      req.write(data);
      req.end();
    } catch (err) {
      resolve({ synced: false, reason: err.message });
    }
  });
}

function normalizeFurnishedCopy(val) {
  if (Array.isArray(val)) return [...new Set(val.map((s) => String(s || "").trim()).filter(Boolean))];
  if (typeof val === "string" && val.trim()) {
    return [...new Set(val.split(",").map((s) => s.trim()).filter(Boolean))];
  }
  return [];
}

function sendEmailViaGmailSmtp({ senderEmail, appPassword, toEmails, subject, plainBody, htmlBody }) {
  return new Promise((resolve, reject) => {
    const cleanPass = String(appPassword || "").replace(/\s+/g, "");
    if (!senderEmail || !cleanPass) return reject(new Error("Missing sender email or Gmail App Password."));
    const socket = tls.connect({ host: "smtp.gmail.com", port: 465, servername: "smtp.gmail.com", timeout: 20000 });
    let buffer = "";
    let step = 0;
    let rcptIdx = 0;

    const boundary = "DAR_RO8_DTS_" + crypto.randomBytes(8).toString("hex");
    const safeSubj = String(subject || "").replace(/[\r\n]+/g, " ");
    const mimeLines = [
      `From: "DAR RO VIII Records Unit" <${senderEmail}>`,
      `Reply-To: ${senderEmail}`,
      `To: ${toEmails.join(", ")}`,
      `Subject: =?UTF-8?B?${Buffer.from(safeSubj, "utf8").toString("base64")}?=`,
      `Date: ${new Date().toUTCString()}`,
      `MIME-Version: 1.0`,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ``,
      `--${boundary}`,
      `Content-Type: text/plain; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      Buffer.from(String(plainBody || ""), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n").trim(),
      `--${boundary}`,
      `Content-Type: text/html; charset="UTF-8"`,
      `Content-Transfer-Encoding: base64`,
      ``,
      Buffer.from(String(htmlBody || plainBody || ""), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n").trim(),
      `--${boundary}--`,
      ``,
    ].join("\r\n");
    const stuffedBody = mimeLines.replace(/\r\n\./g, "\r\n..");

    const sendLine = (line) => socket.write(line + "\r\n");
    const fail = (msg) => {
      try { socket.destroy(); } catch (_) {}
      reject(new Error(msg));
    };

    socket.on("timeout", () => fail("Gmail SMTP connection timed out"));
    socket.on("error", (err) => fail("Gmail SMTP error: " + err.message));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\r\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        // Wait for final line of multi-line SMTP reply (e.g. "250-..." vs "250 ...")
        if (/^\d{3}-/.test(line)) continue;
        const code = parseInt(line.slice(0, 3), 10);
        if (isNaN(code)) continue;
        if (code >= 400) return fail(`Gmail SMTP rejected (${code}): ${line}`);

        if (step === 0 && code === 220) {
          step = 1;
          sendLine("EHLO darro8-dts.local");
        } else if (step === 1 && code === 250) {
          step = 2;
          sendLine("AUTH LOGIN");
        } else if (step === 2 && code === 334) {
          step = 3;
          sendLine(Buffer.from(senderEmail, "utf8").toString("base64"));
        } else if (step === 3 && code === 334) {
          step = 4;
          sendLine(Buffer.from(cleanPass, "utf8").toString("base64"));
        } else if (step === 4 && code === 235) {
          step = 5;
          sendLine(`MAIL FROM:<${senderEmail}>`);
        } else if (step === 5 && code === 250) {
          step = 6;
          rcptIdx = 0;
          sendLine(`RCPT TO:<${toEmails[rcptIdx]}>`);
        } else if (step === 6 && (code === 250 || code === 251)) {
          rcptIdx++;
          if (rcptIdx < toEmails.length) {
            sendLine(`RCPT TO:<${toEmails[rcptIdx]}>`);
          } else {
            step = 7;
            sendLine("DATA");
          }
        } else if (step === 7 && code === 354) {
          step = 8;
          socket.write(stuffedBody + "\r\n.\r\n");
        } else if (step === 8 && code === 250) {
          step = 9;
          sendLine("QUIT");
          try { socket.end(); } catch (_) {}
          return resolve({ ok: true, from: senderEmail, to: toEmails });
        }
      }
    });
  });
}

async function dispatchFurnishedCopyEmails(db, record, senderUser) {
  const fromFc = normalizeFurnishedCopy(record.furnishedCopy);
  const offices = fromFc.length ? fromFc : normalizeFurnishedCopy(record.recipientTo);
  if (!offices.length) {
    return { attempted: false, sent: false, recipients: [], missing: [], note: "No Recipient offices selected." };
  }
  const senderEmail = String((db.meta && db.meta.senderEmail) || "darrec8@gmail.com").trim();
  const smtpAppPassword = String(process.env.DAR_SMTP_APP_PASSWORD || (db.meta && db.meta.smtpAppPassword) || "").trim();
  const emailMap = (db.meta && db.meta.officeEmails) || {};
  const recipients = [];
  const missing = [];
  offices.forEach((office) => {
    const email = String(emailMap[office] || "").trim();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      recipients.push({ office, email });
    } else {
      missing.push(office);
    }
  });

  const att = record.attachmentFile && (record.attachmentFile.driveUrl || record.attachmentFile.localUrl || record.attachmentFile.url)
    ? record.attachmentFile
    : null;
  const attDriveUrl = att ? String(att.driveUrl || "").trim() : "";
  const attDriveFileId = att ? String(att.driveFileId || "").trim() : "";
  const docNo = record.recNo || record.userDocNo || record.id;
  const safeDocFile = `${String(docNo || "Scanned_Document").replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
  const attSizeBytes = att ? Number(att.size || 0) : 0;

  const emailSubject = `[DAR RO VIII DTS] Outgoing Document: ${record.subject || "Outgoing Document"} (${docNo})`;
  const plainBody = [
    "DAR Eastern Visayas Regional Office VIII — Document Tracking System (DTS)",
    `Official Sender: ${senderEmail}`,
    "================================================================",
    "Your office is listed as a Recipient / Furnished Copy for the following Outgoing Document:",
    "",
    `DAR8 Rec. No.:        ${record.recNo || "(Pending Records Assignment)"}`,
    `User Outgoing No.:    ${record.userDocNo || "—"}`,
    `Originating Office:   ${record.originatingDivision || "—"}`,
    `Document Type:        ${record.docDescription || "—"}`,
    `Date Originated:      ${record.dateOriginated || "—"}`,
    `Subject:              ${record.subject || "—"}`,
    `Recipient (To):       ${record.recipientTo || "—"} (${record.recipientOffice || "—"})`,
    `Recipient Address:    ${record.recipientAddress || "—"}`,
    `Transmission Mode:    ${record.finalDispatchMode || record.transmissionMode || "—"}`,
    `Date Dispatched:      ${record.dateDispatched || "—"}`,
    `Attachments:          ${record.attachments || "NONE"}`,
    att ? `Scanned PDF:          ${attDriveUrl || "Attached to this email"}` : "",
    `Remarks:              ${record.remarks || "—"}`,
    "",
    `Released / Sent by:   ${(senderUser && senderUser.fullName) || "DAR RO VIII Records Unit"} (${senderEmail})`,
    `Date/Time Sent:       ${getManilaNowString()}`,
  ].filter((l) => l !== "").join("\n");

  const scannedHtmlBlock = att
    ? `<div style="margin-top:14px;padding:12px 14px;border-radius:8px;background:#e8f5e9;border:1px solid #a5d6a7;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
         <div style="font-weight:700;color:#1b5e20;">📄 Scanned Document (PDF)</div>
         ${attDriveUrl
           ? `<a href="${attDriveUrl}" style="display:inline-block;padding:8px 14px;background:#1b5e20;color:#fff;text-decoration:none;border-radius:6px;font-weight:700;font-size:13px;">View / Download PDF ↗</a>`
           : `<span style="font-size:12.5px;color:#2c3a32;">PDF attached to this email.</span>`}
       </div>`
    : "";

  const htmlBody = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;border:1px solid #d5e2d8;border-radius:10px;overflow:hidden;">
      <div style="background:#0d3b1e;color:#fff;padding:16px 20px;border-bottom:4px solid #f5c542;">
        <div style="font-size:11px;letter-spacing:0.8px;color:#f5c542;font-weight:700;">REPUBLIC OF THE PHILIPPINES • DEPARTMENT OF AGRARIAN REFORM</div>
        <div style="font-size:17px;font-weight:800;margin-top:3px;">DAR RO VIII — Outgoing DTS Notification</div>
      </div>
      <div style="padding:18px 20px;color:#1b2a22;font-size:13.5px;line-height:1.5;">
        <p style="margin-top:0;">Your office is listed as a recipient of the following outgoing document from DAR RO VIII Records Unit (<strong>${senderEmail}</strong>):</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;width:185px;">DAR8 Rec. No.</td><td style="padding:6px 8px;border:1px solid #dde6df;"><strong>${record.recNo || "Pending Records Assignment"}</strong></td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">User Outgoing No.</td><td style="padding:6px 8px;border:1px solid #dde6df;">${record.userDocNo || "—"}</td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Originating Office</td><td style="padding:6px 8px;border:1px solid #dde6df;">${record.originatingDivision || "—"}</td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Document Type</td><td style="padding:6px 8px;border:1px solid #dde6df;">${record.docDescription || "—"}</td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Subject</td><td style="padding:6px 8px;border:1px solid #dde6df;"><strong>${record.subject || "—"}</strong></td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Recipient (To)</td><td style="padding:6px 8px;border:1px solid #dde6df;">${record.recipientTo || "—"} ${record.recipientOffice ? "— " + record.recipientOffice : ""}</td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Transmission / Dispatch</td><td style="padding:6px 8px;border:1px solid #dde6df;">${record.finalDispatchMode || record.transmissionMode || "—"} ${record.dateDispatched ? "• " + record.dateDispatched : ""}</td></tr>
        </table>
        ${scannedHtmlBlock}
        <p style="font-size:12px;color:#5a6a62;margin-bottom:0;margin-top:14px;">Sent from ${senderEmail} by ${(senderUser && senderUser.fullName) || "DAR RO VIII Records Unit"} on ${getManilaNowString()} via DAR RO VIII DTS.</p>
      </div>
    </div>
  `;

  // Prepare optional local PDF base64 ONLY if no Drive File ID exists and local file <= 12 MB
  let attachmentBase64 = "";
  if (att && !attDriveFileId && att.storedName) {
    try {
      const localPath = resolveSafeLocalUploadPath(att.storedName);
      if (localPath && fs.existsSync(localPath)) {
        const stat = fs.statSync(localPath);
        if (stat.size <= 12 * 1024 * 1024) {
          attachmentBase64 = fs.readFileSync(localPath).toString("base64");
        }
      }
    } catch (_) {}
  }

  const toEmails = [...new Set(recipients.map((r) => r.email))];
  const mailtoUrl = toEmails.length
    ? `mailto:${encodeURIComponent(toEmails.join(","))}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(plainBody)}`
    : "";

  if (!toEmails.length) {
    return {
      attempted: false,
      sent: false,
      senderEmail,
      recipients: [],
      missing,
      mailtoUrl: "",
      via: "none",
      error: `No email address configured yet by Admin for: ${missing.join(", ")}`,
    };
  }

  let sent = false;
  let via = "mailto";
  let error = "";
  let attachedFileSent = false;

  // Priority 1: Direct Gmail SMTP over TLS using darrec8@gmail.com + Gmail App Password!
  if (smtpAppPassword) {
    try {
      await sendEmailViaGmailSmtp({ senderEmail, appPassword: smtpAppPassword, toEmails, subject: emailSubject, plainBody, htmlBody });
      sent = true;
      via = `Gmail SMTP (${senderEmail})`;
    } catch (err) {
      error = err.message;
    }
  }

  // Priority 2: Google Apps Script MailApp relay (uses darrec8@gmail.com; attaches Drive PDF directly if <= 22 MB!)
  if (!sent && db.meta && db.meta.appsScriptUrl) {
    const gasRes = await postToAppsScript(
      db.meta.appsScriptUrl,
      {
        action: "sendFurnishedCopyEmail",
        to: toEmails.join(","),
        replyTo: senderEmail,
        fromName: `DAR RO VIII Records Unit (${senderEmail})`,
        subject: emailSubject,
        body: plainBody,
        htmlBody,
        controlNo: docNo,
        senderName: (senderUser && senderUser.fullName) || "DAR RO VIII Records Unit",
        driveFileId: attSizeBytes <= 22 * 1024 * 1024 ? attDriveFileId : "",
        attachmentName: safeDocFile,
        attachmentBase64: attachmentBase64,
      },
      35000
    );
    if (gasRes.synced && gasRes.json && gasRes.json.ok) {
      sent = true;
      attachedFileSent = !!gasRes.json.attachedFile || !!attDriveUrl;
      via = `Google Apps Script MailApp (${senderEmail})`;
      error = "";
    } else if (!error) {
      error = (gasRes.json && gasRes.json.error) || gasRes.reason || `Enter a Gmail App Password for ${senderEmail} in Settings (or deploy Code.gs under ${senderEmail}) to send automatically.`;
    }
  } else if (!sent && !error) {
    error = `Enter a Gmail App Password for ${senderEmail} in Settings (or connect Apps Script deployed under ${senderEmail}) to send automatically.`;
  }

  return {
    attempted: true,
    sent,
    senderEmail,
    attachedFile: att ? { name: safeDocFile, driveUrl: attDriveUrl, attachedDirect: attachedFileSent } : null,
    sentAt: getManilaNowString(),
    sentBy: (senderUser && senderUser.fullName) || "Records Unit",
    recipients,
    missing,
    mailtoUrl,
    via,
    error,
  };
}

async function dispatchIncomingReplyEmails(db, record, senderUser) {
  const offices = normalizeFurnishedCopy(record.boxERecipients);
  if (!offices.length) {
    return { attempted: false, sent: false, recipients: [], missing: [], note: "No Recipient offices selected." };
  }
  const senderEmail = String((db.meta && db.meta.senderEmail) || "darrec8@gmail.com").trim();
  const smtpAppPassword = String(process.env.DAR_SMTP_APP_PASSWORD || (db.meta && db.meta.smtpAppPassword) || "").trim();
  const emailMap = (db.meta && db.meta.officeEmails) || {};
  const recipients = [];
  const missing = [];
  offices.forEach((office) => {
    const email = String(emailMap[office] || "").trim();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      recipients.push({ office, email });
    } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(office)) {
      recipients.push({ office, email: office });
    } else {
      missing.push(office);
    }
  });

  const att = record.replyAttachmentFile && (record.replyAttachmentFile.driveUrl || record.replyAttachmentFile.localUrl || record.replyAttachmentFile.url)
    ? record.replyAttachmentFile
    : null;
  const attDriveUrl = att ? String(att.driveUrl || "").trim() : "";
  const attDriveFileId = att ? String(att.driveFileId || "").trim() : "";
  const docNo = record.controlNo || "INC-DOC";
  const safeDocFile = `${String(docNo).replace(/[^A-Za-z0-9_-]/g, "_")}_REPLY.pdf`;
  const attSizeBytes = att ? Number(att.size || 0) : 0;

  const emailSubject = `[DAR RO VIII DTS] Reply / Action Taken: ${record.subject || "Incoming Document"} (${docNo})`;
  const plainBody = [
    "DAR Eastern Visayas Regional Office VIII — Document Tracking System (DTS)",
    `Official Sender: ${senderEmail}`,
    "================================================================",
    "Reply / Action Taken for the following Incoming Document:",
    "",
    `DTS Control No.:      ${docNo}`,
    `Original Sender:      ${record.senderName || "—"} (${record.senderOffice || "—"})`,
    `Document Type:        ${record.docType || "—"}`,
    `Subject:              ${record.subject || "—"}`,
    `Assigned Division:    ${resolveAssignedDivision(record) || "—"}`,
    `Action Taken (Box D): ${record.divActionTaken || "—"}`,
    `Date Acted:           ${record.dateActed || "—"}`,
    `Dispatch Mode:        ${record.recordsDispatchMode || "—"}`,
    `Dispatch Details:     ${record.dispatchDetails || "—"}`,
    `Date Returned:        ${record.dateReturnedBy || "—"}`,
    att ? `Reply / Action PDF:   ${attDriveUrl || "Attached to this email"}` : "",
    "",
    `Sent by:              ${(senderUser && senderUser.fullName) || "DAR RO VIII Records Unit"} (${senderEmail})`,
    `Date/Time Sent:       ${getManilaNowString()}`,
  ].filter((l) => l !== "").join("\n");

  const scannedHtmlBlock = att
    ? `<div style="margin-top:14px;padding:12px 14px;border-radius:8px;background:#e8f5e9;border:1px solid #a5d6a7;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
         <div style="font-weight:700;color:#1b5e20;">📄 Reply / Action Taken Document (PDF)</div>
         ${attDriveUrl
           ? `<a href="${attDriveUrl}" style="display:inline-block;padding:8px 14px;background:#1b5e20;color:#fff;text-decoration:none;border-radius:6px;font-weight:700;font-size:13px;">View / Download PDF ↗</a>`
           : `<span style="font-size:12.5px;color:#2c3a32;">PDF attached to this email.</span>`}
       </div>`
    : "";

  const htmlBody = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;border:1px solid #d5e2d8;border-radius:10px;overflow:hidden;">
      <div style="background:#0d3b1e;color:#fff;padding:16px 20px;border-bottom:4px solid #f5c542;">
        <div style="font-size:11px;letter-spacing:0.8px;color:#f5c542;font-weight:700;">REPUBLIC OF THE PHILIPPINES • DEPARTMENT OF AGRARIAN REFORM</div>
        <div style="font-size:17px;font-weight:800;margin-top:3px;">DAR RO VIII — Incoming DTS Reply / Action Taken</div>
      </div>
      <div style="padding:18px 20px;color:#1b2a22;font-size:13.5px;line-height:1.5;">
        <p style="margin-top:0;">Please find below the reply / action taken from DAR RO VIII Records Unit (<strong>${senderEmail}</strong>):</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;width:185px;">DTS Control No.</td><td style="padding:6px 8px;border:1px solid #dde6df;"><strong>${docNo}</strong></td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Original Sender</td><td style="padding:6px 8px;border:1px solid #dde6df;">${record.senderName || "—"} ${record.senderOffice ? "— " + record.senderOffice : ""}</td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Subject</td><td style="padding:6px 8px;border:1px solid #dde6df;"><strong>${record.subject || "—"}</strong></td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Assigned Division</td><td style="padding:6px 8px;border:1px solid #dde6df;">${resolveAssignedDivision(record) || "—"}</td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Action Taken (Box D)</td><td style="padding:6px 8px;border:1px solid #dde6df;">${record.divActionTaken || "—"}</td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Date Acted / Returned</td><td style="padding:6px 8px;border:1px solid #dde6df;">${record.dateActed || "—"} ${record.dateReturnedBy ? "• Returned: " + record.dateReturnedBy : ""}</td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Dispatch Mode / Details</td><td style="padding:6px 8px;border:1px solid #dde6df;">${record.recordsDispatchMode || "—"} ${record.dispatchDetails ? "• " + record.dispatchDetails : ""}</td></tr>
        </table>
        ${scannedHtmlBlock}
        <p style="font-size:12px;color:#5a6a62;margin-bottom:0;margin-top:14px;">Sent from ${senderEmail} by ${(senderUser && senderUser.fullName) || "DAR RO VIII Records Unit"} on ${getManilaNowString()} via DAR RO VIII DTS.</p>
      </div>
    </div>
  `;

  let attachmentBase64 = "";
  if (att && !attDriveFileId && att.storedName) {
    try {
      const localPath = resolveSafeLocalUploadPath(att.storedName);
      if (localPath && fs.existsSync(localPath)) {
        const stat = fs.statSync(localPath);
        if (stat.size <= 12 * 1024 * 1024) {
          attachmentBase64 = fs.readFileSync(localPath).toString("base64");
        }
      }
    } catch (_) {}
  }

  const toEmails = [...new Set(recipients.map((r) => r.email))];
  const mailtoUrl = toEmails.length
    ? `mailto:${encodeURIComponent(toEmails.join(","))}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(plainBody)}`
    : "";

  if (!toEmails.length) {
    return {
      attempted: false,
      sent: false,
      senderEmail,
      recipients: [],
      missing,
      mailtoUrl: "",
      via: "none",
      error: `No email address configured yet by Admin for: ${missing.join(", ")}`,
    };
  }

  let sent = false;
  let via = "mailto";
  let error = "";
  let attachedFileSent = false;

  if (smtpAppPassword) {
    try {
      await sendEmailViaGmailSmtp({ senderEmail, appPassword: smtpAppPassword, toEmails, subject: emailSubject, plainBody, htmlBody });
      sent = true;
      via = `Gmail SMTP (${senderEmail})`;
    } catch (err) {
      error = err.message;
    }
  }

  if (!sent && db.meta && db.meta.appsScriptUrl) {
    const gasRes = await postToAppsScript(
      db.meta.appsScriptUrl,
      {
        action: "sendFurnishedCopyEmail",
        to: toEmails.join(","),
        replyTo: senderEmail,
        fromName: `DAR RO VIII Records Unit (${senderEmail})`,
        subject: emailSubject,
        body: plainBody,
        htmlBody,
        controlNo: docNo,
        senderName: (senderUser && senderUser.fullName) || "DAR RO VIII Records Unit",
        driveFileId: attSizeBytes <= 22 * 1024 * 1024 ? attDriveFileId : "",
        attachmentName: safeDocFile,
        attachmentBase64,
      },
      35000
    );
    if (gasRes.synced && gasRes.json && gasRes.json.ok) {
      sent = true;
      attachedFileSent = !!gasRes.json.attachedFile || !!attDriveUrl;
      via = `Google Apps Script MailApp (${senderEmail})`;
      error = "";
    } else if (!error) {
      error = (gasRes.json && gasRes.json.error) || gasRes.reason || `Failed to relay email via Apps Script (${senderEmail}).`;
    }
  } else if (!sent && !error) {
    error = `Connect Google Apps Script or Gmail App Password for ${senderEmail} in Settings to send automatically.`;
  }

  return {
    attempted: true,
    sent,
    senderEmail,
    attachedFile: att ? { name: safeDocFile, driveUrl: attDriveUrl, attachedDirect: attachedFileSent } : null,
    sentAt: getManilaNowString(),
    sentBy: (senderUser && senderUser.fullName) || "Records Unit",
    recipients,
    missing,
    mailtoUrl,
    via,
    error,
  };
}

async function dispatchIssuanceEmails(db, record, senderUser) {
  const offices = normalizeFurnishedCopy(record.recipients);
  if (!offices.length) {
    return { attempted: false, sent: false, recipients: [], missing: [], note: "No Recipient offices selected." };
  }
  const senderEmail = String((db.meta && db.meta.senderEmail) || "darrec8@gmail.com").trim();
  const smtpAppPassword = String(process.env.DAR_SMTP_APP_PASSWORD || (db.meta && db.meta.smtpAppPassword) || "").trim();
  const emailMap = (db.meta && db.meta.officeEmails) || {};
  const recipients = [];
  const missing = [];
  offices.forEach((office) => {
    const email = String(emailMap[office] || "").trim();
    if (email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      recipients.push({ office, email });
    } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(office)) {
      recipients.push({ office, email: office });
    } else {
      missing.push(office);
    }
  });

  const docNo = record.issuanceNo || "Issuance";
  const catLabel = record.category || "Issuance";
  const att = record.attachmentFile && (record.attachmentFile.url || record.attachmentFile.driveUrl || record.attachmentFile.localUrl)
    ? record.attachmentFile
    : null;
  const attDriveUrl = att ? (att.driveUrl || (att.url && att.url.startsWith("http") ? att.url : "")) : "";
  const attDriveFileId = att ? String(att.driveFileId || "").trim() : "";
  const attSizeBytes = att ? Number(att.size || 0) : 0;
  const safeDocFile = `${String(docNo).replace(/[^A-Za-z0-9._-]+/g, "_")}.pdf`;

  const emailSubject = `[DAR RO VIII ${catLabel}] ${docNo} — ${record.subject || "Official Issuance"}`;
  const custom = record.customFields || {};
  const plainLines = [
    "DAR EASTERN VISAYAS REGIONAL OFFICE VIII",
    `Official Issuance Notification (${catLabel})`,
    "--------------------------------------------------",
    `Control Number: ${docNo}`,
    `Issuance Type: ${catLabel}`,
    `Date of Document: ${record.dateIssued || "—"}`,
    `Signatory / Issued By: ${record.issuedBy || "—"}`,
    `Subject: ${record.subject || "—"}`,
    custom.col_province ? `Province: ${custom.col_province}` : "",
    custom.col_date_of_activity ? `Date of Activity: ${custom.col_date_of_activity}` : "",
    custom.col_place_venue ? `Place / Venue: ${custom.col_place_venue}` : "",
    record.remarks ? `Remarks: ${record.remarks}` : "",
    `Recipients: ${offices.join(", ")}`,
    att ? "" : "",
    att ? "Scanned Document (PDF): Attached / Linked below" : "",
    attDriveUrl ? `View / Download PDF (Google Drive): ${attDriveUrl}` : "",
    "",
    `Sent from: ${senderEmail}`,
    `Sent by: ${(senderUser && senderUser.fullName) || "DAR RO VIII"} on ${getManilaNowString()}`,
  ].filter((l) => l !== "");
  const plainBody = plainLines.join("\n");

  const scannedHtmlBlock = att
    ? `<div style="margin-top:14px;padding:12px 14px;border-radius:8px;background:#e8f5e9;border:1px solid #a5d6a7;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
         <div style="font-weight:700;color:#1b5e20;">📄 Scanned Document (PDF)</div>
         ${attDriveUrl
           ? `<a href="${attDriveUrl}" style="display:inline-block;padding:8px 14px;background:#1b5e20;color:#fff;text-decoration:none;border-radius:6px;font-weight:700;font-size:13px;">View / Download PDF ↗</a>`
           : `<span style="font-size:12.5px;color:#2c3a32;">PDF attached to this email.</span>`}
       </div>`
    : "";

  const extraRows = [
    custom.col_province ? `<tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Province</td><td style="padding:6px 8px;border:1px solid #dde6df;">${custom.col_province}</td></tr>` : "",
    custom.col_date_of_activity ? `<tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Date of Activity</td><td style="padding:6px 8px;border:1px solid #dde6df;">${custom.col_date_of_activity}</td></tr>` : "",
    custom.col_place_venue ? `<tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Place / Venue</td><td style="padding:6px 8px;border:1px solid #dde6df;">${custom.col_place_venue}</td></tr>` : "",
    record.remarks ? `<tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Remarks</td><td style="padding:6px 8px;border:1px solid #dde6df;">${record.remarks}</td></tr>` : "",
  ].join("");

  const htmlBody = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:640px;border:1px solid #d5e2d8;border-radius:10px;overflow:hidden;">
      <div style="background:#0d3b1e;color:#fff;padding:16px 20px;border-bottom:4px solid #f5c542;">
        <div style="font-size:11px;letter-spacing:0.8px;color:#f5c542;font-weight:700;">REPUBLIC OF THE PHILIPPINES • DEPARTMENT OF AGRARIAN REFORM</div>
        <div style="font-size:17px;font-weight:800;margin-top:3px;">DAR RO VIII — Official Issuance (${catLabel})</div>
      </div>
      <div style="padding:18px 20px;color:#1b2a22;font-size:13.5px;line-height:1.5;">
        <p style="margin-top:0;">Your office is listed as a recipient of the following official issuance from DAR RO VIII (<strong>${senderEmail}</strong>):</p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;width:185px;">Control Number</td><td style="padding:6px 8px;border:1px solid #dde6df;"><strong>${docNo}</strong></td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Issuance Type</td><td style="padding:6px 8px;border:1px solid #dde6df;">${catLabel}</td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Date of Document</td><td style="padding:6px 8px;border:1px solid #dde6df;">${record.dateIssued || "—"}</td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Signatory / Issued By</td><td style="padding:6px 8px;border:1px solid #dde6df;">${record.issuedBy || "—"}</td></tr>
          <tr><td style="padding:6px 8px;border:1px solid #dde6df;background:#f4f8f5;font-weight:700;">Subject</td><td style="padding:6px 8px;border:1px solid #dde6df;"><strong>${record.subject || "—"}</strong></td></tr>
          ${extraRows}
        </table>
        ${scannedHtmlBlock}
        <p style="font-size:12px;color:#5a6a62;margin-bottom:0;margin-top:14px;">Sent from ${senderEmail} by ${(senderUser && senderUser.fullName) || "DAR RO VIII"} on ${getManilaNowString()} via DAR RO VIII DTS.</p>
      </div>
    </div>
  `;

  let attachmentBase64 = "";
  if (att && !attDriveFileId && att.storedName) {
    try {
      const localPath = resolveSafeLocalUploadPath(att.storedName);
      if (localPath && fs.existsSync(localPath)) {
        const stat = fs.statSync(localPath);
        if (stat.size <= 12 * 1024 * 1024) {
          attachmentBase64 = fs.readFileSync(localPath).toString("base64");
        }
      }
    } catch (_) {}
  }

  const toEmails = [...new Set(recipients.map((r) => r.email))];
  const mailtoUrl = toEmails.length
    ? `mailto:${encodeURIComponent(toEmails.join(","))}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(plainBody)}`
    : "";

  if (!toEmails.length) {
    return {
      attempted: false,
      sent: false,
      senderEmail,
      recipients: [],
      missing,
      mailtoUrl: "",
      via: "none",
      error: `No email address configured yet by Admin for: ${missing.join(", ")}`,
    };
  }

  let sent = false;
  let via = "mailto";
  let error = "";
  let attachedFileSent = false;

  if (smtpAppPassword) {
    try {
      await sendEmailViaGmailSmtp({ senderEmail, appPassword: smtpAppPassword, toEmails, subject: emailSubject, plainBody, htmlBody });
      sent = true;
      via = `Gmail SMTP (${senderEmail})`;
    } catch (err) {
      error = err.message;
    }
  }

  if (!sent && db.meta && db.meta.appsScriptUrl) {
    const gasRes = await postToAppsScript(
      db.meta.appsScriptUrl,
      {
        action: "sendFurnishedCopyEmail",
        to: toEmails.join(","),
        replyTo: senderEmail,
        fromName: `DAR RO VIII Records Unit (${senderEmail})`,
        subject: emailSubject,
        body: plainBody,
        htmlBody,
        controlNo: docNo,
        senderName: (senderUser && senderUser.fullName) || "DAR RO VIII Records Unit",
        driveFileId: attSizeBytes <= 22 * 1024 * 1024 ? attDriveFileId : "",
        attachmentName: safeDocFile,
        attachmentBase64: attachmentBase64,
      },
      35000
    );
    if (gasRes.synced && gasRes.json && gasRes.json.ok) {
      sent = true;
      attachedFileSent = !!gasRes.json.attachedFile || !!attDriveUrl;
      via = `Google Apps Script MailApp (${senderEmail})`;
      error = "";
    } else if (!error) {
      error = (gasRes.json && gasRes.json.error) || gasRes.reason || `Configure Gmail/Apps Script email for ${senderEmail} in Settings.`;
    }
  } else if (!sent && !error) {
    error = `Configure Gmail/Apps Script email for ${senderEmail} in Settings.`;
  }

  return {
    attempted: true,
    sent,
    senderEmail,
    attachedFile: att ? { name: safeDocFile, driveUrl: attDriveUrl, attachedDirect: attachedFileSent } : null,
    sentAt: getManilaNowString(),
    sentBy: (senderUser && senderUser.fullName) || "Records Unit",
    recipients,
    missing,
    mailtoUrl,
    via,
    error,
  };
}

async function sendLoginOtpEmail(db, user, toEmail, otpCode) {
  const senderEmail = String((db.meta && db.meta.senderEmail) || "darrec8@gmail.com").trim();
  const smtpAppPassword = String(process.env.DAR_SMTP_APP_PASSWORD || (db.meta && db.meta.smtpAppPassword) || "").trim();
  const subject = `[DAR RO VIII DTS] Your Login Verification Code: ${otpCode}`;
  const plainBody = [
    "DAR Eastern Visayas Regional Office VIII — Document Tracking System (DTS)",
    "================================================================",
    `Hello ${user.fullName || user.username},`,
    "",
    `Your 6-digit One-Time Password (OTP) to sign in to your DAR RO VIII DTS account (${user.username}) is:`,
    "",
    `    ${otpCode}`,
    "",
    "This code expires in 5 minutes. Do not share this code with anyone.",
    "If you did not try to sign in, please ignore this message and notify your System Administrator.",
    "",
    `Sent from ${senderEmail} at ${getManilaNowString()}`,
  ].join("\n");

  const htmlBody = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;border:1px solid #d5e2d8;border-radius:10px;overflow:hidden;">
      <div style="background:#0d3b1e;color:#fff;padding:16px 20px;border-bottom:4px solid #f5c542;">
        <div style="font-size:11px;letter-spacing:0.8px;color:#f5c542;font-weight:700;">REPUBLIC OF THE PHILIPPINES • DEPARTMENT OF AGRARIAN REFORM</div>
        <div style="font-size:17px;font-weight:800;margin-top:3px;">DAR RO VIII DTS — Login OTP Verification</div>
      </div>
      <div style="padding:20px;color:#1b2a22;font-size:14px;line-height:1.5;">
        <p style="margin-top:0;">Hello <strong>${user.fullName || user.username}</strong>,</p>
        <p>Use the 6-digit verification code below to finish signing in to your account (<code>${user.username}</code>):</p>
        <div style="margin:18px 0;padding:16px;text-align:center;background:#f1f8e9;border:2px dashed #2e7d32;border-radius:10px;">
          <div style="font-size:32px;font-weight:900;letter-spacing:8px;color:#0d3b1e;">${otpCode}</div>
          <div style="font-size:12px;color:#5a6a62;margin-top:6px;">Valid for 5 minutes • Do not share this code</div>
        </div>
        <p style="font-size:12px;color:#5a6a62;margin-bottom:0;">Sent from ${senderEmail} at ${getManilaNowString()}. If you did not request this sign-in, please contact your DAR RO VIII System Administrator.</p>
      </div>
    </div>
  `;

  if (smtpAppPassword) {
    try {
      await sendEmailViaGmailSmtp({ senderEmail, appPassword: smtpAppPassword, toEmails: [toEmail], subject, plainBody, htmlBody });
      return { ok: true, via: `Gmail SMTP (${senderEmail})` };
    } catch (err) {
      if (!db.meta || !db.meta.appsScriptUrl) return { ok: false, error: err.message };
    }
  }
  if (db.meta && db.meta.appsScriptUrl) {
    const gasRes = await postToAppsScript(
      db.meta.appsScriptUrl,
      {
        action: "sendFurnishedCopyEmail",
        to: toEmail,
        replyTo: senderEmail,
        fromName: `DAR RO VIII DTS Security (${senderEmail})`,
        subject,
        body: plainBody,
        htmlBody,
      },
      25000
    );
    if (gasRes.synced && gasRes.json && gasRes.json.ok) {
      return { ok: true, via: `Google Apps Script MailApp (${senderEmail})` };
    }
    return { ok: false, error: (gasRes.json && gasRes.json.error) || gasRes.reason || "Could not deliver OTP email." };
  }
  return { ok: false, error: "Email sender is not connected in Settings." };
}

async function sendRegistrationOtpEmail(db, fullName, username, toEmail, otpCode) {
  const senderEmail = String((db.meta && db.meta.senderEmail) || "darrec8@gmail.com").trim();
  const smtpAppPassword = String(process.env.DAR_SMTP_APP_PASSWORD || (db.meta && db.meta.smtpAppPassword) || "").trim();
  const subject = `[DAR RO VIII DTS] Verify Your Email for Account Registration: ${otpCode}`;
  const plainBody = [
    "DAR Eastern Visayas Regional Office VIII — Document Tracking System (DTS)",
    "================================================================",
    `Hello ${fullName || username},`,
    "",
    `Your 6-digit Email Verification Code to complete registration for username "${username}" is:`,
    "",
    `    ${otpCode}`,
    "",
    "This code expires in 5 minutes. After verifying your email, your account will be sent to the System Administrator for approval.",
    "",
    `Sent from ${senderEmail} at ${getManilaNowString()}`,
  ].join("\n");

  const htmlBody = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:520px;border:1px solid #d5e2d8;border-radius:10px;overflow:hidden;">
      <div style="background:#0d3b1e;color:#fff;padding:16px 20px;border-bottom:4px solid #f5c542;">
        <div style="font-size:11px;letter-spacing:0.8px;color:#f5c542;font-weight:700;">REPUBLIC OF THE PHILIPPINES • DEPARTMENT OF AGRARIAN REFORM</div>
        <div style="font-size:17px;font-weight:800;margin-top:3px;">DAR RO VIII DTS — Verify Registration Email</div>
      </div>
      <div style="padding:20px;color:#1b2a22;font-size:14px;line-height:1.5;">
        <p style="margin-top:0;">Hello <strong>${fullName || username}</strong>,</p>
        <p>Enter the 6-digit verification code below to confirm your email address and submit your account registration (<code>${username}</code>) for Admin approval:</p>
        <div style="margin:18px 0;padding:16px;text-align:center;background:#f1f8e9;border:2px dashed #2e7d32;border-radius:10px;">
          <div style="font-size:32px;font-weight:900;letter-spacing:8px;color:#0d3b1e;">${otpCode}</div>
          <div style="font-size:12px;color:#5a6a62;margin-top:6px;">Valid for 5 minutes • Do not share this code</div>
        </div>
        <p style="font-size:12px;color:#5a6a62;margin-bottom:0;">Sent from ${senderEmail} at ${getManilaNowString()}. If you did not request an account, please ignore this email.</p>
      </div>
    </div>
  `;

  if (smtpAppPassword) {
    try {
      await sendEmailViaGmailSmtp({ senderEmail, appPassword: smtpAppPassword, toEmails: [toEmail], subject, plainBody, htmlBody });
      return { ok: true, via: `Gmail SMTP (${senderEmail})` };
    } catch (err) {
      if (!db.meta || !db.meta.appsScriptUrl) return { ok: false, error: err.message };
    }
  }
  if (db.meta && db.meta.appsScriptUrl) {
    const gasRes = await postToAppsScript(
      db.meta.appsScriptUrl,
      {
        action: "sendFurnishedCopyEmail",
        to: toEmail,
        replyTo: senderEmail,
        fromName: `DAR RO VIII DTS Registration (${senderEmail})`,
        subject,
        body: plainBody,
        htmlBody,
      },
      25000
    );
    if (gasRes.synced && gasRes.json && gasRes.json.ok) {
      return { ok: true, via: `Google Apps Script MailApp (${senderEmail})` };
    }
    return { ok: false, error: (gasRes.json && gasRes.json.error) || gasRes.reason || "Could not deliver verification OTP email." };
  }
  return { ok: false, error: "Email sender is not connected in Settings." };
}

async function sendAccountStatusEmail(db, targetUser, nextStatus, adminUser) {
  const toEmail = resolveUserOtpEmail(db, targetUser);
  if (!toEmail) {
    return { attempted: false, sent: false, to: "", error: "No email address set for this account." };
  }
  const senderEmail = String((db.meta && db.meta.senderEmail) || "darrec8@gmail.com").trim();
  const smtpAppPassword = String(process.env.DAR_SMTP_APP_PASSWORD || (db.meta && db.meta.smtpAppPassword) || "").trim();
  const isApproved = nextStatus === "APPROVED";
  const subject = isApproved
    ? `[DAR RO VIII DTS] Account Approved — You Can Now Sign In`
    : `[DAR RO VIII DTS] Account Status Update (${nextStatus})`;
  const plainBody = isApproved
    ? [
        "DAR Eastern Visayas Regional Office VIII — Document Tracking System (DTS)",
        "================================================================",
        `Hello ${targetUser.fullName || targetUser.username},`,
        "",
        "Good news! Your DAR RO VIII Document Tracking System account has been CONFIRMED and APPROVED by the System Administrator.",
        "",
        `Username:    ${targetUser.username}`,
        `Role:        ${targetUser.role}`,
        `Division:    ${targetUser.division || "—"}`,
        `Approved By: ${(adminUser && adminUser.fullName) || "System Administrator"}`,
        `Approved At: ${getManilaNowString()}`,
        "",
        "You may now sign in to the DAR RO VIII DTS portal using your username, password, and Email OTP verification.",
      ].join("\n")
    : [
        "DAR Eastern Visayas Regional Office VIII — Document Tracking System (DTS)",
        "================================================================",
        `Hello ${targetUser.fullName || targetUser.username},`,
        "",
        `Your DAR RO VIII DTS account (${targetUser.username}) status has been updated to: ${nextStatus}.`,
        "If you believe this is an error, please contact the DAR RO VIII System Administrator.",
        "",
        `Updated By: ${(adminUser && adminUser.fullName) || "System Administrator"} at ${getManilaNowString()}`,
      ].join("\n");

  const bannerColor = isApproved ? "#0d3b1e" : "#8e1c1c";
  const badgeBg = isApproved ? "#e8f5e9" : "#ffebee";
  const badgeColor = isApproved ? "#1b5e20" : "#b71c1c";
  const badgeBorder = isApproved ? "#81c784" : "#ef9a9a";
  const headline = isApproved ? "Account Approved — Ready to Sign In" : `Account Status: ${nextStatus}`;
  const intro = isApproved
    ? `Good news! Your DAR RO VIII Document Tracking System account has been <strong>confirmed and approved</strong> by the System Administrator. You can now sign in to the portal.`
    : `Your DAR RO VIII Document Tracking System account (<code>${targetUser.username}</code>) has been marked as <strong>${nextStatus}</strong>. Please contact your System Administrator for assistance.`;

  const htmlBody = `
    <div style="font-family:Segoe UI,Arial,sans-serif;max-width:560px;border:1px solid #d5e2d8;border-radius:10px;overflow:hidden;">
      <div style="background:${bannerColor};color:#fff;padding:16px 20px;border-bottom:4px solid #f5c542;">
        <div style="font-size:11px;letter-spacing:0.8px;color:#f5c542;font-weight:700;">REPUBLIC OF THE PHILIPPINES • DEPARTMENT OF AGRARIAN REFORM</div>
        <div style="font-size:17px;font-weight:800;margin-top:3px;">DAR RO VIII DTS — ${headline}</div>
      </div>
      <div style="padding:20px;color:#1b2a22;font-size:13.8px;line-height:1.5;">
        <p style="margin-top:0;">Hello <strong>${targetUser.fullName || targetUser.username}</strong>,</p>
        <p>${intro}</p>
        <div style="margin:14px 0;padding:12px 14px;border-radius:8px;background:${badgeBg};border:1px solid ${badgeBorder};color:${badgeColor};font-size:13px;">
          <div><strong>Username:</strong> <code>${targetUser.username}</code></div>
          <div><strong>Role:</strong> ${targetUser.role}</div>
          <div><strong>Division / Section:</strong> ${targetUser.division || "—"}</div>
          <div><strong>Status:</strong> <strong>${nextStatus}</strong></div>
        </div>
        <p style="font-size:12px;color:#5a6a62;margin-bottom:0;">Processed by ${(adminUser && adminUser.fullName) || "System Administrator"} on ${getManilaNowString()} via DAR RO VIII DTS (${senderEmail}).</p>
      </div>
    </div>
  `;

  if (smtpAppPassword) {
    try {
      await sendEmailViaGmailSmtp({ senderEmail, appPassword: smtpAppPassword, toEmails: [toEmail], subject, plainBody, htmlBody });
      return { attempted: true, sent: true, to: toEmail, via: `Gmail SMTP (${senderEmail})` };
    } catch (err) {
      if (!db.meta || !db.meta.appsScriptUrl) return { attempted: true, sent: false, to: toEmail, error: err.message };
    }
  }
  if (db.meta && db.meta.appsScriptUrl) {
    const gasRes = await postToAppsScript(
      db.meta.appsScriptUrl,
      {
        action: "sendFurnishedCopyEmail",
        to: toEmail,
        replyTo: senderEmail,
        fromName: `DAR RO VIII DTS Admin (${senderEmail})`,
        subject,
        body: plainBody,
        htmlBody,
      },
      25000
    );
    if (gasRes.synced && gasRes.json && gasRes.json.ok) {
      return { attempted: true, sent: true, to: toEmail, via: `Google Apps Script MailApp (${senderEmail})` };
    }
    return { attempted: true, sent: false, to: toEmail, error: (gasRes.json && gasRes.json.error) || gasRes.reason || "Could not send notification email." };
  }
  return { attempted: true, sent: false, to: toEmail, error: "Email sender is not connected in Settings." };
}

// ----------------- API Router -----------------
async function handleApi(req, res, urlObj) {
  const pathname = urlObj.pathname;
  const method = req.method;

  try {
    if (IS_VERCEL) {
      const needFresh =
        !fs.existsSync(DB_PATH) ||
        pathname === "/api/state" ||
        pathname.startsWith("/api/auth/") ||
        method !== "GET";
      await hydrateDbFromSheet(needFresh);
    }
    const db = readDb();

    // PUBLIC: Divisions list (needed on Registration screen)
    if (method === "GET" && pathname === "/api/public/divisions") {
      return sendJson(res, 200, { divisions: db.divisions, meta: { officeName: db.meta.officeName, tagline: db.meta.tagline } });
    }

    // AUTH: Register new account (Step 1 — validates details & sends 6-digit OTP to verify email address!)
    if (method === "POST" && pathname === "/api/auth/register") {
      const body = await parseBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const fullName = String(body.fullName || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const role = String(body.role || "").trim();
      let division = String(body.division || "").trim();

      const validRoles = ["RECORDS", "RD_SECRETARY", "ARD_SECRETARY", "DIVISION_CHIEF"];
      if (!username || username.length < 3 || !/^[a-z0-9._-]+$/.test(username)) {
        return sendJson(res, 400, { error: "Username must be at least 3 characters (letters, numbers, dot, underscore, hyphen)." });
      }
      if (!fullName) return sendJson(res, 400, { error: "Full name is required." });
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendJson(res, 400, { error: "A valid Official Email Address is required to verify your account via OTP." });
      }
      if (password.length < 6) return sendJson(res, 400, { error: "Password must be at least 6 characters." });
      if (!validRoles.includes(role)) return sendJson(res, 400, { error: "Invalid account role selected." });
      if (db.users.some((u) => u.username.toLowerCase() === username)) {
        return sendJson(res, 409, { error: `Username "${username}" is already registered.` });
      }

      if (role === "RECORDS") division = "STO - Records";
      else if (role === "RD_SECRETARY") division = "RD";
      else if (role === "ARD_SECRETARY" && !["ARDO", "ARDA"].includes(division)) division = "ARDO";
      else if (role === "DIVISION_CHIEF" && !division) {
        return sendJson(res, 400, { error: "Please select your Division / STO Section." });
      }

      const now = Date.now();
      for (const [cid, ch] of regOtpChallenges.entries()) {
        if (ch.expiresAt < now) regOtpChallenges.delete(cid);
      }

      const otpCode = String(crypto.randomInt(100000, 1000000));
      const sendRes = await sendRegistrationOtpEmail(db, fullName, username, email, otpCode);
      if (!sendRes.ok) {
        return sendJson(res, 502, { error: `Could not send verification OTP to ${maskEmailAddress(email)}: ${sendRes.error}` });
      }

      const pendingUser = {
        id: "u-" + crypto.randomBytes(6).toString("hex"),
        username,
        fullName,
        email,
        emailVerified: true,
        role,
        division,
        approvalStatus: "PENDING",
        approvedBy: "",
        approvedAt: "",
        passwordHash: hashPassword(password),
        createdAt: new Date().toISOString(),
      };
      const challengeId = "regotp-" + crypto.randomBytes(16).toString("hex");
      regOtpChallenges.set(challengeId, {
        pendingUser,
        code: otpCode,
        email,
        expiresAt: now + 5 * 60 * 1000,
        attempts: 0,
        lastSentAt: now,
      });

      return sendJson(res, 200, {
        ok: true,
        otpRequired: true,
        challengeId,
        maskedEmail: maskEmailAddress(email),
        senderEmail: db.meta.senderEmail || "darrec8@gmail.com",
        expiresInSec: 300,
      });
    }

    // AUTH: Verify Registration OTP (Step 2 — confirms user owns the email & submits account for Admin approval!)
    if (method === "POST" && pathname === "/api/auth/register/verify-otp") {
      const body = await parseBody(req);
      const challengeId = String(body.challengeId || "").trim();
      const otp = String(body.otp || "").replace(/\s+/g, "").trim();
      const ch = regOtpChallenges.get(challengeId);
      if (!ch) {
        return sendJson(res, 401, { error: "Verification session not found or expired. Please submit the registration form again." });
      }
      if (Date.now() > ch.expiresAt) {
        regOtpChallenges.delete(challengeId);
        return sendJson(res, 401, { error: "Verification code has expired. Please click Resend OTP or register again." });
      }
      if (!/^\d{6}$/.test(otp)) {
        return sendJson(res, 400, { error: "Please enter the 6-digit verification code sent to your email." });
      }
      const a = Buffer.from(otp, "utf8");
      const b = Buffer.from(ch.code, "utf8");
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        ch.attempts += 1;
        if (ch.attempts >= 5) {
          regOtpChallenges.delete(challengeId);
          return sendJson(res, 401, { error: "Too many incorrect OTP attempts. Please submit the registration form again." });
        }
        return sendJson(res, 401, { error: `Invalid verification code. ${5 - ch.attempts} attempt(s) remaining.` });
      }
      const newUser = ch.pendingUser;
      regOtpChallenges.delete(challengeId);
      if (db.users.some((u) => u.username.toLowerCase() === newUser.username.toLowerCase())) {
        return sendJson(res, 409, { error: `Username "${newUser.username}" was already registered.` });
      }
      newUser.createdAt = new Date().toISOString();
      db.users.push(newUser);
      writeDb(db);

      return sendJson(res, 201, {
        ok: true,
        pendingApproval: true,
        message: "Email verified! Your registration has been submitted and is pending confirmation by the System Administrator.",
        user: sanitizeUser(newUser),
      });
    }

    // AUTH: Resend Registration OTP
    if (method === "POST" && pathname === "/api/auth/register/resend-otp") {
      const body = await parseBody(req);
      const challengeId = String(body.challengeId || "").trim();
      const ch = regOtpChallenges.get(challengeId);
      if (!ch) return sendJson(res, 404, { error: "Verification session expired. Please fill out the registration form again." });
      const now = Date.now();
      const waitSec = Math.ceil((20000 - (now - ch.lastSentAt)) / 1000);
      if (waitSec > 0) {
        return sendJson(res, 429, { error: `Please wait ${waitSec}s before requesting another verification code.` });
      }
      const newCode = String(crypto.randomInt(100000, 1000000));
      const sendRes = await sendRegistrationOtpEmail(db, ch.pendingUser.fullName, ch.pendingUser.username, ch.email, newCode);
      if (!sendRes.ok) {
        return sendJson(res, 502, { error: `Failed to resend verification email: ${sendRes.error}` });
      }
      ch.code = newCode;
      ch.attempts = 0;
      ch.lastSentAt = now;
      ch.expiresAt = now + 5 * 60 * 1000;
      return sendJson(res, 200, {
        ok: true,
        maskedEmail: maskEmailAddress(ch.email),
        expiresInSec: 300,
      });
    }

    // AUTH: Login (Step 1 — verifies credentials and sends 6-digit Email OTP if account has an email & Login OTP is enabled)
    if (method === "POST" && pathname === "/api/auth/login") {
      const body = await parseBody(req);
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = db.users.find((u) => u.username.toLowerCase() === username);
      if (!user || !verifyPassword(password, user.passwordHash)) {
        return sendJson(res, 401, { error: "Invalid username or password." });
      }
      if (user.approvalStatus === "PENDING") {
        return sendJson(res, 403, { error: "Your account is pending confirmation by the System Administrator. Please wait for approval before signing in." });
      }
      if (user.approvalStatus === "REJECTED") {
        return sendJson(res, 403, { error: "Your registration request was declined by the System Administrator. Please contact your Admin." });
      }

      const otpEnabled = db.meta.loginOtpEnabled !== false;
      const targetEmail = resolveUserOtpEmail(db, user);
      if (otpEnabled && targetEmail) {
        // Purge expired challenges periodically
        const now = Date.now();
        for (const [cid, ch] of otpChallenges.entries()) {
          if (ch.expiresAt < now) otpChallenges.delete(cid);
        }
        const otpCode = String(crypto.randomInt(100000, 1000000));
        const sendRes = await sendLoginOtpEmail(db, user, targetEmail, otpCode);
        if (!sendRes.ok) {
          return sendJson(res, 502, { error: `Failed to send Login OTP email to ${maskEmailAddress(targetEmail)}: ${sendRes.error}` });
        }
        const challengeId = "otp-" + crypto.randomBytes(16).toString("hex");
        otpChallenges.set(challengeId, {
          userId: user.id,
          code: otpCode,
          email: targetEmail,
          expiresAt: now + 5 * 60 * 1000,
          attempts: 0,
          lastSentAt: now,
        });
        return sendJson(res, 200, {
          ok: true,
          otpRequired: true,
          challengeId,
          maskedEmail: maskEmailAddress(targetEmail),
          senderEmail: db.meta.senderEmail || "darrec8@gmail.com",
          expiresInSec: 300,
        });
      }

      const token = createToken(user.id);
      sessions.set(token, user.id);
      return sendJson(res, 200, {
        ok: true,
        token,
        user: sanitizeUser(user),
        otpSkippedNoEmail: otpEnabled && !targetEmail,
      });
    }

    // AUTH: Verify Login OTP (Step 2)
    if (method === "POST" && pathname === "/api/auth/verify-otp") {
      const body = await parseBody(req);
      const challengeId = String(body.challengeId || "").trim();
      const otp = String(body.otp || "").replace(/\s+/g, "").trim();
      const ch = otpChallenges.get(challengeId);
      if (!ch) {
        return sendJson(res, 401, { error: "OTP session not found or already used. Please sign in again." });
      }
      if (Date.now() > ch.expiresAt) {
        otpChallenges.delete(challengeId);
        return sendJson(res, 401, { error: "OTP code has expired. Please click Resend OTP or sign in again." });
      }
      if (!/^\d{6}$/.test(otp)) {
        return sendJson(res, 400, { error: "Please enter the 6-digit verification code sent to your email." });
      }
      const a = Buffer.from(otp, "utf8");
      const b = Buffer.from(ch.code, "utf8");
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        ch.attempts += 1;
        if (ch.attempts >= 5) {
          otpChallenges.delete(challengeId);
          return sendJson(res, 401, { error: "Too many incorrect OTP attempts. Please sign in again to request a new code." });
        }
        return sendJson(res, 401, { error: `Invalid OTP code. ${5 - ch.attempts} attempt(s) remaining.` });
      }
      const user = db.users.find((u) => u.id === ch.userId);
      otpChallenges.delete(challengeId);
      if (!user || user.approvalStatus !== "APPROVED") {
        return sendJson(res, 403, { error: "Account is no longer active." });
      }
      const token = createToken(user.id);
      sessions.set(token, user.id);
      return sendJson(res, 200, { ok: true, token, user: sanitizeUser(user) });
    }

    // AUTH: Resend Login OTP
    if (method === "POST" && pathname === "/api/auth/resend-otp") {
      const body = await parseBody(req);
      const challengeId = String(body.challengeId || "").trim();
      const ch = otpChallenges.get(challengeId);
      if (!ch) return sendJson(res, 404, { error: "OTP session expired. Please sign in again." });
      const now = Date.now();
      const waitSec = Math.ceil((20000 - (now - ch.lastSentAt)) / 1000);
      if (waitSec > 0) {
        return sendJson(res, 429, { error: `Please wait ${waitSec}s before requesting another OTP code.` });
      }
      const user = db.users.find((u) => u.id === ch.userId);
      if (!user) return sendJson(res, 404, { error: "Account not found." });
      const newCode = String(crypto.randomInt(100000, 1000000));
      const sendRes = await sendLoginOtpEmail(db, user, ch.email, newCode);
      if (!sendRes.ok) {
        return sendJson(res, 502, { error: `Failed to resend OTP email: ${sendRes.error}` });
      }
      ch.code = newCode;
      ch.attempts = 0;
      ch.lastSentAt = now;
      ch.expiresAt = now + 5 * 60 * 1000;
      return sendJson(res, 200, {
        ok: true,
        maskedEmail: maskEmailAddress(ch.email),
        expiresInSec: 300,
      });
    }

    // AUTH: Logout
    if (method === "POST" && pathname === "/api/auth/logout") {
      const authHeader = req.headers["authorization"] || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      if (token) sessions.delete(token);
      return sendJson(res, 200, { ok: true });
    }

    // AUTH: Current user check
    if (method === "GET" && pathname === "/api/auth/me") {
      const user = getAuthUser(req, db);
      if (!user) return sendJson(res, 401, { error: "Not authenticated" });
      return sendJson(res, 200, { ok: true, user: sanitizeUser(user) });
    }

    // ---- PROTECTED ROUTES (Require valid login session) ----
    const user = getAuthUser(req, db);
    if (!user) {
      return sendJson(res, 401, { error: "Authentication required. Please log in." });
    }

    // GET full state (excludes password hashes & raw SMTP password; incoming documents scoped per user role!)
    if (method === "GET" && pathname === "/api/state") {
      const sa = loadServiceAccount();
      const visibleIncoming = db.incoming.filter((doc) => canUserViewIncoming(user, doc));
      const visibleOutgoing = db.outgoing.filter((doc) => canUserViewOutgoing(user, doc));
      const visibleIssuances = (db.issuances || []).filter((rec) => canUserViewConcernedRecord(user, rec));
      const visibleMailings = (db.mailings || []).filter((rec) => canUserViewConcernedRecord(user, rec));
      const { smtpAppPassword: _hiddenSmtp, ...safeMeta } = db.meta;
      const hasSmtpPassword = !!(process.env.DAR_SMTP_APP_PASSWORD || _hiddenSmtp);
      return sendJson(res, 200, {
        meta: {
          ...safeMeta,
          senderEmail: safeMeta.senderEmail || "darrec8@gmail.com",
          hasSmtpPassword,
          emailMode: hasSmtpPassword ? "gmail_smtp" : safeMeta.appsScriptUrl ? "apps_script" : "mailto_only",
          driveMode: sa ? "service_account" : db.meta.appsScriptUrl ? "apps_script" : "local_only",
          serviceAccountEmail: sa ? sa.client_email : "",
          issuanceSheetSync: { ...issuanceAutoSyncState },
          mailingSheetSync: { ...mailingAutoSyncState },
        },
        divisions: db.divisions,
        darpoOffices: DARPO_PROVINCES,
        incoming: visibleIncoming,
        outgoing: visibleOutgoing,
        issuances: visibleIssuances,
        mailings: visibleMailings,
        user: sanitizeUser(user),
        users: user.role === "ADMIN" ? db.users.map(sanitizeUser) : [],
      });
    }

    // POST test sending email from darrec8@gmail.com
    if (method === "POST" && pathname === "/api/test-email") {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") {
        return sendJson(res, 403, { error: "Only Admin or Records can test email sending." });
      }
      const body = await parseBody(req);
      const senderEmail = String((db.meta && db.meta.senderEmail) || "darrec8@gmail.com").trim();
      const toEmail = String(body.toEmail || senderEmail).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
        return sendJson(res, 400, { ok: false, error: "Please provide a valid test recipient email address." });
      }
      const smtpAppPassword = String(process.env.DAR_SMTP_APP_PASSWORD || (db.meta && db.meta.smtpAppPassword) || "").trim();
      const subject = `[DAR RO VIII DTS] Email Connection Test (${getManilaNowString()})`;
      const plainBody = `This is a live test email from DAR RO VIII Document Tracking System.\nOfficial Sender: ${senderEmail}\nTested by: ${user.fullName}`;
      const htmlBody = `<div style="font-family:Segoe UI,Arial,sans-serif;padding:16px;border:1px solid #c8e6c9;border-radius:8px;"><h3 style="color:#0d3b1e;margin-top:0;">DAR RO VIII DTS — Email Test Successful</h3><p>Official Sender Email: <strong>${senderEmail}</strong></p><p>Tested by: ${user.fullName} at ${getManilaNowString()}</p></div>`;

      if (smtpAppPassword) {
        try {
          await sendEmailViaGmailSmtp({ senderEmail, appPassword: smtpAppPassword, toEmails: [toEmail], subject, plainBody, htmlBody });
          return sendJson(res, 200, { ok: true, mode: `Direct Gmail SMTP (${senderEmail})`, to: toEmail });
        } catch (err) {
          return sendJson(res, 502, { ok: false, error: err.message });
        }
      }
      if (db.meta && db.meta.appsScriptUrl) {
        const gasRes = await postToAppsScript(db.meta.appsScriptUrl, {
          action: "sendFurnishedCopyEmail",
          to: toEmail,
          replyTo: senderEmail,
          fromName: `DAR RO VIII Records Unit (${senderEmail})`,
          subject,
          body: plainBody,
          htmlBody,
        }, 25000);
        if (gasRes.synced && gasRes.json && gasRes.json.ok) {
          return sendJson(res, 200, { ok: true, mode: `Google Apps Script MailApp (Reply-To: ${senderEmail})`, to: toEmail });
        }
        return sendJson(res, 502, { ok: false, error: (gasRes.json && gasRes.json.error) || gasRes.reason || `To send directly from ${senderEmail}, paste a 16-character Gmail App Password for ${senderEmail} in Settings (or deploy Code.gs under ${senderEmail}).` });
      }
      return sendJson(res, 400, { ok: false, error: `Paste a 16-character Gmail App Password for ${senderEmail} in Settings to send emails directly from ${senderEmail}.` });
    }

    // POST test Google Drive upload connection
    if (method === "POST" && pathname === "/api/test-drive") {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") {
        return sendJson(res, 403, { error: "Only Admin or Records can test Google Drive connection." });
      }
      const folderId = db.meta.driveFolderId || "1JJwNkttWowxao0UIhR7k_hKXWI1L_eQC";
      const sa = loadServiceAccount();
      const samplePdf = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF");
      if (sa) {
        const up = await uploadPdfDirectToDrive(samplePdf, `DAR_RO8_DriveTest_${Date.now()}.pdf`, folderId, sa);
        return sendJson(res, 200, { ok: true, mode: "Google Drive API v3 (Service Account — up to 100 MB)", url: up.url });
      }
      if (db.meta.appsScriptUrl) {
        const gasRes = await postToAppsScript(db.meta.appsScriptUrl, {
          action: "uploadPdf",
          filename: `DAR_RO8_DriveTest_${Date.now()}.pdf`,
          controlNo: "TEST",
          folderId,
          base64: samplePdf.toString("base64"),
          uploadedBy: user.fullName,
        }, 30000);
        if (gasRes.synced && gasRes.json && gasRes.json.ok && gasRes.json.file) {
          return sendJson(res, 200, { ok: true, mode: "Google Apps Script Bridge (up to 35 MB)", url: gasRes.json.file.url });
        }
        return sendJson(res, 502, { ok: false, error: (gasRes.json && gasRes.json.error) || gasRes.reason || "Apps Script did not return a valid Drive response. Make sure Web App is deployed with 'Who has access: Anyone'." });
      }
      return sendJson(res, 400, { ok: false, error: "Google Drive upload is not connected yet. Either paste your deployed Google Apps Script Web App URL in Settings, or place google-credentials.json in the project folder." });
    }

    // POST upload PDF attachment (Box A Records or Admin; supports raw binary up to 100 MB & JSON base64)
    if (method === "POST" && pathname === "/api/upload-pdf") {
      if (user.role !== "RECORDS" && user.role !== "ADMIN") {
        return sendJson(res, 403, { error: "Only Records Section or Admin can upload Incoming PDF attachments." });
      }
      const contentType = String(req.headers["content-type"] || "").toLowerCase();
      let origName = "attachment.pdf";
      let controlNo = "";
      let docYear = "";
      let transaction = "";
      let subFolder = "";
      let buf = null;

      if (contentType.includes("application/pdf") || contentType.includes("application/octet-stream")) {
        origName = decodeURIComponent(String(req.headers["x-filename"] || "attachment.pdf")).trim();
        controlNo = decodeURIComponent(String(req.headers["x-control-no"] || "")).trim();
        docYear = decodeURIComponent(String(req.headers["x-doc-year"] || "")).trim();
        transaction = decodeURIComponent(String(req.headers["x-transaction"] || "")).trim();
        subFolder = decodeURIComponent(String(req.headers["x-subfolder"] || "")).trim();
        buf = await readRawBuffer(req, MAX_PDF_BYTES);
      } else {
        const body = await parseBody(req, 150 * 1024 * 1024);
        origName = String(body.filename || "attachment.pdf").trim();
        controlNo = String(body.controlNo || "").trim();
        docYear = String(body.docYear || "").trim();
        transaction = String(body.transaction || "").trim();
        subFolder = String(body.subFolder || "").trim();
        const base64Raw = String(body.base64 || "").replace(/^data:application\/pdf;base64,/i, "").trim();
        if (!base64Raw) return sendJson(res, 400, { error: "Empty PDF file data." });
        buf = Buffer.from(base64Raw, "base64");
      }

      if (!origName.toLowerCase().endsWith(".pdf")) {
        return sendJson(res, 400, { error: "Only PDF (.pdf) files are allowed." });
      }
      if (!buf || buf.length < 5 || buf.slice(0, 5).toString("ascii") !== "%PDF-") {
        return sendJson(res, 400, { error: "Uploaded file is not a valid PDF document." });
      }
      if (buf.length > MAX_PDF_BYTES) {
        return sendJson(res, 400, { error: "PDF exceeds maximum allowed size of 100 MB." });
      }

      const folderSegments = resolveUploadFolderSegments(docYear, transaction, subFolder, controlNo);
      const folderPath = folderSegments.join(" / ");
      const safeCtrl = String(controlNo || "DOC").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);
      const baseNoExt = path.basename(origName, path.extname(origName)).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 72);
      const fileOnlyName = `${safeCtrl}_${Date.now()}_${baseNoExt || "document"}.pdf`;
      const localSubDir = path.join(UPLOADS_DIR, ...folderSegments);
      fs.mkdirSync(localSubDir, { recursive: true });
      fs.writeFileSync(path.join(localSubDir, fileOnlyName), buf);
      const storedName = [...folderSegments, fileOnlyName].join("/");
      const encodedLocalPath = storedName.split("/").map(encodeURIComponent).join("/");

      // Upload to Google Drive folder (Year / Transaction / SubFolder)
      const folderId = db.meta.driveFolderId || "1JJwNkttWowxao0UIhR7k_hKXWI1L_eQC";
      const driveFileName = `${controlNo ? controlNo + "_" : ""}${origName}`;
      let driveUrl = "";
      let driveFileId = "";
      let driveFolderUrl = db.meta.driveFolderUrl || "https://drive.google.com/drive/folders/1JJwNkttWowxao0UIhR7k_hKXWI1L_eQC?usp=sharing";
      let driveSynced = false;
      let driveNote = "";
      const sa = loadServiceAccount();

      if (sa) {
        try {
          const up = await uploadPdfDirectToDrive(buf, driveFileName, folderId, sa, folderSegments);
          driveUrl = up.url;
          driveFileId = up.fileId;
          if (up.folderUrl) driveFolderUrl = up.folderUrl;
          driveSynced = true;
        } catch (err) {
          driveNote = `Saved locally (Google Drive upload error: ${err.message})`;
        }
      } else if (db.meta.appsScriptUrl) {
        if (buf.length <= MAX_GAS_PDF_BYTES) {
          const gasRes = await postToAppsScript(
            db.meta.appsScriptUrl,
            {
              action: "uploadPdf",
              filename: origName,
              controlNo,
              docYear: folderSegments[0],
              transaction: folderSegments[1],
              subFolder: folderSegments[2] || "",
              folderId,
              base64: buf.toString("base64"),
              uploadedBy: user.fullName,
            },
            60000
          );
          if (gasRes.synced && gasRes.json && gasRes.json.ok && gasRes.json.file) {
            driveUrl = gasRes.json.file.url || "";
            driveFileId = gasRes.json.file.driveFileId || gasRes.json.file.storedName || "";
            if (gasRes.json.file.driveFolderUrl) driveFolderUrl = gasRes.json.file.driveFolderUrl;
            driveSynced = !!driveUrl;
          } else {
            driveNote = `Saved locally (Apps Script Drive sync error: ${(gasRes.json && gasRes.json.error) || gasRes.reason || "Check Web App deployment"})`;
          }
        } else {
          driveNote = "Saved locally (>35 MB exceeds Apps Script relay limit; add google-credentials.json for 100 MB direct Drive upload).";
        }
      } else {
        driveNote = "Saved locally — connect Google Apps Script URL or google-credentials.json in Settings to auto-upload to Google Drive.";
      }

      return sendJson(res, 200, {
        ok: true,
        file: {
          name: origName,
          storedName,
          folderPath,
          url: driveUrl || `/uploads/${encodedLocalPath}`,
          localUrl: `/uploads/${encodedLocalPath}`,
          driveUrl,
          driveFileId,
          driveFolderUrl,
          driveSynced,
          driveNote,
          size: buf.length,
          uploadedAt: getManilaNowString(),
          uploadedBy: user.fullName,
        },
      });
    }

    // GET next control number (Incoming shared annual sequence; Outgoing User No. per office; Outgoing DAR8 Rec. No. from last assigned Rec. No.)
    if (method === "GET" && pathname === "/api/next-number") {
      const rawType = urlObj.searchParams.get("type") || "incoming";
      const dateStr = urlObj.searchParams.get("date") || "";
      const category = urlObj.searchParams.get("category") || "External";
      const yearOverride = urlObj.searchParams.get("year") || "";
      const divisionParam = urlObj.searchParams.get("division") || "";
      if (rawType === "outgoing-user") {
        const prefix = buildOutgoingUserPrefix(user, divisionParam || user.division);
        return sendJson(res, 200, { number: generateNextOutgoingUserNo(db.outgoing, prefix, dateStr, yearOverride) });
      }
      if (rawType === "issuance") {
        return sendJson(res, 200, { number: generateNextIssuanceNo(db.issuances, category, dateStr, yearOverride) });
      }
      if (rawType === "mailing") {
        return sendJson(res, 200, { number: generateNextMailingNo(db.mailings, category, dateStr, yearOverride) });
      }
      const type = rawType === "outgoing" ? "outgoing" : "incoming";
      const list = type === "incoming" ? db.incoming : db.outgoing;
      return sendJson(res, 200, { number: generateNextControlNo(type, list, dateStr, category, yearOverride) });
    }

    // POST /api/incoming/send-email (Records or Admin emails Box E Reply / Action Taken + PDF to selected recipients)
    if (method === "POST" && pathname === "/api/incoming/send-email") {
      if (user.role !== "RECORDS" && user.role !== "ADMIN") {
        return sendJson(res, 403, { error: "Only Records Section or Admin can send Incoming Box E reply emails." });
      }
      const body = await parseBody(req);
      const ctrl = String(body.controlNo || "").trim();
      const idx = db.incoming.findIndex((r) => r.controlNo === ctrl);
      if (idx < 0) return sendJson(res, 404, { error: "Incoming document not found. Please save the document first." });
      const rec = { ...db.incoming[idx] };
      if (body.boxERecipients !== undefined) rec.boxERecipients = normalizeFurnishedCopy(body.boxERecipients);
      if (body.replyAttachmentFile !== undefined) rec.replyAttachmentFile = body.replyAttachmentFile || null;
      const emailDispatch = await dispatchIncomingReplyEmails(db, rec, user);
      rec.boxEEmailLog = emailDispatch;
      db.incoming[idx] = rec;
      writeDb(db);
      return sendJson(res, 200, { ok: true, emailDispatch, record: rec });
    }

    // POST / PUT incoming (STRICT BOX A-E RBAC + AUTOMATED STATUS!)
    if ((method === "POST" || method === "PUT") && pathname === "/api/incoming") {
      const body = await parseBody(req);
      const reqControlNo = String(body.controlNo || "").trim();
      const idx = reqControlNo ? db.incoming.findIndex((r) => r.controlNo === reqControlNo) : -1;
      const isNew = idx < 0;

      if (isNew) {
        if (user.role !== "RECORDS" && user.role !== "ADMIN") {
          return sendJson(res, 403, { error: "Only the Records Section account can encode new Incoming documents (Box A)." });
        }
        const docCategory = String(body.docCategory || "").trim().toLowerCase() === "internal" ? "Internal" : "External";
        const controlNo = reqControlNo || generateNextControlNo("incoming", db.incoming, "", docCategory);
        const record = {
          controlNo,
          docCategory,
          dateReceived: "", timeReceived: "", receivedBy: user.fullName,
          senderName: "", senderOffice: "", docType: "", thru: "",
          dateOfDoc: "", refNo: "NONE", subject: "", attachments: "NO ATTACHMENT",
          rdDateTime: "", rdReceivedBy: "", rdInstructionsTo: "", rdInstructions: "", rdTimeFrame: "",
          ardDateTime: "", ardReceivedBy: "", ardInstructionsTo: "", ardInstructions: "", ardTimeFrame: "",
          assignedDivision: "", divDateTime: "", divReceivedBy: "", divActionTaken: "",
          divChiefName: "", dateActed: "", transmissionMode: "", addressedTo: "", pouchCC: "",
          recordsDispatchMode: "", dispatchDetails: "", returnedAs: "", dateReturnedBy: "",
          archived: false,
          history: [],
        };
        // Only apply Box A fields (plus Box E if Admin/Records included them on creation)
        const allowedCreate = user.role === "ADMIN"
          ? [...BOX_A_FIELDS, ...BOX_B_FIELDS, ...BOX_C_FIELDS, ...BOX_D_FIELDS, ...BOX_E_FIELDS]
          : [...BOX_A_FIELDS];
        allowedCreate.forEach((f) => {
          if (body[f] !== undefined && f !== "controlNo") record[f] = body[f];
        });
        record.assignedDivision = resolveAssignedDivision(record);
        record.status = computeIncomingAutoStatus(record);
        record.history.push({
          at: getManilaNowString(),
          by: user.fullName,
          role: user.role,
          box: "Box A",
          status: record.status,
          note: "Encoded incoming document in Box A",
        });

        db.incoming.unshift(record);
        writeDb(db);
        const sync = await postToAppsScript(db.meta.appsScriptUrl, { action: "upsertIncoming", record });
        return sendJson(res, 200, { ok: true, record, sync });
      }

      // Updating existing incoming document — enforce per-Box RBAC!
      const existing = { ...db.incoming[idx], history: [...(db.incoming[idx].history || [])] };
      const perms = getBoxPermissions(user, existing);
      const allowedFields = [];
      const editedBoxes = [];

      if (perms.boxA) { allowedFields.push(...BOX_A_FIELDS); editedBoxes.push("Box A"); }
      if (perms.boxB) { allowedFields.push(...BOX_B_FIELDS); editedBoxes.push("Box B"); }
      if (perms.boxC) { allowedFields.push(...BOX_C_FIELDS); editedBoxes.push("Box C"); }
      if (perms.boxD) { allowedFields.push(...BOX_D_FIELDS); editedBoxes.push("Box D"); }
      if (perms.boxE) { allowedFields.push(...BOX_E_FIELDS); editedBoxes.push("Box E"); }

      if (allowedFields.length === 0) {
        const assigned = resolveAssignedDivision(existing) || "unassigned";
        return sendJson(res, 403, {
          error: `Your account (${user.role} — ${user.division}) does not have edit permission for this document (Assigned Division: ${assigned}).`,
        });
      }

      const prevStatus = existing.status;
      allowedFields.forEach((f) => {
        if (f === "controlNo") return;
        if (body[f] !== undefined) {
          existing[f] = f === "boxERecipients" ? normalizeFurnishedCopy(body[f]) : body[f];
        }
      });
      if (perms.boxE && (body.dateReturnedAt !== undefined || body.releasedBy !== undefined)) {
        const dtPart = String(existing.dateReturnedAt || "").trim();
        const byPart = String(existing.releasedBy || "").trim();
        if (dtPart || byPart) {
          existing.dateReturnedBy = [dtPart, byPart].filter(Boolean).join(" / ");
        }
      }

      // Automatically synchronize Assigned Division when Box B or Box C routes the document!
      existing.assignedDivision = resolveAssignedDivision(existing);

      // Automatically compute Current Tracking Status from Box A through Box E!
      existing.status = computeIncomingAutoStatus(existing);

      // Auto-email Box E recipients when Records dispatches via Email and hasn't emailed yet
      let emailDispatch = null;
      if (
        perms.boxE &&
        Array.isArray(existing.boxERecipients) &&
        existing.boxERecipients.length > 0 &&
        String(existing.recordsDispatchMode || "").trim() === "Email" &&
        !(existing.boxEEmailLog && existing.boxEEmailLog.sent)
      ) {
        emailDispatch = await dispatchIncomingReplyEmails(db, existing, user);
        existing.boxEEmailLog = emailDispatch;
      }

      existing.history.push({
        at: getManilaNowString(),
        by: user.fullName,
        role: user.role,
        box: editedBoxes.join(" / "),
        status: existing.status,
        note: prevStatus !== existing.status ? `Status auto-updated: ${prevStatus} → ${existing.status}` : `Updated ${editedBoxes.join(", ")}`,
      });

      db.incoming[idx] = existing;
      writeDb(db);
      const sync = await postToAppsScript(db.meta.appsScriptUrl, { action: "upsertIncoming", record: existing });
      return sendJson(res, 200, { ok: true, record: existing, sync, emailDispatch });
    }

    // DELETE incoming (Records or Admin only)
    if (method === "DELETE" && pathname.startsWith("/api/incoming/")) {
      if (user.role !== "RECORDS" && user.role !== "ADMIN") {
        return sendJson(res, 403, { error: "Only Records Section or Admin can delete incoming documents." });
      }
      const id = decodeURIComponent(pathname.slice("/api/incoming/".length));
      const before = db.incoming.length;
      db.incoming = db.incoming.filter((r) => r.controlNo !== id);
      writeDb(db);
      const sync = await postToAppsScript(db.meta.appsScriptUrl, { action: "deleteIncoming", controlNo: id });
      return sendJson(res, 200, { ok: true, deleted: before - db.incoming.length, sync });
    }

    // POST /api/outgoing/send-email (Records or Admin triggers Furnished Copy email notifications)
    if (method === "POST" && pathname === "/api/outgoing/send-email") {
      if (user.role !== "RECORDS" && user.role !== "ADMIN") {
        return sendJson(res, 403, { error: "Only Records Section or Admin can send Furnished Copy email notifications." });
      }
      const body = await parseBody(req);
      const key = String(body.id || body.recNo || body.userDocNo || "").trim();
      const idx = db.outgoing.findIndex((r) => r.id === key || (r.recNo && r.recNo === key) || r.userDocNo === key);
      if (idx < 0) return sendJson(res, 404, { error: "Outgoing document not found. Please save the document first." });
      const rec = { ...db.outgoing[idx] };
      if (body.furnishedCopy !== undefined) rec.furnishedCopy = normalizeFurnishedCopy(body.furnishedCopy);
      if (body.attachmentFile !== undefined) rec.attachmentFile = body.attachmentFile || null;
      const emailDispatch = await dispatchFurnishedCopyEmails(db, rec, user);
      rec.furnishedCopyEmailLog = emailDispatch;
      db.outgoing[idx] = rec;
      writeDb(db);
      return sendJson(res, 200, { ok: true, emailDispatch, record: rec });
    }

    // POST / PUT outgoing
    // - Box A & B (including Mode of Transmission, Recipient, Furnished Copy) & Box C: ALL users
    // - Box D (Records Release & DAR8 Rec. No.) & Box E (Returned to Originating Office — AFTER Release): Records & Admin ONLY!
    if ((method === "POST" || method === "PUT") && pathname === "/api/outgoing") {
      const body = await parseBody(req);
      const isRecordsOrAdmin = user.role === "RECORDS" || user.role === "ADMIN";
      const reqId = String(body.id || "").trim();
      const reqRecNo = String(body.recNo || "").trim();
      const reqUserDocNo = String(body.userDocNo || "").trim();

      let idx = -1;
      if (reqId) idx = db.outgoing.findIndex((r) => r.id === reqId);
      if (idx < 0 && reqRecNo) idx = db.outgoing.findIndex((r) => r.recNo === reqRecNo);
      if (idx < 0 && reqUserDocNo) idx = db.outgoing.findIndex((r) => r.userDocNo === reqUserDocNo);
      const isNew = idx < 0;

      if (isNew) {
        const prefix = buildOutgoingUserPrefix(user, body.originatingDivision || user.division);
        const userDocNo = reqUserDocNo || generateNextOutgoingUserNo(db.outgoing, prefix, body.dateOriginated);
        const autoUserStatus = String(body.approvedBy || "").trim()
          ? "For Approval"
          : String(body.counterSignBy || "").trim()
          ? "For Counter-Signature"
          : "Draft / Originating";
        const record = {
          ...body,
          id: "out-" + crypto.randomBytes(6).toString("hex"),
          userDocNo,
          recNo: "",
          furnishedCopy: normalizeFurnishedCopy(body.furnishedCopy),
          createdByUserId: user.id,
          createdByUsername: user.username,
          recordsDateReceived: "",
          recordsTimeReceived: "",
          recordsReceivedBy: "",
          finalDispatchMode: "",
          dispatchDetails: "",
          dateDispatched: "",
          returnedToOffice: "",
          dateReceivedBack: "",
          attachmentFile: isRecordsOrAdmin ? (body.attachmentFile || null) : null,
          status: isRecordsOrAdmin ? String(body.status || autoUserStatus) : autoUserStatus,
        };
        delete record.assignDar8RecNo;

        let emailDispatch = null;
        if (isRecordsOrAdmin) {
          [...OUT_BOX_D_RECORDS_FIELDS, ...OUT_BOX_E_RETURN_FIELDS].forEach((f) => {
            if (body[f] !== undefined) record[f] = String(body[f] || "").trim();
          });
          const hasBoxDActivity =
            body.assignDar8RecNo === true ||
            !!(record.recordsDateReceived || record.recordsReceivedBy || record.finalDispatchMode || record.dateDispatched) ||
            record.status === "Received by Records" ||
            record.status === "Dispatched / Released";
          if (!record.recNo && hasBoxDActivity) {
            record.recNo = generateNextControlNo("outgoing", db.outgoing, record.recordsDateReceived || record.dateOriginated);
          }
          if (record.recNo && db.outgoing.some((r) => r.recNo === record.recNo)) {
            return sendJson(res, 409, { error: `DAR8 Rec. No. "${record.recNo}" is already assigned to another outgoing document.` });
          }
          const isReleased = record.status === "Dispatched / Released" || !!record.dateDispatched;
          if (isReleased && record.furnishedCopy.length > 0) {
            emailDispatch = await dispatchFurnishedCopyEmails(db, record, user);
            record.furnishedCopyEmailLog = emailDispatch;
          }
        }

        db.outgoing.unshift(record);
        writeDb(db);
        const sync = await postToAppsScript(db.meta.appsScriptUrl, { action: "upsertOutgoing", record });
        return sendJson(res, 200, { ok: true, record, sync, emailDispatch });
      }

      // Updating existing outgoing document
      const existing = { ...db.outgoing[idx] };
      const merged = {
        ...existing,
        ...body,
        id: existing.id,
        userDocNo: existing.userDocNo || reqUserDocNo,
        furnishedCopy: body.furnishedCopy !== undefined ? normalizeFurnishedCopy(body.furnishedCopy) : normalizeFurnishedCopy(existing.furnishedCopy),
      };
      delete merged.assignDar8RecNo;

      let emailDispatch = null;
      if (!isRecordsOrAdmin) {
        // Non-Records users can ONLY edit Box A & B (incl. Recipient & Furnished Copy) and Box C — lock Box D (Records Release) & Box E (Return)!
        [...OUT_BOX_D_RECORDS_FIELDS, ...OUT_BOX_E_RETURN_FIELDS].forEach((f) => {
          merged[f] = existing[f] || "";
        });
        merged.attachmentFile = existing.attachmentFile || null;
        if (!["Received by Records", "Dispatched / Released", "Returned to Originating Office", "Archived"].includes(existing.status)) {
          merged.status = String(merged.approvedBy || "").trim()
            ? "For Approval"
            : String(merged.counterSignBy || "").trim()
            ? "For Counter-Signature"
            : "Draft / Originating";
        } else {
          merged.status = existing.status;
        }
      } else {
        const hasBoxDActivity =
          body.assignDar8RecNo === true ||
          !!(String(merged.recordsDateReceived || "").trim() || String(merged.recordsReceivedBy || "").trim() || String(merged.finalDispatchMode || "").trim() || String(merged.dateDispatched || "").trim()) ||
          merged.status === "Received by Records" ||
          merged.status === "Dispatched / Released";
        if (!String(merged.recNo || "").trim() && hasBoxDActivity) {
          merged.recNo = generateNextControlNo("outgoing", db.outgoing, merged.recordsDateReceived || merged.dateOriginated);
        }
        const trimmedRec = String(merged.recNo || "").trim();
        merged.recNo = trimmedRec;
        if (trimmedRec && db.outgoing.some((r) => r.id !== existing.id && r.recNo === trimmedRec)) {
          return sendJson(res, 409, { error: `DAR8 Rec. No. "${trimmedRec}" is already assigned to another outgoing document.` });
        }
        const wasReleased = existing.status === "Dispatched / Released" || !!String(existing.dateDispatched || "").trim();
        const isNowReleased = merged.status === "Dispatched / Released" || !!String(merged.dateDispatched || "").trim();
        if (isNowReleased && (!wasReleased || !(existing.furnishedCopyEmailLog && existing.furnishedCopyEmailLog.sent)) && merged.furnishedCopy.length > 0) {
          emailDispatch = await dispatchFurnishedCopyEmails(db, merged, user);
          merged.furnishedCopyEmailLog = emailDispatch;
        }
      }

      db.outgoing[idx] = merged;
      writeDb(db);
      const sync = await postToAppsScript(db.meta.appsScriptUrl, { action: "upsertOutgoing", record: merged });
      return sendJson(res, 200, { ok: true, record: merged, sync, emailDispatch });
    }

    // DELETE outgoing
    if (method === "DELETE" && pathname.startsWith("/api/outgoing/")) {
      if (user.role !== "RECORDS" && user.role !== "ADMIN") {
        return sendJson(res, 403, { error: "Only Records Section or Admin can delete outgoing documents." });
      }
      const id = decodeURIComponent(pathname.slice("/api/outgoing/".length));
      const target = db.outgoing.find((r) => r.id === id || r.recNo === id || r.userDocNo === id);
      const before = db.outgoing.length;
      db.outgoing = db.outgoing.filter((r) => r.id !== id && r.recNo !== id && r.userDocNo !== id);
      writeDb(db);
      const sync = target && target.recNo
        ? await postToAppsScript(db.meta.appsScriptUrl, { action: "deleteOutgoing", recNo: target.recNo })
        : { synced: false };
      return sendJson(res, 200, { ok: true, deleted: before - db.outgoing.length, sync });
    }

    // POST /api/issuances/send-email — Email selected RO VIII / DARPO Recipient offices for an Issuance
    if (method === "POST" && pathname === "/api/issuances/send-email") {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") {
        return sendJson(res, 403, { error: "View-only access: Only System Admin or Records Section can send Issuance emails." });
      }
      const body = await parseBody(req);
      const targetId = String(body.id || "").trim();
      const idx = (db.issuances || []).findIndex((r) => r.id === targetId);
      if (idx < 0) return sendJson(res, 404, { error: "Issuance record not found. Save the Issuance first before sending emails." });
      const rec = db.issuances[idx];
      if (body.recipients !== undefined) {
        rec.recipients = normalizeFurnishedCopy(body.recipients);
      }
      if (body.attachmentFile !== undefined) {
        rec.attachmentFile = body.attachmentFile || rec.attachmentFile || null;
      }
      const emailDispatch = await dispatchIssuanceEmails(db, rec, user);
      rec.emailDispatchLog = emailDispatch;
      db.issuances[idx] = rec;
      writeDb(db);
      return sendJson(res, 200, { ok: true, record: rec, emailDispatch });
    }

    // POST /api/issuances/sync-sheets — Push all Issuance sub-categories to their own Google Sheet tabs
    if (method === "POST" && pathname === "/api/issuances/sync-sheets") {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") {
        return sendJson(res, 403, { error: "View-only access: Only System Admin or Records Section can sync Issuances to Google Sheets." });
      }
      if (!db.meta || !db.meta.appsScriptUrl) {
        return sendJson(res, 400, { error: "Google Apps Script Web App URL is not configured in Settings." });
      }
      const out = await syncAllIssuancesToSheet(db);
      return sendJson(res, 200, out);
    }

    // POST / PUT / DELETE Issuances (ALI Case, Memo, Notice, & Admin custom sub-categories)
    if ((method === "POST" || method === "PUT") && pathname === "/api/issuances") {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") {
        return sendJson(res, 403, { error: "View-only access: Only System Admin or Records Section can encode or edit Issuances." });
      }
      const body = await parseBody(req);
      const reqId = String(body.id || "").trim();
      const category = String(body.category || (db.meta.issuanceCategories && db.meta.issuanceCategories[0]) || "Memo").trim();
      const dateIssued = String(body.dateIssued || "").trim();
      const subject = String(body.subject || "").trim();
      if (!subject) return sendJson(res, 400, { error: "Issuance Subject / Title is required." });

      const rawCustom = body.customFields && typeof body.customFields === "object" && !Array.isArray(body.customFields) ? body.customFields : null;
      const cleanCustomFields = (src) => {
        const out = {};
        Object.entries(src || {}).forEach(([k, v]) => {
          const ck = String(k || "").trim();
          if (ck) out[ck] = String(v ?? "").trim();
        });
        return out;
      };

      let idx = reqId ? db.issuances.findIndex((r) => r.id === reqId) : -1;
      if (idx < 0) {
        const issuanceNo = String(body.issuanceNo || "").trim() || generateNextIssuanceNo(db.issuances, category, dateIssued);
        const rec = {
          id: "iss-" + crypto.randomBytes(6).toString("hex"),
          issuanceNo,
          category,
          dateIssued,
          originatingDivision: String(body.originatingDivision || user.division || "RD").trim(),
          issuedBy: String(body.issuedBy || "").trim(),
          refNo: String(body.refNo || "").trim(),
          subject,
          remarks: String(body.remarks || "").trim(),
          status: String(body.status || "Issued / Effective").trim(),
          recipients: normalizeFurnishedCopy(body.recipients),
          customFields: cleanCustomFields(rawCustom),
          attachmentFile: body.attachmentFile || null,
          createdBy: user.fullName,
          createdByUserId: user.id,
          createdAt: getManilaNowString(),
          updatedAt: getManilaNowString(),
        };
        db.issuances.unshift(rec);
        writeDb(db);
        const sync = await syncIssuanceCategoryToSheet(db, category);
        return sendJson(res, 200, { ok: true, record: rec, sync });
      }

      const existing = db.issuances[idx];
      const prevCategory = existing.category;
      const updated = {
        ...existing,
        issuanceNo: String(body.issuanceNo || existing.issuanceNo).trim(),
        category,
        dateIssued,
        originatingDivision: String(body.originatingDivision ?? existing.originatingDivision ?? "").trim(),
        issuedBy: String(body.issuedBy ?? existing.issuedBy ?? "").trim(),
        refNo: String(body.refNo ?? existing.refNo ?? "").trim(),
        subject,
        remarks: String(body.remarks ?? existing.remarks ?? "").trim(),
        status: String(body.status || existing.status || "Issued / Effective").trim(),
        recipients: body.recipients !== undefined ? normalizeFurnishedCopy(body.recipients) : (existing.recipients || []),
        customFields: rawCustom !== null ? cleanCustomFields(rawCustom) : (existing.customFields || {}),
        attachmentFile: body.attachmentFile !== undefined ? body.attachmentFile : existing.attachmentFile || null,
        updatedBy: user.fullName,
        updatedAt: getManilaNowString(),
      };
      db.issuances[idx] = updated;
      writeDb(db);
      const sync = await syncIssuanceCategoryToSheet(db, category);
      if (prevCategory && prevCategory !== category) {
        await syncIssuanceCategoryToSheet(db, prevCategory);
      }
      return sendJson(res, 200, { ok: true, record: updated, sync });
    }

    if (method === "DELETE" && pathname.startsWith("/api/issuances/")) {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") {
        return sendJson(res, 403, { error: "Only System Admin or Records Section can delete issuances." });
      }
      const id = decodeURIComponent(pathname.slice("/api/issuances/".length));
      const target = db.issuances.find((r) => r.id === id || r.issuanceNo === id);
      const before = db.issuances.length;
      db.issuances = db.issuances.filter((r) => r.id !== id && r.issuanceNo !== id);
      writeDb(db);
      const sync = target && target.category
        ? await syncIssuanceCategoryToSheet(db, target.category)
        : { synced: false };
      return sendJson(res, 200, { ok: true, deleted: before - db.issuances.length, sync });
    }

    // POST /api/mailings/sync-sheets — Push all Mailing Process couriers to separate Google Sheet tabs
    if (method === "POST" && pathname === "/api/mailings/sync-sheets") {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") {
        return sendJson(res, 403, { error: "View-only access: Only System Admin or Records Section can sync Mailing Process to Google Sheets." });
      }
      if (!db.meta || !db.meta.appsScriptUrl) {
        return sendJson(res, 400, { error: "Google Apps Script Web App URL is not configured in Settings." });
      }
      const out = await syncAllMailingsToSheet(db);
      return sendJson(res, 200, out);
    }

    // POST / PUT / DELETE Mailing Process (PhilPost, JRS & custom couriers)
    if ((method === "POST" || method === "PUT") && pathname === "/api/mailings") {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") {
        return sendJson(res, 403, { error: "View-only access: Only System Admin or Records Section can encode or edit Mailing Process records." });
      }
      const body = await parseBody(req);
      const reqId = String(body.id || "").trim();
      const courier = String(body.courier || (db.meta.mailingCouriers && db.meta.mailingCouriers[0]) || "PhilPost").trim();
      const dateMailed = String(body.dateMailed || "").trim();
      const docType = String(body.docType || "").trim();
      const subject = String(body.subject || "").trim();

      const rawAddressees = Array.isArray(body.addressees) ? body.addressees : [];
      let addressees = rawAddressees
        .map((a) => ({
          name: String((a && a.name) || "").trim(),
          trackingNo: String((a && a.trackingNo) || "").trim(),
          dateReceived: String((a && a.dateReceived) || "").trim(),
        }))
        .filter((a) => a.name || a.trackingNo || a.dateReceived);
      if (!addressees.length && String(body.recipientName || "").trim()) {
        addressees = [{
          name: String(body.recipientName || "").trim(),
          trackingNo: String(body.trackingNo || "").trim(),
          dateReceived: String(body.dateReceived || "").trim(),
        }];
      }
      const recipientName = addressees.map((a) => a.name).filter(Boolean).join("\n");
      const trackingNo = addressees.map((a) => a.trackingNo).filter(Boolean).join("\n");
      const dateReceived = addressees.map((a) => a.dateReceived).filter(Boolean).join("\n");
      if (!recipientName) return sendJson(res, 400, { error: "At least one Addressee / Recipient Name is required." });
      if (!subject) return sendJson(res, 400, { error: "Subject / Particulars is required." });

      let idx = reqId ? db.mailings.findIndex((r) => r.id === reqId) : -1;
      if (idx < 0) {
        const mailingNo = String(body.mailingNo || "").trim() || generateNextMailingNo(db.mailings, courier, dateMailed);
        const rec = {
          id: "mail-" + crypto.randomBytes(6).toString("hex"),
          mailingNo,
          courier,
          docType,
          dateMailed,
          addressees,
          trackingNo,
          docRefNo: String(body.docRefNo || "").trim(),
          recipientName,
          province: String(body.province || "").trim(),
          recipientAddress: String(body.recipientAddress || "").trim(),
          subject,
          originatingDivision: String(body.originatingDivision || user.division || "STO - Records").trim(),
          mailedBy: String(body.mailedBy || user.fullName || "").trim(),
          amount: String(body.amount || "").trim(),
          status: String(body.status || "Mailed / In Transit").trim(),
          dateReceived,
          receivedBy: String(body.receivedBy || "").trim(),
          remarks: String(body.remarks || "").trim(),
          recipients: normalizeFurnishedCopy(body.recipients),
          attachmentFile: body.attachmentFile || null,
          createdBy: user.fullName,
          createdByUserId: user.id,
          createdAt: getManilaNowString(),
          updatedAt: getManilaNowString(),
        };
        db.mailings.unshift(rec);
        writeDb(db);
        const sync = await syncMailingCourierToSheet(db, courier);
        return sendJson(res, 200, { ok: true, record: rec, sync });
      }

      const existing = db.mailings[idx];
      const prevCourier = existing.courier;
      const updated = {
        ...existing,
        mailingNo: String(body.mailingNo || existing.mailingNo).trim(),
        courier,
        docType: body.docType !== undefined ? docType : (existing.docType || ""),
        dateMailed,
        addressees,
        trackingNo,
        docRefNo: String(body.docRefNo ?? existing.docRefNo ?? "").trim(),
        recipientName,
        province: String(body.province ?? existing.province ?? "").trim(),
        recipientAddress: String(body.recipientAddress ?? existing.recipientAddress ?? "").trim(),
        subject,
        originatingDivision: String(body.originatingDivision ?? existing.originatingDivision ?? "").trim(),
        mailedBy: String(body.mailedBy ?? existing.mailedBy ?? "").trim(),
        amount: String(body.amount ?? existing.amount ?? "").trim(),
        status: String(body.status || existing.status || "Mailed / In Transit").trim(),
        dateReceived,
        receivedBy: String(body.receivedBy ?? existing.receivedBy ?? "").trim(),
        remarks: String(body.remarks ?? existing.remarks ?? "").trim(),
        recipients: body.recipients !== undefined ? normalizeFurnishedCopy(body.recipients) : (existing.recipients || []),
        attachmentFile: body.attachmentFile !== undefined ? body.attachmentFile : existing.attachmentFile || null,
        updatedBy: user.fullName,
        updatedAt: getManilaNowString(),
      };
      db.mailings[idx] = updated;
      writeDb(db);
      const sync = await syncMailingCourierToSheet(db, courier);
      if (prevCourier && prevCourier !== courier) {
        await syncMailingCourierToSheet(db, prevCourier);
      }
      return sendJson(res, 200, { ok: true, record: updated, sync });
    }

    if (method === "DELETE" && pathname.startsWith("/api/mailings/")) {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") {
        return sendJson(res, 403, { error: "Only System Admin or Records Section can delete mailing records." });
      }
      const id = decodeURIComponent(pathname.slice("/api/mailings/".length));
      const target = db.mailings.find((r) => r.id === id || r.mailingNo === id);
      const before = db.mailings.length;
      db.mailings = db.mailings.filter((r) => r.id !== id && r.mailingNo !== id);
      writeDb(db);
      const sync = target && target.courier
        ? await syncMailingCourierToSheet(db, target.courier)
        : { synced: false };
      return sendJson(res, 200, { ok: true, deleted: before - db.mailings.length, sync });
    }

    // ADMIN: Set / Update User Account Email (for Login OTP)
    if (method === "PUT" && pathname.startsWith("/api/users/") && pathname.endsWith("/email")) {
      if (user.role !== "ADMIN") return sendJson(res, 403, { error: "Admin access required." });
      const uid = decodeURIComponent(pathname.slice("/api/users/".length, -"/email".length));
      const body = await parseBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return sendJson(res, 400, { error: "Please enter a valid email address." });
      }
      const target = db.users.find((u) => u.id === uid);
      if (!target) return sendJson(res, 404, { error: "User account not found." });
      target.email = email;
      writeDb(db);
      return sendJson(res, 200, { ok: true, user: sanitizeUser(target) });
    }

    // ADMIN: Approve / Reject user account
    if (method === "PUT" && pathname.startsWith("/api/users/") && pathname.endsWith("/status")) {
      if (user.role !== "ADMIN") return sendJson(res, 403, { error: "Admin access required." });
      const uid = decodeURIComponent(pathname.slice("/api/users/".length, -"/status".length));
      if (uid === user.id) return sendJson(res, 400, { error: "You cannot change the approval status of your own admin account." });
      const body = await parseBody(req);
      const nextStatus = String(body.approvalStatus || "").toUpperCase();
      if (!["APPROVED", "REJECTED", "PENDING"].includes(nextStatus)) {
        return sendJson(res, 400, { error: "Invalid approval status." });
      }
      const target = db.users.find((u) => u.id === uid);
      if (!target) return sendJson(res, 404, { error: "User account not found." });
      target.approvalStatus = nextStatus;
      target.approvedBy = user.fullName;
      target.approvedAt = getManilaNowString();
      if (nextStatus !== "APPROVED") {
        // Revoke any active sessions belonging to this user
        for (const [tok, sessUid] of sessions.entries()) {
          if (sessUid === uid) sessions.delete(tok);
        }
      }
      writeDb(db);
      let emailNotification = null;
      if (nextStatus === "APPROVED" || nextStatus === "REJECTED") {
        emailNotification = await sendAccountStatusEmail(db, target, nextStatus, user);
      }
      return sendJson(res, 200, { ok: true, user: sanitizeUser(target), emailNotification });
    }

    // ADMIN: Delete user
    if (method === "DELETE" && pathname.startsWith("/api/users/")) {
      if (user.role !== "ADMIN") return sendJson(res, 403, { error: "Admin access required." });
      const uid = decodeURIComponent(pathname.slice("/api/users/".length));
      if (uid === user.id) return sendJson(res, 400, { error: "You cannot delete your own active admin account." });
      for (const [tok, sessUid] of sessions.entries()) {
        if (sessUid === uid) sessions.delete(tok);
      }
      db.users = db.users.filter((u) => u.id !== uid);
      writeDb(db);
      return sendJson(res, 200, { ok: true });
    }

    // PUT settings / metadata (Admin ONLY)
    if (method === "PUT" && pathname === "/api/settings") {
      if (user.role !== "ADMIN") {
        return sendJson(res, 403, { error: "Only the System Administrator can modify Settings & Accounts." });
      }
      const body = await parseBody(req);
      if (body.officeEmails !== undefined) {
        if (user.role !== "ADMIN") {
          return sendJson(res, 403, { error: "Only the System Administrator can manage the Office & DARPO Email Directory." });
        }
        const cleaned = {};
        Object.entries(body.officeEmails || {}).forEach(([k, v]) => {
          const email = String(v || "").trim();
          if (email) cleaned[k] = email;
        });
        db.meta.officeEmails = cleaned;
      }
      if (body.preparedSignatories !== undefined) {
        if (user.role !== "ADMIN") {
          return sendJson(res, 403, { error: "Only the System Administrator can add or delete Prepared / Signed By signatories." });
        }
        const cleanedList = [...new Set((Array.isArray(body.preparedSignatories) ? body.preparedSignatories : []).map((s) => String(s || "").trim()).filter(Boolean))];
        db.meta.preparedSignatories = cleanedList;
      }
      if (body.issuanceCategories !== undefined) {
        if (user.role !== "ADMIN") {
          return sendJson(res, 403, { error: "Only the System Administrator can manage Issuance sub-categories." });
        }
        const cleanedCats = [...new Set((Array.isArray(body.issuanceCategories) ? body.issuanceCategories : []).map((s) => String(s || "").trim()).filter(Boolean))];
        if (cleanedCats.length === 0) {
          return sendJson(res, 400, { error: "At least one Issuance sub-category is required." });
        }
        if (body.renameIssuanceCategory && body.renameIssuanceCategory.from && body.renameIssuanceCategory.to) {
          const fromCat = String(body.renameIssuanceCategory.from).trim();
          const toCat = String(body.renameIssuanceCategory.to).trim();
          (db.issuances || []).forEach((iss) => {
            if (iss.category === fromCat) iss.category = toCat;
          });
          if (db.meta.issuanceColumns && db.meta.issuanceColumns[fromCat]) {
            db.meta.issuanceColumns[toCat] = db.meta.issuanceColumns[fromCat];
            delete db.meta.issuanceColumns[fromCat];
          }
        }
        db.meta.issuanceCategories = cleanedCats;
      }
      if (body.issuanceColumns !== undefined) {
        if (user.role !== "ADMIN") {
          return sendJson(res, 403, { error: "Only the System Administrator can add or delete Issuance columns." });
        }
        const incomingMap = body.issuanceColumns && typeof body.issuanceColumns === "object" && !Array.isArray(body.issuanceColumns)
          ? body.issuanceColumns
          : {};
        const nextColsMap = { ...(db.meta.issuanceColumns || {}) };
        Object.entries(incomingMap).forEach(([catKey, colArr]) => {
          const k = String(catKey || "").trim();
          if (!k) return;
          if (colArr === null) {
            delete nextColsMap[k];
            return;
          }
          if (!Array.isArray(colArr)) return;
          const seen = new Set();
          const cleaned = [];
          const allowedColTypes = new Set(["text", "date", "date_range", "datetime", "select_or_custom", "multi_names", "pdf"]);
          colArr.forEach((c) => {
            if (!c || typeof c !== "object") return;
            const key = String(c.key || "").trim();
            const label = String(c.label || "").trim();
            if (!key || !label || seen.has(key)) return;
            seen.add(key);
            const colObj = {
              key,
              label,
              builtin: !!c.builtin,
              type: allowedColTypes.has(c.type) ? c.type : "text",
            };
            if (Array.isArray(c.options) && c.options.length) {
              colObj.options = [...new Set(c.options.map((o) => String(o || "").trim()).filter(Boolean))];
            }
            cleaned.push(colObj);
          });
          if (cleaned.length > 0) nextColsMap[k] = cleaned;
        });
        db.meta.issuanceColumns = nextColsMap;
      }
      if (body.mailingCouriers !== undefined) {
        if (user.role !== "ADMIN") {
          return sendJson(res, 403, { error: "Only the System Administrator can manage Mailing Process couriers." });
        }
        const cleanedCouriers = [...new Set((Array.isArray(body.mailingCouriers) ? body.mailingCouriers : []).map((s) => String(s || "").trim()).filter(Boolean))];
        if (cleanedCouriers.length === 0) {
          return sendJson(res, 400, { error: "At least one Mailing courier is required." });
        }
        if (body.renameMailingCourier && body.renameMailingCourier.from && body.renameMailingCourier.to) {
          const fromC = String(body.renameMailingCourier.from).trim();
          const toC = String(body.renameMailingCourier.to).trim();
          (db.mailings || []).forEach((m) => {
            if (m.courier === fromC) m.courier = toC;
          });
        }
        db.meta.mailingCouriers = cleanedCouriers;
      }
      if (body.meta) {
        const nextMeta = { ...body.meta };
        if (user.role !== "ADMIN") {
          delete nextMeta.officeEmails;
          delete nextMeta.preparedSignatories;
          delete nextMeta.issuanceCategories;
          delete nextMeta.issuanceColumns;
          delete nextMeta.mailingCouriers;
          delete nextMeta.smtpAppPassword;
        } else if (nextMeta.smtpAppPassword === "") {
          // Keep existing stored password unless explicitly cleared via clearSmtpPassword
          delete nextMeta.smtpAppPassword;
        }
        if (user.role === "ADMIN" && body.clearSmtpPassword) {
          db.meta.smtpAppPassword = "";
        }
        db.meta = { ...db.meta, ...nextMeta };
      }
      if (Array.isArray(body.divisions)) db.divisions = body.divisions;
      writeDb(db);

      // Sync Issuance Google Sheet tabs automatically when Admin adds/renames a sub-category or updates columns
      if (db.meta && db.meta.appsScriptUrl) {
        if (body.renameIssuanceCategory && body.renameIssuanceCategory.from && body.renameIssuanceCategory.to) {
          const toCat = String(body.renameIssuanceCategory.to).trim();
          await postToAppsScript(db.meta.appsScriptUrl, {
            action: "renameIssuanceTab",
            fromCategory: String(body.renameIssuanceCategory.from).trim(),
            toCategory: toCat,
            columns: getServerIssuanceColumnsFor(db, toCat),
            records: (db.issuances || []).filter((r) => r.category === toCat),
          });
        } else if (Array.isArray(body.issuanceCategories)) {
          // Ensure every newly added Issuance sub-category immediately gets its own tab in Google Sheets
          for (const cat of db.meta.issuanceCategories || []) {
            await syncIssuanceCategoryToSheet(db, cat);
          }
        }
        if (body.issuanceColumns && typeof body.issuanceColumns === "object") {
          for (const catKey of Object.keys(body.issuanceColumns)) {
            if (catKey && catKey !== "ALL") {
              await syncIssuanceCategoryToSheet(db, catKey);
            }
          }
        }
        if (body.renameMailingCourier && body.renameMailingCourier.from && body.renameMailingCourier.to) {
          const toC = String(body.renameMailingCourier.to).trim();
          await postToAppsScript(db.meta.appsScriptUrl, {
            action: "renameMailingTab",
            fromCourier: String(body.renameMailingCourier.from).trim(),
            toCourier: toC,
            records: (db.mailings || []).filter((r) => r.courier === toC),
          });
        } else if (Array.isArray(body.mailingCouriers)) {
          for (const c of db.meta.mailingCouriers || []) {
            await syncMailingCourierToSheet(db, c);
          }
        }
      }

      const { smtpAppPassword: _masked, ...safeMeta } = db.meta;
      return sendJson(res, 200, { ok: true, meta: { ...safeMeta, hasSmtpPassword: !!_masked }, divisions: db.divisions });
    }

    return sendJson(res, 404, { error: "API endpoint not found" });
  } catch (err) {
    return sendJson(res, 500, { error: err.message });
  }
}

function serveStatic(req, res, urlObj) {
  let reqPath = decodeURIComponent(urlObj.pathname);
  if (reqPath === "/") reqPath = "/index.html";
  const safePath = path.normalize(reqPath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = path.join(PUBLIC_DIR, safePath);

  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.stat(fullPath, (err, stats) => {
    if (err || !stats.isFile()) {
      const fallback = path.join(PUBLIC_DIR, "index.html");
      fs.readFile(fallback, (e2, content) => {
        if (e2) { res.writeHead(404); return res.end("Not Found"); }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(content);
      });
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    fs.createReadStream(fullPath).pipe(res);
  });
}

function requestHandler(req, res) {
  const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if (urlObj.pathname.startsWith("/api/")) return handleApi(req, res, urlObj);
  if (urlObj.pathname.startsWith("/uploads/")) {
    const relPath = decodeURIComponent(urlObj.pathname.slice("/uploads/".length));
    const fullPath = resolveSafeLocalUploadPath(relPath);
    if (!fullPath || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      res.writeHead(404);
      return res.end("Attachment not found");
    }
    const fileName = path.basename(fullPath);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    });
    return fs.createReadStream(fullPath).pipe(res);
  }
  return serveStatic(req, res, urlObj);
}

if (IS_VERCEL) {
  module.exports = requestHandler;
} else {
  const server = http.createServer(requestHandler);
  server.listen(PORT, HOST, () => {
    console.log(`DAR RO VIII Document Tracking System running at http://localhost:${PORT}`);
    // Automated Google Sheets live DB + Issuance & Mailing sync on startup + every 2 minutes in background
    setTimeout(() => {
      try {
        const curDb = readDb();
        const gasUrl = getActiveAppsScriptUrl(curDb);
        if (gasUrl && ((curDb.incoming || []).length > 0 || (curDb.outgoing || []).length > 0 || (curDb.issuances || []).length > 0)) {
          postToAppsScript(gasUrl, { action: "saveFullDb", db: curDb }, 25000).then((r) => {
            if (r && r.synced && r.json && r.json.ok) console.log(`[Auto-Sync] Synced full DTS database to Google Sheet.`);
          }).catch(() => {});
        }
      } catch (_) {}
      syncAllIssuancesToSheet().then((r) => {
        if (r && r.ok) console.log(`[Auto-Sync] Synced ${r.syncedCount} Issuance tab(s) to Google Sheet.`);
      }).catch(() => {});
      syncAllMailingsToSheet().then((r) => {
        if (r && r.ok) console.log(`[Auto-Sync] Synced ${r.syncedCount} Mailing tab(s) to Google Sheet.`);
      }).catch(() => {});
    }, 2500);
    setInterval(() => {
      syncAllIssuancesToSheet().catch(() => {});
      syncAllMailingsToSheet().catch(() => {});
    }, 2 * 60 * 1000);
  });
}
