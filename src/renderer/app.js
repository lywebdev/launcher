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
  const engineModal = document.getElementById('engineModal');
  const engineStatusText = document.getElementById('engineStatusText');
  const engineInstallBtn = document.getElementById('engineInstallBtn');
  const engineExitBtn = document.getElementById('engineExitBtn');
  const forceEngineBtn = document.getElementById('forceEngineBtn');
  const engineProgressViews = [
    {
      container: document.getElementById('engineProgressModal'),
      fill: document.getElementById('engineProgressModalFill'),
      text: document.getElementById('engineProgressModalText'),
      timeoutId: null
    },
    {
      container: document.getElementById('engineProgressInline'),
      fill: document.getElementById('engineProgressInlineFill'),
      text: document.getElementById('engineProgressInlineText'),
      timeoutId: null
    }
  ];
  let engineReady = true;

  const updateEngineProgress = ({ phase = 'download', percent = 0, active = false }) => {
    const labels = {
      start: 'Подготовка установки',
      download: 'Загрузка архива',
      extract: 'Распаковка файлов',
      done: 'Готово',
      error: 'Ошибка установки'
    };
    const caption =
      phase === 'start' || phase === 'error'
        ? labels[phase] || 'Прогресс'
        : `${labels[phase] || 'Прогресс'} — ${Math.round(percent)}%`;

    engineProgressViews.forEach((view) => {
      if (!view.container) return;
      if (view.timeoutId) {
        clearTimeout(view.timeoutId);
        view.timeoutId = null;
      }

      if (!active) {
        if (phase === 'done') {
          view.container.hidden = false;
          if (view.fill) view.fill.style.width = '100%';
          if (view.text) view.text.textContent = labels.done;
          view.timeoutId = window.setTimeout(() => {
            view.container.hidden = true;
            view.timeoutId = null;
          }, 1200);
        } else if (phase === 'error') {
          view.container.hidden = false;
          if (view.fill) view.fill.style.width = '0%';
          if (view.text) view.text.textContent = labels.error;
          view.timeoutId = window.setTimeout(() => {
            view.container.hidden = true;
            view.timeoutId = null;
          }, 1500);
        } else {
          view.container.hidden = true;
        }
        return;
      }

      view.container.hidden = false;
      if (view.fill) {
        const width = Math.min(100, Math.max(0, phase === 'start' ? 5 : Math.round(percent)));
        view.fill.style.width = `${width}%`;
      }
      if (view.text) {
        view.text.textContent = caption;
      }
    });

    if (engineStatusText && (active || phase === 'error')) {
      engineStatusText.textContent = caption;
    }
  };

  const showEngineModal = (visible) => {
    if (!engineModal) return;
    engineModal.classList.toggle('visible', visible);
  };

  const handleEngineStatus = (ready) => {
    engineReady = ready;
    if (ready) {
      showEngineModal(false);
      engineStatusText && (engineStatusText.textContent = '');
      launchBtn.disabled = false;
    } else {
      showEngineModal(true);
      if (engineStatusText) {
        engineStatusText.textContent =
          'Чтобы продолжить, установите дополнительные файлы лаунчера.';
      }
      if (engineInstallBtn) {
        engineInstallBtn.disabled = false;
        engineInstallBtn.textContent = 'Установить';
      }
      launchBtn.disabled = true;
    }
  };

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
  handleEngineStatus(Boolean(config.engineReady));

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

  if (engineInstallBtn) {
    engineInstallBtn.addEventListener('click', async () => {
      engineInstallBtn.disabled = true;
      engineInstallBtn.textContent = 'Устанавливаем...';
      if (engineStatusText) {
        engineStatusText.textContent = 'Скачиваем и распаковываем архив...';
      }
      updateEngineProgress({ phase: 'start', percent: 0, active: true });
      appendLog('Загрузка компонентов лаунчера...');
      const result = await window.launcherApi.installEngine();
      if (result.ok) {
        engineStatusText && (engineStatusText.textContent = 'Компоненты установлены.');
        engineInstallBtn.textContent = 'Готово';
      } else {
        engineStatusText &&
          (engineStatusText.textContent = `Ошибка установки: ${result.error || 'неизвестно'}`);
        engineInstallBtn.disabled = false;
        engineInstallBtn.textContent = 'Повторить';
      }
    });
  }

  if (engineExitBtn) {
    engineExitBtn.addEventListener('click', () => window.launcherApi.close());
  }

  if (forceEngineBtn) {
    forceEngineBtn.addEventListener('click', async () => {
      if (forceEngineBtn.disabled) return;
      const confirmed = window.confirm(
        'Переустановить компоненты лаунчера? Текущие файлы Minecraft могут быть перезаписаны.'
      );
      if (!confirmed) {
        return;
      }
      forceEngineBtn.disabled = true;
      const defaultText = forceEngineBtn.textContent;
      forceEngineBtn.textContent = 'Обновляем...';
      appendLog('Принудительная установка компонентов лаунчера...');
      const result = await window.launcherApi.installEngine();
      if (!result.ok) {
        appendLog(`Ошибка принудительной установки: ${result.error || 'неизвестно'}`);
        setStatus('Ошибка установки компонентов');
      } else {
        setStatus('Компоненты обновлены');
      }
      forceEngineBtn.textContent = defaultText;
      forceEngineBtn.disabled = false;
    });
  }

  window.launcherApi.onEngineStatus((payload) => {
    if (payload && typeof payload.ready === 'boolean') {
      handleEngineStatus(payload.ready);
    }
  });
  window.launcherApi.onEngineProgress((payload) => {
    if (!payload) return;
    updateEngineProgress(payload);
  });

  launchBtn.addEventListener('click', async () => {
    if (!engineReady) {
      setStatus('Установите компоненты лаунчера');
      appendLog('Ошибка: нужно установить компоненты лаунчера');
      return;
    }
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
