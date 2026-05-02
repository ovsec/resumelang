(function () {
  'use strict';

  const LOCAL_RESUMES_KEY = 'resumelang.local_resumes';

  function getLocalResumes() {
    try { return JSON.parse(localStorage.getItem(LOCAL_RESUMES_KEY)) || []; } catch { return []; }
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
        <div class="dash-card-body">
          <span class="dash-card-name">${escHtml(r.name)}</span>
          <span class="dash-card-date">${new Date(r.updatedAt).toLocaleDateString()}</span>
        </div>
        <div class="dash-card-actions">
          <button class="dash-card-link" data-id="${r.id}" onclick="importLocalResume('${r.id}')">Import</button>
          <button class="dash-card-link dash-card-link-danger" data-id="${r.id}" onclick="deleteLocalResume('${r.id}')">Delete</button>
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
      // Remove from localStorage after successful import
      setLocalResumes(resumes.filter(x => x.id !== id));
      renderLocalResumes();
      // Redirect to editor with the imported resume
      location.href = '/editor?id=' + saved.id;
    } catch (e) {
      alert('Import failed: ' + e.message);
    }
  };

  window.deleteLocalResume = function(id) {
    if (!confirm('Delete this local draft?')) return;
    const resumes = getLocalResumes();
    setLocalResumes(resumes.filter(x => x.id !== id));
    renderLocalResumes();
  };

  function setLocalResumes(list) {
    localStorage.setItem(LOCAL_RESUMES_KEY, JSON.stringify(list));
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

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

  // Init on load
  renderLocalResumes();
})();
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
      // Remove from localStorage after successful import
      setLocalResumes(resumes.filter(x => x.id !== id));
      renderLocalResumes();
      // Redirect to editor with the imported resume
      location.href = '/editor?id=' + saved.id;
    } catch (e) {
      alert('Import failed: ' + e.message);
    }
  };

  window.deleteLocalResume = function(id) {
    if (!confirm('Delete this local draft?')) return;
    const resumes = getLocalResumes();
    setLocalResumes(resumes.filter(x => x.id !== id));
    renderLocalResumes();
  };

  function setLocalResumes(list) {
    localStorage.setItem(LOCAL_RESUMES_KEY, JSON.stringify(list));
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  // Init on load
  renderLocalResumes();
})();
