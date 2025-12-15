const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(__dirname, '../../config/launcher.config.json');
const CONFIG_DIR = path.dirname(CONFIG_PATH);

const defaultMinecraftDir = () => {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), '.minecraft');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'minecraft');
  }
  return path.join(home, '.minecraft');
};

function loadConfig() {
  const file = fs.readFileSync(CONFIG_PATH, 'utf-8');
  const parsed = JSON.parse(file);
  parsed.minecraftDir = parsed.minecraftDir || defaultMinecraftDir();
  parsed.runtimeDir = parsed.runtimeDir || path.join(process.cwd(), '.launcher');
  parsed.java = parsed.java || {};
  parsed.java.minMemory = parsed.java.minMemory || '2G';
  parsed.java.maxMemory = parsed.java.maxMemory || '4G';
  parsed.java.executable = parsed.java.executable || 'java';
  parsed.modsRepo = parsed.modsRepo || {};
  parsed.customLaunch = parsed.customLaunch || { enabled: false };
  if (parsed.customLaunch.argsTemplate) {
    parsed.customLaunch.argsTemplate = path.resolve(CONFIG_DIR, parsed.customLaunch.argsTemplate);
  }
  if (parsed.customLaunch && parsed.customLaunch.argsFileName === undefined) {
    parsed.customLaunch.argsFileName = 'launcher.args';
  }
  parsed.forge.profileName = parsed.forge.profileName || `${parsed.forge.mcVersion}-forge-${parsed.forge.version}`;
  return parsed;
}

module.exports = loadConfig();
