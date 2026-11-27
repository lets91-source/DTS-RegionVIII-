const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
const js = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");

const gasShim = `
// Google Apps Script unified fetch adapter (Full Auth/OTP, RBAC, Incoming/Outgoing/Issuance/Mailing, Emails & Drive PDFs)
(function () {
  if (typeof google === "undefined" || !google.script || !google.script.run) return;
  const callGas = (fn, ...args) => new Promise((resolve, reject) => {
    google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[fn](...args);
  });
  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^;]+;base64,/i, ""));
    reader.onerror = () => reject(new Error("Failed to read file for Google Drive upload."));
    reader.readAsDataURL(blob);
  });
  window.fetch = async function (url, opts) {
    const method = ((opts && opts.method) || "GET").toUpperCase();
    const rawHeaders = (opts && opts.headers) || {};
    const headers = {};
    Object.keys(rawHeaders).forEach((k) => { headers[k.toLowerCase()] = rawHeaders[k]; });
    const auth = headers["authorization"] || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";

    let body = {};
    if (opts && opts.body !== undefined && opts.body !== null) {
      if (typeof Blob !== "undefined" && opts.body instanceof Blob) {
        const base64 = await blobToBase64(opts.body);
        body = {
          filename: decodeURIComponent(headers["x-filename"] || (opts.body.name || "attachment.pdf")),
          controlNo: decodeURIComponent(headers["x-control-no"] || ""),
          base64,
        };
      } else if (typeof opts.body === "string") {
        try { body = JSON.parse(opts.body); } catch (_) { body = { raw: opts.body }; }
      } else if (typeof opts.body === "object") {
        body = opts.body;
      }
    }

    const resData = await callGas("gasApiDispatch", {
      url: String(url || ""),
      method,
      token,
      body,
    });
    const ok = !!(resData && !resData.error && (resData.statusCode === undefined || resData.statusCode < 400));
    const status = resData && resData.statusCode ? resData.statusCode : (ok ? 200 : 400);
    return { ok, status, json: async () => resData || {} };
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
