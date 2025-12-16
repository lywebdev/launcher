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
  const statusTitle = document.getElementById('statusTitle');
  const statusSubtitle = document.getElementById('statusSubtitle');
  const statusMessage = document.getElementById('statusMessage');
  if (statusMessage) {
    statusMessage.textContent = '';
  }
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
  const cancelEngineBtn = document.getElementById('cancelEngineBtn');
  const deleteAllModsBtn = document.getElementById('deleteAllModsBtn');
  const reinstallModsBtn = document.getElementById('reinstallModsBtn');
  const modsProgressText = document.getElementById('modsProgressText');
  const memorySlider = document.getElementById('memorySlider');
  const minMemInput = document.getElementById('minMem');
  const maxMemInput = document.getElementById('maxMem');
  const minMemLabel = document.getElementById('minMemLabel');
  const maxMemLabel = document.getElementById('maxMemLabel');
  const javaModal = document.getElementById('javaModal');
  const javaDownloadBtn = document.getElementById('javaDownloadBtn');
  const javaDismissBtn = document.getElementById('javaDismissBtn');
  const usernameError = document.getElementById('usernameError');
  const bootOverlay = document.getElementById('bootOverlay');
  const bootOverlayText = document.getElementById('bootOverlayText');
  const copyIpBtn = document.getElementById('copyIp');
  const confirmModal = document.getElementById('confirmModal');
  const confirmTitle = document.getElementById('confirmTitle');
  const confirmMessage = document.getElementById('confirmMessage');
  const confirmOkBtn = document.getElementById('confirmOkBtn');
  const confirmCancelBtn = document.getElementById('confirmCancelBtn');
  const engineProgressViews = [
    {
      container: document.getElementById('engineProgressModal'),
      fill: document.getElementById('engineProgressModalFill'),
      text: document.getElementById('engineProgressModalText'),
      timeoutId: null
    }
  ];
  const modProgressState = new Map();
  let repoProgressState = null;
  let currentModStatuses = [];
  let engineReinstallInProgress = false;
  let modsLoading = true;
  let modsReinstalling = false;
  let copyIpResetTimeout = null;
  const nicknamePattern = /^[A-Za-z_]+$/;
  let engineReady = true;
  let javaReady = true;
  let javaDownloadUrl = '';
  const defaultJavaDownloadUrl =
    'https://www.oracle.com/java/technologies/downloads/#jdk17-windows';

  const setBootOverlayMessage = (message) => {
    if (bootOverlayText && message) {
      bootOverlayText.textContent = message;
    }
  };
  let confirmResolver = null;
  const openConfirmModal = ({
    title = 'Подтверждение',
    message = 'Вы уверены?',
    confirmText = 'ОК'
  } = {}) =>
    new Promise((resolve) => {
      confirmResolver = resolve;
      if (confirmTitle) confirmTitle.textContent = title;
      if (confirmMessage) confirmMessage.textContent = message;
      if (confirmOkBtn) confirmOkBtn.textContent = confirmText;
      confirmModal && confirmModal.classList.add('visible');
    });

  const closeConfirmModal = (result) => {
    if (confirmModal) {
      confirmModal.classList.remove('visible');
    }
    if (confirmResolver) {
      confirmResolver(result);
      confirmResolver = null;
    }
  };

  const hideBootOverlay = () => {
    if (bootOverlay) {
      bootOverlay.classList.remove('visible');
    }
  };

  const applyMemorySettings = (maxValue, emitChange = true) => {
    if (!minMemInput || !maxMemInput) return;
    const sanitizedMax = Math.max(3, Number(maxValue) || 3);
    const suggestedMin = Math.max(2, Math.min(sanitizedMax - 1, Math.round(sanitizedMax / 2)));
    minMemInput.value = `${suggestedMin}G`;
    maxMemInput.value = `${sanitizedMax}G`;
    if (minMemLabel) {
      minMemLabel.textContent = `${suggestedMin} ГБ`;
    }
    if (maxMemLabel) {
      maxMemLabel.textContent = `${sanitizedMax} ГБ`;
    }
    if (emitChange) {
      window.launcherApi.storeMemory({ minMemory: minMemInput.value, maxMemory: maxMemInput.value });
    }
  };

  const initMemorySlider = async () => {
    if (!memorySlider) return;
    let totalMem = 8;
    let persistedMem = null;
    try {
      const info = await window.launcherApi.getSystemInfo();
      if (info?.totalMemGB) {
        totalMem = Math.max(info.totalMemGB, 4);
      }
    } catch {
      // ignore
    }
    try {
      const persisted = await window.launcherApi.getConfig();
      if (persisted?.lastMemory) {
        persistedMem = persisted.lastMemory;
      }
    } catch {
      // ignore
    }
    const safeTotal = Math.max(4, totalMem);
    const maxSelectable = Math.max(4, Math.min(32, Math.floor(safeTotal * 0.85)));
    let recommended = Math.max(3, maxSelectable);
    if (persistedMem?.max) {
      const numeric = Number(persistedMem.max.replace(/[^0-9.]/g, ''));
      if (!Number.isNaN(numeric)) {
        recommended = Math.min(maxSelectable, Math.max(3, numeric));
      }
    }
    memorySlider.min = 3;
    memorySlider.max = maxSelectable;
    memorySlider.step = 0.5;
    memorySlider.value = recommended;
    applyMemorySettings(recommended, false);
    memorySlider.addEventListener('input', (event) => {
      applyMemorySettings(Number(event.target.value), true);
    });
  };

  const updateModsProgressText = () => {
    if (!modsProgressText) return;
    if (repoProgressState && repoProgressState.state !== 'done') {
      const labels = {
        download: 'Загрузка репозитория модов',
        extract: 'Распаковка репозитория',
        start: 'Подготовка репозитория'
      };
      const percentText =
        typeof repoProgressState.percent === 'number'
          ? `${Math.round(repoProgressState.percent)}%`
          : '';
      modsProgressText.hidden = false;
      modsProgressText.innerHTML = `
        <span class="progress-spinner" aria-hidden="true"></span>
        <span>${labels[repoProgressState.state] || 'Подготовка модов'} ${
          percentText ? `— ${percentText}` : ''
        }</span>`;
      return;
    }
    if (!modsReinstalling) {
      modsProgressText.hidden = true;
      modsProgressText.textContent = '';
      return;
    }
    const total =
      currentModStatuses.length || modProgressState.size || (modsLoading ? 0 : currentModStatuses.length);
    const values = Array.from(modProgressState.values());
    const completed = values.filter(
      (item) => item && (item.state === 'done' || item.state === 'skipped')
    ).length;
    const installing = values.filter((item) => item && item.state === 'installing').length;
    let message = 'Подготовка синхронизации модов...';
    if (installing > 0 && total > 0) {
      message = `Устанавливается ${installing} из ${total}`;
    } else if (completed > 0 && total > 0) {
      message = `Готово ${completed} из ${total}`;
    }
    if (total > 0 && completed === total) {
      message = 'Моды синхронизированы';
    }
    modsProgressText.hidden = false;
    modsProgressText.textContent = message;
  };

  const updateEngineProgress = ({ phase = 'download', percent = 0, active = false }) => {
    const labels = {
      start: 'Подготовка установки',
      download: 'Загрузка архива',
      extract: 'Распаковка файлов',
      done: 'Готово',
      error: 'Ошибка установки',
      cancelled: 'Установка отменена'
    };
    const caption =
      phase === 'start' || phase === 'error' || phase === 'cancelled'
        ? labels[phase] || 'Прогресс'
        : `${labels[phase] || 'Прогресс'} — ${Math.round(percent)}%`;

    engineProgressViews.forEach((view) => {
      if (!view.container) return;
      if (view.timeoutId) {
        clearTimeout(view.timeoutId);
        view.timeoutId = null;
      }

      if (!active) {
        if (phase === 'done' || phase === 'cancelled') {
          view.container.hidden = false;
          if (view.fill) view.fill.style.width = '100%';
          if (view.text) view.text.textContent = labels[phase] || labels.done;
          view.timeoutId = window.setTimeout(() => {
            view.container.hidden = true;
            view.timeoutId = null;
          }, phase === 'done' ? 1200 : 1500);
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

    if (engineStatusText && (active || phase === 'error' || phase === 'cancelled' || phase === 'done')) {
      engineStatusText.textContent = caption;
    }

    if (!active && engineReinstallInProgress && ['done', 'error', 'cancelled'].includes(phase)) {
      engineReinstallInProgress = false;
      toggleEngineCancelButton(false);
    }
  };

  const toggleEngineCancelButton = (visible) => {
    if (!cancelEngineBtn) return;
    if (!visible) {
      cancelEngineBtn.hidden = true;
      cancelEngineBtn.disabled = true;
      return;
    }
    cancelEngineBtn.hidden = false;
    cancelEngineBtn.disabled = false;
  };

  const setModActionsDisabled = (disabled) => {
    if (reinstallModsBtn) {
      reinstallModsBtn.disabled = disabled;
    }
    if (deleteAllModsBtn) {
      deleteAllModsBtn.disabled = disabled;
    }
  };

  const getModStateLabel = (mod, progress) => {
    if (progress) {
      if (progress.state === 'installing') {
        return 'Устанавливается...';
      }
      if (progress.state === 'queued') {
        return 'В очереди...';
      }
      if (progress.state === 'done') {
        return 'Готово';
      }
      if (progress.state === 'skipped') {
        return 'Пропущен';
      }
      if (progress.state === 'error') {
        return 'Ошибка установки';
      }
    }
    return mod.installed ? 'Установлен' : 'Не найден';
  };

  const getModProgressMarkup = (progress) => {
    if (progress && progress.state === 'installing') {
      return `
        <div class="mod-progress loader">
          <div class="loader-spinner"></div>
          <p class="mod-progress-label">Установка...</p>
        </div>`;
    }
    if (!progress || (progress.state !== 'queued' && progress.state !== 'done')) {
      return '';
    }
    const percent = progress.state === 'done' ? 100 : 5;
    return `
      <div class="mod-progress">
        <div class="mod-progress-track">
          <div class="mod-progress-fill" style="width:${percent}%"></div>
        </div>
        <p class="mod-progress-label">${progress.state === 'done' ? '100%' : '0%'}</p>
      </div>`;
  };

  const showEngineModal = (visible) => {
    if (!engineModal) return;
    engineModal.classList.toggle('visible', visible);
  };

  const updateGlobalStatus = () => {
    let state = {
      level: 'ok',
      title: 'Готов к запуску',
      subtitle: 'Все системы готовы.',
      pill: 'Готов'
    };
    if (!engineReady) {
      state = {
        level: 'error',
        title: 'Нужна установка компонентов',
        subtitle: 'Установите дополнительные файлы лаунчера.',
        pill: 'Нет компонентов'
      };
    } else if (!javaReady) {
      state = {
        level: 'error',
        title: 'Не найдена Java 17',
        subtitle: 'Установите Java 17 и попробуйте снова.',
        pill: 'Java'
      };
    } else if (modsLoading) {
      state = {
        level: 'warn',
        title: 'Синхронизация модов',
        subtitle: 'Загружаем моды из репозитория.',
        pill: 'Синхронизация'
      };
    } else {
      const missing = currentModStatuses.filter((mod) => !mod.installed);
      if (missing.length) {
        const missingName = missing[0]?.name || missing[0]?.fileName || 'мод';
        state = {
          level: 'warn',
          title: 'Не все моды установлены',
          subtitle: `Отсутствует ${
            missing.length === 1 ? missingName : `${missing.length} мод(ов)`
          }`,
          pill: 'Моды'
        };
      }
    }
    if (statusTitle) {
      statusTitle.textContent = state.title;
    }
    if (statusSubtitle) {
      statusSubtitle.textContent = state.subtitle;
    }
    if (statusTag) {
      statusTag.textContent = state.pill;
      statusTag.classList.remove('status-ok', 'status-warn', 'status-error');
      statusTag.classList.add(
        state.level === 'error' ? 'status-error' : state.level === 'warn' ? 'status-warn' : 'status-ok'
      );
    }
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
      modsLoading = true;
      renderMods(currentModStatuses);
    }
    updateGlobalStatus();
  };

  const showJavaModal = (visible) => {
    if (!javaModal) return;
    javaModal.classList.toggle('visible', visible);
  };

  const handleJavaStatus = (payload) => {
    if (!payload) return;
    javaReady = Boolean(payload.ready);
    if (payload.downloadUrl) {
      javaDownloadUrl = payload.downloadUrl;
    }
    if (javaReady) {
      showJavaModal(false);
    } else {
      showJavaModal(true);
    }
    updateGlobalStatus();
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
    currentModStatuses = statuses;
    if (modsCount) {
      if (modsLoading) {
        modsCount.textContent = '—';
      } else if (statuses.length) {
        const installed = statuses.filter((mod) => mod.installed).length;
        modsCount.textContent = `${installed}/${statuses.length}`;
      } else {
        modsCount.textContent = '0/0';
      }
    }

    if (modsLoading) {
      const placeholder =
        '<li class="mod-item muted">Синхронизация модов с GitHub...</li>';
      if (modsSummary) {
        modsSummary.innerHTML = placeholder;
      }
      if (modsList) {
        modsList.innerHTML =
          '<li class="mod-item muted">Загружаем список модов. Это может занять пару минут при первом запуске.</li>';
      }
      updateModsProgressText();
      updateGlobalStatus();
      return;
    }

    if (!statuses.length) {
      const emptyMessage = '<li class="mod-item muted">Моды не найдены.</li>';
      if (modsSummary) {
        modsSummary.innerHTML = emptyMessage;
      }
      if (modsList) {
        modsList.innerHTML =
          '<li class="mod-item muted">Нет доступных модов. Проверьте конфигурацию репозитория.</li>';
      }
      updateGlobalStatus();
      return;
    }

    const buildTemplate = (mod, withActions = false) => {
      const fileName = mod.fileName || mod.name;
      const progress = modProgressState.get(fileName);
      const stateText = getModStateLabel(mod, progress);
      const progressMarkup = getModProgressMarkup(progress);
      let actionMarkup = '';
      if (withActions) {
        if (mod.installed) {
          actionMarkup = `<button class="ghost mini mod-delete" data-mod="${fileName}">Удалить</button>`;
        } else {
          actionMarkup = `<button class="ghost mini mod-install" data-mod="${fileName}">Установить</button>`;
        }
      }
      return `
        <li class="mod-item ${mod.installed ? 'installed' : 'missing'}">
          <span class="mod-dot ${mod.installed ? 'installed' : 'missing'}"></span>
          <div class="mod-info">
            <p class="mod-name">${mod.name}</p>
            <p class="mod-state">${stateText}</p>
            ${progressMarkup}
          </div>
          ${actionMarkup}
        </li>`;
    };

    if (modsSummary) {
      modsSummary.innerHTML = statuses.map((mod) => buildTemplate(mod, false)).join('');
    }
    if (modsList) {
      modsList.innerHTML = statuses.map((mod) => buildTemplate(mod, true)).join('');
    }
    updateModsProgressText();
    updateGlobalStatus();
  };

  setBootOverlayMessage('Подготовка лаунчера...');
  let config = null;
  try {
    config = await window.launcherApi.getConfig();
  } catch (error) {
    console.error('Не удалось получить конфигурацию лаунчера', error);
    setBootOverlayMessage('Ошибка загрузки. Перезапустите лаунчер.');
    return;
  }
  hideBootOverlay();
  await initMemorySlider();
  if (config.lastUsername) {
    usernameInput.value = config.lastUsername;
  }
  serverAddress.textContent = `${config.server.address}:${config.server.port}`;
  serverVersion.textContent = `${config.forge.mcVersion} Forge`;
  renderMods(config.status || []);
  handleEngineStatus(Boolean(config.engineReady));
  javaDownloadUrl = config.javaDownloadUrl || defaultJavaDownloadUrl;
  handleJavaStatus({ ready: Boolean(config.javaReady), downloadUrl: javaDownloadUrl });

  if (copyIpBtn) {
    const defaultCopyLabel = copyIpBtn.textContent;
    copyIpBtn.addEventListener('click', async () => {
      if (!navigator.clipboard) {
        setStatus('Буфер обмена недоступен');
        return;
      }
      try {
        await navigator.clipboard.writeText(`${config.server.address}:${config.server.port}`);
        setStatus('IP скопирован');
        copyIpBtn.textContent = 'Скопировано!';
        copyIpBtn.classList.add('copied');
        if (copyIpResetTimeout) {
          clearTimeout(copyIpResetTimeout);
        }
        copyIpResetTimeout = window.setTimeout(() => {
          copyIpBtn.textContent = defaultCopyLabel;
          copyIpBtn.classList.remove('copied');
        }, 1600);
      } catch (error) {
        console.error('Clipboard error', error);
        setStatus('Не удалось скопировать IP');
      }
    });
  }

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
  window.launcherApi.onModsStatus((statuses) => {
    if (!engineReady && !statuses.length) {
      modsLoading = true;
      modProgressState.clear();
      renderMods([]);
      return;
    }
    modsLoading = false;
    modsReinstalling = false;
    modProgressState.clear();
    repoProgressState = null;
    renderMods(statuses);
    setModActionsDisabled(false);
    updateModsProgressText();
  });

  const setStatus = (text) => {
    if (!statusMessage) return;
    statusMessage.textContent = text || '';
  };

  const showUsernameError = (message) => {
    if (!usernameError) return;
    if (message) {
      usernameError.textContent = message;
      usernameError.hidden = false;
    } else {
      usernameError.textContent = '';
      usernameError.hidden = true;
    }
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
        if (result.cancelled) {
          engineStatusText && (engineStatusText.textContent = 'Установка отменена.');
          appendLog('Установка компонентов отменена.');
        } else {
          engineStatusText &&
            (engineStatusText.textContent = `Ошибка установки: ${result.error || 'неизвестно'}`);
        }
        engineInstallBtn.disabled = false;
        engineInstallBtn.textContent = 'Повторить';
      }
    });
  }

  if (engineExitBtn) {
    engineExitBtn.addEventListener('click', () => window.launcherApi.close());
  }

  if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener('click', () => closeConfirmModal(false));
  }
  if (confirmOkBtn) {
    confirmOkBtn.addEventListener('click', () => closeConfirmModal(true));
  }

  if (forceEngineBtn) {
    forceEngineBtn.addEventListener('click', async () => {
      if (forceEngineBtn.disabled) return;
      const confirmed = await openConfirmModal({
        title: 'Переустановить компоненты?',
        message:
          'Текущие файлы Minecraft могут быть перезаписаны. Продолжить установку компонентов лаунчера?',
        confirmText: 'Переустановить'
      });
      if (!confirmed) {
        return;
      }
      forceEngineBtn.disabled = true;
      const defaultText = forceEngineBtn.textContent;
      forceEngineBtn.textContent = 'Обновляем...';
      appendLog('Принудительная установка компонентов лаунчера...');
      engineReinstallInProgress = true;
      toggleEngineCancelButton(true);
      const result = await window.launcherApi.installEngine();
      if (!result.ok) {
        if (result.cancelled) {
          appendLog('Отмена установки компонентов.');
          setStatus('Установка отменена');
        } else {
          appendLog(`Ошибка принудительной установки: ${result.error || 'неизвестно'}`);
          setStatus('Ошибка установки компонентов');
        }
        engineReinstallInProgress = false;
        toggleEngineCancelButton(false);
      } else {
        setStatus('Компоненты обновлены');
      }
      forceEngineBtn.textContent = defaultText;
      forceEngineBtn.disabled = false;
    });
  }

  if (cancelEngineBtn) {
    cancelEngineBtn.addEventListener('click', async () => {
      cancelEngineBtn.disabled = true;
      appendLog('Отмена переустановки компонентов лаунчера...');
      const cancelResult = await window.launcherApi.cancelEngineInstall();
      if (!cancelResult.ok) {
        appendLog('Нет активной установки для отмены.');
        engineReinstallInProgress = false;
        toggleEngineCancelButton(false);
      }
    });
  }

  if (javaDownloadBtn) {
    javaDownloadBtn.addEventListener('click', () => {
      const target = javaDownloadUrl || defaultJavaDownloadUrl;
      window.launcherApi.openExternal(target);
    });
  }

  if (javaDismissBtn) {
    javaDismissBtn.addEventListener('click', () => showJavaModal(false));
  }

  if (reinstallModsBtn) {
    reinstallModsBtn.addEventListener('click', async () => {
      if (reinstallModsBtn.disabled) return;
      setModActionsDisabled(true);
      modsReinstalling = true;
      modProgressState.clear();
      if (currentModStatuses.length) {
        currentModStatuses.forEach((mod) => {
          const key = mod.fileName || mod.name;
          modProgressState.set(key, { state: 'installing', percent: 0 });
        });
      }
      updateModsProgressText();
      renderMods(currentModStatuses);
      appendLog('Переустановка всех модов...');
      try {
        const result = await window.launcherApi.reinstallMods();
        if (!result.ok) {
          appendLog(`Ошибка переустановки модов: ${result.error || 'неизвестно'}`);
          setStatus('Ошибка установки модов');
          modsReinstalling = false;
          updateModsProgressText();
          setModActionsDisabled(false);
        } else {
          appendLog('Моды переустановлены.');
          setStatus('Моды обновлены');
        }
      } catch (error) {
        appendLog(`Ошибка переустановки модов: ${error.message}`);
        setStatus('Ошибка установки модов');
        modsReinstalling = false;
        updateModsProgressText();
        setModActionsDisabled(false);
      }
    });
  }

  if (deleteAllModsBtn) {
    deleteAllModsBtn.addEventListener('click', async () => {
      if (deleteAllModsBtn.disabled) return;
      const confirmed = await openConfirmModal({
        title: 'Удаление модов',
        message: 'Удалить все моды? Это действие нельзя отменить.',
        confirmText: 'Удалить'
      });
      if (!confirmed) return;
      setModActionsDisabled(true);
      appendLog('Удаление всех модов...');
      try {
        const result = await window.launcherApi.deleteAllMods();
        if (!result.ok) {
          appendLog(`Ошибка удаления модов: ${result.error || 'неизвестно'}`);
          setStatus('Ошибка удаления модов');
        } else {
          appendLog('Все моды удалены.');
          setStatus('Моды удалены');
        }
      } catch (error) {
        appendLog(`Ошибка удаления модов: ${error.message}`);
        setStatus('Ошибка удаления модов');
      } finally {
        setModActionsDisabled(false);
      }
    });
  }

  if (modsList) {
    modsList.addEventListener('click', async (event) => {
      const deleteBtn = event.target.closest('.mod-delete');
      if (deleteBtn) {
        if (deleteBtn.disabled) return;
        const fileName = deleteBtn.dataset.mod;
        appendLog(`Удаление мода ${fileName}...`);
        deleteBtn.disabled = true;
        try {
          const result = await window.launcherApi.deleteMod(fileName);
          if (!result.ok) {
            appendLog(`Ошибка удаления мода ${fileName}: ${result.error || 'неизвестно'}`);
            setStatus('Ошибка удаления мода');
          } else {
            appendLog(`Мод ${fileName} удалён.`);
          }
        } catch (error) {
          appendLog(`Ошибка удаления мода ${fileName}: ${error.message}`);
          setStatus('Ошибка удаления мода');
        } finally {
          deleteBtn.disabled = false;
        }
        return;
      }

      const installBtn = event.target.closest('.mod-install');
      if (installBtn) {
        if (installBtn.disabled) return;
        const fileName = installBtn.dataset.mod;
        appendLog(`Установка мода ${fileName}...`);
        installBtn.disabled = true;
        modProgressState.set(fileName, { state: 'installing', percent: 0 });
        renderMods(currentModStatuses);
        try {
          const result = await window.launcherApi.installMod(fileName);
          if (!result.ok) {
            appendLog(`Ошибка установки мода ${fileName}: ${result.error || 'неизвестно'}`);
            setStatus('Ошибка установки мода');
            modProgressState.set(fileName, { state: 'error', percent: 0 });
            renderMods(currentModStatuses);
          } else {
            setStatus('Мод установлен');
          }
        } catch (error) {
          appendLog(`Ошибка установки мода ${fileName}: ${error.message}`);
          setStatus('Ошибка установки мода');
          modProgressState.set(fileName, { state: 'error', percent: 0 });
          renderMods(currentModStatuses);
        } finally {
          installBtn.disabled = false;
        }
      }
    });
  }

  window.launcherApi.onEngineStatus((payload) => {
    if (payload && typeof payload.ready === 'boolean') {
      handleEngineStatus(payload.ready);
    }
  });
  window.launcherApi.onJavaStatus((payload) => {
    handleJavaStatus(payload);
  });
  window.launcherApi.onEngineProgress((payload) => {
    if (!payload) return;
    updateEngineProgress(payload);
  });

  window.launcherApi.onModsInstallProgress((payload) => {
    if (!payload) return;
    if (payload.scope === 'repo') {
      if (payload.state === 'done') {
        repoProgressState = null;
      } else {
        repoProgressState = payload;
      }
      updateModsProgressText();
      return;
    }
    if (!payload.fileName) return;
    const state = payload.state;
    if (state === 'done' || state === 'skipped') {
      modProgressState.set(payload.fileName, { state, percent: 100 });
    } else if (state === 'error') {
      modProgressState.set(payload.fileName, { state: 'error', percent: payload.percent || 0 });
    } else {
      modProgressState.set(payload.fileName, payload);
    }
    renderMods(currentModStatuses);
    updateModsProgressText();
  });

  launchBtn.addEventListener('click', async () => {
    if (!engineReady) {
      setStatus('Установите компоненты лаунчера');
      appendLog('Ошибка: нужно установить компоненты лаунчера');
      return;
    }
    if (!javaReady) {
      setStatus('Установите Java 17');
      appendLog('Ошибка: требуется Java 17');
      showJavaModal(true);
      return;
    }
    const username = (usernameInput.value || '').trim();
    if (!username) {
      setStatus('Укажите ник');
      appendLog('Ошибка: ник не указан');
      showUsernameError('Введите ник');
      return;
    }
    if (!nicknamePattern.test(username)) {
      setStatus('Только латиница и _');
      appendLog('Ошибка: ник может содержать только латинские буквы и нижнее подчёркивание');
      showUsernameError('Допустимы только латинские буквы и _');
      return;
    }
    showUsernameError('');
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
      showUsernameError('');
    } else if (response.javaMissing) {
      setStatus('Установите Java 17');
      appendLog('Ошибка: требуется Java 17');
      showJavaModal(true);
    } else {
      setStatus('Ошибка');
      appendLog(`Ошибка: ${response.error}`);
    }
    launchBtn.disabled = false;
  });
});
