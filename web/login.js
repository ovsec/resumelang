(function () {
  'use strict';

  fetch('/api/me', { credentials: 'same-origin' })
    .then(r => r.json())
    .then(data => {
      if (data && data.user) {
        // already signed in — bounce home
        window.location.replace('/');
        return;
      }
      const enabled = new Set(data && data.providers ? data.providers : []);
      document.querySelectorAll('.prov').forEach(btn => {
        const name = btn.dataset.provider;
        if (!enabled.has(name)) {
          btn.dataset.disabled = '1';
          btn.disabled = true;
          btn.title = name + ' is not configured on this server';
        }
      });
    })
    .catch(() => { /* offline OK */ });

  document.querySelectorAll('.prov').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      window.location.assign('/auth/' + btn.dataset.provider);
    });
  });
})();
