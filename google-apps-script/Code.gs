/**
 * DAR Eastern Visayas Regional Office VIII — Document Tracking System (DTS)
 * Google Apps Script Backend with Registration/Login, Box A-E RBAC, & Automated Status
 * Bound to Spreadsheet: 1aGcUZqjCA0GSfKoxVLdNG64Q6udj2AZniRRK79r9OZE
 */

const SPREADSHEET_ID = "1aGcUZqjCA0GSfKoxVLdNG64Q6udj2AZniRRK79r9OZE";
const DRIVE_FOLDER_ID = "1JJwNkttWowxao0UIhR7k_hKXWI1L_eQC";
const DRIVE_FOLDER_URL = "https://drive.google.com/drive/folders/1JJwNkttWowxao0UIhR7k_hKXWI1L_eQC?usp=sharing";
const OFFICIAL_SENDER_EMAIL = "darrec8@gmail.com";

function getBook_() {
  return SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SPREADSHEET_ID);
}

function doGet() {
  return HtmlService.createHtmlOutputFromFile("Index")
    .setTitle("DAR RO VIII — Document Tracking System (DTS)")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    let result = { ok: false, error: "Unknown action" };
    if (body.action === "upsertIncoming") result = writeIncomingRowDirect_(body.record);
    else if (body.action === "upsertOutgoing") result = writeOutgoingRowDirect_(body.record);
    else if (body.action === "deleteIncoming") result = deleteIncoming(body.controlNo);
    else if (body.action === "deleteOutgoing") result = deleteOutgoing(body.recNo);
    else if (body.action === "syncIssuanceTab" || body.action === "upsertIssuance" || body.action === "deleteIssuance") result = syncIssuanceTabDirect_(body);
    else if (body.action === "renameIssuanceTab") result = renameIssuanceTabDirect_(body);
    else if (body.action === "syncMailingTab") result = syncMailingTabDirect_(body);
    else if (body.action === "renameMailingTab") result = renameMailingTabDirect_(body);
    else if (body.action === "uploadPdf") result = savePdfToDriveFolder_(body, body.uploadedBy || "Records Staff");
    else if (body.action === "sendFurnishedCopyEmail") result = sendFurnishedCopyEmailDirect_(body);
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

// ----------------- Auth Helpers (Users Tab + SHA-256 + CacheService Sessions) -----------------
function hashPass_(pw, salt) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + ":" + pw);
  return salt + ":" + bytes.map((b) => ((b < 0 ? b + 256 : b).toString(16)).padStart(2, "0")).join("");
}

function ensureUsersSheet_() {
  const ss = getBook_();
  let sh = ss.getSheetByName("Users_Auth");
  if (!sh) {
    sh = ss.insertSheet("Users_Auth");
    sh.getRange(1, 1, 1, 7).setValues([["id", "username", "fullName", "role", "division", "passwordHash", "approvalStatus"]]);
    const seeds = [
      ["u-records", "records", "Elvie (Records Staff)", "RECORDS", "STO - Records", hashPass_("darro8", "s1"), "APPROVED"],
      ["u-rdsec", "rdsec", "RD Secretary", "RD_SECRETARY", "RD", hashPass_("darro8", "s2"), "APPROVED"],
      ["u-ard", "ard", "ARD Secretary (ARDO/ARDA)", "ARD_SECRETARY", "ARDO", hashPass_("darro8", "s3"), "APPROVED"],
      ["u-sto", "sto", "Chief, STO Division", "DIVISION_CHIEF", "STO", hashPass_("darro8", "s4"), "APPROVED"],
      ["u-lts", "lts", "Chief, LTS Division", "DIVISION_CHIEF", "LTS", hashPass_("darro8", "s5"), "APPROVED"],
      ["u-legal", "legal", "Chief, Legal Division", "DIVISION_CHIEF", "LEGAL", hashPass_("darro8", "s6"), "APPROVED"],
      ["u-arbdsp", "arbdsp", "Chief, ARBDSP Division", "DIVISION_CHIEF", "ARBDSP", hashPass_("darro8", "s7"), "APPROVED"],
      ["u-rarad", "rarad", "RARAD / Regional Adjudicator", "DIVISION_CHIEF", "DARAB", hashPass_("darro8", "s8"), "APPROVED"],
      ["u-admin", "admin", "DAR RO VIII System Admin", "ADMIN", "RD", hashPass_("admin123", "s9"), "APPROVED"],
    ];
    sh.getRange(2, 1, seeds.length, 7).setValues(seeds);
    sh.hideSheet();
  }
  return sh;
}

function getAllUsers_() {
  const sh = ensureUsersSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, 7).getValues()
    .filter((r) => r[1])
    .map((r) => ({
      id: String(r[0]), username: String(r[1]), fullName: String(r[2]),
      role: String(r[3]), division: String(r[4]), passwordHash: String(r[5]),
      approvalStatus: String(r[6] || "APPROVED"),
    }));
}

function getSessionUser_(token) {
  if (!token) return null;
  const uid = CacheService.getScriptCache().get("dts_sess_" + token);
  if (!uid) return null;
  const user = getAllUsers_().find((u) => u.id === uid);
  return user && user.approvalStatus === "APPROVED" ? user : null;
}

function sanitizeUser_(u) {
  return { id: u.id, username: u.username, fullName: u.fullName, role: u.role, division: u.division, approvalStatus: u.approvalStatus || "APPROVED" };
}

function getPublicDivisions() {
  const ss = getBook_();
  const cfg = ss.getSheetByName("Lists_Config");
  const divVals = cfg.getRange("A5:E20").getValues();
  const divisions = divVals.filter((r) => r[0]).map((r) => ({
    code: String(r[0]), name: String(r[1]), group: String(r[2]), head: String(r[3]), focal: String(r[4]),
  }));
  if (!divisions.some((d) => d.code === "STO")) {
    divisions.splice(7, 0, { code: "STO", name: "Support to Operations Division (STOD Chief)", group: "STO", head: "Chief, STOD", focal: "STO Secretary" });
  }
  return { divisions };
}

function authLogin(body) {
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  const user = getAllUsers_().find((u) => u.username.toLowerCase() === username);
  if (!user) return { ok: false, statusCode: 401, error: "Invalid username or password." };
  const salt = user.passwordHash.split(":")[0];
  if (hashPass_(password, salt) !== user.passwordHash) return { ok: false, statusCode: 401, error: "Invalid username or password." };
  if (user.approvalStatus === "PENDING") return { ok: false, statusCode: 403, error: "Your account is pending confirmation by the System Administrator." };
  if (user.approvalStatus === "REJECTED") return { ok: false, statusCode: 403, error: "Your registration was declined by the System Administrator." };
  const token = Utilities.getUuid().replace(/-/g, "");
  CacheService.getScriptCache().put("dts_sess_" + token, user.id, 21600);
  return { ok: true, token, user: sanitizeUser_(user) };
}

function authRegister(body) {
  const username = String(body.username || "").trim().toLowerCase();
  const fullName = String(body.fullName || "").trim();
  const password = String(body.password || "");
  const role = String(body.role || "").trim();
  let division = String(body.division || "").trim();
  const validRoles = ["RECORDS", "RD_SECRETARY", "ARD_SECRETARY", "DIVISION_CHIEF"];
  if (!username || username.length < 3) return { ok: false, error: "Username must be at least 3 characters." };
  if (!fullName || password.length < 6 || validRoles.indexOf(role) < 0) return { ok: false, error: "Invalid registration details." };
  const users = getAllUsers_();
  if (users.some((u) => u.username.toLowerCase() === username)) return { ok: false, error: "Username already registered." };
  if (role === "RECORDS") division = "STO - Records";
  else if (role === "RD_SECRETARY") division = "RD";
  const newUser = {
    id: "u-" + Utilities.getUuid().slice(0, 8),
    username, fullName, role, division,
    approvalStatus: "PENDING",
    passwordHash: hashPass_(password, Utilities.getUuid().slice(0, 8)),
  };
  ensureUsersSheet_().appendRow([newUser.id, newUser.username, newUser.fullName, newUser.role, newUser.division, newUser.passwordHash, "PENDING"]);
  return { ok: true, pendingApproval: true, message: "Registration submitted! Your account is pending confirmation by the System Administrator.", user: sanitizeUser_(newUser) };
}

function updateUserApprovalStatus(uid, approvalStatus, token) {
  const me = getSessionUser_(token);
  if (!me || me.role !== "ADMIN") return { ok: false, statusCode: 403, error: "Admin access required." };
  const sh = ensureUsersSheet_();
  const rows = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 1).getValues().map((r) => String(r[0]));
  const idx = rows.indexOf(String(uid));
  if (idx < 0) return { ok: false, statusCode: 404, error: "User not found." };
  sh.getRange(idx + 2, 7).setValue(String(approvalStatus || "APPROVED").toUpperCase());
  return { ok: true };
}

function authLogout(token) {
  if (token) CacheService.getScriptCache().remove("dts_sess_" + token);
  return { ok: true };
}

function deleteUserAccount(uid, token) {
  const me = getSessionUser_(token);
  if (!me || me.role !== "ADMIN") return { ok: false, statusCode: 403, error: "Admin access required." };
  const sh = ensureUsersSheet_();
  const rows = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 1).getValues().map((r) => String(r[0]));
  const idx = rows.indexOf(String(uid));
  if (idx >= 0) sh.deleteRow(idx + 2);
  return { ok: true };
}

// ----------------- Automated Status & RBAC -----------------
function computeIncomingAutoStatus_(rec) {
  const t = (v) => String(v || "").trim();
  if (rec.archived === true || rec.archived === "true") return "Archived";
  if (t(rec.returnedAs) || t(rec.dateReturnedBy)) return "Completed / Returned to Records";
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
  const t = (v) => String(v || "").trim();
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
  if ((u === "DARAB" || u === "RARAD") && (d === "DARAB" || d === "RARAD")) return true;
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
  if (divMatches_(user.division, doc.originatingDivision)) return true;
  if (divMatches_(user.division, doc.returnedToOffice)) return true;
  const recips = String(doc.recipientTo || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (recips.some((r) => divMatches_(user.division, r))) return true;
  if (user.role === "ARD_SECRETARY" && user.division) {
    const cs = String(doc.counterSignBy || "").toUpperCase();
    const uDiv = String(user.division).toUpperCase();
    if (cs.indexOf(uDiv) >= 0) return true;
  }
  return false;
}

function loadAllIncoming_(ss) {
  const incSheet = ss.getSheetByName("Incoming_DTS");
  const incLast = Math.max(4, incSheet.getLastRow());
  const incRaw = incSheet.getRange(4, 1, incLast - 3, 36).getValues();
  return incRaw
    .filter((r) => String(r[0] || "").trim() !== "")
    .map((r) => {
      const rec = {
        controlNo: String(r[0]), dateReceived: fmtDateVal_(r[1]), timeReceived: fmtTimeVal_(r[2]), receivedBy: String(r[3] || ""),
        senderName: String(r[4] || ""), senderOffice: String(r[5] || ""), docType: String(r[6] || ""), thru: String(r[7] || ""),
        dateOfDoc: fmtDateVal_(r[8]), refNo: String(r[9] || ""), subject: String(r[10] || ""), attachments: String(r[11] || ""),
        rdDateTime: String(r[12] || ""), rdReceivedBy: String(r[13] || ""), rdInstructionsTo: String(r[14] || ""), rdInstructions: String(r[15] || ""), rdTimeFrame: String(r[16] || ""),
        ardDateTime: String(r[17] || ""), ardReceivedBy: String(r[18] || ""), ardInstructionsTo: String(r[19] || ""), ardInstructions: String(r[20] || ""), ardTimeFrame: String(r[21] || ""),
        assignedDivision: String(r[22] || ""), divDateTime: String(r[23] || ""), divReceivedBy: String(r[24] || ""), divActionTaken: String(r[25] || ""),
        divChiefName: String(r[26] || ""), dateActed: fmtDateVal_(r[27]), transmissionMode: String(r[28] || ""), addressedTo: String(r[29] || ""), pouchCC: String(r[30] || ""),
        recordsDispatchMode: String(r[31] || ""), dispatchDetails: String(r[32] || ""), returnedAs: String(r[33] || ""), dateReturnedBy: String(r[34] || ""),
        archived: String(r[35]) === "Archived",
      };
      rec.status = computeIncomingAutoStatus_(rec);
      return rec;
    });
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

function getState(token) {
  const user = getSessionUser_(token);
  if (!user) return { ok: false, statusCode: 401, error: "Authentication required." };

  const ss = getBook_();
  const cfg = ss.getSheetByName("Lists_Config");
  const incSheet = ss.getSheetByName("Incoming_DTS");
  const outSheet = ss.getSheetByName("Outgoing_DTS");

  const divisions = getPublicDivisions().divisions;
  const metaVals = cfg.getRange("Q5:R12").getValues();
  const metaMap = {};
  metaVals.forEach((r) => { if (r[0]) metaMap[String(r[0]).trim()] = String(r[1] || ""); });
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
  };

  const incoming = loadAllIncoming_(ss).filter((rec) => canUserViewIncoming_(user, rec));

  const outLast = Math.max(4, outSheet.getLastRow());
  const outRaw = outSheet.getRange(4, 1, outLast - 3, 26).getValues();
  const outgoing = outRaw
    .filter((r) => String(r[0] || "").trim() !== "")
    .map((r) => ({
      recNo: String(r[0]), dateOriginated: fmtDateVal_(r[1]), originatingDivision: String(r[2] || ""), subject: String(r[3] || ""),
      attachments: String(r[4] || ""), remarks: String(r[5] || ""), preparedBy: String(r[6] || ""),
      docDescription: String(r[7] || ""), otherDescription: String(r[8] || ""),
      counterSignBy: String(r[9] || ""), counterSignRemarks: String(r[10] || ""), approvedBy: String(r[11] || ""), approvalRemarks: String(r[12] || ""),
      returnedToOffice: String(r[13] || ""), dateReceivedBack: String(r[14] || ""), transmissionMode: String(r[15] || ""),
      recipientTo: String(r[16] || ""), recipientOffice: String(r[17] || ""), recipientAddress: String(r[18] || ""),
      recordsDateReceived: fmtDateVal_(r[19]), recordsTimeReceived: fmtTimeVal_(r[20]), recordsReceivedBy: String(r[21] || ""),
      finalDispatchMode: String(r[22] || ""), dispatchDetails: String(r[23] || ""), dateDispatched: fmtDateVal_(r[24]),
      status: String(r[25] || "Draft / Originating"),
    }));

  return {
    meta, divisions,
    incoming: incoming.reverse(),
    outgoing: outgoing.filter((rec) => canUserViewOutgoing_(user, rec)).reverse(),
    user: sanitizeUser_(user),
    users: user.role === "ADMIN" ? getAllUsers_().map(sanitizeUser_) : [],
  };
}

function savePdfToDriveFolder_(body, uploaderName) {
  const origName = String(body.filename || "attachment.pdf").trim();
  const base64Raw = String(body.base64 || "").replace(/^data:application\/pdf;base64,/i, "").trim();
  if (!origName.toLowerCase().endsWith(".pdf") || !base64Raw) {
    return { ok: false, error: "Valid PDF file required." };
  }
  const targetFolderId = String(body.folderId || DRIVE_FOLDER_ID).trim();
  let folder;
  try {
    folder = DriveApp.getFolderById(targetFolderId);
  } catch (err) {
    const folderName = "DAR RO VIII DTS Attachments";
    const folders = DriveApp.getFoldersByName(folderName);
    folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
  }
  const bytes = Utilities.base64Decode(base64Raw);
  const fileName = (body.controlNo ? body.controlNo + "_" : "") + origName;
  const blob = Utilities.newBlob(bytes, "application/pdf", fileName);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const url = file.getUrl();
  return {
    ok: true,
    file: {
      name: origName,
      storedName: file.getId(),
      url: url,
      driveUrl: url,
      driveFileId: file.getId(),
      driveFolderUrl: DRIVE_FOLDER_URL,
      driveSynced: true,
      size: bytes.length,
      uploadedAt: Utilities.formatDate(new Date(), "Asia/Manila", "MMM dd, yyyy h:mm a"),
      uploadedBy: uploaderName || "Records Staff",
    },
  };
}

function uploadPdfAttachment(body, token) {
  const user = getSessionUser_(token);
  if (!user || (user.role !== "RECORDS" && user.role !== "ADMIN")) {
    return { ok: false, statusCode: 403, error: "Only Records Section or Admin can upload PDF attachments." };
  }
  return savePdfToDriveFolder_(body, user.fullName);
}

function getNextNumber(type, dateStr, token, category, yearOverride, divisionParam) {
  const st = getState(token);
  if (st.error) return st;
  const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const valid = isNaN(d.getTime()) ? new Date() : d;
  const mm = String(valid.getMonth() + 1).padStart(2, "0");
  const dd = String(valid.getDate()).padStart(2, "0");
  const yyyy = /^\d{4}$/.test(String(yearOverride || "").trim())
    ? String(yearOverride).trim()
    : String(valid.getFullYear());
  if (type === "outgoing-user") {
    const rawDiv = String(divisionParam || (st.user && st.user.division) || "USER").trim().toUpperCase();
    const pref = rawDiv === "STO - RECORDS" ? "RECORDS" : rawDiv.replace(/\s*-\s*/g, "-").replace(/[^A-Z0-9-]/g, "").slice(0, 16) || "USER";
    const escPref = pref.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const re = new RegExp("^" + escPref + "-\\d{2}-\\d{2}-" + yyyy + "-(\\d+)$", "i");
    let maxSeq = 0;
    st.outgoing.forEach((item) => {
      const m = String(item.userDocNo || "").match(re);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    });
    return { number: pref + "-" + mm + "-" + dd + "-" + yyyy + "-" + String(maxSeq + 1).padStart(4, "0") };
  }
  if (type === "outgoing") {
    const re = new RegExp("^OUT-\\d{2}-\\d{2}-" + yyyy + "-(\\d+)$", "i");
    let maxSeq = 0;
    st.outgoing.forEach((item) => {
      const m = String(item.recNo || "").match(re);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    });
    return { number: "OUT-" + mm + "-" + dd + "-" + yyyy + "-" + String(maxSeq + 1).padStart(4, "0") };
  }
  const letter = String(category || "").trim().toLowerCase() === "internal" ? "I" : "E";
  const re = new RegExp("^[EI]-\\d{2}-\\d{2}-" + yyyy + "-(\\d+)$", "i");
  let maxSeq = 0;
  loadAllIncoming_(getBook_()).forEach((item) => {
    const m = String(item.controlNo || "").match(re);
    if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
  });
  return { number: letter + "-" + mm + "-" + dd + "-" + yyyy + "-" + String(maxSeq + 1).padStart(4, "0") };
}

function writeIncomingRowDirect_(rec) {
  const ss = getBook_();
  const sh = ss.getSheetByName("Incoming_DTS");
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
  const ids = sh.getRange(4, 1, lastRow - 3, 1).getValues().map((r) => String(r[0] || ""));
  const idx = ids.indexOf(String(rec.controlNo));
  const targetRow = idx >= 0 ? idx + 4 : ids.filter(Boolean).length + 4;
  sh.getRange(targetRow, 1, 1, 36).setValues([rowVals]);
  return { ok: true, record: rec };
}

function upsertIncoming(rec, token) {
  const user = getSessionUser_(token);
  if (!user) return { ok: false, statusCode: 401, error: "Authentication required." };
  const allInc = loadAllIncoming_(getBook_());
  const existing = allInc.find((x) => x.controlNo === rec.controlNo);

  if (!existing) {
    if (user.role !== "RECORDS" && user.role !== "ADMIN") {
      return { ok: false, statusCode: 403, error: "Only Records Section can encode new Incoming documents (Box A)." };
    }
    return writeIncomingRowDirect_(rec);
  }

  const merged = Object.assign({}, existing);
  const allowA = user.role === "RECORDS" || user.role === "ADMIN";
  const allowB = user.role === "RD_SECRETARY" || user.role === "ADMIN";
  const allowC = user.role === "ADMIN" || (user.role === "ARD_SECRETARY" && canUserViewIncoming_(user, existing));
  const allowD = user.role === "ADMIN" || (user.role === "DIVISION_CHIEF" && divMatches_(user.division, resolveAssignedDiv_(existing)));
  const allowE = user.role === "RECORDS" || user.role === "ADMIN";

  if (!allowA && !allowB && !allowC && !allowD && !allowE) {
    return { ok: false, statusCode: 403, error: "Your account does not have edit permission for this document." };
  }
  const copy = (fields) => fields.forEach((f) => { if (rec[f] !== undefined) merged[f] = rec[f]; });
  if (allowA) copy(["dateReceived", "timeReceived", "receivedBy", "senderName", "senderOffice", "docType", "thru", "dateOfDoc", "refNo", "subject", "attachments"]);
  if (allowB) copy(["rdDateTime", "rdReceivedBy", "rdInstructionsTo", "rdInstructions", "rdTimeFrame"]);
  if (allowC) copy(["ardDateTime", "ardReceivedBy", "ardInstructionsTo", "ardInstructions", "ardTimeFrame"]);
  if (allowD) copy(["assignedDivision", "divDateTime", "divReceivedBy", "divActionTaken", "divChiefName", "dateActed", "transmissionMode", "addressedTo", "pouchCC"]);
  if (allowE) copy(["recordsDispatchMode", "dispatchDetails", "returnedAs", "dateReturnedBy", "archived"]);

  return writeIncomingRowDirect_(merged);
}

function writeOutgoingRowDirect_(rec) {
  const ss = getBook_();
  const sh = ss.getSheetByName("Outgoing_DTS");
  const rowVals = [
    rec.recNo, rec.dateOriginated, rec.originatingDivision, rec.subject,
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
  const ids = sh.getRange(4, 1, lastRow - 3, 1).getValues().map((r) => String(r[0] || ""));
  const idx = ids.indexOf(String(rec.recNo));
  const targetRow = idx >= 0 ? idx + 4 : ids.filter(Boolean).length + 4;
  sh.getRange(targetRow, 1, 1, 26).setValues([rowVals]);
  return { ok: true, record: rec };
}

function authorizeAllPermissions() {
  // Run once in Apps Script editor to grant Sheets, Drive, and MailApp permissions
  getBook_().getName();
  DriveApp.getFolderById(DRIVE_FOLDER_ID).getName();
  MailApp.getRemainingDailyQuota();
  return { ok: true, sender: Session.getActiveUser().getEmail() || OFFICIAL_SENDER_EMAIL };
}

function sendFurnishedCopyEmailDirect_(body) {
  const to = String(body.to || "").trim();
  const replyTo = String(body.replyTo || OFFICIAL_SENDER_EMAIL).trim();
  const fromName = String(body.fromName || "DAR RO VIII Records Unit (darrec8@gmail.com)").trim();
  const subject = String(body.subject || "DAR RO VIII DTS Outgoing Notification").trim();
  const plainBody = String(body.body || "").trim();
  const htmlBody = String(body.htmlBody || "").trim();
  if (!to) return { ok: false, error: "No recipient email addresses provided." };
  try {
    const mailOpts = {
      to: to,
      replyTo: replyTo,
      subject: subject,
      body: plainBody || "Please see DAR RO VIII Document Tracking System notification.",
      htmlBody: htmlBody || undefined,
      name: fromName,
    };
    const attachments = [];
    const driveFileId = String(body.driveFileId || "").trim();
    const attName = String(body.attachmentName || "Scanned_Document.pdf").trim();
    const attB64 = String(body.attachmentBase64 || "").trim();
    if (driveFileId) {
      try {
        const f = DriveApp.getFileById(driveFileId);
        if (f.getSize() <= 22 * 1024 * 1024) {
          attachments.push(f.getBlob().setName(attName));
        }
      } catch (_) {}
    } else if (attB64) {
      try {
        const bytes = Utilities.base64Decode(attB64);
        attachments.push(Utilities.newBlob(bytes, "application/pdf", attName));
      } catch (_) {}
    }
    if (attachments.length) mailOpts.attachments = attachments;
    MailApp.sendEmail(mailOpts);
    return { ok: true, sent: true, to: to, replyTo: replyTo, attachedFile: attachments.length > 0 };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function upsertOutgoing(rec, token) {
  const user = getSessionUser_(token);
  if (!user) return { ok: false, statusCode: 401, error: "Authentication required." };
  const isRecOrAdmin = user.role === "RECORDS" || user.role === "ADMIN";
  if (!isRecOrAdmin) {
    rec.returnedToOffice = "";
    rec.dateReceivedBack = "";
    rec.recNo = "";
    rec.recordsDateReceived = "";
    rec.recordsTimeReceived = "";
    rec.recordsReceivedBy = "";
    rec.finalDispatchMode = "";
    rec.dispatchDetails = "";
    rec.dateDispatched = "";
  }
  return writeOutgoingRowDirect_(rec);
}

function deleteIncoming(controlNo) {
  const ss = getBook_();
  const sh = ss.getSheetByName("Incoming_DTS");
  const lastRow = Math.max(4, sh.getLastRow());
  const ids = sh.getRange(4, 1, lastRow - 3, 1).getValues().map((r) => String(r[0] || ""));
  const idx = ids.indexOf(String(controlNo));
  if (idx >= 0) sh.deleteRow(idx + 4);
  return { ok: true };
}

function deleteOutgoing(recNo) {
  const ss = getBook_();
  const sh = ss.getSheetByName("Outgoing_DTS");
  const lastRow = Math.max(4, sh.getLastRow());
  const ids = sh.getRange(4, 1, lastRow - 3, 1).getValues().map((r) => String(r[0] || ""));
  const idx = ids.indexOf(String(recNo));
  if (idx >= 0) sh.deleteRow(idx + 4);
  return { ok: true };
}

function saveSettings(meta, token) {
  const user = getSessionUser_(token);
  if (!user || (user.role !== "ADMIN" && user.role !== "RECORDS")) return { ok: false, statusCode: 403, error: "Admin or Records access required." };
  const ss = getBook_();
  const cfg = ss.getSheetByName("Lists_Config");
  if (meta.address !== undefined) cfg.getRange("R8").setValue(meta.address);
  if (meta.telefax !== undefined) cfg.getRange("R9").setValue(meta.telefax);
  if (meta.website !== undefined) cfg.getRange("R10").setValue(meta.website);
  if (meta.regionalDirector !== undefined) cfg.getRange("R11").setValue(meta.regionalDirector);
  if (meta.incomingFormCode !== undefined) cfg.getRange("R12").setValue(meta.incomingFormCode);
  return { ok: true };
}

// ----------------- Issuances Sync (One Tab Per Sub-Category: Issuance_Order, Issuance_Memo, etc.) -----------------
function getIssuanceSheetName_(category) {
  const clean = String(category || "General")
    .trim()
    .replace(/[:\\/?*\[\]]+/g, " ")
    .replace(/\s+/g, "_")
    .slice(0, 85);
  return "Issuance_" + (clean || "General");
}

function formatIssuanceCellForSheet_(rec, col) {
  const k = col.key;
  if (k === "pdfFile") {
    const att = rec.attachmentFile;
    if (!att) return "";
    return String(att.driveUrl || att.url || att.name || "");
  }
  if (col.builtin) {
    return String(rec[k] == null ? "" : rec[k]);
  }
  const raw = (rec.customFields && rec.customFields[k]) || "";
  if (col.type === "multi_names" && raw) {
    const names = String(raw)
      .split(/\r?\n|;/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    return names.map(function (n, i) { return (i + 1) + ". " + n; }).join("\n");
  }
  return String(raw);
}

function syncIssuanceTabDirect_(body) {
  const ss = getBook_();
  const category = String(body.category || "General").trim();
  const sheetName = getIssuanceSheetName_(category);
  const cols = Array.isArray(body.columns) && body.columns.length
    ? body.columns
    : [
        { key: "issuanceNo", label: "Issuance No.", builtin: true, type: "text" },
        { key: "category", label: "Sub-Category", builtin: true, type: "text" },
        { key: "dateIssued", label: "Date Issued", builtin: true, type: "date" },
        { key: "originatingDivision", label: "Originating Unit", builtin: true, type: "text" },
        { key: "subject", label: "Subject / Title", builtin: true, type: "text" },
        { key: "issuedBy", label: "Issued By", builtin: true, type: "text" },
        { key: "pdfFile", label: "PDF file", builtin: true, type: "pdf" },
      ];
  const records = Array.isArray(body.records)
    ? body.records
    : (body.record ? [body.record] : []);

  let sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
  } else {
    sh.clearContents();
  }

  const headers = ["Record ID"]
    .concat(cols.map(function (c) { return String(c.label || c.key); }))
    .concat(["Case No. / Ref No.", "Encoded By", "Last Updated"]);

  const rows = records.map(function (rec) {
    const dockets = String(rec.refNo || "")
      .split(/\r?\n|;/)
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    const formattedRef = dockets.length > 1
      ? dockets.map(function (d, i) { return (i + 1) + ". " + d; }).join("\n")
      : (dockets[0] || "");
    return [String(rec.id || "")]
      .concat(cols.map(function (c) { return formatIssuanceCellForSheet_(rec, c); }))
      .concat([
        formattedRef,
        String(rec.createdBy || ""),
        String(rec.updatedAt || rec.createdAt || ""),
      ]);
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
  sh.hideColumns(1); // Hide internal Record ID column cleanly

  return { ok: true, sheetName: sheetName, rowCount: rows.length };
}

function renameIssuanceTabDirect_(body) {
  const ss = getBook_();
  const oldName = getIssuanceSheetName_(body.fromCategory);
  const newName = getIssuanceSheetName_(body.toCategory);
  const oldSh = ss.getSheetByName(oldName);
  if (oldSh && oldName !== newName && !ss.getSheetByName(newName)) {
    oldSh.setName(newName);
  }
  return syncIssuanceTabDirect_({
    category: body.toCategory,
    columns: body.columns,
    records: body.records,
  });
}

function authorizeAllPermissions() {
  SpreadsheetApp.openById(SPREADSHEET_ID).getName();
  DriveApp.getFolderById(DRIVE_FOLDER_ID).getName();
  MailApp.getRemainingDailyQuota();
  return "Authorized Spreadsheet, Drive, and MailApp!";
}

// ----------------- Mailing Process Sync (One Tab Per Courier: Mailing_PhilPost, Mailing_JRS, etc.) -----------------
function getMailingSheetName_(courier) {
  const clean = String(courier || "General")
    .trim()
    .replace(/[:\\/?*\[\]]+/g, " ")
    .replace(/\s+/g, "_")
    .slice(0, 85);
  return "Mailing_" + (clean || "General");
}

function syncMailingTabDirect_(body) {
  const ss = getBook_();
  const courier = String(body.courier || "PhilPost").trim();
  const sheetName = getMailingSheetName_(courier);
  const records = Array.isArray(body.records) ? body.records : [];

  let sh = ss.getSheetByName(sheetName);
  if (!sh) {
    sh = ss.insertSheet(sheetName);
  } else {
    sh.clearContents();
  }

  const headers = [
    "Record ID",
    "Mailing / Control No.",
    "Courier",
    "Type of Document",
    "Date Mailed",
    "Addressee / Recipient",
    "Tracking / Registry / Waybill No.",
    "Date Received / Return Card",
    "Province",
    "Complete Address",
    "Document / Case Ref. No.",
    "Subject / Particulars",
    "Originating Unit",
    "Mailed By",
    "Postage / Amount (PHP)",
    "Status",
    "Remarks",
    "PDF / Receipt",
    "Last Updated",
  ];

  const rows = records.map(function (r) {
    const att = r.attachmentFile;
    const pdfVal = att ? String(att.driveUrl || att.url || att.name || "") : "";
    const addrs = Array.isArray(r.addressees) && r.addressees.length
      ? r.addressees
      : [{ name: r.recipientName || "", trackingNo: r.trackingNo || "", dateReceived: r.dateReceived || "" }];
    const fmtList = function (arr) {
      return arr.length > 1
        ? arr.map(function (v, i) { return (i + 1) + ". " + (v || "—"); }).join("\n")
        : String(arr[0] || "");
    };
    return [
      String(r.id || ""),
      String(r.mailingNo || ""),
      String(r.courier || courier),
      String(r.docType || ""),
      String(r.dateMailed || ""),
      fmtList(addrs.map(function (a) { return a.name || ""; })),
      fmtList(addrs.map(function (a) { return a.trackingNo || ""; })),
      fmtList(addrs.map(function (a) { return a.dateReceived || ""; })),
      String(r.province || ""),
      String(r.recipientAddress || ""),
      String(r.docRefNo || ""),
      String(r.subject || ""),
      String(r.originatingDivision || ""),
      String(r.mailedBy || ""),
      String(r.amount || ""),
      String(r.status || ""),
      String(r.remarks || ""),
      pdfVal,
      String(r.updatedAt || r.createdAt || ""),
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

  return { ok: true, sheetName: sheetName, rowCount: rows.length };
}

function renameMailingTabDirect_(body) {
  const ss = getBook_();
  const oldName = getMailingSheetName_(body.fromCourier);
  const newName = getMailingSheetName_(body.toCourier);
  const oldSh = ss.getSheetByName(oldName);
  if (oldSh && oldName !== newName && !ss.getSheetByName(newName)) {
    oldSh.setName(newName);
  }
  return syncMailingTabDirect_({ courier: body.toCourier, records: body.records });
}
