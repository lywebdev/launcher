const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, exec } = require('child_process');
const { Client, Authenticator } = require('minecraft-launcher-core');

const getAppDataPath = () => {
  if (process.platform === 'win32') {
    return process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support');
  }
  return process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
};

class LauncherService {
  constructor(config) {
    this.config = config;
  }

  async launch(payload, forgeProfileName, onLog) {
    if (this.config.customLaunch && this.config.customLaunch.enabled) {
      return this.launchCustom(payload, onLog);
    }
    return this.launchDefault(payload, forgeProfileName, onLog);
  }

  launchDefault({ username, uuid, authToken, minMemory, maxMemory }, forgeProfileName, onLog) {
    return new Promise((resolve, reject) => {
      const launcher = new Client();
      const authorization = authToken
        ? { access_token: authToken, client_token: uuid, uuid, name: username, user_properties: '[]', meta: { type: 'msa' } }
        : Authenticator.getAuth(username || 'Player');

      const options = {
        authorization,
        root: this.config.minecraftDir,
        version: {
          number: this.config.forge.mcVersion,
          type: 'release',
          custom: forgeProfileName
        },
        memory: {
          max: maxMemory || this.config.java.maxMemory,
          min: minMemory || this.config.java.minMemory
        },
        forgeProfile: forgeProfileName,
        server: this.config.server.address,
        port: this.config.server.port,
        window: {
          width: 854,
          height: 480
        }
      };

      const callback = (log) => onLog && onLog(log);
      launcher.on('debug', callback);
      launcher.on('data', callback);

      launcher.launch(options);
      launcher.once('close', (code) => {
        launcher.removeListener('debug', callback);
        launcher.removeListener('data', callback);
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Minecraft exited with code ${code}`));
        }
      });
      launcher.once('error', (err) => {
        launcher.removeListener('debug', callback);
        launcher.removeListener('data', callback);
        reject(err);
      });
    });
  }

  launchCustom({ username, minMemory, maxMemory }, onLog) {
    return new Promise((resolve, reject) => {
      const custom = this.config.customLaunch || {};
      const appDataDir = this.config.appDataPath || getAppDataPath();
      const normalize = (value) => (value ? value.replace(/\\/g, '/') : value);
      const placeholders = {
        username: username || 'Player',
        minMemory: minMemory || this.config.java.minMemory,
        maxMemory: maxMemory || this.config.java.maxMemory,
        minecraftDir: this.config.minecraftDir,
        minecraftDirForward: normalize(this.config.minecraftDir || ''),
        appData: appDataDir,
        appDataForward: normalize(appDataDir)
      };
      const applyPlaceholders = (value) => {
        if (typeof value !== 'string') {
          return value;
        }
        return value.replace(/\{(\w+)\}/g, (_, key) => placeholders[key] ?? '');
      };

      const mapValue = (value) => applyPlaceholders(value);

      const prepareArgsFile = () => {
        if (!custom.argsTemplate) {
          return null;
        }
        const template = fs.readFileSync(custom.argsTemplate, 'utf-8');
        const rendered = applyPlaceholders(template);
        const cwd = mapValue(custom.workDir) || this.config.minecraftDir;
        const rawName = custom.argsFileName || 'launcher.args';
        const resolvedName = applyPlaceholders(rawName);
        const targetPath = path.isAbsolute(resolvedName) ? resolvedName : path.join(cwd, resolvedName);
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, rendered, 'utf-8');
        placeholders.argsFilePath = targetPath;
        placeholders.argsFileName = path.basename(targetPath);
        onLog && onLog(`Args file written: ${targetPath}`);
        return targetPath;
      };

      try {
        if (custom.argsTemplate) {
          prepareArgsFile();
        }
      } catch (err) {
        return reject(err);
      }

      if (custom.command) {
        const shellCommand = mapValue(custom.command);
        const cwd = mapValue(custom.workDir) || this.config.minecraftDir;
        onLog && onLog(`Shell command: ${shellCommand}`);
        if (process.platform === 'win32') {
          const child = exec(shellCommand, { cwd });
          child.stdout.on('data', (chunk) => onLog && onLog(chunk.toString().trim()));
          child.stderr.on('data', (chunk) => onLog && onLog(chunk.toString().trim()));
          child.on('error', reject);
          child.on('close', (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`Java exited with code ${code}`));
            }
          });
          return;
        }
        const shell = custom.shell || '/bin/sh';
        const shellArgs = ['-c', shellCommand];
        const child = spawn(shell, shellArgs, {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        child.stdout.on('data', (chunk) => onLog && onLog(chunk.toString().trim()));
        child.stderr.on('data', (chunk) => onLog && onLog(chunk.toString().trim()));
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Java exited with code ${code}`));
          }
        });
        return;
      }

      const jvmArgs = (custom.jvmArgs || []).map(mapValue);
      const args = [...jvmArgs];

      if (custom.classpath && custom.classpath.length > 0) {
        const classpath = custom.classpath.map(mapValue).join(path.delimiter);
        args.push('-cp', classpath);
      }

      const mainClass = custom.mainClass || 'cpw.mods.bootstraplauncher.BootstrapLauncher';
      const gameArgs = (custom.gameArgs || []).map(mapValue);
      args.push(mainClass, ...gameArgs);

      const javaExec = mapValue(custom.javaPath) || this.config.java.executable || 'java';
      const cwd = mapValue(custom.workDir) || this.config.minecraftDir;
      if (onLog) {
        const printableArgs = args
          .map((arg) => (typeof arg === 'string' && arg.includes(' ') ? '"' + arg + '"' : arg))
          .join(' ');
        onLog(`Command: ${javaExec} ${printableArgs}`);
      }
      const child = spawn(javaExec, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      child.stdout.on('data', (chunk) => onLog && onLog(chunk.toString().trim()));
      child.stderr.on('data', (chunk) => onLog && onLog(chunk.toString().trim()));
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Java exited with code ${code}`));
        }
      });
    });
  }
}

module.exports = LauncherService;
