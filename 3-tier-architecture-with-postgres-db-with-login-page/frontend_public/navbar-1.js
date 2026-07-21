document.addEventListener("DOMContentLoaded", () => {
    const user = localStorage.getItem('cidr_user');
    const activePage = window.location.pathname;

    // Redirect unauthorized users back to the root login page
    if (!user && activePage !== '/' && !activePage.includes('/index')) {
        window.location.href = '/';
        return;
    }

    if (!document.querySelector("link[rel*='icon']")) {
        const favicon = document.createElement('link');
        favicon.rel = 'icon';
        favicon.type = 'image/png';
        favicon.href = '/logo.png';
        document.head.appendChild(favicon);
    }

    const style = document.createElement('style');
    style.innerHTML = `
        :root { --bg: #f4f4f5; --card-bg: white; --text: #334155; --border: #cbd5e1; --primary: #2563eb; --primary-hover: #1d4ed8; }
        body.dark-mode { --bg: #0f172a; --card-bg: #1e293b; --text: #e2e8f0; --border: #475569; --primary: #3b82f6; --primary-hover: #2563eb; }
        
        /* FIXED: Force the body of ALL pages to respect the theme variables */
        body { 
            background-color: var(--bg) !important; 
            color: var(--text) !important; 
            transition: background-color 0.2s, color 0.2s;
        }

        .nav-bar { display: flex; justify-content: space-between; border-bottom: 2px solid var(--border); padding-bottom: 15px; margin-bottom: 25px; align-items: center; font-family: system-ui; }
        .nav-left { display: flex; align-items: center; gap: 20px; }
        .logo-img { height: 40px; border-radius: 8px; object-fit: contain; }
        .theme-toggle { background: transparent; border: 1px solid var(--border); color: var(--text); padding: 5px 10px; border-radius: 4px; cursor: pointer; font-weight: bold; transition: 0.2s;}
        .theme-toggle:hover { background: var(--border); }
        .logout-btn { border-color: #ef4444 !important; color: #ef4444 !important; margin-left: 10px; }
        .logout-btn:hover { background: #fee2e2 !important; }
        body.dark-mode .logout-btn:hover { background: #7f1d1d !important; color: white !important;}

        /* Password Modal Styling */
        .pwd-modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); z-index: 1000; align-items: center; justify-content: center; font-family: system-ui; }
        .pwd-box { background: var(--card-bg); padding: 25px; border-radius: 8px; width: 300px; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
        .pwd-box input { width: 90%; padding: 10px; margin: 10px 0; border: 1px solid var(--border); border-radius: 4px; background: var(--bg); color: var(--text); }
        .pwd-box button { width: 95%; padding: 10px; margin-top: 10px; background: var(--primary); color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; }
        .pwd-box .cancel-btn { background: #ef4444; margin-top: 5px; }
    `;
    document.head.appendChild(style);

    const navHTML = `
        <div class="nav-bar">
            <div class="nav-left">
                <img src="/logo.png" alt="Sidorea" class="logo-img">
            </div>
            <div style="display: flex; align-items: center;">
                <span style="margin-right: 15px; font-weight:500; text-transform: capitalize;">User: ${user || 'Guest'}</span>
                <button class="theme-toggle" onclick="openPasswordModal()">🔑 Change Password</button>
                <button class="theme-toggle" style="margin-left: 10px;" onclick="toggleGlobalTheme()">🌓 Theme</button>
                <button class="theme-toggle logout-btn" onclick="logoutUser()">🚪 Logout</button>
            </div>
        </div>

        <!-- Change Password Modal -->
        <div id="pwd-modal" class="pwd-modal">
            <div class="pwd-box">
                <h3 style="margin-top:0; color:var(--text);">Change Password</h3>
                <input type="password" id="new-password" placeholder="New Password (min 8 chars)">
                <button onclick="submitNewPassword()">Update Password</button>
                <button class="cancel-btn" onclick="closePasswordModal()">Cancel</button>
            </div>
        </div>
    `;
    
    document.body.insertAdjacentHTML('afterbegin', navHTML);
    applyStoredTheme();
});

window.logoutUser = function() {
    localStorage.removeItem('cidr_user');
    window.location.href = '/';
};

function applyStoredTheme() {
    document.body.classList.toggle('dark-mode', localStorage.getItem('theme') === 'dark');
}

function toggleGlobalTheme() {
    document.body.classList.toggle('dark-mode');
    localStorage.setItem('theme', document.body.classList.contains('dark-mode') ? 'dark' : 'light');
    window.dispatchEvent(new Event('storage')); 
}
window.addEventListener('storage', applyStoredTheme);


window.openPasswordModal = function() { document.getElementById('pwd-modal').style.display = 'flex'; };
window.closePasswordModal = function() { 
    document.getElementById('pwd-modal').style.display = 'none'; 
    document.getElementById('new-password').value = '';
};

window.submitNewPassword = async function() {
    const user = localStorage.getItem('cidr_user');
    const newPassword = document.getElementById('new-password').value;

    if(newPassword.length < 8) return alert("Password must be at least 8 characters.");

    try {
        const res = await fetch('/api/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: user, newPassword })
        });
        if (res.ok) {
            alert("Password updated successfully!");
            closePasswordModal();
        } else {
            alert(await res.text());
        }
    } catch (err) { alert("Network error while updating password."); }
};
