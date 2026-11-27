const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
const js = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

const gasShim = `
// Google Apps Script transparent fetch adapter (supports Auth, RBAC, and CRUD)
(function () {
  if (typeof google === "undefined" || !google.script || !google.script.run) return;
  const callGas = (fn, ...args) => new Promise((resolve, reject) => {
    google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...args);
  });
  window.fetch = async function (url, opts) {
    const method = ((opts && opts.method) || "GET").toUpperCase();
    const headers = (opts && opts.headers) || {};
    const auth = headers.Authorization || headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const body = opts && opts.body ? JSON.parse(opts.body) : {};
    let resData = {};
    if (url === "/api/public/divisions") resData = await callGas("getPublicDivisions");
    else if (url === "/api/auth/login") resData = await callGas("authLogin", body);
    else if (url === "/api/auth/register") resData = await callGas("authRegister", body);
    else if (url === "/api/auth/logout") resData = await callGas("authLogout", token);
    else if (url === "/api/state") resData = await callGas("getState", token);
    else if (url.startsWith("/api/next-number")) {
      const sp = new URLSearchParams(url.split("?")[1] || "");
      resData = await callGas("getNextNumber", sp.get("type") || "incoming", sp.get("date") || "", token, sp.get("category") || "External", sp.get("year") || "", sp.get("division") || "");
    } else if (url === "/api/upload-pdf" && method === "POST") resData = await callGas("uploadPdfAttachment", body, token);
    else if (url === "/api/incoming" && method === "POST") resData = await callGas("upsertIncoming", body, token);
    else if (url === "/api/outgoing" && method === "POST") resData = await callGas("upsertOutgoing", body, token);
    else if (url.startsWith("/api/users/") && url.endsWith("/status") && method === "PUT") {
      const uid = decodeURIComponent(url.slice("/api/users/".length, -"/status".length));
      resData = await callGas("updateUserApprovalStatus", uid, body.approvalStatus || "APPROVED", token);
    } else if (url.startsWith("/api/users/") && method === "DELETE") {
      resData = await callGas("deleteUserAccount", decodeURIComponent(url.slice("/api/users/".length)), token);
    } else if (url === "/api/settings" && method === "PUT") resData = await callGas("saveSettings", body.meta || {}, token);
    const ok = resData && !resData.error;
    return { ok, status: resData && resData.statusCode ? resData.statusCode : (ok ? 200 : 400), json: async () => resData };
  };
})();
`;

const logoPath = path.join(root, "public", "dar-ro8-logo.jpg");
const logoDataUri = fs.existsSync(logoPath)
  ? "data:image/jpeg;base64," + fs.readFileSync(logoPath).toString("base64")
  : "/dar-ro8-logo.jpg";

const bundled = html
  .replace('<link rel="stylesheet" href="/styles.css" />', "<style>\n" + css + "\n</style>")
  .replace('<script src="/app.js"></script>', "<script>\n" + gasShim + "\n" + js + "\n</script>")
  .split("/dar-ro8-logo.jpg").join(logoDataUri);

const outPath = path.join(root, "google-apps-script", "Index.html");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, bundled, "utf8");
console.log("Built google-apps-script/Index.html (" + bundled.length + " bytes)");
