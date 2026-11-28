/**
 * DAR Eastern Visayas Regional Office VIII — Document Tracking System (DTS)
 * Complete Google Apps Script Web App Backend
 * Features: Auth + Email OTP, Box A-E RBAC, Incoming & Outgoing DTS,
 * Official Issuances (9 sub-categories + custom columns), Mailing Process (PhilPost & JRS),
 * Recipient (To) Visibility Scoping, Google Drive PDF Uploads, Gmail Notifications,
 * and Automatic Google Sheets Tab Synchronization.
 *
 * Bound to Spreadsheet: 1aGcUZqjCA0GSfKoxVLdNG64Q6udj2AZniRRK79r9OZE
 */

const SPREADSHEET_ID = "1aGcUZqjCA0GSfKoxVLdNG64Q6udj2AZniRRK79r9OZE";
const DRIVE_FOLDER_ID = "1JJwNkttWowxao0UIhR7k_hKXWI1L_eQC";
const DRIVE_FOLDER_URL = "https://drive.google.com/drive/folders/1JJwNkttWowxao0UIhR7k_hKXWI1L_eQC?usp=sharing";
const OFFICIAL_SENDER_EMAIL = "darrec8@gmail.com";

const DARPO_PROVINCES = [
  { code: "DARPO - Biliran", name: "DAR Provincial Office — Biliran", province: "Biliran" },
  { code: "DARPO - Eastern Samar", name: "DAR Provincial Office — Eastern Samar", province: "Eastern Samar" },
  { code: "DARPO - Leyte", name: "DAR Provincial Office — Leyte", province: "Leyte" },
  { code: "DARPO - Northern Samar", name: "DAR Provincial Office — Northern Samar", province: "Northern Samar" },
  { code: "DARPO - Samar", name: "DAR Provincial Office — Samar (Western Samar)", province: "Samar" },
  { code: "DARPO - Southern Leyte", name: "DAR Provincial Office — Southern Leyte", province: "Southern Leyte" },
];

const BOX_A_FIELDS = [
  "controlNo", "dtsYear", "docCategory", "dateReceived", "timeReceived", "receivedBy",
  "senderName", "senderOffice", "docType", "thru",
  "dateOfDoc", "refNo", "subject", "attachments", "attachmentFile",
];
const BOX_B_FIELDS = ["rdDateTime", "rdReceivedBy", "rdInstructionsTo", "rdInstructions", "rdTimeFrame"];
const BOX_C_FIELDS = ["ardDateTime", "ardReceivedBy", "ardInstructionsTo", "ardInstructions", "ardTimeFrame"];
const BOX_D_FIELDS = [
  "assignedDivision", "divDateTime", "divReceivedBy", "divActionTaken",
  "divChiefName", "dateActed", "transmissionMode", "addressedTo", "pouchCC",
];
const BOX_E_FIELDS = [
  "recordsDispatchMode", "dispatchDetails", "returnedAs", "dateReturnedBy",
  "dateReturnedAt", "releasedBy", "replyAttachmentFile", "boxERecipients", "archived",
];
const OUT_BOX_D_RECORDS_FIELDS = [
  "recNo", "recordsDateReceived", "recordsTimeReceived", "recordsReceivedBy",
  "finalDispatchMode", "dispatchDetails", "dateDispatched",
];
const OUT_BOX_E_RETURN_FIELDS = ["returnedToOffice", "dateReceivedBack"];

const DEFAULT_ISSUANCE_CATEGORIES = [
  "Order", "Finality", "RCLUPPI", "Resolution", "Erratum",
  "Writ of Execution", "Interlocutory", "Memo", "Notice",
];

const CASE_ISSUANCE_COLUMNS = [
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

const MEMO_NOTICE_COLUMNS = [
  { key: "issuanceNo", label: "Control Number", builtin: true, type: "text" },
  { key: "col_date_released", label: "Date Released", builtin: false, type: "date" },
  { key: "col_released_by", label: "Released By", builtin: false, type: "text" },
  { key: "subject", label: "Subject", builtin: true, type: "text" },
  { key: "dateIssued", label: "Date of Document", builtin: true, type: "date" },
  { key: "col_date_of_activity", label: "Date of Activity", builtin: false, type: "date_range" },
  { key: "col_place_venue", label: "Place / Venue", builtin: false, type: "text" },
  { key: "col_concerned_parties", label: "Concerned Parties", builtin: false, type: "multi_names" },
];

const DEFAULT_PREPARED_SIGNATORIES = [
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

function getBook_() {
  return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getManilaNow_() {
  return Utilities.formatDate(new Date(), "Asia/Manila", "MMM dd, yyyy h:mm a");
}

function getTodayIso_() {
  return Utilities.formatDate(new Date(), "Asia/Manila", "yyyy-MM-dd");
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("DAR Eastern Visayas — Document Tracking System (DTS)")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function authorizeAllPermissions() {
  getBook_().getName();
  DriveApp.getFolderById(DRIVE_FOLDER_ID).getName();
  MailApp.getRemainingDailyQuota();
  return "Authorized Spreadsheet, Drive, and MailApp (" + (Session.getActiveUser().getEmail() || OFFICIAL_SENDER_EMAIL) + ")!";
}

// ----------------- Backwards-Compatible External Webhook (doPost) -----------------
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    let result = { ok: false, error: "Unknown action" };
    if (body.action === "getFullDb") result = { ok: true, db: readDb_() };
    else if (body.action === "saveFullDb") {
      if (body.db && typeof body.db === "object") {
        const lock = LockService.getScriptLock();
        lock.waitLock(25000);
        try {
          writeDb_(body.db);
          if (Array.isArray(body.db.users)) syncUsersSheet_(body.db.users);
          result = { ok: true, savedAt: getManilaNow_() };
        } finally {
          try { lock.releaseLock(); } catch (_) {}
        }
      } else {
        result = { ok: false, error: "Missing db payload" };
      }
    }
    else if (body.action === "upsertIncoming") result = writeIncomingRowDirect_(body.record);
    else if (body.action === "upsertOutgoing") result = writeOutgoingRowDirect_(body.record);
    else if (body.action === "deleteIncoming") result = deleteIncomingRowDirect_(body.controlNo);
    else if (body.action === "deleteOutgoing") result = deleteOutgoingRowDirect_(body.recNo);
    else if (body.action === "syncIssuanceTab" || body.action === "upsertIssuance" || body.action === "deleteIssuance") result = syncIssuanceTabDirect_(body);
    else if (body.action === "renameIssuanceTab") result = renameIssuanceTabDirect_(body);
    else if (body.action === "syncMailingTab") result = syncMailingTabDirect_(body);
    else if (body.action === "renameMailingTab") result = renameMailingTabDirect_(body);
    else if (body.action === "uploadPdf") result = savePdfToDriveFolder_(body, body.uploadedBy || "Records Staff");
    else if (body.action === "sendFurnishedCopyEmail") result = sendEmailDirect_(body);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ----------------- Chunked JSON Persistent Store inside Spreadsheet -----------------
function hashPass_(pw, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ":" + pw);
  return salt + ":" + bytes.map(function (b) { return ((b < 0 ? b + 256 : b).toString(16)).padStart(2, "0"); }).join("");
}

function buildSeedUsers_() {
  const now = new Date().toISOString();
  return [
    { id: "u-records", username: "records", fullName: "Elvie (Records Staff)", role: "RECORDS", division: "STO - Records", email: "", approvalStatus: "APPROVED", passwordHash: hashPass_("darro8", "s1"), createdAt: now },
    { id: "u-rdsec", username: "rdsec", fullName: "RD Secretary", role: "RD_SECRETARY", division: "RD", email: "", approvalStatus: "APPROVED", passwordHash: hashPass_("darro8", "s2"), createdAt: now },
    { id: "u-ard", username: "ard", fullName: "ARD Secretary (ARDO/ARDA)", role: "ARD_SECRETARY", division: "ARDO", email: "", approvalStatus: "APPROVED", passwordHash: hashPass_("darro8", "s3"), createdAt: now },
    { id: "u-sto", username: "sto", fullName: "Chief, STO Division", role: "DIVISION_CHIEF", division: "STO", email: "", approvalStatus: "APPROVED", passwordHash: hashPass_("darro8", "s4"), createdAt: now },
    { id: "u-lts", username: "lts", fullName: "Chief, LTS Division", role: "DIVISION_CHIEF", division: "LTS", email: "", approvalStatus: "APPROVED", passwordHash: hashPass_("darro8", "s5"), createdAt: now },
    { id: "u-legal", username: "legal", fullName: "Chief, Legal Division", role: "DIVISION_CHIEF", division: "LEGAL", email: "", approvalStatus: "APPROVED", passwordHash: hashPass_("darro8", "s6"), createdAt: now },
    { id: "u-arbdsp", username: "arbdsp", fullName: "Chief, ARBDSP Division", role: "DIVISION_CHIEF", division: "ARBDSP", email: "", approvalStatus: "APPROVED", passwordHash: hashPass_("darro8", "s7"), createdAt: now },
    { id: "u-rarad", username: "rarad", fullName: "RARAD / Regional Adjudicator", role: "DIVISION_CHIEF", division: "DARAB", email: "", approvalStatus: "APPROVED", passwordHash: hashPass_("darro8", "s8"), createdAt: now },
    { id: "u-admin", username: "admin", fullName: "DAR RO VIII System Admin", role: "ADMIN", division: "RD", email: "", approvalStatus: "APPROVED", passwordHash: hashPass_("admin123", "s9"), createdAt: now },
  ];
}

function buildDefaultDivisions_(ss) {
  const cfg = ss.getSheetByName("Lists_Config");
  let divisions = [];
  if (cfg) {
    const divVals = cfg.getRange("A5:E20").getValues();
    divisions = divVals.filter(function (r) { return r[0]; }).map(function (r) {
      return { code: String(r[0]), name: String(r[1]), group: String(r[2]), head: String(r[3]), focal: String(r[4]) };
    });
  }
  if (!divisions.length) {
    divisions = [
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
    ];
  }
  if (!divisions.some(function (d) { return d.code === "STO"; })) {
    const stoIdx = divisions.findIndex(function (d) { return d.code.indexOf("STO -") === 0; });
    const stoEntry = { code: "STO", name: "Support to Operations Division (STOD Chief)", group: "STO", head: "Chief, STOD", focal: "STO Secretary" };
    if (stoIdx >= 0) divisions.splice(stoIdx, 0, stoEntry);
    else divisions.push(stoEntry);
  }
  return divisions;
}

function buildDefaultIssuanceColumns_() {
  const map = {};
  ["Order", "Finality", "RCLUPPI", "Resolution", "Erratum", "Writ of Execution", "Interlocutory"].forEach(function (c) {
    map[c] = JSON.parse(JSON.stringify(CASE_ISSUANCE_COLUMNS));
  });
  ["Memo", "Notice"].forEach(function (c) {
    map[c] = JSON.parse(JSON.stringify(MEMO_NOTICE_COLUMNS));
  });
  return map;
}

function fmtDateVal_(v) {
  if (!v) return "";
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, "Asia/Manila", "yyyy-MM-dd");
  }
  return String(v);
}

function fmtTimeVal_(v) {
  if (!v) return "";
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, "Asia/Manila", "h:mm a");
  }
  return String(v);
}

function importInitialDbFromSheets_(ss) {
  const cfg = ss.getSheetByName("Lists_Config");
  const metaMap = {};
  if (cfg) {
    cfg.getRange("Q5:R12").getValues().forEach(function (r) {
      if (r[0]) metaMap[String(r[0]).trim()] = String(r[1] || "");
    });
  }
  const meta = {
    agency: metaMap["Agency"] || "DEPARTMENT OF AGRARIAN REFORM",
    tagline: metaMap["Tagline"] || "Tunay na Pagbabago sa Repormang Agraryo",
    officeName: metaMap["Office Name"] || "DAR Eastern Visayas Regional Office VIII",
    address: metaMap["Address"] || "DAR Regional Office 08, Sto. Niño Extension, Tacloban City",
    telefax: metaMap["Telefax"] || "(02) 325-3095",
    website: metaMap["Website"] || "www.dar.gov.ph",
    regionalDirector: metaMap["Regional Director"] || "ATTY. ROBERT ANTHONY P. YU",
    incomingFormCode: metaMap["Incoming Form Code"] || "DR08-STOR-F-001-REV-01",
    spreadsheetId: ss.getId(),
    spreadsheetUrl: ss.getUrl(),
    driveFolderId: DRIVE_FOLDER_ID,
    driveFolderUrl: DRIVE_FOLDER_URL,
    appsScriptUrl: ScriptApp.getService().getUrl() || "",
    senderEmail: OFFICIAL_SENDER_EMAIL,
    loginOtpEnabled: false,
    officeEmails: {},
    issuanceCategories: DEFAULT_ISSUANCE_CATEGORIES.slice(),
    issuanceColumns: buildDefaultIssuanceColumns_(),
    mailingCouriers: ["PhilPost", "JRS"],
    preparedSignatories: DEFAULT_PREPARED_SIGNATORIES.slice(),
  };

  // Users from Users_Auth if present
  let users = [];
  const uSh = ss.getSheetByName("Users_Auth");
  if (uSh && uSh.getLastRow() >= 2) {
    const numCols = Math.min(8, Math.max(7, uSh.getLastColumn()));
    uSh.getRange(2, 1, uSh.getLastRow() - 1, numCols).getValues().forEach(function (r) {
      if (!r[1]) return;
      users.push({
        id: String(r[0]),
        username: String(r[1]),
        fullName: String(r[2]),
        role: String(r[3]),
        division: String(r[4]),
        passwordHash: String(r[5]),
        approvalStatus: String(r[6] || "APPROVED"),
        email: numCols >= 8 ? String(r[7] || "") : "",
        createdAt: new Date().toISOString(),
      });
    });
  }
  if (!users.length) users = buildSeedUsers_();

  // Incoming from Incoming_DTS if present
  let incoming = [];
  const incSheet = ss.getSheetByName("Incoming_DTS");
  if (incSheet && incSheet.getLastRow() >= 4) {
    const incRaw = incSheet.getRange(4, 1, incSheet.getLastRow() - 3, 36).getValues();
    incoming = incRaw
      .filter(function (r) { return String(r[0] || "").trim() !== ""; })
      .map(function (r) {
        const cn = String(r[0]).trim();
        const rec = {
          controlNo: cn,
          docCategory: cn.toUpperCase().indexOf("I-") === 0 ? "Internal" : "External",
          dateReceived: fmtDateVal_(r[1]), timeReceived: fmtTimeVal_(r[2]), receivedBy: String(r[3] || ""),
          senderName: String(r[4] || ""), senderOffice: String(r[5] || ""), docType: String(r[6] || ""), thru: String(r[7] || ""),
          dateOfDoc: fmtDateVal_(r[8]), refNo: String(r[9] || ""), subject: String(r[10] || ""), attachments: String(r[11] || ""),
          rdDateTime: String(r[12] || ""), rdReceivedBy: String(r[13] || ""), rdInstructionsTo: String(r[14] || ""), rdInstructions: String(r[15] || ""), rdTimeFrame: String(r[16] || ""),
          ardDateTime: String(r[17] || ""), ardReceivedBy: String(r[18] || ""), ardInstructionsTo: String(r[19] || ""), ardInstructions: String(r[20] || ""), ardTimeFrame: String(r[21] || ""),
          assignedDivision: String(r[22] || ""), divDateTime: String(r[23] || ""), divReceivedBy: String(r[24] || ""), divActionTaken: String(r[25] || ""),
          divChiefName: String(r[26] || ""), dateActed: fmtDateVal_(r[27]), transmissionMode: String(r[28] || ""), addressedTo: String(r[29] || ""), pouchCC: String(r[30] || ""),
          recordsDispatchMode: String(r[31] || ""), dispatchDetails: String(r[32] || ""), returnedAs: String(r[33] || ""), dateReturnedBy: String(r[34] || ""),
          archived: String(r[35]) === "Archived",
          history: [],
        };
        rec.status = computeIncomingAutoStatus_(rec);
        return rec;
      })
      .reverse();
  }

  // Outgoing from Outgoing_DTS if present
  let outgoing = [];
  const outSheet = ss.getSheetByName("Outgoing_DTS");
  if (outSheet && outSheet.getLastRow() >= 4) {
    const outRaw = outSheet.getRange(4, 1, outSheet.getLastRow() - 3, 26).getValues();
    outgoing = outRaw
      .filter(function (r) { return String(r[0] || "").trim() !== ""; })
      .map(function (r, i) {
        const recNo = String(r[0]).trim();
        const recipStr = String(r[16] || "");
        return {
          id: "out-imp-" + (i + 1) + "-" + recNo.replace(/[^A-Za-z0-9]/g, ""),
          recNo: recNo,
          userDocNo: "",
          dateOriginated: fmtDateVal_(r[1]), originatingDivision: String(r[2] || ""), subject: String(r[3] || ""),
          attachments: String(r[4] || ""), remarks: String(r[5] || ""), preparedBy: String(r[6] || ""),
          docDescription: String(r[7] || ""), otherDescription: String(r[8] || ""),
          counterSignBy: String(r[9] || ""), counterSignRemarks: String(r[10] || ""), approvedBy: String(r[11] || ""), approvalRemarks: String(r[12] || ""),
          returnedToOffice: String(r[13] || ""), dateReceivedBack: String(r[14] || ""), transmissionMode: String(r[15] || ""),
          recipientTo: recipStr,
          furnishedCopy: normalizeStrList_(recipStr),
          recipientOffice: String(r[17] || ""), recipientAddress: String(r[18] || ""),
          recordsDateReceived: fmtDateVal_(r[19]), recordsTimeReceived: fmtTimeVal_(r[20]), recordsReceivedBy: String(r[21] || ""),
          finalDispatchMode: String(r[22] || ""), dispatchDetails: String(r[23] || ""), dateDispatched: fmtDateVal_(r[24]),
          status: String(r[25] || "Draft / Originating"),
        };
      })
      .reverse();
  }

  return {
    meta: meta,
    divisions: buildDefaultDivisions_(ss),
    users: users,
    incoming: incoming,
    outgoing: outgoing,
    issuances: [],
    mailings: [],
  };
}

function readDb_() {
  const ss = getBook_();
  let sh = ss.getSheetByName("_DTS_JSON_Store");
  let db = null;
  if (sh && sh.getLastRow() >= 1) {
    const vals = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
    const raw = vals.map(function (r) { return String(r[0] || ""); }).join("");
    if (raw) {
      try { db = JSON.parse(raw); } catch (_) { db = null; }
    }
  }
  if (!db) {
    db = importInitialDbFromSheets_(ss);
    writeDb_(db);
  }

  // Ensure required fields always exist cleanly
  if (!db.meta) db.meta = {};
  if (!db.meta.driveFolderId) { db.meta.driveFolderId = DRIVE_FOLDER_ID; db.meta.driveFolderUrl = DRIVE_FOLDER_URL; }
  if (!db.meta.senderEmail) db.meta.senderEmail = OFFICIAL_SENDER_EMAIL;
  if (!db.meta.officeEmails || typeof db.meta.officeEmails !== "object") db.meta.officeEmails = {};
  if (!Array.isArray(db.meta.issuanceCategories) || !db.meta.issuanceCategories.length) db.meta.issuanceCategories = DEFAULT_ISSUANCE_CATEGORIES.slice();
  if (!db.meta.issuanceColumns || typeof db.meta.issuanceColumns !== "object") db.meta.issuanceColumns = buildDefaultIssuanceColumns_();
  if (!Array.isArray(db.meta.mailingCouriers) || !db.meta.mailingCouriers.length) db.meta.mailingCouriers = ["PhilPost", "JRS"];
  if (!Array.isArray(db.meta.preparedSignatories) || !db.meta.preparedSignatories.length) db.meta.preparedSignatories = DEFAULT_PREPARED_SIGNATORIES.slice();
  if (!Array.isArray(db.divisions) || !db.divisions.length) db.divisions = buildDefaultDivisions_(ss);
  if (!Array.isArray(db.users) || !db.users.length) db.users = buildSeedUsers_();
  if (!Array.isArray(db.incoming)) db.incoming = [];
  if (!Array.isArray(db.outgoing)) db.outgoing = [];
  if (!Array.isArray(db.issuances)) db.issuances = [];
  if (!Array.isArray(db.mailings)) db.mailings = [];
  db.meta.spreadsheetId = ss.getId();
  db.meta.spreadsheetUrl = ss.getUrl();
  db.meta.appsScriptUrl = ScriptApp.getService().getUrl() || db.meta.appsScriptUrl || "";
  return db;
}

function writeDb_(db) {
  const ss = getBook_();
  let sh = ss.getSheetByName("_DTS_JSON_Store");
  if (!sh) {
    sh = ss.insertSheet("_DTS_JSON_Store");
    sh.hideSheet();
  }
  const str = JSON.stringify(db);
  const chunkSize = 40000;
  const rows = [];
  for (let i = 0; i < str.length; i += chunkSize) {
    rows.push([str.slice(i, i + chunkSize)]);
  }
  if (!rows.length) rows.push(["{}"]);
  sh.clearContents();
  sh.getRange(1, 1, rows.length, 1).setValues(rows);
}

function syncUsersSheet_(users) {
  const ss = getBook_();
  let sh = ss.getSheetByName("Users_Auth");
  if (!sh) {
    sh = ss.insertSheet("Users_Auth");
    sh.hideSheet();
  }
  sh.clearContents();
  const headers = [["id", "username", "fullName", "role", "division", "passwordHash", "approvalStatus", "email"]];
  const rows = (users || []).map(function (u) {
    return [u.id, u.username, u.fullName, u.role, u.division, u.passwordHash, u.approvalStatus || "APPROVED", u.email || ""];
  });
  sh.getRange(1, 1, rows.length + 1, 8).setValues(headers.concat(rows));
}

// ----------------- Helpers, Automated Status & RBAC -----------------
function normalizeStrList_(val) {
  const raw = Array.isArray(val) ? val : String(val || "").split(/[,;\n]+/);
  const seen = {};
  const out = [];
  raw.forEach(function (item) {
    const s = String(item || "").trim();
    if (s && !seen[s.toLowerCase()]) {
      seen[s.toLowerCase()] = true;
      out.push(s);
    }
  });
  return out;
}

function sanitizeUser_(u) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    email: u.email || "",
    emailVerified: !!u.emailVerified,
    role: u.role,
    division: u.division || "",
    approvalStatus: u.approvalStatus || "APPROVED",
    createdAt: u.createdAt || "",
  };
}

function getSessionUser_(db, token) {
  if (!token) return null;
  const uid = CacheService.getScriptCache().get("dts_sess_" + token);
  if (!uid) return null;
  const user = (db.users || []).find(function (u) { return u.id === uid; });
  return user && (user.approvalStatus || "APPROVED") === "APPROVED" ? user : null;
}

function computeIncomingAutoStatus_(rec) {
  const t = function (v) { return String(v || "").trim(); };
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

function resolveAssignedDiv_(rec) {
  const t = function (v) { return String(v || "").trim(); };
  if (t(rec.ardInstructionsTo)) return t(rec.ardInstructionsTo);
  const rdTo = t(rec.rdInstructionsTo);
  if (rdTo && rdTo !== "ARDO" && rdTo !== "ARDA") return rdTo;
  return t(rec.assignedDivision) || rdTo || "";
}

function divMatches_(uDiv, dDiv) {
  const u = String(uDiv || "").trim().toUpperCase();
  const d = String(dDiv || "").trim().toUpperCase();
  if (!u || !d) return false;
  if (u === d) return true;
  if (u === "STO" && (d === "STO" || d.indexOf("STO -") === 0)) return true;
  if ((u === "DARAB" || u === "RARAD" || u === "DARAB / RARAD") && (d === "DARAB" || d === "RARAD" || d === "DARAB / RARAD")) return true;
  return false;
}

function canUserViewIncoming_(user, doc) {
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
    const assigned = resolveAssignedDiv_(doc);
    return divMatches_(user.division, assigned) || divMatches_(user.division, rdTo) || divMatches_(user.division, ardTo);
  }
  return false;
}

function canUserViewOutgoing_(user, doc) {
  if (!user || !doc) return false;
  if (user.role === "ADMIN" || user.role === "RECORDS" || user.role === "RD_SECRETARY") return true;
  if (doc.createdByUserId && doc.createdByUserId === user.id) return true;
  if (divMatches_(user.division, doc.originatingDivision)) return true;
  if (divMatches_(user.division, doc.returnedToOffice)) return true;
  const fc = Array.isArray(doc.furnishedCopy) ? doc.furnishedCopy : [];
  if (fc.some(function (r) { return divMatches_(user.division, r); })) return true;
  const recips = normalizeStrList_(doc.recipientTo);
  if (recips.some(function (r) { return divMatches_(user.division, r); })) return true;
  if (user.role === "ARD_SECRETARY" && user.division) {
    const cs = String(doc.counterSignBy || "").toUpperCase();
    const uDiv = String(user.division).toUpperCase();
    if (cs.indexOf(uDiv) >= 0) return true;
    if (uDiv === "ARDO" && cs.indexOf("OPERATIONS") >= 0) return true;
    if (uDiv === "ARDA" && cs.indexOf("ADMINISTRATION") >= 0) return true;
  }
  return false;
}

function canUserViewConcernedRecord_(user, rec) {
  if (!user || !rec) return false;
  if (user.role === "ADMIN" || user.role === "RECORDS") return true;
  const recips = Array.isArray(rec.recipients) ? rec.recipients : [];
  if (!recips.length) return false;
  const userEmail = String(user.email || "").trim().toLowerCase();
  return recips.some(function (r) {
    const tok = String(r || "").trim();
    if (!tok) return false;
    if (divMatches_(user.division, tok)) return true;
    if (userEmail && tok.toLowerCase() === userEmail) return true;
    return false;
  });
}

// ----------------- Control Number Generators -----------------
function generateNextNumber_(db, type, dateStr, category, yearOverride, divisionParam, user) {
  const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const valid = isNaN(d.getTime()) ? new Date() : d;
  const mm = String(valid.getMonth() + 1).padStart(2, "0");
  const dd = String(valid.getDate()).padStart(2, "0");
  const yyyy = /^\d{4}$/.test(String(yearOverride || "").trim())
    ? String(yearOverride).trim()
    : String(valid.getFullYear());

  if (type === "issuance") {
    const cleanCat = String(category || "ISS").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 14) || "ISS";
    const escCat = cleanCat.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const re = new RegExp("^" + escCat + "-" + yyyy + "-(\\d+)$", "i");
    let maxSeq = 0;
    (db.issuances || []).forEach(function (item) {
      const m = String(item.issuanceNo || "").match(re);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    });
    return cleanCat + "-" + yyyy + "-" + String(maxSeq + 1).padStart(4, "0");
  }

  if (type === "mailing") {
    const cleanC = String(category || "MAIL").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 14) || "MAIL";
    const escC = cleanC.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const re = new RegExp("^" + escC + "-" + yyyy + "-(\\d+)$", "i");
    let maxSeq = 0;
    (db.mailings || []).forEach(function (item) {
      const m = String(item.mailingNo || "").match(re);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    });
    return cleanC + "-" + yyyy + "-" + String(maxSeq + 1).padStart(4, "0");
  }

  if (type === "outgoing-user") {
    const rawDiv = String(divisionParam || (user && user.division) || "USER").trim().toUpperCase();
    const pref = rawDiv === "STO - RECORDS" ? "RECORDS" : rawDiv.replace(/\s*-\s*/g, "-").replace(/[^A-Z0-9-]/g, "").slice(0, 16) || "USER";
    const escPref = pref.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const re = new RegExp("^" + escPref + "-\\d{2}-\\d{2}-" + yyyy + "-(\\d+)$", "i");
    let maxSeq = 0;
    (db.outgoing || []).forEach(function (item) {
      const m = String(item.userDocNo || "").match(re);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    });
    return pref + "-" + mm + "-" + dd + "-" + yyyy + "-" + String(maxSeq + 1).padStart(4, "0");
  }

  if (type === "outgoing") {
    const re = new RegExp("^OUT-\\d{2}-\\d{2}-" + yyyy + "-(\\d+)$", "i");
    let maxSeq = 0;
    (db.outgoing || []).forEach(function (item) {
      const m = String(item.recNo || "").match(re);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    });
    return "OUT-" + mm + "-" + dd + "-" + yyyy + "-" + String(maxSeq + 1).padStart(4, "0");
  }

  const letter = String(category || "").trim().toLowerCase() === "internal" ? "I" : "E";
  const re = new RegExp("^[EI]-\\d{2}-\\d{2}-" + yyyy + "-(\\d+)$", "i");
  let maxSeq = 0;
  (db.incoming || []).forEach(function (item) {
    const m = String(item.controlNo || "").match(re);
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  });
  return letter + "-" + mm + "-" + dd + "-" + yyyy + "-" + String(maxSeq + 1).padStart(4, "0");
}

// ----------------- Drive PDF Upload & Email Helpers -----------------
function sanitizeFolderSegment_(name) {
  return String(name || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

function resolvePdfFolderSegments_(body) {
  let yr = String((body && body.docYear) || "").trim();
  if (!/^(?:19|20)\d{2}$/.test(yr)) {
    const m = String((body && body.controlNo) || "").match(/(?:^|-)((?:19|20)\d{2})(?:-|$)/);
    yr = m ? m[1] : Utilities.formatDate(new Date(), "Asia/Manila", "yyyy");
  }
  let tx = sanitizeFolderSegment_(body && body.transaction);
  if (!tx) {
    const cn = String((body && body.controlNo) || "").trim().toUpperCase();
    if (cn.indexOf("OUT-") === 0) tx = "Outgoing";
    else if (cn.indexOf("PHILPOST-") === 0 || cn.indexOf("JRS-") === 0 || cn.indexOf("MAIL") === 0) tx = "Mailing Process";
    else if (cn.indexOf("E-") === 0 || cn.indexOf("I-") === 0) tx = "Incoming";
    else tx = "General";
  }
  const sub = sanitizeFolderSegment_(body && body.subFolder);
  const segs = [yr, tx];
  if (sub && sub.toLowerCase() !== tx.toLowerCase()) segs.push(sub);
  return segs;
}

function getOrCreateDriveSubfolder_(parentFolder, name) {
  const it = parentFolder.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parentFolder.createFolder(name);
}

function savePdfToDriveFolder_(body, uploaderName) {
  const origName = String(body.filename || "attachment.pdf").trim();
  const base64Raw = String(body.base64 || "").replace(/^data:[^;]+;base64,/i, "").trim();
  if (!origName.toLowerCase().endsWith(".pdf") || !base64Raw) {
    return { ok: false, error: "Valid PDF file required." };
  }
  const targetFolderId = String(body.folderId || DRIVE_FOLDER_ID).trim();
  let rootFolder;
  try {
    rootFolder = DriveApp.getFolderById(targetFolderId);
  } catch (err) {
    const folders = DriveApp.getFoldersByName("DAR RO VIII DTS Attachments");
    rootFolder = folders.hasNext() ? folders.next() : DriveApp.createFolder("DAR RO VIII DTS Attachments");
  }
  const segments = resolvePdfFolderSegments_(body);
  let targetFolder = rootFolder;
  for (let i = 0; i < segments.length; i++) {
    targetFolder = getOrCreateDriveSubfolder_(targetFolder, segments[i]);
  }
  const bytes = Utilities.base64Decode(base64Raw);
  const fileName = (body.controlNo ? body.controlNo + "_" : "") + origName;
  const blob = Utilities.newBlob(bytes, "application/pdf", fileName);
  const file = targetFolder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const url = file.getUrl();
  const folderPath = segments.join(" / ");
  return {
    ok: true,
    file: {
      name: origName,
      storedName: file.getId(),
      url: url,
      driveUrl: url,
      driveFileId: file.getId(),
      driveFolderUrl: targetFolder.getUrl() || DRIVE_FOLDER_URL,
      folderPath: folderPath,
      driveSynced: true,
      size: bytes.length,
      uploadedAt: getManilaNow_(),
      uploadedBy: uploaderName || "Records Staff",
    },
  };
}

function sendEmailDirect_(body) {
  const to = String(body.to || "").trim();
  const replyTo = String(body.replyTo || OFFICIAL_SENDER_EMAIL).trim();
  const fromName = String(body.fromName || "DAR Eastern Visayas Records Unit (darrec8@gmail.com)").trim();
  const subject = String(body.subject || "DAR Eastern Visayas DTS Notification").trim();
  const plainBody = String(body.body || "").trim();
  const htmlBody = String(body.htmlBody || "").trim();
  if (!to) return { ok: false, error: "No recipient email addresses provided." };
  try {
    const mailOpts = {
      to: to,
      replyTo: replyTo,
      subject: subject,
      body: plainBody || "Please see DAR Eastern Visayas Document Tracking System notification.",
      htmlBody: htmlBody || undefined,
      name: fromName,
    };
    const attachments = [];
    const driveFileId = String(body.driveFileId || "").trim();
    const attName = String(body.attachmentName || "Scanned_Document.pdf").trim();
    if (driveFileId) {
      try {
        const f = DriveApp.getFileById(driveFileId);
        if (f.getSize() <= 22 * 1024 * 1024) attachments.push(f.getBlob().setName(attName));
      } catch (_) {}
    }
    if (attachments.length) mailOpts.attachments = attachments;
    MailApp.sendEmail(mailOpts);
    return { ok: true, sent: true, to: to, replyTo: replyTo, attachedFile: attachments.length > 0 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function resolveOfficeEmails_(db, codes) {
  const emailMap = (db.meta && db.meta.officeEmails) || {};
  const list = normalizeStrList_(codes);
  const emails = [];
  const missing = [];
  list.forEach(function (code) {
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(code)) {
      emails.push(code);
    } else if (emailMap[code] && String(emailMap[code]).trim()) {
      emails.push(String(emailMap[code]).trim());
    } else {
      missing.push(code);
    }
  });
  return { emails: emails, missing: missing };
}

function dispatchNotificationEmails_(db, codes, subject, lines, attachmentFile, senderUser) {
  const resolved = resolveOfficeEmails_(db, codes);
  if (!resolved.emails.length) {
    return {
      attempted: true,
      sent: false,
      recipients: [],
      missingOffices: resolved.missing,
      error: "No Admin email addresses configured for the selected offices.",
    };
  }
  const att = attachmentFile || null;
  const attLink = att && (att.driveUrl || att.url) ? (att.driveUrl || att.url) : "";
  const plainBody = lines.concat(attLink ? ["", "Scanned PDF: " + attLink] : []).join("\n");
  const htmlRows = lines.map(function (l) { return "<div style='margin-bottom:4px;'>" + l + "</div>"; }).join("");
  const htmlBody = "<div style='font-family:Segoe UI,Arial,sans-serif;font-size:13px;color:#1c2420;'>"
    + "<div style='background:#0d3b1e;color:#fff;padding:12px 16px;border-radius:8px 8px 0 0;'><strong>DAR Eastern Visayas Regional Office VIII — DTS</strong></div>"
    + "<div style='padding:14px 16px;border:1px solid #d5e0d9;border-top:0;border-radius:0 0 8px 8px;'>"
    + htmlRows
    + (attLink ? "<div style='margin-top:12px;'><a href='" + attLink + "' style='display:inline-block;padding:8px 14px;background:#1b5e20;color:#fff;text-decoration:none;border-radius:6px;font-weight:700;'>📄 Open Scanned PDF</a></div>" : "")
    + "<p style='font-size:11.5px;color:#5a6a62;margin-top:14px;'>Sent by " + ((senderUser && senderUser.fullName) || "DAR Eastern Visayas Records Unit") + " on " + getManilaNow_() + ".</p>"
    + "</div></div>";

  const sentRes = sendEmailDirect_({
    to: resolved.emails.join(", "),
    replyTo: (db.meta && db.meta.senderEmail) || OFFICIAL_SENDER_EMAIL,
    subject: subject,
    body: plainBody,
    htmlBody: htmlBody,
    driveFileId: att && att.driveFileId ? att.driveFileId : "",
    attachmentName: att && att.name ? att.name : "Scanned_Document.pdf",
  });
  return {
    attempted: true,
    sent: !!sentRes.sent,
    sentAt: getManilaNow_(),
    via: (db.meta && db.meta.senderEmail) || OFFICIAL_SENDER_EMAIL,
    recipients: resolved.emails,
    missingOffices: resolved.missing,
    attachedFile: !!sentRes.attachedFile,
    error: sentRes.error || "",
  };
}

// ----------------- Google Sheets Tab Sync Helpers -----------------
function writeIncomingRowDirect_(rec) {
  const ss = getBook_();
  const sh = ss.getSheetByName("Incoming_DTS");
  if (!sh) return { ok: false, error: "Incoming_DTS tab not found" };
  rec.assignedDivision = resolveAssignedDiv_(rec);
  rec.status = computeIncomingAutoStatus_(rec);
  const rowVals = [
    rec.controlNo, rec.dateReceived, rec.timeReceived, rec.receivedBy,
    rec.senderName, rec.senderOffice, rec.docType, rec.thru,
    rec.dateOfDoc, rec.refNo, rec.subject, rec.attachments,
    rec.rdDateTime, rec.rdReceivedBy, rec.rdInstructionsTo, rec.rdInstructions, rec.rdTimeFrame,
    rec.ardDateTime, rec.ardReceivedBy, rec.ardInstructionsTo, rec.ardInstructions, rec.ardTimeFrame,
    rec.assignedDivision, rec.divDateTime, rec.divReceivedBy, rec.divActionTaken,
    rec.divChiefName, rec.dateActed, rec.transmissionMode, rec.addressedTo, rec.pouchCC,
    rec.recordsDispatchMode, rec.dispatchDetails, rec.returnedAs, rec.dateReturnedBy,
    rec.status,
  ];
  const lastRow = Math.max(4, sh.getLastRow());
  const ids = sh.getRange(4, 1, lastRow - 3, 1).getValues().map(function (r) { return String(r[0] || ""); });
  const idx = ids.indexOf(String(rec.controlNo));
  const targetRow = idx >= 0 ? idx + 4 : ids.filter(Boolean).length + 4;
  sh.getRange(targetRow, 1, 1, 36).setValues([rowVals]);
  return { ok: true, record: rec };
}

function deleteIncomingRowDirect_(controlNo) {
  const ss = getBook_();
  const sh = ss.getSheetByName("Incoming_DTS");
  if (!sh) return { ok: true };
  const lastRow = Math.max(4, sh.getLastRow());
  const ids = sh.getRange(4, 1, lastRow - 3, 1).getValues().map(function (r) { return String(r[0] || ""); });
  const idx = ids.indexOf(String(controlNo));
  if (idx >= 0) sh.deleteRow(idx + 4);
  return { ok: true };
}

function writeOutgoingRowDirect_(rec) {
  const ss = getBook_();
  const sh = ss.getSheetByName("Outgoing_DTS");
  if (!sh) return { ok: false, error: "Outgoing_DTS tab not found" };
  const keyVal = String(rec.recNo || rec.userDocNo || rec.id || "");
  if (!keyVal) return { ok: true };
  const rowVals = [
    keyVal, rec.dateOriginated, rec.originatingDivision, rec.subject,
    rec.attachments, rec.remarks, rec.preparedBy,
    rec.docDescription, rec.otherDescription,
    rec.counterSignBy, rec.counterSignRemarks, rec.approvedBy, rec.approvalRemarks,
    rec.returnedToOffice, rec.dateReceivedBack, rec.transmissionMode,
    rec.recipientTo, rec.recipientOffice, rec.recipientAddress,
    rec.recordsDateReceived, rec.recordsTimeReceived, rec.recordsReceivedBy,
    rec.finalDispatchMode, rec.dispatchDetails, rec.dateDispatched,
    rec.status || "Draft / Originating",
  ];
  const lastRow = Math.max(4, sh.getLastRow());
  const ids = sh.getRange(4, 1, lastRow - 3, 1).getValues().map(function (r) { return String(r[0] || ""); });
  let idx = rec.recNo ? ids.indexOf(String(rec.recNo)) : -1;
  if (idx < 0 && rec.userDocNo) idx = ids.indexOf(String(rec.userDocNo));
  const targetRow = idx >= 0 ? idx + 4 : ids.filter(Boolean).length + 4;
  sh.getRange(targetRow, 1, 1, 26).setValues([rowVals]);
  return { ok: true, record: rec };
}

function deleteOutgoingRowDirect_(recNo) {
  const ss = getBook_();
  const sh = ss.getSheetByName("Outgoing_DTS");
  if (!sh || !recNo) return { ok: true };
  const lastRow = Math.max(4, sh.getLastRow());
  const ids = sh.getRange(4, 1, lastRow - 3, 1).getValues().map(function (r) { return String(r[0] || ""); });
  const idx = ids.indexOf(String(recNo));
  if (idx >= 0) sh.deleteRow(idx + 4);
  return { ok: true };
}

function getIssuanceSheetName_(category) {
  const clean = String(category || "General").trim().replace(/[:\\/?*\[\]]+/g, " ").replace(/\s+/g, "_").slice(0, 85);
  return "Issuance_" + (clean || "General");
}

function formatIssuanceCellForSheet_(rec, col) {
  const k = col.key;
  if (k === "pdfFile") {
    const att = rec.attachmentFile;
    return att ? String(att.driveUrl || att.url || att.name || "") : "";
  }
  if (col.builtin) return String(rec[k] == null ? "" : rec[k]);
  const raw = (rec.customFields && rec.customFields[k]) || "";
  if (col.type === "multi_names" && raw) {
    const names = String(raw).split(/\r?\n|;/).map(function (s) { return s.trim(); }).filter(Boolean);
    return names.map(function (n, i) { return (i + 1) + ". " + n; }).join("\n");
  }
  return String(raw);
}

function syncIssuanceTabDirect_(body) {
  const ss = getBook_();
  const category = String(body.category || "General").trim();
  const sheetName = getIssuanceSheetName_(category);
  const cols = Array.isArray(body.columns) && body.columns.length ? body.columns : CASE_ISSUANCE_COLUMNS;
  const records = Array.isArray(body.records) ? body.records : (body.record ? [body.record] : []);
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  else sh.clearContents();
  const headers = ["Record ID"].concat(cols.map(function (c) { return String(c.label || c.key); })).concat(["Case No. / Ref No.", "Encoded By", "Last Updated"]);
  const rows = records.map(function (rec) {
    const dockets = String(rec.refNo || "").split(/\r?\n|;/).map(function (s) { return s.trim(); }).filter(Boolean);
    const formattedRef = dockets.length > 1 ? dockets.map(function (d, i) { return (i + 1) + ". " + d; }).join("\n") : (dockets[0] || "");
    return [String(rec.id || "")]
      .concat(cols.map(function (c) { return formatIssuanceCellForSheet_(rec, c); }))
      .concat([formattedRef, String(rec.createdBy || ""), String(rec.updatedAt || rec.createdAt || "")]);
  });
  const allValues = [headers].concat(rows);
  const range = sh.getRange(1, 1, allValues.length, headers.length);
  range.setValues(allValues);
  range.setVerticalAlignment("top");
  range.setWrap(true);
  const hdrRange = sh.getRange(1, 1, 1, headers.length);
  hdrRange.setBackground("#1b5e20");
  hdrRange.setFontColor("#ffffff");
  hdrRange.setFontWeight("bold");
  sh.setFrozenRows(1);
  sh.hideColumns(1);
  return { ok: true, synced: true, sheetName: sheetName, rowCount: rows.length };
}

function renameIssuanceTabDirect_(body) {
  const ss = getBook_();
  const oldName = getIssuanceSheetName_(body.fromCategory);
  const newName = getIssuanceSheetName_(body.toCategory);
  const oldSh = ss.getSheetByName(oldName);
  if (oldSh && oldName !== newName && !ss.getSheetByName(newName)) oldSh.setName(newName);
  return syncIssuanceTabDirect_({ category: body.toCategory, columns: body.columns, records: body.records });
}

function getMailingSheetName_(courier) {
  const clean = String(courier || "General").trim().replace(/[:\\/?*\[\]]+/g, " ").replace(/\s+/g, "_").slice(0, 85);
  return "Mailing_" + (clean || "General");
}

function syncMailingTabDirect_(body) {
  const ss = getBook_();
  const courier = String(body.courier || "PhilPost").trim();
  const sheetName = getMailingSheetName_(courier);
  const records = Array.isArray(body.records) ? body.records : [];
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  else sh.clearContents();
  const headers = [
    "Record ID", "Mailing / Control No.", "Courier", "Type of Document", "Date Mailed",
    "Addressee / Recipient", "Tracking / Registry / Waybill No.", "Date Received / Return Card",
    "Province", "Complete Address", "Document / Case Ref. No.", "Subject / Particulars",
    "Originating Unit", "Mailed By", "Postage / Amount (PHP)", "Status", "Remarks", "PDF / Receipt", "Last Updated",
  ];
  const rows = records.map(function (r) {
    const att = r.attachmentFile;
    const pdfVal = att ? String(att.driveUrl || att.url || att.name || "") : "";
    const addrs = Array.isArray(r.addressees) && r.addressees.length
      ? r.addressees
      : [{ name: r.recipientName || "", trackingNo: r.trackingNo || "", dateReceived: r.dateReceived || "" }];
    const fmtList = function (arr) {
      return arr.length > 1 ? arr.map(function (v, i) { return (i + 1) + ". " + (v || "—"); }).join("\n") : String(arr[0] || "");
    };
    return [
      String(r.id || ""), String(r.mailingNo || ""), String(r.courier || courier), String(r.docType || ""),
      String(r.dateMailed || ""), fmtList(addrs.map(function (a) { return a.name || ""; })),
      fmtList(addrs.map(function (a) { return a.trackingNo || ""; })),
      fmtList(addrs.map(function (a) { return a.dateReceived || ""; })),
      String(r.province || ""), String(r.recipientAddress || ""), String(r.docRefNo || ""),
      String(r.subject || ""), String(r.originatingDivision || ""), String(r.mailedBy || ""),
      String(r.amount || ""), String(r.status || ""), String(r.remarks || ""), pdfVal, String(r.updatedAt || r.createdAt || ""),
    ];
  });
  const allValues = [headers].concat(rows);
  const range = sh.getRange(1, 1, allValues.length, headers.length);
  range.setValues(allValues);
  range.setVerticalAlignment("top");
  range.setWrap(true);
  const hdrRange = sh.getRange(1, 1, 1, headers.length);
  hdrRange.setBackground("#0d47a1");
  hdrRange.setFontColor("#ffffff");
  hdrRange.setFontWeight("bold");
  sh.setFrozenRows(1);
  sh.hideColumns(1);
  return { ok: true, synced: true, sheetName: sheetName, rowCount: rows.length };
}

function renameMailingTabDirect_(body) {
  const ss = getBook_();
  const oldName = getMailingSheetName_(body.fromCourier);
  const newName = getMailingSheetName_(body.toCourier);
  const oldSh = ss.getSheetByName(oldName);
  if (oldSh && oldName !== newName && !ss.getSheetByName(newName)) oldSh.setName(newName);
  return syncMailingTabDirect_({ courier: body.toCourier, records: body.records });
}

// ----------------- Unified Web App API Dispatcher -----------------
function parseQuery_(url) {
  const idx = url.indexOf("?");
  const params = {};
  if (idx < 0) return { path: url, params: params };
  const qs = url.slice(idx + 1).split("&");
  qs.forEach(function (pair) {
    if (!pair) return;
    const eq = pair.indexOf("=");
    const k = decodeURIComponent(eq >= 0 ? pair.slice(0, eq) : pair);
    const v = decodeURIComponent(eq >= 0 ? pair.slice(eq + 1) : "");
    params[k] = v;
  });
  return { path: url.slice(0, idx), params: params };
}

function gasApiDispatch(req) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const parsed = parseQuery_(String((req && req.url) || ""));
    const pathname = parsed.path;
    const params = parsed.params;
    const method = String((req && req.method) || "GET").toUpperCase();
    const token = String((req && req.token) || "");
    const body = (req && req.body) || {};

    const db = readDb_();

    // Public endpoints
    if (method === "GET" && pathname === "/api/public/divisions") {
      return { ok: true, divisions: db.divisions };
    }

    if (method === "POST" && pathname === "/api/auth/login") {
      const username = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");
      const user = db.users.find(function (u) { return String(u.username || "").toLowerCase() === username; });
      if (!user) return { ok: false, statusCode: 401, error: "Invalid username or password." };
      const salt = String(user.passwordHash || "").split(":")[0];
      if (hashPass_(password, salt) !== user.passwordHash) return { ok: false, statusCode: 401, error: "Invalid username or password." };
      const appr = user.approvalStatus || "APPROVED";
      if (appr === "PENDING") return { ok: false, statusCode: 403, error: "Your account is pending confirmation by the System Administrator." };
      if (appr === "REJECTED") return { ok: false, statusCode: 403, error: "Your registration was declined by the System Administrator." };

      const otpOn = db.meta && db.meta.loginOtpEnabled === true;
      const userEmail = String(user.email || "").trim();
      if (otpOn && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const challengeId = Utilities.getUuid().replace(/-/g, "");
        CacheService.getScriptCache().put("dts_otp_" + challengeId, JSON.stringify({ userId: user.id, otp: otp }), 300);
        sendEmailDirect_({
          to: userEmail,
          subject: "[DAR Eastern Visayas DTS] Your Login Verification Code: " + otp,
          body: "Your 6-digit DAR Eastern Visayas DTS login OTP is: " + otp + "\n\nThis code expires in 5 minutes.",
        });
        const masked = userEmail.replace(/(^.).*(@.*$)/, "$1***$2");
        return { ok: true, otpRequired: true, challengeId: challengeId, maskedEmail: masked, expiresInSeconds: 300 };
      }

      const newTok = Utilities.getUuid().replace(/-/g, "");
      CacheService.getScriptCache().put("dts_sess_" + newTok, user.id, 21600);
      return { ok: true, token: newTok, user: sanitizeUser_(user) };
    }

    if (method === "POST" && pathname === "/api/auth/verify-otp") {
      const raw = CacheService.getScriptCache().get("dts_otp_" + String(body.challengeId || ""));
      if (!raw) return { ok: false, statusCode: 400, error: "OTP expired. Please sign in again." };
      const ch = JSON.parse(raw);
      if (String(body.otp || "").trim() !== String(ch.otp)) return { ok: false, statusCode: 401, error: "Invalid 6-digit OTP code." };
      CacheService.getScriptCache().remove("dts_otp_" + String(body.challengeId || ""));
      const user = db.users.find(function (u) { return u.id === ch.userId; });
      if (!user) return { ok: false, statusCode: 404, error: "User not found." };
      const newTok = Utilities.getUuid().replace(/-/g, "");
      CacheService.getScriptCache().put("dts_sess_" + newTok, user.id, 21600);
      return { ok: true, token: newTok, user: sanitizeUser_(user) };
    }

    if (method === "POST" && pathname === "/api/auth/resend-otp") {
      const raw = CacheService.getScriptCache().get("dts_otp_" + String(body.challengeId || ""));
      if (!raw) return { ok: false, statusCode: 400, error: "OTP session expired. Please sign in again." };
      const ch = JSON.parse(raw);
      const user = db.users.find(function (u) { return u.id === ch.userId; });
      if (!user || !user.email) return { ok: false, statusCode: 400, error: "User email not found." };
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      CacheService.getScriptCache().put("dts_otp_" + String(body.challengeId || ""), JSON.stringify({ userId: user.id, otp: otp }), 300);
      sendEmailDirect_({ to: user.email, subject: "[DAR Eastern Visayas DTS] New Login OTP: " + otp, body: "Your new 6-digit OTP is: " + otp });
      return { ok: true, expiresInSeconds: 300 };
    }

    if (method === "POST" && pathname === "/api/auth/register") {
      const username = String(body.username || "").trim().toLowerCase();
      const fullName = String(body.fullName || "").trim();
      const email = String(body.email || "").trim();
      const password = String(body.password || "");
      const role = String(body.role || "").trim();
      let division = String(body.division || "").trim();
      const validRoles = ["RECORDS", "RD_SECRETARY", "ARD_SECRETARY", "DIVISION_CHIEF"];
      if (!username || username.length < 3) return { ok: false, statusCode: 400, error: "Username must be at least 3 characters." };
      if (!fullName || password.length < 6 || validRoles.indexOf(role) < 0) return { ok: false, statusCode: 400, error: "Invalid registration details." };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, statusCode: 400, error: "Please enter a valid email address." };
      if (db.users.some(function (u) { return String(u.username || "").toLowerCase() === username; })) {
        return { ok: false, statusCode: 409, error: "Username is already registered." };
      }
      if (role === "RECORDS") division = "STO - Records";
      else if (role === "RD_SECRETARY") division = "RD";
      else if (role === "ARD_SECRETARY" && division !== "ARDO" && division !== "ARDA") division = "ARDO";

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const regChallengeId = Utilities.getUuid().replace(/-/g, "");
      const salt = Utilities.getUuid().slice(0, 8);
      CacheService.getScriptCache().put(
        "dts_reg_" + regChallengeId,
        JSON.stringify({ username: username, fullName: fullName, email: email, role: role, division: division, passwordHash: hashPass_(password, salt), otp: otp }),
        300
      );
      sendEmailDirect_({
        to: email,
        subject: "[DAR Eastern Visayas DTS] Verify Your Email — OTP: " + otp,
        body: "Hello " + fullName + ",\n\nYour 6-digit email verification code for DAR Eastern Visayas DTS is: " + otp + "\n\nThis code expires in 5 minutes.",
      });
      return { ok: true, otpRequired: true, challengeId: regChallengeId, maskedEmail: email.replace(/(^.).*(@.*$)/, "$1***$2"), expiresInSeconds: 300 };
    }

    if (method === "POST" && (pathname === "/api/auth/verify-register-otp" || pathname === "/api/auth/register/verify-otp")) {
      const raw = CacheService.getScriptCache().get("dts_reg_" + String(body.challengeId || ""));
      if (!raw) return { ok: false, statusCode: 400, error: "Verification code expired. Please register again." };
      const reg = JSON.parse(raw);
      if (String(body.otp || "").trim() !== String(reg.otp)) return { ok: false, statusCode: 401, error: "Invalid 6-digit verification code." };
      CacheService.getScriptCache().remove("dts_reg_" + String(body.challengeId || ""));
      const newUser = {
        id: "u-" + Utilities.getUuid().slice(0, 8),
        username: reg.username,
        fullName: reg.fullName,
        email: reg.email,
        emailVerified: true,
        role: reg.role,
        division: reg.division,
        passwordHash: reg.passwordHash,
        approvalStatus: "PENDING",
        createdAt: new Date().toISOString(),
      };
      db.users.push(newUser);
      writeDb_(db);
      syncUsersSheet_(db.users);
      return { ok: true, pendingApproval: true, message: "Email verified & registration submitted! Your account awaits confirmation by the System Administrator.", user: sanitizeUser_(newUser) };
    }

    if (method === "POST" && (pathname === "/api/auth/resend-register-otp" || pathname === "/api/auth/register/resend-otp")) {
      const raw = CacheService.getScriptCache().get("dts_reg_" + String(body.challengeId || ""));
      if (!raw) return { ok: false, statusCode: 400, error: "Session expired. Please register again." };
      const reg = JSON.parse(raw);
      reg.otp = String(Math.floor(100000 + Math.random() * 900000));
      CacheService.getScriptCache().put("dts_reg_" + String(body.challengeId || ""), JSON.stringify(reg), 300);
      sendEmailDirect_({ to: reg.email, subject: "[DAR Eastern Visayas DTS] New Verification Code: " + reg.otp, body: "Your new 6-digit verification code is: " + reg.otp });
      return { ok: true, expiresInSeconds: 300 };
    }

    if (method === "POST" && pathname === "/api/auth/logout") {
      if (token) CacheService.getScriptCache().remove("dts_sess_" + token);
      return { ok: true };
    }

    // Authenticated endpoints
    const user = getSessionUser_(db, token);
    if (!user) return { ok: false, statusCode: 401, error: "Authentication required. Please sign in." };

    if (method === "GET" && pathname === "/api/state") {
      const visibleIncoming = db.incoming.filter(function (doc) { return canUserViewIncoming_(user, doc); });
      const visibleOutgoing = db.outgoing.filter(function (doc) { return canUserViewOutgoing_(user, doc); });
      const visibleIssuances = db.issuances.filter(function (rec) { return canUserViewConcernedRecord_(user, rec); });
      const visibleMailings = db.mailings.filter(function (rec) { return canUserViewConcernedRecord_(user, rec); });
      return {
        ok: true,
        meta: Object.assign({}, db.meta, {
          emailMode: "apps_script",
          driveMode: "apps_script",
          hasSmtpPassword: false,
          issuanceSheetSync: { lastSyncedAt: getManilaNow_(), syncedTabs: db.meta.issuanceCategories.map(getIssuanceSheetName_), lastError: "" },
          mailingSheetSync: { lastSyncedAt: getManilaNow_(), syncedTabs: db.meta.mailingCouriers.map(getMailingSheetName_), lastError: "" },
        }),
        divisions: db.divisions,
        darpoOffices: DARPO_PROVINCES,
        incoming: visibleIncoming,
        outgoing: visibleOutgoing,
        issuances: visibleIssuances,
        mailings: visibleMailings,
        user: sanitizeUser_(user),
        users: user.role === "ADMIN" ? db.users.map(sanitizeUser_) : [],
      };
    }

    if (method === "GET" && pathname === "/api/next-number") {
      return {
        ok: true,
        number: generateNextNumber_(db, params.type || "incoming", params.date || "", params.category || "External", params.year || "", params.division || "", user),
      };
    }

    if (method === "POST" && pathname === "/api/upload-pdf") {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") {
        return { ok: false, statusCode: 403, error: "Only Records Section or Admin can upload PDF files." };
      }
      return savePdfToDriveFolder_(body, user.fullName);
    }

    if (method === "POST" && pathname === "/api/test-email") {
      if (user.role !== "ADMIN") return { ok: false, statusCode: 403, error: "Admin access required." };
      return sendEmailDirect_({
        to: body.toEmail || db.meta.senderEmail || OFFICIAL_SENDER_EMAIL,
        subject: "[DAR Eastern Visayas DTS] Test Email Notification",
        body: "This is a live test email from DAR Eastern Visayas Document Tracking System (Google Apps Script).",
      });
    }

    if (method === "POST" && pathname === "/api/test-drive") {
      if (user.role !== "ADMIN") return { ok: false, statusCode: 403, error: "Admin access required." };
      const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
      return { ok: true, mode: "apps_script", folderName: folder.getName(), folderUrl: DRIVE_FOLDER_URL };
    }

    // Incoming DTS CRUD + Box E Reply Email
    if (method === "POST" && pathname === "/api/incoming/send-reply-email") {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") return { ok: false, statusCode: 403, error: "Only Records Section or Admin can email Box E replies." };
      const rec = db.incoming.find(function (d) { return d.controlNo === body.controlNo; });
      if (!rec) return { ok: false, statusCode: 404, error: "Incoming document not found." };
      const recips = normalizeStrList_(body.recipients !== undefined ? body.recipients : rec.boxERecipients);
      rec.boxERecipients = recips;
      if (body.replyAttachmentFile !== undefined) rec.replyAttachmentFile = body.replyAttachmentFile;
      const emailDispatch = dispatchNotificationEmails_(
        db,
        recips,
        "[DAR Eastern Visayas DTS Reply] " + rec.controlNo + " — " + (rec.subject || "Incoming Reply"),
        ["Control No.: " + rec.controlNo, "Subject: " + (rec.subject || "—"), "Sender: " + (rec.senderName || "—") + " (" + (rec.senderOffice || "—") + ")", "Status: " + (rec.status || "—")],
        rec.replyAttachmentFile || rec.attachmentFile,
        user
      );
      rec.replyEmailLog = emailDispatch;
      writeDb_(db);
      return { ok: true, record: rec, emailDispatch: emailDispatch };
    }

    if (method === "POST" && pathname === "/api/incoming") {
      const idx = db.incoming.findIndex(function (d) { return d.controlNo === body.controlNo; });
      if (idx < 0) {
        if (user.role !== "RECORDS" && user.role !== "ADMIN") {
          return { ok: false, statusCode: 403, error: "Only Records Section can encode new Incoming documents (Box A)." };
        }
        const docCat = body.docCategory === "Internal" ? "Internal" : "External";
        const cn = String(body.controlNo || "").trim() || generateNextNumber_(db, "incoming", body.dateReceived, docCat, body.dtsYear, "", user);
        const rec = {
          controlNo: cn, dtsYear: String(body.dtsYear || ""), docCategory: docCat,
          dateReceived: "", timeReceived: "", receivedBy: user.fullName,
          senderName: "", senderOffice: "", docType: "", thru: "",
          dateOfDoc: "", refNo: "NONE", subject: "", attachments: "NO ATTACHMENT",
          rdDateTime: "", rdReceivedBy: "", rdInstructionsTo: "", rdInstructions: "", rdTimeFrame: "",
          ardDateTime: "", ardReceivedBy: "", ardInstructionsTo: "", ardInstructions: "", ardTimeFrame: "",
          assignedDivision: "", divDateTime: "", divReceivedBy: "", divActionTaken: "",
          divChiefName: "", dateActed: "", transmissionMode: "", addressedTo: "", pouchCC: "",
          recordsDispatchMode: "", dispatchDetails: "", returnedAs: "", dateReturnedBy: "",
          archived: false, history: [],
        };
        const allowedCreate = user.role === "ADMIN"
          ? BOX_A_FIELDS.concat(BOX_B_FIELDS, BOX_C_FIELDS, BOX_D_FIELDS, BOX_E_FIELDS)
          : BOX_A_FIELDS;
        allowedCreate.forEach(function (f) { if (body[f] !== undefined && f !== "controlNo") rec[f] = body[f]; });
        rec.assignedDivision = resolveAssignedDiv_(rec);
        rec.status = computeIncomingAutoStatus_(rec);
        rec.history.push({ at: getManilaNow_(), by: user.fullName, role: user.role, box: "Box A", status: rec.status, note: "Encoded incoming document" });
        db.incoming.unshift(rec);
        writeDb_(db);
        writeIncomingRowDirect_(rec);
        return { ok: true, record: rec };
      }

      const existing = Object.assign({}, db.incoming[idx]);
      const allowA = user.role === "RECORDS" || user.role === "ADMIN";
      const allowB = user.role === "RD_SECRETARY" || user.role === "ADMIN";
      const allowC = user.role === "ADMIN" || (user.role === "ARD_SECRETARY" && canUserViewIncoming_(user, existing));
      const allowD = user.role === "ADMIN" || (user.role === "DIVISION_CHIEF" && divMatches_(user.division, resolveAssignedDiv_(existing)));
      const allowE = user.role === "RECORDS" || user.role === "ADMIN";
      if (!allowA && !allowB && !allowC && !allowD && !allowE) {
        return { ok: false, statusCode: 403, error: "Your account does not have edit permission for this document." };
      }
      const copy = function (fields) { fields.forEach(function (f) { if (body[f] !== undefined && f !== "controlNo") existing[f] = body[f]; }); };
      if (allowA) copy(BOX_A_FIELDS);
      if (allowB) copy(BOX_B_FIELDS);
      if (allowC) copy(BOX_C_FIELDS);
      if (allowD) copy(BOX_D_FIELDS);
      if (allowE) copy(BOX_E_FIELDS);
      existing.assignedDivision = resolveAssignedDiv_(existing);
      existing.status = computeIncomingAutoStatus_(existing);
      existing.history = existing.history || [];
      existing.history.push({ at: getManilaNow_(), by: user.fullName, role: user.role, status: existing.status, note: "Updated document" });
      db.incoming[idx] = existing;
      writeDb_(db);
      writeIncomingRowDirect_(existing);
      return { ok: true, record: existing };
    }

    if (method === "DELETE" && pathname.indexOf("/api/incoming/") === 0) {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") return { ok: false, statusCode: 403, error: "Only Admin or Records can delete incoming documents." };
      const cn = decodeURIComponent(pathname.slice("/api/incoming/".length));
      db.incoming = db.incoming.filter(function (d) { return d.controlNo !== cn; });
      writeDb_(db);
      deleteIncomingRowDirect_(cn);
      return { ok: true };
    }

    // Outgoing DTS CRUD + Furnished Copy Email
    if (method === "POST" && pathname === "/api/outgoing/send-email") {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") return { ok: false, statusCode: 403, error: "Only Records Section or Admin can send Outgoing emails." };
      const rec = db.outgoing.find(function (d) { return d.id === body.id || d.recNo === body.id; });
      if (!rec) return { ok: false, statusCode: 404, error: "Outgoing document not found." };
      const recips = normalizeStrList_(body.furnishedCopy !== undefined ? body.furnishedCopy : rec.furnishedCopy);
      rec.furnishedCopy = recips;
      const emailDispatch = dispatchNotificationEmails_(
        db,
        recips,
        "[DAR Eastern Visayas Outgoing] " + (rec.recNo || rec.userDocNo) + " — " + (rec.subject || "Official Communication"),
        ["DAR8 Rec. No.: " + (rec.recNo || "Pending"), "Originating Unit: " + (rec.originatingDivision || "—"), "Subject: " + (rec.subject || "—"), "Final Dispatch Mode: " + (rec.finalDispatchMode || rec.transmissionMode || "—")],
        rec.attachmentFile,
        user
      );
      rec.furnishedCopyEmailLog = emailDispatch;
      writeDb_(db);
      return { ok: true, record: rec, emailDispatch: emailDispatch };
    }

    if (method === "POST" && pathname === "/api/outgoing") {
      const isRecOrAdmin = user.role === "RECORDS" || user.role === "ADMIN";
      const idx = db.outgoing.findIndex(function (r) { return (body.id && r.id === body.id) || (body.recNo && r.recNo === body.recNo); });
      if (idx < 0) {
        const userDocNo = String(body.userDocNo || "").trim() || generateNextNumber_(db, "outgoing-user", body.dateOriginated, "", body.dtsYear, body.originatingDivision, user);
        const rec = Object.assign({}, body, {
          id: "out-" + Utilities.getUuid().slice(0, 8),
          userDocNo: userDocNo,
          recNo: isRecOrAdmin ? String(body.recNo || "").trim() : "",
          furnishedCopy: normalizeStrList_(body.furnishedCopy || body.recipientTo),
          createdByUserId: user.id,
          createdByUsername: user.username,
          attachmentFile: isRecOrAdmin ? (body.attachmentFile || null) : null,
          status: isRecOrAdmin ? String(body.status || "Draft / Originating") : (body.approvedBy ? "For Approval" : body.counterSignBy ? "For Counter-Signature" : "Draft / Originating"),
        });
        if (!isRecOrAdmin) {
          OUT_BOX_D_RECORDS_FIELDS.concat(OUT_BOX_E_RETURN_FIELDS).forEach(function (f) { rec[f] = ""; });
        }
        db.outgoing.unshift(rec);
        writeDb_(db);
        writeOutgoingRowDirect_(rec);
        return { ok: true, record: rec };
      }
      const existing = Object.assign({}, db.outgoing[idx]);
      const merged = Object.assign({}, existing, body, {
        id: existing.id,
        userDocNo: existing.userDocNo || body.userDocNo || "",
        furnishedCopy: body.furnishedCopy !== undefined ? normalizeStrList_(body.furnishedCopy) : existing.furnishedCopy,
      });
      if (!isRecOrAdmin) {
        OUT_BOX_D_RECORDS_FIELDS.concat(OUT_BOX_E_RETURN_FIELDS).forEach(function (f) { merged[f] = existing[f] || ""; });
        merged.attachmentFile = existing.attachmentFile || null;
      }
      db.outgoing[idx] = merged;
      writeDb_(db);
      writeOutgoingRowDirect_(merged);
      return { ok: true, record: merged };
    }

    if (method === "DELETE" && pathname.indexOf("/api/outgoing/") === 0) {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") return { ok: false, statusCode: 403, error: "Only Admin or Records can delete outgoing documents." };
      const id = decodeURIComponent(pathname.slice("/api/outgoing/".length));
      const target = db.outgoing.find(function (r) { return r.id === id || r.recNo === id || r.userDocNo === id; });
      db.outgoing = db.outgoing.filter(function (r) { return r.id !== id && r.recNo !== id && r.userDocNo !== id; });
      writeDb_(db);
      if (target) deleteOutgoingRowDirect_(target.recNo || target.userDocNo);
      return { ok: true };
    }

    // Issuances CRUD, Email & Sheet Sync (Admin & Records write; RD/ARD/Divisions View-Only)
    if (method === "POST" && pathname === "/api/issuances/send-email") {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") return { ok: false, statusCode: 403, error: "View-only access: Only System Admin or Records Section can send Issuance emails." };
      const idx = db.issuances.findIndex(function (r) { return r.id === body.id; });
      if (idx < 0) return { ok: false, statusCode: 404, error: "Issuance record not found. Save first before sending emails." };
      const rec = db.issuances[idx];
      if (body.recipients !== undefined) rec.recipients = normalizeStrList_(body.recipients);
      if (body.attachmentFile !== undefined) rec.attachmentFile = body.attachmentFile || rec.attachmentFile || null;
      const emailDispatch = dispatchNotificationEmails_(
        db,
        rec.recipients,
        "[DAR Eastern Visayas " + (rec.category || "Issuance") + "] " + (rec.issuanceNo || "") + " — " + (rec.subject || "Official Issuance"),
        ["Issuance Type: " + (rec.category || "—"), "Control No.: " + (rec.issuanceNo || "—"), "Date of Document: " + (rec.dateIssued || "—"), "Subject: " + (rec.subject || "—"), "Signatory: " + (rec.issuedBy || "—"), "Remarks: " + (rec.remarks || "—")],
        rec.attachmentFile,
        user
      );
      rec.emailDispatchLog = emailDispatch;
      db.issuances[idx] = rec;
      writeDb_(db);
      return { ok: true, record: rec, emailDispatch: emailDispatch };
    }

    if (method === "POST" && pathname === "/api/issuances/sync-sheets") {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") return { ok: false, statusCode: 403, error: "View-only access: Only System Admin or Records Section can sync Issuances." };
      const results = (db.meta.issuanceCategories || []).map(function (cat) {
        return syncIssuanceTabDirect_({
          category: cat,
          columns: (db.meta.issuanceColumns && db.meta.issuanceColumns[cat]) || CASE_ISSUANCE_COLUMNS,
          records: db.issuances.filter(function (r) { return r.category === cat; }),
        });
      });
      return { ok: true, syncedCount: results.length, results: results };
    }

    if ((method === "POST" || method === "PUT") && pathname === "/api/issuances") {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") return { ok: false, statusCode: 403, error: "View-only access: Only System Admin or Records Section can encode or edit Issuances." };
      const category = String(body.category || db.meta.issuanceCategories[0] || "Order").trim();
      const subject = String(body.subject || "").trim();
      if (!subject) return { ok: false, statusCode: 400, error: "Issuance Subject / Title is required." };
      const cleanCustom = {};
      if (body.customFields && typeof body.customFields === "object") {
        Object.keys(body.customFields).forEach(function (k) { cleanCustom[k] = String(body.customFields[k] == null ? "" : body.customFields[k]).trim(); });
      }
      const idx = body.id ? db.issuances.findIndex(function (r) { return r.id === body.id; }) : -1;
      let saved, prevCat = "";
      if (idx < 0) {
        saved = {
          id: "iss-" + Utilities.getUuid().slice(0, 8),
          issuanceNo: String(body.issuanceNo || "").trim() || generateNextNumber_(db, "issuance", body.dateIssued, category, body.issuanceYear, "", user),
          category: category,
          dateIssued: String(body.dateIssued || "").trim(),
          originatingDivision: String(body.originatingDivision || user.division || "RD").trim(),
          issuedBy: String(body.issuedBy || "").trim(),
          refNo: String(body.refNo || "").trim(),
          subject: subject,
          remarks: String(body.remarks || "").trim(),
          status: String(body.status || "Issued / Effective").trim(),
          recipients: normalizeStrList_(body.recipients),
          customFields: cleanCustom,
          attachmentFile: body.attachmentFile || null,
          createdBy: user.fullName,
          createdByUserId: user.id,
          createdAt: getManilaNow_(),
          updatedAt: getManilaNow_(),
        };
        db.issuances.unshift(saved);
      } else {
        const ex = db.issuances[idx];
        prevCat = ex.category;
        saved = Object.assign({}, ex, {
          issuanceNo: String(body.issuanceNo || ex.issuanceNo).trim(),
          category: category,
          dateIssued: String(body.dateIssued || "").trim(),
          originatingDivision: String(body.originatingDivision != null ? body.originatingDivision : ex.originatingDivision || "").trim(),
          issuedBy: String(body.issuedBy != null ? body.issuedBy : ex.issuedBy || "").trim(),
          refNo: String(body.refNo != null ? body.refNo : ex.refNo || "").trim(),
          subject: subject,
          remarks: String(body.remarks != null ? body.remarks : ex.remarks || "").trim(),
          status: String(body.status || ex.status || "Issued / Effective").trim(),
          recipients: body.recipients !== undefined ? normalizeStrList_(body.recipients) : (ex.recipients || []),
          customFields: body.customFields !== undefined ? cleanCustom : (ex.customFields || {}),
          attachmentFile: body.attachmentFile !== undefined ? body.attachmentFile : (ex.attachmentFile || null),
          updatedBy: user.fullName,
          updatedAt: getManilaNow_(),
        });
        db.issuances[idx] = saved;
      }
      writeDb_(db);
      const sync = syncIssuanceTabDirect_({
        category: category,
        columns: (db.meta.issuanceColumns && db.meta.issuanceColumns[category]) || CASE_ISSUANCE_COLUMNS,
        records: db.issuances.filter(function (r) { return r.category === category; }),
      });
      if (prevCat && prevCat !== category) {
        syncIssuanceTabDirect_({
          category: prevCat,
          columns: (db.meta.issuanceColumns && db.meta.issuanceColumns[prevCat]) || CASE_ISSUANCE_COLUMNS,
          records: db.issuances.filter(function (r) { return r.category === prevCat; }),
        });
      }
      return { ok: true, record: saved, sync: sync };
    }

    if (method === "DELETE" && pathname.indexOf("/api/issuances/") === 0) {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") return { ok: false, statusCode: 403, error: "Only System Admin or Records Section can delete issuances." };
      const id = decodeURIComponent(pathname.slice("/api/issuances/".length));
      const target = db.issuances.find(function (r) { return r.id === id || r.issuanceNo === id; });
      db.issuances = db.issuances.filter(function (r) { return r.id !== id && r.issuanceNo !== id; });
      writeDb_(db);
      if (target && target.category) {
        syncIssuanceTabDirect_({
          category: target.category,
          columns: (db.meta.issuanceColumns && db.meta.issuanceColumns[target.category]) || CASE_ISSUANCE_COLUMNS,
          records: db.issuances.filter(function (r) { return r.category === target.category; }),
        });
      }
      return { ok: true };
    }

    // Mailing Process CRUD & Sheet Sync (Admin & Records write; RD/ARD/Divisions View-Only)
    if (method === "POST" && pathname === "/api/mailings/sync-sheets") {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") return { ok: false, statusCode: 403, error: "View-only access: Only System Admin or Records Section can sync Mailings." };
      const results = (db.meta.mailingCouriers || []).map(function (c) {
        return syncMailingTabDirect_({ courier: c, records: db.mailings.filter(function (r) { return r.courier === c; }) });
      });
      return { ok: true, syncedCount: results.length, results: results };
    }

    if ((method === "POST" || method === "PUT") && pathname === "/api/mailings") {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") return { ok: false, statusCode: 403, error: "View-only access: Only System Admin or Records Section can encode or edit Mailing records." };
      const courier = String(body.courier || db.meta.mailingCouriers[0] || "PhilPost").trim();
      const rawAddrs = Array.isArray(body.addressees) ? body.addressees : [];
      let addressees = rawAddrs.map(function (a) {
        return { name: String((a && a.name) || "").trim(), trackingNo: String((a && a.trackingNo) || "").trim(), dateReceived: String((a && a.dateReceived) || "").trim() };
      }).filter(function (a) { return a.name || a.trackingNo || a.dateReceived; });
      if (!addressees.length && String(body.recipientName || "").trim()) {
        addressees = [{ name: String(body.recipientName || "").trim(), trackingNo: String(body.trackingNo || "").trim(), dateReceived: String(body.dateReceived || "").trim() }];
      }
      const recipientName = addressees.map(function (a) { return a.name; }).filter(Boolean).join("\n");
      const trackingNo = addressees.map(function (a) { return a.trackingNo; }).filter(Boolean).join("\n");
      const dateReceived = addressees.map(function (a) { return a.dateReceived; }).filter(Boolean).join("\n");
      const subject = String(body.subject || "").trim();
      if (!recipientName) return { ok: false, statusCode: 400, error: "At least one Addressee / Recipient Name is required." };
      if (!subject) return { ok: false, statusCode: 400, error: "Subject / Particulars is required." };

      const idx = body.id ? db.mailings.findIndex(function (r) { return r.id === body.id; }) : -1;
      let saved, prevCourier = "";
      if (idx < 0) {
        saved = {
          id: "mail-" + Utilities.getUuid().slice(0, 8),
          mailingNo: String(body.mailingNo || "").trim() || generateNextNumber_(db, "mailing", body.dateMailed, courier, body.mailingYear, "", user),
          courier: courier,
          docType: String(body.docType || "").trim(),
          dateMailed: String(body.dateMailed || "").trim(),
          addressees: addressees,
          trackingNo: trackingNo,
          docRefNo: String(body.docRefNo || "").trim(),
          recipientName: recipientName,
          province: String(body.province || "").trim(),
          recipientAddress: String(body.recipientAddress || "").trim(),
          subject: subject,
          originatingDivision: String(body.originatingDivision || user.division || "STO - Records").trim(),
          mailedBy: String(body.mailedBy || user.fullName || "").trim(),
          amount: String(body.amount || "").trim(),
          status: String(body.status || "Mailed / In Transit").trim(),
          dateReceived: dateReceived,
          remarks: String(body.remarks || "").trim(),
          recipients: normalizeStrList_(body.recipients),
          attachmentFile: body.attachmentFile || null,
          createdBy: user.fullName,
          createdByUserId: user.id,
          createdAt: getManilaNow_(),
          updatedAt: getManilaNow_(),
        };
        db.mailings.unshift(saved);
      } else {
        const ex = db.mailings[idx];
        prevCourier = ex.courier;
        saved = Object.assign({}, ex, {
          mailingNo: String(body.mailingNo || ex.mailingNo).trim(),
          courier: courier,
          docType: body.docType !== undefined ? String(body.docType || "").trim() : (ex.docType || ""),
          dateMailed: String(body.dateMailed || "").trim(),
          addressees: addressees,
          trackingNo: trackingNo,
          docRefNo: String(body.docRefNo != null ? body.docRefNo : ex.docRefNo || "").trim(),
          recipientName: recipientName,
          province: String(body.province != null ? body.province : ex.province || "").trim(),
          recipientAddress: String(body.recipientAddress != null ? body.recipientAddress : ex.recipientAddress || "").trim(),
          subject: subject,
          originatingDivision: String(body.originatingDivision != null ? body.originatingDivision : ex.originatingDivision || "").trim(),
          mailedBy: String(body.mailedBy != null ? body.mailedBy : ex.mailedBy || "").trim(),
          amount: String(body.amount != null ? body.amount : ex.amount || "").trim(),
          status: String(body.status || ex.status || "Mailed / In Transit").trim(),
          dateReceived: dateReceived,
          remarks: String(body.remarks != null ? body.remarks : ex.remarks || "").trim(),
          recipients: body.recipients !== undefined ? normalizeStrList_(body.recipients) : (ex.recipients || []),
          attachmentFile: body.attachmentFile !== undefined ? body.attachmentFile : (ex.attachmentFile || null),
          updatedBy: user.fullName,
          updatedAt: getManilaNow_(),
        });
        db.mailings[idx] = saved;
      }
      writeDb_(db);
      const sync = syncMailingTabDirect_({ courier: courier, records: db.mailings.filter(function (r) { return r.courier === courier; }) });
      if (prevCourier && prevCourier !== courier) {
        syncMailingTabDirect_({ courier: prevCourier, records: db.mailings.filter(function (r) { return r.courier === prevCourier; }) });
      }
      return { ok: true, record: saved, sync: sync };
    }

    if (method === "DELETE" && pathname.indexOf("/api/mailings/") === 0) {
      if (user.role !== "ADMIN" && user.role !== "RECORDS") return { ok: false, statusCode: 403, error: "Only System Admin or Records Section can delete mailing records." };
      const id = decodeURIComponent(pathname.slice("/api/mailings/".length));
      const target = db.mailings.find(function (r) { return r.id === id || r.mailingNo === id; });
      db.mailings = db.mailings.filter(function (r) { return r.id !== id && r.mailingNo !== id; });
      writeDb_(db);
      if (target && target.courier) {
        syncMailingTabDirect_({ courier: target.courier, records: db.mailings.filter(function (r) { return r.courier === target.courier; }) });
      }
      return { ok: true };
    }

    // Admin User Management
    if (method === "PUT" && pathname.indexOf("/api/users/") === 0 && pathname.slice(-7) === "/status") {
      if (user.role !== "ADMIN") return { ok: false, statusCode: 403, error: "Admin access required." };
      const uid = decodeURIComponent(pathname.slice("/api/users/".length, -7));
      const target = db.users.find(function (u) { return u.id === uid; });
      if (!target) return { ok: false, statusCode: 404, error: "User not found." };
      target.approvalStatus = String(body.approvalStatus || "APPROVED").toUpperCase();
      writeDb_(db);
      syncUsersSheet_(db.users);
      let emailNotification = null;
      if (target.email && (target.approvalStatus === "APPROVED" || target.approvalStatus === "REJECTED")) {
        const resMail = sendEmailDirect_({
          to: target.email,
          subject: "[DAR Eastern Visayas DTS] Account " + target.approvalStatus,
          body: "Hello " + target.fullName + ",\n\nYour DAR Eastern Visayas DTS account (" + target.username + ") has been " + target.approvalStatus + " by the System Administrator.",
        });
        emailNotification = { attempted: true, sent: !!resMail.sent, to: target.email, error: resMail.error || "" };
      }
      return { ok: true, user: sanitizeUser_(target), emailNotification: emailNotification };
    }

    if (method === "PUT" && pathname.indexOf("/api/users/") === 0 && pathname.slice(-6) === "/email") {
      if (user.role !== "ADMIN") return { ok: false, statusCode: 403, error: "Admin access required." };
      const uid = decodeURIComponent(pathname.slice("/api/users/".length, -6));
      const target = db.users.find(function (u) { return u.id === uid; });
      if (!target) return { ok: false, statusCode: 404, error: "User not found." };
      target.email = String(body.email || "").trim();
      writeDb_(db);
      syncUsersSheet_(db.users);
      return { ok: true, user: sanitizeUser_(target) };
    }

    if (method === "DELETE" && pathname.indexOf("/api/users/") === 0) {
      if (user.role !== "ADMIN") return { ok: false, statusCode: 403, error: "Admin access required." };
      const uid = decodeURIComponent(pathname.slice("/api/users/".length));
      if (uid === user.id) return { ok: false, statusCode: 400, error: "You cannot delete your own active admin account." };
      db.users = db.users.filter(function (u) { return u.id !== uid; });
      writeDb_(db);
      syncUsersSheet_(db.users);
      return { ok: true };
    }

    // Admin Settings & Configuration
    if (method === "PUT" && pathname === "/api/settings") {
      if (user.role !== "ADMIN") return { ok: false, statusCode: 403, error: "Only the System Administrator can modify Settings & Accounts." };
      if (body.officeEmails !== undefined) {
        const cleaned = {};
        Object.keys(body.officeEmails || {}).forEach(function (k) {
          const v = String(body.officeEmails[k] || "").trim();
          if (v) cleaned[k] = v;
        });
        db.meta.officeEmails = cleaned;
      }
      if (body.preparedSignatories !== undefined) {
        db.meta.preparedSignatories = normalizeStrList_(body.preparedSignatories);
      }
      if (body.issuanceCategories !== undefined) {
        const nextCats = normalizeStrList_(body.issuanceCategories);
        if (nextCats.length) db.meta.issuanceCategories = nextCats;
        if (body.renameIssuanceCategory && body.renameIssuanceCategory.from && body.renameIssuanceCategory.to) {
          const fromC = String(body.renameIssuanceCategory.from).trim();
          const toC = String(body.renameIssuanceCategory.to).trim();
          db.issuances.forEach(function (r) { if (r.category === fromC) r.category = toC; });
          if (db.meta.issuanceColumns && db.meta.issuanceColumns[fromC] && !db.meta.issuanceColumns[toC]) {
            db.meta.issuanceColumns[toC] = db.meta.issuanceColumns[fromC];
            delete db.meta.issuanceColumns[fromC];
          }
          renameIssuanceTabDirect_({
            fromCategory: fromC,
            toCategory: toC,
            columns: (db.meta.issuanceColumns && db.meta.issuanceColumns[toC]) || CASE_ISSUANCE_COLUMNS,
            records: db.issuances.filter(function (r) { return r.category === toC; }),
          });
        }
      }
      if (body.issuanceColumns !== undefined && typeof body.issuanceColumns === "object") {
        db.meta.issuanceColumns = Object.assign({}, db.meta.issuanceColumns || {}, body.issuanceColumns);
      }
      if (body.mailingCouriers !== undefined) {
        const nextCouriers = normalizeStrList_(body.mailingCouriers);
        if (nextCouriers.length) db.meta.mailingCouriers = nextCouriers;
        if (body.renameMailingCourier && body.renameMailingCourier.from && body.renameMailingCourier.to) {
          const fromM = String(body.renameMailingCourier.from).trim();
          const toM = String(body.renameMailingCourier.to).trim();
          db.mailings.forEach(function (r) { if (r.courier === fromM) r.courier = toM; });
          renameMailingTabDirect_({ fromCourier: fromM, toCourier: toM, records: db.mailings.filter(function (r) { return r.courier === toM; }) });
        }
      }
      if (body.meta && typeof body.meta === "object") {
        ["regionalDirector", "incomingFormCode", "address", "telefax", "website", "driveFolderUrl", "driveFolderId", "appsScriptUrl", "senderEmail", "loginOtpEnabled"].forEach(function (k) {
          if (body.meta[k] !== undefined) db.meta[k] = body.meta[k];
        });
        const cfg = getBook_().getSheetByName("Lists_Config");
        if (cfg) {
          if (body.meta.address !== undefined) cfg.getRange("R8").setValue(body.meta.address);
          if (body.meta.telefax !== undefined) cfg.getRange("R9").setValue(body.meta.telefax);
          if (body.meta.website !== undefined) cfg.getRange("R10").setValue(body.meta.website);
          if (body.meta.regionalDirector !== undefined) cfg.getRange("R11").setValue(body.meta.regionalDirector);
          if (body.meta.incomingFormCode !== undefined) cfg.getRange("R12").setValue(body.meta.incomingFormCode);
        }
      }
      writeDb_(db);
      return { ok: true, meta: db.meta, divisions: db.divisions };
    }

    return { ok: false, statusCode: 404, error: "API endpoint not found: " + method + " " + pathname };
  } catch (err) {
    return { ok: false, statusCode: 500, error: err && err.message ? err.message : String(err) };
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}
