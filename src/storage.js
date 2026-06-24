// storage.js — Simple JSON-based persistent storage
const fs = require("fs");
const path = require("path");

const DATA_FILE = path.join(process.env.DATA_DIR || __dirname, "data.json");

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    return { guilds: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    console.error("⚠️  Failed to parse data.json, resetting.");
    return { guilds: {} };
  }
}

function saveData(data) {
  // Write to a temp file then rename, so a crash mid-write can't corrupt data.json.
  const tmpFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmpFile, DATA_FILE);
}

module.exports = { loadData, saveData };
