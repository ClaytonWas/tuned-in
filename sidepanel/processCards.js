let processState = [];
let processIdCounter = 1;
let processContainer = null;

function ensureContainer() {
  if (processContainer) return processContainer;
  processContainer = document.createElement('ul');
  processContainer.id = 'processListContainer';
  processContainer.className = 'process-list';

  const nowPlayingSection = document.querySelector('.now-playing-section');
  if (nowPlayingSection?.nextSibling) {
    nowPlayingSection.parentNode.insertBefore(processContainer, nowPlayingSection.nextSibling);
  } else {
    const main = document.querySelector('.main');
    if (main?.firstChild) main.insertBefore(processContainer, main.firstChild.nextSibling);
  }
  return processContainer;
}

function getStatusWord(progress, status) {
  if (status === 'error') return 'Error';
  if (status === 'done' || progress >= 100) return 'Complete';
  if (progress < 25) return 'Extracting';
  if (progress < 50) return 'Summarizing';
  if (progress < 75) return 'Analyzing';
  return 'Matching';
}

function statusClass(status) {
  if (status === 'error') return 'status-error';
  if (status === 'done') return 'status-done';
  return 'status-running';
}

function renderAll() {
  const container = ensureContainer();
  if (processState.length === 0) {
    container.innerHTML = '';
    container.setAttribute('hidden', '');
    return;
  }
  container.removeAttribute('hidden');
  container.innerHTML = '';
  for (const p of processState) {
    const item = document.createElement('li');
    item.className = 'process-item';
    item.setAttribute('data-id', p.id);
    item.innerHTML = `
      <div class="process-item-content">
        <span class="process-page-title">${p.pageTitle}</span>
        <div class="process-bar">
          <div class="process-bar-fill" style="width: ${p.progress}%;"></div>
        </div>
        <span class="process-status-word ${statusClass(p.status)}">${getStatusWord(p.progress, p.status)}</span>
      </div>
      <button class="process-dismiss" data-id="${p.id}" aria-label="Dismiss">×</button>
    `;
    item.querySelector('.process-dismiss').onclick = (e) => {
      e.stopPropagation();
      removeProcessCard(p.id);
    };
    container.appendChild(item);
  }
}

export function addProcessCard(type, description, pageTitle = null) {
  const id = processIdCounter++;
  processState.push({
    id, type, description,
    pageTitle: pageTitle || description,
    progress: 0,
    status: 'running',
  });
  renderAll();
  return id;
}

export function updateProcessCard(id, updates) {
  const idx = processState.findIndex(p => p.id === id);
  if (idx === -1) return;
  processState[idx] = { ...processState[idx], ...updates };
  const p = processState[idx];

  if (typeof updates.progress === 'number') {
    const item = document.querySelector(`.process-item[data-id='${id}']`);
    if (item) {
      const fill = item.querySelector('.process-bar-fill');
      const statusEl = item.querySelector('.process-status-word');
      if (fill) fill.style.width = `${updates.progress}%`;
      if (statusEl) {
        statusEl.textContent = getStatusWord(updates.progress, p.status);
        statusEl.className = `process-status-word ${statusClass(p.status)}`;
      }
    }
  } else {
    renderAll();
  }

  if (updates.status === 'done' || (updates.progress === 100 && p.status !== 'error')) {
    setTimeout(() => removeProcessCard(id), 3000);
  }
}

export function removeProcessCard(id) {
  const item = document.querySelector(`.process-item[data-id='${id}']`);
  if (item) {
    item.classList.add('process-item-removing');
    setTimeout(() => {
      processState = processState.filter(p => p.id !== id);
      renderAll();
    }, 200);
  } else {
    processState = processState.filter(p => p.id !== id);
    renderAll();
  }
}
