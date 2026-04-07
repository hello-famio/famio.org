// HTML templates for all Worker-served pages.
// Design system matches index.html: pink (#ff6b9d), teal (#4ecdc4), yellow (#ffe66d).

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SHARED_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    line-height: 1.6;
    color: #333;
    background: linear-gradient(135deg, #fff5f5 0%, #f0f9ff 50%, #f0fdf4 100%);
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  .app-header {
    padding: 24px 20px;
    text-align: center;
    border-bottom: 1px solid rgba(0,0,0,0.05);
    background: rgba(255,255,255,0.7);
    backdrop-filter: blur(8px);
  }

  .logo-link {
    font-size: 1.8rem;
    font-weight: 800;
    background: linear-gradient(135deg, #ff6b9d 0%, #4ecdc4 50%, #ffe66d 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    text-decoration: none;
  }

  .app-main {
    flex: 1;
    padding: 40px 20px 60px;
    max-width: 640px;
    margin: 0 auto;
    width: 100%;
  }

  .app-footer {
    text-align: center;
    padding: 30px 20px;
    color: #a0aec0;
    font-size: 0.85rem;
  }

  /* Cards */
  .card {
    background: white;
    border-radius: 20px;
    padding: 32px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.08);
    margin-bottom: 20px;
  }

  .card-title {
    font-size: 1.1rem;
    font-weight: 700;
    color: #2d3748;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .card-title-count {
    font-size: 0.8rem;
    font-weight: 600;
    color: #a0aec0;
    background: #f7fafc;
    border-radius: 20px;
    padding: 3px 10px;
  }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 12px 24px;
    font-size: 0.95rem;
    font-weight: 600;
    color: white;
    background: linear-gradient(135deg, #ff6b9d 0%, #4ecdc4 100%);
    border: none;
    border-radius: 50px;
    cursor: pointer;
    text-decoration: none;
    transition: transform 0.2s ease, box-shadow 0.2s ease;
    box-shadow: 0 4px 15px rgba(78,205,196,0.25);
    font-family: inherit;
    white-space: nowrap;
  }

  .btn:hover {
    transform: translateY(-2px);
    box-shadow: 0 8px 25px rgba(78,205,196,0.35);
  }

  .btn:active { transform: translateY(0); }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
    transform: none;
    box-shadow: none;
  }

  .btn-sm {
    padding: 7px 16px;
    font-size: 0.82rem;
  }

  .btn-danger {
    background: linear-gradient(135deg, #ff6b9d 0%, #fc8181 100%);
    box-shadow: 0 4px 15px rgba(255,107,157,0.2);
  }

  .btn-danger:hover {
    box-shadow: 0 8px 25px rgba(255,107,157,0.3);
  }

  .btn-ghost {
    background: transparent;
    color: #4a5568;
    border: 2px solid #e2e8f0;
    box-shadow: none;
  }

  .btn-ghost:hover {
    border-color: #4ecdc4;
    color: #2d3748;
    box-shadow: none;
  }

  .btn-teal {
    background: linear-gradient(135deg, #4ecdc4 0%, #44b9b1 100%);
    box-shadow: 0 4px 15px rgba(78,205,196,0.25);
  }

  /* Inputs */
  .input {
    width: 100%;
    padding: 12px 18px;
    font-size: 0.95rem;
    font-family: inherit;
    border: 2px solid #e2e8f0;
    border-radius: 50px;
    background: white;
    color: #2d3748;
    transition: border-color 0.2s ease;
  }

  .input:focus {
    outline: none;
    border-color: #4ecdc4;
  }

  .input::placeholder { color: #a0aec0; }

  /* Flash banners */
  .flash {
    border-radius: 12px;
    padding: 12px 18px;
    font-size: 0.9rem;
    margin-bottom: 20px;
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .flash-ok {
    background: #f0fff4;
    color: #276749;
    border: 1.5px solid #9ae6b4;
  }

  .flash-err {
    background: #fff5f5;
    color: #c53030;
    border: 1.5px solid #feb2b2;
  }

  .flash-icon { flex-shrink: 0; font-size: 1rem; margin-top: 1px; }

  /* Member rows */
  .member-list { display: flex; flex-direction: column; gap: 2px; }

  .member-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 0;
    border-bottom: 1px solid #f7fafc;
  }

  .member-row:last-child { border-bottom: none; }

  .member-info {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }

  .member-email {
    font-size: 0.9rem;
    color: #2d3748;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .member-badge {
    flex-shrink: 0;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 3px 10px;
    border-radius: 20px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .member-badge--confirmed {
    background: #ebfff9;
    color: #2c7a7b;
  }

  .member-badge--pending {
    background: #fffbeb;
    color: #92600a;
  }

  /* Status page (confirm / unsubscribe / error) */
  .status-page {
    text-align: center;
    padding: 20px 0;
  }

  .status-icon {
    font-size: 4rem;
    display: block;
    margin-bottom: 20px;
  }

  .status-title {
    font-size: 2rem;
    font-weight: 800;
    color: #2d3748;
    margin-bottom: 12px;
  }

  .status-body {
    font-size: 1.05rem;
    color: #4a5568;
    margin-bottom: 30px;
    line-height: 1.7;
  }

  .status-address {
    font-family: monospace;
    font-size: 1.1rem;
    color: #4ecdc4;
    font-weight: 700;
    background: #f0fffe;
    border-radius: 8px;
    padding: 2px 8px;
  }

  .status-badge {
    display: inline-block;
    font-size: 0.8rem;
    font-weight: 700;
    padding: 4px 12px;
    border-radius: 20px;
    border: 1.5px solid #e2e8f0;
    color: #718096;
    margin-bottom: 16px;
  }

  /* Add member form row */
  .add-row {
    display: flex;
    gap: 10px;
    margin-top: 16px;
  }

  .add-row .input { flex: 1; }

  /* Magic link section */
  .magic-link-section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  .magic-link-copy {
    font-size: 0.9rem;
    color: #718096;
  }

  /* Unsubscribe page form */
  .unsubscribe-actions {
    display: flex;
    gap: 12px;
    justify-content: center;
    flex-wrap: wrap;
  }

  @media (max-width: 480px) {
    .card { padding: 24px 20px; }
    .status-title { font-size: 1.6rem; }
    .add-row { flex-direction: column; }
    .add-row .btn { width: 100%; justify-content: center; }
    .magic-link-section { flex-direction: column; align-items: flex-start; }
  }
`;

function layout(
  title: string,
  body: string,
  bodyAttrs = ""
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)} — Famio</title>
  <style>${SHARED_CSS}</style>
</head>
<body${bodyAttrs ? " " + bodyAttrs : ""}>
  <header class="app-header">
    <a href="/" class="logo-link">Famio</a>
  </header>
  <main class="app-main">
    ${body}
  </main>
  <footer class="app-footer">
    <p>&copy; 2024 Famio. Made with &#10084;&#65039; for families everywhere.</p>
  </footer>
</body>
</html>`;
}

// ─── Manage page ──────────────────────────────────────────────────────────────

export interface ManageMember {
  email: string;
  confirmed: boolean;
}

export interface ManageParams {
  addressName: string;
  domain: string;
  ownerEmail: string;
  members: ManageMember[];
  token: string;
  error?: string;
  success?: string;
}

export function managePage(p: ManageParams): string {
  const address = `${escHtml(p.addressName)}@${escHtml(p.domain)}`;
  const confirmedCount = p.members.filter((m) => m.confirmed).length;
  const totalCount = p.members.length;

  const flash = p.error
    ? `<div class="flash flash-err" id="flash" role="alert">
        <span class="flash-icon">⚠</span>
        <span>${escHtml(p.error)}</span>
      </div>`
    : p.success
    ? `<div class="flash flash-ok" id="flash" role="status">
        <span class="flash-icon">✓</span>
        <span>${escHtml(p.success)}</span>
      </div>`
    : `<div class="flash flash-ok" id="flash" role="status" style="display:none" aria-hidden="true">
        <span class="flash-icon">✓</span>
        <span id="flash-msg"></span>
      </div>`;

  const memberRows = p.members
    .map((m) => {
      const isOwner = m.email === p.ownerEmail;
      const badgeClass = m.confirmed
        ? "member-badge--confirmed"
        : "member-badge--pending";
      const badgeText = m.confirmed ? "Confirmed" : "Pending";
      const removeBtn = isOwner
        ? `<span style="font-size:0.78rem;color:#a0aec0;font-style:italic">Owner</span>`
        : `<button class="btn btn-sm btn-danger remove-btn" data-email="${escHtml(m.email)}" aria-label="Remove ${escHtml(m.email)}">Remove</button>`;
      return `
      <div class="member-row">
        <div class="member-info">
          <span class="member-email" title="${escHtml(m.email)}">${escHtml(m.email)}</span>
          <span class="member-badge ${badgeClass}">${badgeText}</span>
        </div>
        ${removeBtn}
      </div>`;
    })
    .join("");

  const atLimit = totalCount >= 6;
  const addSection = atLimit
    ? `<p style="font-size:0.9rem;color:#718096;margin-top:16px;text-align:center">
        You've reached the 6-member limit.
        Remove a member to add someone new.
      </p>`
    : `<form class="add-row" id="add-member-form" novalidate>
        <input
          type="email"
          class="input"
          id="add-email"
          placeholder="family@example.com"
          required
          autocomplete="email"
          aria-label="Member email address"
        >
        <button type="submit" class="btn btn-sm btn-teal">Add member</button>
      </form>
      <p style="font-size:0.8rem;color:#a0aec0;margin-top:8px">
        They'll receive a confirmation email before joining.
      </p>`;

  const body = `
    <div style="margin-bottom:6px">
      <p style="font-size:0.85rem;color:#718096">Managing address</p>
      <h1 style="font-size:1.6rem;font-weight:800;color:#2d3748;font-family:monospace">${address}</h1>
    </div>

    ${flash}

    <div class="card">
      <div class="card-title">
        Family members
        <span class="card-title-count">${confirmedCount} of 6 confirmed</span>
      </div>
      <div class="member-list">
        ${memberRows || `<p style="color:#a0aec0;font-size:0.9rem;padding:8px 0">No members yet — add some below.</p>`}
      </div>
      <div style="margin-top:16px;border-top:1px solid #f7fafc;padding-top:16px">
        ${addSection}
      </div>
    </div>

    <div class="card">
      <div class="magic-link-section">
        <div>
          <p style="font-size:0.95rem;font-weight:600;color:#2d3748;margin-bottom:4px">Need a new manage link?</p>
          <p class="magic-link-copy">We'll send it to ${escHtml(p.ownerEmail)}</p>
        </div>
        <button class="btn btn-ghost btn-sm" id="resend-link-btn">Send link</button>
      </div>
    </div>

    <div class="card" style="border:1px solid #fed7d7">
      <p style="font-size:0.95rem;font-weight:600;color:#2d3748;margin-bottom:4px">Delete this address</p>
      <p style="font-size:0.85rem;color:#718096;margin-bottom:16px">
        Permanently removes ${address} and stops all email forwarding.
      </p>
      <button class="btn btn-sm btn-danger" id="delete-address-btn">Delete address</button>
    </div>

    <!-- Delete address confirm dialog -->
    <dialog id="delete-dialog" style="border:none;border-radius:16px;padding:32px;max-width:420px;width:90%;box-shadow:0 8px 32px rgba(0,0,0,0.15)">
      <h2 style="font-size:1.2rem;font-weight:700;color:#2d3748;margin-bottom:8px">Delete ${address}?</h2>
      <p style="color:#4a5568;font-size:0.95rem;margin-bottom:8px">This will permanently:</p>
      <ul style="color:#4a5568;font-size:0.9rem;padding-left:20px;margin-bottom:20px;line-height:1.8">
        <li>Stop all email forwarding to your family</li>
        <li>Remove all ${totalCount} member${totalCount === 1 ? "" : "s"}</li>
        <li>Delete all manage links</li>
      </ul>
      <p style="font-size:0.85rem;color:#e53e3e;font-weight:600;margin-bottom:20px">This cannot be undone.</p>
      <div style="display:flex;gap:12px;justify-content:flex-end">
        <button class="btn btn-ghost btn-sm" id="delete-cancel-btn">Cancel</button>
        <button class="btn btn-sm btn-danger" id="delete-confirm-btn">Yes, delete forever</button>
      </div>
    </dialog>

    <script>
    (function() {
      var token = document.body.dataset.token;

      async function apiFetch(method, url, body) {
        var opts = {
          method: method,
          headers: Object.assign(
            { 'Authorization': 'Bearer ' + token },
            body !== undefined ? { 'Content-Type': 'application/json' } : {}
          )
        };
        if (body !== undefined) opts.body = JSON.stringify(body);
        return fetch(url, opts);
      }

      function showFlash(type, msg) {
        var el = document.getElementById('flash');
        var msgEl = document.getElementById('flash-msg');
        if (msgEl) msgEl.textContent = msg;
        el.className = 'flash ' + (type === 'ok' ? 'flash-ok' : 'flash-err');
        el.style.display = '';
        el.removeAttribute('aria-hidden');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      // Remove member
      document.querySelectorAll('.remove-btn').forEach(function(btn) {
        btn.addEventListener('click', async function() {
          var email = this.dataset.email;
          if (!confirm('Remove ' + email + ' from this address?')) return;
          this.disabled = true;
          this.textContent = '…';
          try {
            var res = await apiFetch('DELETE', '/manage/members/' + encodeURIComponent(email));
            if (res.ok) {
              location.reload();
            } else {
              var data = await res.json().catch(function() { return {}; });
              showFlash('err', data.error || 'Could not remove member. Please try again.');
              this.disabled = false;
              this.textContent = 'Remove';
            }
          } catch(e) {
            showFlash('err', 'Network error. Please try again.');
            this.disabled = false;
            this.textContent = 'Remove';
          }
        });
      });

      // Add member
      var addForm = document.getElementById('add-member-form');
      if (addForm) {
        addForm.addEventListener('submit', async function(e) {
          e.preventDefault();
          var emailInput = document.getElementById('add-email');
          var email = emailInput.value.trim();
          if (!email) return;
          var btn = addForm.querySelector('button[type="submit"]');
          btn.disabled = true;
          btn.textContent = 'Adding…';
          try {
            var res = await apiFetch('POST', '/manage/members', { email: email });
            if (res.ok) {
              location.reload();
            } else {
              var data = await res.json().catch(function() { return {}; });
              showFlash('err', data.error || 'Could not add member. Please try again.');
              btn.disabled = false;
              btn.textContent = 'Add member';
            }
          } catch(e) {
            showFlash('err', 'Network error. Please try again.');
            btn.disabled = false;
            btn.textContent = 'Add member';
          }
        });
      }

      // Delete address
      var deleteDialog = document.getElementById('delete-dialog');
      document.getElementById('delete-address-btn').addEventListener('click', function() {
        deleteDialog.showModal();
      });
      document.getElementById('delete-cancel-btn').addEventListener('click', function() {
        deleteDialog.close();
      });
      deleteDialog.addEventListener('click', function(e) {
        if (e.target === deleteDialog) deleteDialog.close();
      });
      document.getElementById('delete-confirm-btn').addEventListener('click', async function() {
        this.disabled = true;
        this.textContent = 'Deleting…';
        try {
          var res = await apiFetch('DELETE', '/manage/address');
          if (res.ok) {
            window.location.href = '/';
          } else {
            var data = await res.json().catch(function() { return {}; });
            deleteDialog.close();
            showFlash('err', data.error || 'Could not delete address. Please try again.');
            this.disabled = false;
            this.textContent = 'Yes, delete forever';
          }
        } catch(e) {
          deleteDialog.close();
          showFlash('err', 'Network error. Please try again.');
          this.disabled = false;
          this.textContent = 'Yes, delete forever';
        }
      });

      // Resend magic link
      document.getElementById('resend-link-btn').addEventListener('click', async function() {
        this.disabled = true;
        this.textContent = 'Sending…';
        try {
          var res = await apiFetch('POST', '/manage/magic-link');
          if (res.ok) {
            showFlash('ok', 'Magic link sent — check your email.');
          } else {
            showFlash('err', 'Could not send link. Please try again.');
          }
        } catch(e) {
          showFlash('err', 'Network error. Please try again.');
        }
        this.disabled = false;
        this.textContent = 'Send link';
      });
    })();
    </script>`;

  return layout(
    `Manage ${p.addressName}@${p.domain}`,
    body,
    `data-token="${escHtml(p.token)}"`
  );
}

// ─── Confirm page ─────────────────────────────────────────────────────────────

export interface ConfirmParams {
  ok: boolean;
  addressName: string;
  domain: string;
  memberEmail: string;
  errorMessage?: string;
}

export function confirmPage(p: ConfirmParams): string {
  const address = `${p.addressName}@${p.domain}`;
  const body = p.ok
    ? `<div class="card status-page">
        <span class="status-icon">🎉</span>
        <h1 class="status-title">You're confirmed!</h1>
        <p class="status-body">
          <strong>${escHtml(p.memberEmail)}</strong> will now receive emails
          forwarded from
          <span class="status-address">${escHtml(address)}</span>.
          <br><br>
          Share that address with anyone who wants to reach your whole family.
        </p>
        <a href="/" class="btn btn-ghost">Back to Famio</a>
      </div>`
    : `<div class="card status-page">
        <span class="status-icon">😬</span>
        <h1 class="status-title">Confirmation failed</h1>
        <p class="status-body">
          ${escHtml(p.errorMessage ?? "This confirmation link has expired or already been used.")}
          <br><br>
          Ask the owner of
          <span class="status-address">${escHtml(address)}</span>
          to resend your invitation.
        </p>
        <a href="/" class="btn btn-ghost">Back to Famio</a>
      </div>`;

  return layout(`Confirm — ${address}`, body);
}

// ─── Unsubscribe pages ────────────────────────────────────────────────────────

export interface UnsubscribeParams {
  addressName: string;
  domain: string;
  memberEmail: string;
  token: string;
}

export function unsubscribePage(p: UnsubscribeParams): string {
  const address = `${p.addressName}@${p.domain}`;
  const body = `
    <div class="card status-page">
      <span class="status-icon">👋</span>
      <h1 class="status-title">Leave ${escHtml(p.addressName)}?</h1>
      <p class="status-body">
        <strong>${escHtml(p.memberEmail)}</strong> will stop receiving
        emails forwarded from
        <span class="status-address">${escHtml(address)}</span>.
        <br><br>
        The family owner will be notified.
      </p>
      <div class="unsubscribe-actions">
        <form method="POST" action="/unsubscribe?token=${encodeURIComponent(p.token)}" style="display:inline">
          <button type="submit" class="btn btn-danger">Yes, remove me</button>
        </form>
        <a href="/" class="btn btn-ghost">Never mind</a>
      </div>
    </div>`;

  return layout(`Leave ${address}`, body);
}

export interface UnsubscribeSuccessParams {
  addressName: string;
  domain: string;
  memberEmail: string;
}

export function unsubscribeSuccessPage(p: UnsubscribeSuccessParams): string {
  const address = `${p.addressName}@${p.domain}`;
  const body = `
    <div class="card status-page">
      <span class="status-icon">✅</span>
      <h1 class="status-title">You've been removed</h1>
      <p class="status-body">
        <strong>${escHtml(p.memberEmail)}</strong> has been removed from
        <span class="status-address">${escHtml(address)}</span>.
        <br><br>
        You won't receive any more forwarded emails. The family owner has been notified.
      </p>
      <a href="/" class="btn btn-ghost">Back to Famio</a>
    </div>`;

  return layout(`Removed from ${address}`, body);
}

// ─── Error page ───────────────────────────────────────────────────────────────

export interface ErrorPageParams {
  status: number;
  title: string;
  message: string;
  backUrl?: string;
}

export function errorPage(p: ErrorPageParams): string {
  const icon =
    p.status === 404
      ? "🔍"
      : p.status === 401 || p.status === 403
      ? "🔒"
      : p.status >= 500
      ? "⚡"
      : "😬";

  const body = `
    <div class="card status-page">
      <span class="status-icon">${icon}</span>
      <span class="status-badge">${p.status}</span>
      <h1 class="status-title">${escHtml(p.title)}</h1>
      <p class="status-body">${escHtml(p.message)}</p>
      ${p.backUrl ? `<a href="${escHtml(p.backUrl)}" class="btn btn-ghost">Back to Famio</a>` : ""}
    </div>`;

  return layout(p.title, body);
}
