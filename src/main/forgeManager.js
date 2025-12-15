const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');

const ensureDir = (dir) => fs.promises.mkdir(dir, { recursive: true });
const fileExists = async (p) => !!(await fs.promises.stat(p).catch(() => null));

class ForgeManager {
  constructor(config, runtimeDir, javaConfig = {}) {
    this.config = config;
    this.runtimeDir = runtimeDir;
    this.javaExecutable = javaConfig.executable || 'java';
  }

  get profileName() {
    return this.config.profileName || `${this.config.mcVersion}-forge-${this.config.version}`;
  }

  async ensureInstalled(minecraftDir, onProgress) {
    const versionDir = path.join(minecraftDir, 'versions', this.profileName);
    if (await fileExists(versionDir)) {
      return versionDir;
    }

    onProgress && onProgress('Скачиваем Forge');
    const installerPath = await this.downloadInstaller();
    onProgress && onProgress('Устанавливаем Forge');
    await this.installForge(installerPath, minecraftDir);
    return versionDir;
  }

  async downloadInstaller() {
    const installerFolder = path.join(this.runtimeDir, 'forge');
    await ensureDir(installerFolder);
    const target = path.join(installerFolder, `forge-${this.config.mcVersion}-${this.config.version}-installer.jar`);
    if (await fileExists(target)) {
      return target;
    }
    const response = await fetch(this.config.installerUrl);
    if (!response.ok) {
      throw new Error(`Forge installer download failed: ${response.status}`);
    }
    await pipeline(response.body, fs.createWriteStream(target));
    return target;
  }

  installForge(installer, minecraftDir) {
    return new Promise((resolve, reject) => {
      const javaArgs = ['-jar', installer, '--installClient', minecraftDir];
      const child = spawn(this.javaExecutable, javaArgs, { stdio: 'inherit' });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Forge installer exited with code ${code}`));
        }
      });
    });
  }
}

module.exports = ForgeManager;
