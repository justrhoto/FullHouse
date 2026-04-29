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
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
}

module.exports = { loadData, saveData };
