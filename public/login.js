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
        console.log('Login effort - password length:', password.length);
        const passwordBase64 = btoa(password);
        const body = JSON.stringify({ email, password: passwordBase64 });
        console.log('JSON payload to be sent:', body);
        
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
        });

        const data = await res.json();
        
        if (!res.ok) {
            errEl.textContent = data.error || 'Login failed';
            errEl.style.display = 'block';
            btn.textContent = 'Log In';
            btn.disabled = false;
            return;
        }

        console.log('Backend response:', data); // Debugging backend response
        console.log('st_user before update:', sessionStorage.getItem('st_user')); // Debugging session storage before update

        // Store token
        sessionStorage.setItem('st_token', data.access_token);

        // Store token expiry time (7 hours from now - gives 1 hour buffer before actual 8h expiry)
        const expiresAt = Date.now() + (7 * 60 * 60 * 1000);
        sessionStorage.setItem('st_token_expires_at', expiresAt.toString());

        // Update st_user with new flags from backend response
        sessionStorage.setItem('st_user', JSON.stringify({
            email: email,
            isAdmin: data.isAdmin,
            is_hr: data.is_hr,
            is_coordinator: data.is_coordinator
        }));

        // Debugging session storage
        console.log('st_user after login:', sessionStorage.getItem('st_user'));
        console.log('st_token after login:', sessionStorage.getItem('st_token'));
        console.log('Redirecting user based on flags:', {
            isAdmin: data.isAdmin,
            is_hr: data.is_hr,
            is_coordinator: data.is_coordinator
        });

        // Redirect based on flags
        if (data.isAdmin) {
            location.href = '/admin.html';
        } else if (data.is_hr) {
            location.href = '/staff-view.html';
        } else if (data.is_coordinator) {
            location.href = '/projects.html';
        } else {
            location.href = '/';
        }

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
        if (user.isAdmin) location.href = '/admin.html';
        else if (user.is_hr) location.href = '/staff-view.html';
        else if (user.is_coordinator) location.href = '/projects.html';
        else location.href = '/';
    } catch { }
}
