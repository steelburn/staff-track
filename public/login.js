'use strict';

// Theme toggle for login page
document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            ThemeManager.toggle();
        });
    }
});

// Login form handler
const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await handleLogin();
    });
}

// Also handle button click for backward compatibility
const loginBtn = document.getElementById('btn-login');
if (loginBtn) {
    loginBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        await handleLogin();
    });
}

async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const errEl = document.getElementById('login-error');
    const btn = document.getElementById('btn-login');

    if (!email) {
        showLoginError('Please enter your email.');
        return;
    }

    if (!password) {
        showLoginError('Please enter your password.');
        return;
    }

    // Update button state
    btn.textContent = 'Signing in...';
    btn.disabled = true;
    btn.style.opacity = '0.7';

    try {
        // Encode password as Base64 for external auth service
        const passwordBase64 = btoa(password);
        const body = JSON.stringify({ email, password: passwordBase64 });
        
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
        });

        const data = await res.json();
        
        if (!res.ok) {
            showLoginError(data.error || 'Login failed. Please check your credentials.');
            resetLoginButton();
            return;
        }

        // Store token
        sessionStorage.setItem('st_token', data.access_token);

        // Store token expiry time (7 hours from now - gives 1 hour buffer before actual 8h expiry)
        const expiresAt = Date.now() + (7 * 60 * 60 * 1000);
        sessionStorage.setItem('st_token_expires_at', expiresAt.toString());

        // Update st_user with new flags from backend response
        sessionStorage.setItem('st_user', JSON.stringify({
            email: email,
            name: data.name || null,
            isAdmin: data.isAdmin,
            is_hr: data.is_hr,
            is_coordinator: data.is_coordinator
        }));

        // Show success state
        btn.textContent = 'Success!';
        btn.style.background = 'var(--color-success)';

        // Fetch subordinate count in background for managers
        fetch('/api/reports/my-subordinates', {
            headers: { 'Authorization': `Bearer ${data.access_token}` }
        })
        .then(res => res.json())
        .then(subData => {
            const count = subData.count || 0;
            sessionStorage.setItem('st_subordinate_count', count.toString());
        })
        .catch(err => console.error('Failed to fetch subordinate count:', err));

        // Redirect based on flags
        setTimeout(() => {
            if (data.isAdmin) {
                location.href = '/admin.html';
            } else if (data.is_hr) {
                location.href = '/staff-view.html';
            } else if (data.is_coordinator) {
                location.href = '/projects.html';
            } else {
                location.href = '/';
            }
        }, 300);

    } catch (err) {
        showLoginError('Failed to connect to server. Please try again.');
        resetLoginButton();
    }
}

function showLoginError(message) {
    const errEl = document.getElementById('login-error');
    if (errEl) {
        errEl.textContent = message;
        errEl.classList.add('visible');
    }
}

function resetLoginButton() {
    const btn = document.getElementById('btn-login');
    if (btn) {
        btn.textContent = 'Sign In';
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

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
