'use strict';
(() => {
  const form = document.getElementById('login');
  const error = document.getElementById('login-error');
  const submit = document.getElementById('login-submit');
  const pw = document.getElementById('password');
  const toggle = document.getElementById('toggle-pw');

  toggle.addEventListener('click', () => {
    const show = pw.type === 'password';
    pw.type = show ? 'text' : 'password';
    toggle.textContent = show ? 'Ocultar' : 'Mostrar';
    toggle.setAttribute('aria-pressed', String(show));
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.hidden = true;
    const username = form.username.value.trim();
    const password = pw.value;
    if (!username || !password) {
      error.textContent = 'Escribe tu usuario y tu contraseña.';
      error.hidden = false;
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Entrando…';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'portal' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'No fue posible iniciar sesión.');
      window.location.assign('/');
    } catch (err) {
      error.textContent = err instanceof TypeError ? 'No hay conexión con el servidor. Intenta de nuevo.' : err.message;
      error.hidden = false;
      submit.disabled = false;
      submit.textContent = 'Entrar';
      pw.select();
    }
  });
})();
