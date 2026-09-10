/**
 * StaffTrack — Fullscreen toggle + in-fullscreen page switcher
 *
 * Wires a page-header button ([data-fullscreen-toggle]) to the browser
 * Fullscreen API so report/analysis pages can hide the browser chrome and
 * use the whole screen. The whole document is the fullscreen target (not
 * just the content pane) so right-hand drawers and toasts stay usable while
 * fullscreen — they live outside `.main-content`.
 *
 * The button label/icon/aria-pressed are kept in sync with the live state
 * (including exits via Escape), and a synthetic `resize` is dispatched after
 * each transition so ECharts instances recalculate their size.
 *
 * While fullscreen the sidebar is hidden (see layout.css) and the page header
 * shows a compact switcher (`#fs-nav`) between the management analysis pages.
 * Because a real navigation would drop fullscreen, switching while fullscreen
 * loads the sibling page in an iframe instead (`.fs-embed`); the header stays
 * pinned at the top as a slim switcher bar and the frame fills the rest. On
 * exit the top window adopts the page that was shown.
 *
 * Usage:
 *   FullscreenToggle.init();                       // uses defaults
 *   FullscreenToggle.init({ onchange: (on) => {} });
 *
 * Progressive enhancement: on browsers without the Fullscreen API the button
 * is hidden (inline display:none — `.btn` otherwise beats the [hidden] UA rule).
 */
'use strict';

const FullscreenToggle = (() => {
    const doc = document;
    const root = doc.documentElement;
    const IS_TOP = window.self === window.top;
    const HOST_PATH = location.pathname;

    // ── Vendor-prefixed capability probes ─────────────────────────────────
    function requestFn(node) {
        return node.requestFullscreen || node.webkitRequestFullscreen ||
               node.mozRequestFullScreen || node.msRequestFullscreen || null;
    }

    function exitFn() {
        return doc.exitFullscreen || doc.webkitExitFullscreen ||
               doc.mozCancelFullScreen || doc.msExitFullscreen || null;
    }

    function supported() {
        return !!requestFn(root);
    }

    function fsElement() {
        return doc.fullscreenElement || doc.webkitFullscreenElement ||
               doc.mozFullScreenElement || doc.msFullscreenElement || null;
    }

    // Normalise the (sometimes undefined) request/exit return value so a
    // blocked request cannot throw synchronously.
    function requestFullscreen(node) {
        const fn = requestFn(node);
        if (!fn) return Promise.reject(new Error('Fullscreen API unavailable'));
        return Promise.resolve(fn.call(node));
    }

    function exitFullscreen() {
        const fn = exitFn();
        if (!fn) return Promise.resolve();
        return Promise.resolve(fn.call(doc));
    }

    // ── State ─────────────────────────────────────────────────────────────
    let button = null;
    let target = null;
    let onChange = null;

    // In-fullscreen sibling view (top document only).
    let embedFrame = null;   // <iframe> showing the other analysis page
    let embedUrl = null;     // path currently shown in the frame
    let embedReturnUrl = null; // host URL to restore when the frame closes

    function isFullscreen() {
        return !!target && fsElement() === target;
    }

    function sync() {
        const active = isFullscreen();
        root.classList.toggle('is-fullscreen', active);

        if (!button) return;
        button.setAttribute('aria-pressed', String(active));
        button.title = active ? 'Exit full screen' : 'Enter full screen';
        button.setAttribute('aria-label', button.title);

        const icon = button.querySelector('.fs-icon');
        const label = button.querySelector('.fs-label');
        if (icon) icon.textContent = active ? '🗗' : '⛶';
        if (label) label.textContent = active ? 'Exit' : 'Full screen';
    }

    function toggle() {
        if (!supported()) return;
        // Exit if anything is fullscreen (ours or not), otherwise enter.
        if (fsElement()) {
            exitFullscreen().catch(() => { /* browser will handle */ });
        } else {
            requestFullscreen(target).catch(() => {
                if (typeof Toast !== 'undefined' && typeof Toast.error === 'function') {
                    Toast.error('Full screen unavailable',
                        'Your browser blocked the fullscreen request.', 5000);
                }
            });
        }
    }

    function handleChange() {
        const active = isFullscreen();

        // Leaving fullscreen while a sibling page is embedded: make that page
        // the real one so the URL, refresh and back button all line up.
        if (!active && embedUrl) {
            const url = embedUrl;
            embedUrl = null;
            location.href = url;   // fullscreen has already ended
            return;
        }

        if (!active) {
            // No embedded page: leave the address bar alone (reporting.js owns
            // the ?dept= param). closeEmbed() restores the host URL itself.
            if (embedFrame) closeEmbed();
        }

        sync();
        syncNav();
        // Let the layout settle before charts measure themselves.
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
            if (typeof onChange === 'function') onChange(active);
        }, 80);
    }

    // ── Fullscreen page switcher ─────────────────────────────────────────
    // The links live in the page markup; here we mirror the sidebar's
    // permission gating (a link is offered when the sidebar exposes the same
    // href) and flag the page currently on screen — the host page, or the
    // sibling page while it is embedded. Re-run on fullscreen changes and
    // whenever the sidebar nav is (re)rendered (e.g. the async manager probe).
    function syncNav() {
        const nav = doc.getElementById('fs-nav');
        if (!nav) return;

        const sidebar = doc.getElementById('sidebar-nav');
        const current = embedUrl || HOST_PATH;
        let available = 0;

        nav.querySelectorAll('.fs-nav-item').forEach((item) => {
            const href = item.getAttribute('href');
            const allowed = !sidebar || !!sidebar.querySelector(`a[href="${href}"]`);
            item.hidden = !allowed;
            if (!allowed) return;

            available += 1;
            const active = current === href || current.endsWith(href);
            item.classList.toggle('active', active);
            if (active) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });

        nav.hidden = available === 0;
    }

    // While embedded, the page header stays pinned at the top as a slim bar
    // carrying only the switcher, and the frame starts just below it. The
    // offset is recomputed because the header height changes across breakpoints.
    function positionEmbed() {
        if (!embedFrame) return;
        const header = doc.querySelector('.page-header');
        const top = header ? Math.ceil(header.getBoundingClientRect().bottom) : 0;
        embedFrame.style.top = top + 'px';
    }

    function openEmbed(url) {
        if (!embedFrame) {
            // Remember where to send the address bar back to when the frame
            // closes (the host may have a ?dept= scope in its URL).
            embedReturnUrl = location.pathname + location.search + location.hash;
            embedFrame = doc.createElement('iframe');
            embedFrame.className = 'fs-embed';
            embedFrame.title = 'Analysis view';
            // No allowfullscreen: the framed page must not grab its own.
            doc.documentElement.classList.add('fs-embed-open');
            doc.body.appendChild(embedFrame);
        }
        if (embedFrame.getAttribute('src') !== url) embedFrame.setAttribute('src', url);
        embedUrl = url;
        // Keep the address bar on the page that is actually on screen.
        if (IS_TOP) {
            try { history.replaceState(null, '', url); } catch (e) { /* noop */ }
        }
        positionEmbed();
        syncNav();
    }

    function closeEmbed() {
        if (embedFrame) {
            embedFrame.remove();
            embedFrame = null;
        }
        embedUrl = null;
        root.classList.remove('fs-embed-open');
        if (IS_TOP && embedReturnUrl) {
            try { history.replaceState(null, '', embedReturnUrl); } catch (e) { /* noop */ }
        }
        embedReturnUrl = null;
        syncNav();
    }

    function handleNavClick(event) {
        const item = event.target.closest('.fs-nav-item');
        if (!item || item.hidden) return;

        // Outside fullscreen the links stay ordinary navigation.
        if (!isFullscreen()) return;
        event.preventDefault();

        const href = item.getAttribute('href');
        if (href === HOST_PATH) {
            closeEmbed();
        } else if (href !== embedUrl) {
            openEmbed(href);
        }
    }

    function init(opts = {}) {
        // Mark a sibling page shown inside the frame so it can drop its
        // sidebar/global chrome (see layout.css).
        if (!IS_TOP) root.classList.add('embedded');

        button = doc.querySelector(opts.buttonSelector || '[data-fullscreen-toggle]');
        target = opts.target || root;
        onChange = typeof opts.onchange === 'function' ? opts.onchange : null;

        if (!button) return null;

        if (!supported()) {
            // `.btn { display: inline-flex }` outranks the [hidden] UA rule.
            button.style.display = 'none';
            return null;
        }

        button.addEventListener('click', toggle);
        ['fullscreenchange', 'webkitfullscreenchange',
         'mozfullscreenchange', 'MSFullscreenChange'].forEach((evt) =>
            doc.addEventListener(evt, handleChange));

        const nav = doc.getElementById('fs-nav');
        if (nav) {
            nav.addEventListener('click', handleNavClick);
            const exitBtn = nav.querySelector('[data-fs-exit]');
            if (exitBtn) {
                exitBtn.addEventListener('click', (event) => {
                    event.preventDefault();
                    exitFullscreen().catch(() => { /* browser will handle */ });
                });
            }
        }

        // Keep the switcher in step with the sidebar as it re-renders.
        const sidebarNav = doc.getElementById('sidebar-nav');
        if (sidebarNav && typeof MutationObserver !== 'undefined') {
            new MutationObserver(syncNav).observe(sidebarNav, { childList: true, subtree: true });
        }

        if (IS_TOP) window.addEventListener('resize', positionEmbed);

        sync();
        syncNav();
        return { toggle, sync, syncNav, isFullscreen };
    }

    return { init, toggle, sync, syncNav, isFullscreen, supported };
})();
