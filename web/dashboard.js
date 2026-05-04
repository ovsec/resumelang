(function () {
  'use strict';

  const LOCAL_RESUMES_KEY = 'resumelang.local_resumes';

  function getLocalResumes() {
    try { return JSON.parse(localStorage.getItem(LOCAL_RESUMES_KEY)) || []; } catch { return []; }
  }

  function setLocalResumes(list) {
    localStorage.setItem(LOCAL_RESUMES_KEY, JSON.stringify(list));
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function renderLocalResumes() {
    const section = document.getElementById('local-drafts-section');
    const list    = document.getElementById('local-resume-list');
    if (!section || !list) return;

    const resumes = getLocalResumes();
    if (!resumes.length) { section.hidden = true; return; }

    section.hidden = false;
    list.innerHTML = '';
    resumes.forEach(r => {
      const card = document.createElement('div');
      card.className = 'dash-card';
      card.id = 'local-card-' + r.id;
      card.innerHTML = `
        <div class="dash-card-head">
          <div class="dash-card-meta">
            <span class="dash-card-name">${escHtml(r.name)}</span>
            <span class="dash-card-date">${new Date(r.updatedAt).toLocaleDateString()}</span>
          </div>
          <span class="dash-badge dash-badge-private">Local</span>
        </div>
        <div class="dash-card-actions">
          <button class="dash-card-edit" onclick="importLocalResume('${r.id}')">
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M7 1v9M4 7l3 3 3-3"/><path d="M2 11v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1"/></svg>
            Import
          </button>
          <div class="dash-card-sec-actions">
            <button class="dash-card-icon-btn dash-card-icon-btn-danger" title="Delete" onclick="deleteLocalResume('${r.id}')">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h10M5 4V2h4v2M11 4l-.75 8.5a1 1 0 0 1-1 .5h-4.5a1 1 0 0 1-1-.5L3 4"/></svg>
            </button>
          </div>
        </div>`;
      list.appendChild(card);
    });
  }

  window.importLocalResume = async function(id) {
    const resumes = getLocalResumes();
    const r = resumes.find(x => x.id === id);
    if (!r) return;
    try {
      const res = await fetch('/api/resumes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: r.name, yaml: r.yaml }),
      });
      if (!res.ok) throw new Error(await res.text());
      const saved = await res.json();
      setLocalResumes(resumes.filter(x => x.id !== id));
      renderLocalResumes();
      location.href = '/editor?id=' + saved.id;
    } catch (e) {
      alert('Import failed: ' + e.message);
    }
  };

  window.deleteLocalResume = function(id) {
    if (!confirm('Delete this local draft?')) return;
    setLocalResumes(getLocalResumes().filter(x => x.id !== id));
    renderLocalResumes();
  };

  // Expose functions needed by share modal
  window.getEditorYAML = function() {
    const preload = document.getElementById('share-preload-yaml');
    if (preload) return preload.value;
    if (window.editorGetYAML) return window.editorGetYAML();
    const ta = document.getElementById('yaml-hidden');
    return ta ? ta.value : '';
  };

  window.getEditorTheme = function() {
    const sel = document.getElementById('theme-select');
    return sel ? sel.value : 'sap';
  };

  renderLocalResumes();
})();
