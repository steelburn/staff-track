'use strict';

document.getElementById('btn-login').addEventListener('click', async () => {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
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
        // Encode password as Base64 for external auth service
        const passwordBase64 = btoa(password);
        
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: passwordBase64 })
        });

        const data = await res.json();
        
        if (!res.ok) {
            errEl.textContent = data.error || 'Login failed';
            errEl.style.display = 'block';
            btn.textContent = 'Log In';
            btn.disabled = false;
            return;
        }

        // Store tokens (new format: accessToken + refreshToken)
        sessionStorage.setItem('st_token', data.accessToken);
        sessionStorage.setItem('st_refresh_token', data.refreshToken);
        sessionStorage.setItem('st_user', JSON.stringify(data.user));
        
        // Store token expiry time (7 hours from now - gives 1 hour buffer before actual 8h expiry)
        const expiresAt = Date.now() + (7 * 60 * 60 * 1000);
        sessionStorage.setItem('st_token_expires_at', expiresAt.toString());

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
