'use strict';

document.getElementById('btn-login').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('btn-login');

    if (!email) {
        errEl.textContent = 'Please enter your email.';
        errEl.style.display = 'block';
        return;
    }

    btn.textContent = 'Logging in…';
    btn.disabled = true;
    errEl.style.display = 'none';

    try {
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });

        if (!res.ok) throw new Error('Login failed');

        const data = await res.json();
        sessionStorage.setItem('st_token', data.token);
        sessionStorage.setItem('st_user', JSON.stringify(data.user));

        // Redirect to default view based on role
        if (data.user.role === 'admin') location.href = '/admin.html';
        else if (data.user.role === 'hr') location.href = '/staff-view.html';
        else if (data.user.role === 'coordinator') location.href = '/projects.html';
        else location.href = '/'; // staff

    } catch (err) {
        errEl.textContent = 'Failed to log in. Please try again.';
        errEl.style.display = 'block';
        btn.textContent = 'Log In';
        btn.disabled = false;
    }
});

// Auto-redirect if already logged in
if (sessionStorage.getItem('st_token')) {
    try {
        const user = JSON.parse(sessionStorage.getItem('st_user'));
        if (user.role === 'admin') location.href = '/admin.html';
        else if (user.role === 'hr') location.href = '/staff-view.html';
        else if (user.role === 'coordinator') location.href = '/projects.html';
        else location.href = '/';
    } catch { }
}
