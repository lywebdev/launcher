const domReady = (cb) => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', cb);
  } else {
    cb();
  }
};

domReady(async () => {
  const usernameInput = document.getElementById('username');
  const launchBtn = document.getElementById('launchBtn');
  const logView = document.getElementById('logView');
  const statusTag = document.getElementById('statusTag');
  const modsSummary = document.getElementById('modsSummary');
  const modsList = document.getElementById('modsList');
  const serverAddress = document.getElementById('serverAddress');
  const serverVersion = document.getElementById('serverVersion');
  const minMem = document.getElementById('minMem');
  const maxMem = document.getElementById('maxMem');
  const modsCount = document.getElementById('modsCount');
  const panels = document.querySelectorAll('.panel');
  const menu = document.getElementById('menu');

  const switchPanel = (target) => {
    panels.forEach((panel) => {
      if (panel.dataset.panel === target) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });
    menu.querySelectorAll('li').forEach((item) => {
      if (item.dataset.panel === target) {
        item.classList.add('active');
      } else {
        item.classList.remove('active');
      }
    });
  };

  menu.addEventListener('click', (event) => {
    const item = event.target.closest('li[data-panel]');
    if (!item) return;
    switchPanel(item.dataset.panel);
  });

  const renderMods = (statuses = []) => {
    if (modsCount) {
      const installed = statuses.filter((mod) => mod.installed).length;
      modsCount.textContent = `${installed}/${statuses.length}`;
    }

    const template = (mod) => `
      <li>
        <span class="mod-dot ${mod.installed ? 'installed' : 'missing'}"></span>
        <div>
          <p class="mod-name">${mod.name}</p>
          <p class="mod-state">${mod.installed ? 'Установлен' : 'Не найден'}</p>
        </div>
      </li>`;

    if (modsSummary) {
      modsSummary.innerHTML = statuses.map(template).join('');
    }
    if (modsList) {
      modsList.innerHTML = statuses.map(template).join('');
    }
  };

  const config = await window.launcherApi.getConfig();
  if (config.lastUsername) {
    usernameInput.value = config.lastUsername;
  }
  serverAddress.textContent = `${config.server.address}:${config.server.port}`;
  serverVersion.textContent = `${config.forge.mcVersion} Forge`;
  renderMods(config.status || []);

  document.getElementById('copyIp').addEventListener('click', async () => {
    await navigator.clipboard.writeText(`${config.server.address}:${config.server.port}`);
    setStatus('IP скопирован');
  });

  document.getElementById('openMods').addEventListener('click', () => {
    window.launcherApi.openMods();
  });

  document.getElementById('clearLog').addEventListener('click', () => {
    logView.innerHTML = '';
  });

  const appendLog = (message) => {
    const p = document.createElement('p');
    p.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
    logView.appendChild(p);
    logView.scrollTop = logView.scrollHeight;
  };

  window.launcherApi.onLog((message) => appendLog(message));
  window.launcherApi.onModsStatus((statuses) => renderMods(statuses));

  const setStatus = (text) => {
    statusTag.textContent = text;
  };

  const windowMinimize = document.getElementById('windowMinimize');
  const windowClose = document.getElementById('windowClose');
  if (windowMinimize) {
    windowMinimize.addEventListener('click', () => window.launcherApi.minimize());
  }
  if (windowClose) {
    windowClose.addEventListener('click', () => window.launcherApi.close());
  }

  launchBtn.addEventListener('click', async () => {
    const username = (usernameInput.value || '').trim();
    if (!username) {
      setStatus('Укажите ник');
      appendLog('Ошибка: ник не указан');
      return;
    }
    launchBtn.disabled = true;
    setStatus('Запуск...');
    appendLog('==== Старт ===');
    const response = await window.launcherApi.launch({
      username,
      minMemory: minMem.value,
      maxMemory: maxMem.value
    });
    if (response.ok) {
      setStatus('Клиент запущен');
      appendLog('Minecraft запущен. Удачной игры!');
    } else {
      setStatus('Ошибка');
      appendLog(`Ошибка: ${response.error}`);
    }
    launchBtn.disabled = false;
  });
});
