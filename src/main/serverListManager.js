const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const nbt = require('prismarine-nbt');

const ensureDir = async (dir) => fs.promises.mkdir(dir, { recursive: true });

const parseNbt = (buffer) =>
  new Promise((resolve, reject) => {
    nbt.parse(buffer, (err, data) => {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  });

const writeGzipNbt = async (root) => {
  const uncompressed = nbt.writeUncompressed(root);
  return zlib.gzipSync(uncompressed);
};

const buildEntryFields = (serverName, ip) => ({
  name: { type: 'string', value: serverName },
  ip: { type: 'string', value: ip },
  acceptTextures: { type: 'byte', value: 0 },
  icon: { type: 'string', value: '' },
  resourcePack: { type: 'string', value: '' },
  // hidden flag is optional, keep it false by default
  hidden: { type: 'byte', value: 0 }
});

class ServerListManager {
  constructor(minecraftDir) {
    this.minecraftDir = minecraftDir;
    this.serversFile = path.join(this.minecraftDir, 'servers.dat');
  }

  async ensureServer(serverConfig) {
    if (!serverConfig || !this.minecraftDir) {
      return false;
    }
    await ensureDir(this.minecraftDir);
    const ip = `${serverConfig.address}:${serverConfig.port}`;
    let currentList = [];
    try {
      const raw = await fs.promises.readFile(this.serversFile);
      const parsed = await parseNbt(raw);
      const entries = parsed?.value?.servers?.value?.value;
      if (Array.isArray(entries)) {
        currentList = entries;
      }
    } catch (error) {
      // ignore parse errors, we'll recreate file
      currentList = [];
    }

    let updated = false;
    const normalized = currentList.map((entry) => {
      const entryIp = entry?.value?.ip?.value;
      if (entryIp === ip) {
        updated = true;
        return {
          name: '',
          value: {
            ...entry.value,
            name: { type: 'string', value: serverConfig.name },
            ip: { type: 'string', value: ip }
          }
        };
      }
      return entry;
    });

    if (!updated) {
      normalized.push({ name: '', value: buildEntryFields(serverConfig.name, ip) });
    }

    const root = {
      name: '',
      value: {
        servers: {
          type: 'list',
          value: {
            type: 'compound',
            value: normalized
          }
        }
      }
    };
    const gzData = await writeGzipNbt(root);
    await fs.promises.writeFile(this.serversFile, gzData);
    return true;
  }
}

module.exports = ServerListManager;
