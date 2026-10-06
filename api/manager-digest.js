// Sends a pod task-overview email to each configured pod lead and their team.
// Pulls all incomplete tasks from every Asana project in the workspace that are
// assigned to the pod's members, groups them by person, and mails the whole
// picture to the lead (TO) with leadership on CC.
//
// Required env vars (shared with the other digests):
//   ASANA_CLIENT_ID, ASANA_CLIENT_SECRET, ASANA_REFRESH_TOKEN
//   ZEPTOMAIL_URL, ZEPTOMAIL_TOKEN, ZEPTOMAIL_SENDER
//   CRON_SECRET or INSPECT_SECRET  (for auth)
//   MANAGER_DIGEST_CC               (comma-sep, e.g. "rahul.sharma@okiedokiepay.com")
//
// Trigger: call with Authorization: Bearer <CRON_SECRET> or <INSPECT_SECRET>.
// Test mode: add ?test=you@email.com to route everything to a single address.

// ── Config ────────────────────────────────────────────────────────────────────

const WORKSPACE_GID = '480944584143449';

// Each pod: lead gets the email; members + lead all go in TO. Names are matched
// case-insensitively against Asana display names — partial first-name match is
// enough for nicknames like "Ashu". Email is used for the TO list; if null here
// it is derived from the Asana user's own email.
const PODS = [
  {
    lead: 'Sultan Malik',
    members: ['Sultan Malik', 'Lokesh Kumar', 'Aanchal Dhiman', 'Ashu'],
  },
];

// ── Asana auth (same refresh-token flow as data.js) ───────────────────────────

let _asanaToken = null;

async function getAsanaToken() {
  if (_asanaToken && _asanaToken.expiresAt > Date.now() + 60000)
    return _asanaToken.token;
  const r = await fetch('https://app.asana.com/-/oauth_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id:     process.env.ASANA_CLIENT_ID     || '',
      client_secret: process.env.ASANA_CLIENT_SECRET || '',
      refresh_token: process.env.ASANA_REFRESH_TOKEN || '',
    }).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Asana token: ${j.error_description || j.error || r.status}`);
  _asanaToken = { token: j.access_token, expiresAt: Date.now() + (j.expires_in || 3600) * 1000 };
  return _asanaToken.token;
}

async function asanaGet(path, token) {
  const r = await fetch(`https://app.asana.com/api/1.0/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Asana ${path.split('?')[0]}: ${r.status}`);
  return (await r.json()).data;
}

// Fetch all pages of a paginated Asana endpoint.
async function asanaAll(path, token) {
  const sep = path.includes('?') ? '&' : '?';
  let url = `${path}${sep}limit=100`;
  const all = [];
  while (url) {
    const r = await fetch(`https://app.asana.com/api/1.0/${url}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) throw new Error(`Asana ${path.split('?')[0]}: ${r.status}`);
    const body = await r.json();
    all.push(...(body.data || []));
    url = body.next_page ? body.next_page.path.replace(/^\/api\/1\.0\//, '') : null;
  }
  return all;
}

// ── Resolve pod member names → Asana user objects ─────────────────────────────

async function resolveUsers(names, token) {
  // Fetch all workspace users once, then match locally.
  const all = await asanaAll(
    `workspaces/${WORKSPACE_GID}/users?opt_fields=name,email`,
    token
  );

  return names.map(search => {
    const low = search.toLowerCase();
    // Exact full-name match first, then partial (first-name nickname like "Ashu").
    return all.find(u => u.name.toLowerCase() === low)
        || all.find(u => u.name.toLowerCase().startsWith(low))
        || all.find(u => u.name.toLowerCase().includes(low))
        || null;
  });
}

// ── Fetch incomplete tasks for a user across the whole workspace ───────────────

async function userTasks(userGid, token) {
  // completed_since=now → Asana returns only incomplete tasks (standard trick).
  const fields = 'name,due_on,projects.name,assignee.name';
  return asanaAll(
    `tasks?workspace=${WORKSPACE_GID}&assignee=${userGid}&completed_since=now&opt_fields=${fields}`,
    token
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const escapeHtml = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const today = () => new Date().toISOString().slice(0, 10);

const fmtDate = iso => iso
  ? new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—';

function taskStatus(dueOn, todayIso) {
  if (!dueOn) return 'no-date';
  if (dueOn < todayIso) return 'overdue';
  const days = Math.round((new Date(dueOn + 'T00:00:00') - new Date(todayIso + 'T00:00:00')) / 86400000);
  if (days <= 7) return 'due-soon';
  return 'ok';
}

// ── Email HTML ────────────────────────────────────────────────────────────────

const ACCENT = '#1A56A0';
const RED    = '#A82A1C';
const AMBER  = '#B8860B';
const GREEN  = '#2E7D32';
const GREY   = '#6E6E73';

const STYLE = `
  * { margin:0; padding:0; box-sizing:border-box;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; }
  body { background:#F5F4F1; padding:40px 16px; color:#1D1D1F; }
  .wrap { max-width:640px; width:100%; margin:0 auto; background:#fff;
    border:1px solid #E5E3DE; border-radius:12px; padding:36px 32px; }
  h1 { font-size:22px; font-weight:600; text-align:center; color:#1D1D1F; margin:0 0 6px; }
  .sub { font-size:14px; color:${GREY}; text-align:center; margin:0 0 32px; }
  .divider { border:none; border-top:1px solid #E5E3DE; margin:28px 0; }
  .person-head { font-size:16px; font-weight:700; color:${ACCENT}; margin:0 0 4px; }
  .person-count { font-size:13px; color:${GREY}; margin:0 0 14px; }
  table { width:100%; border-collapse:collapse; font-size:13.5px; margin-bottom:4px; }
  th { text-align:left; padding:0 8px 7px 0; font-size:10.5px; font-weight:600;
    letter-spacing:.04em; text-transform:uppercase; color:#8A8A8F;
    border-bottom:1px solid #E5E3DE; }
  td { padding:9px 8px 9px 0; border-bottom:1px solid #EFEDE8; vertical-align:top; }
  tr:last-child td { border-bottom:none; }
  .task  { font-weight:500; color:#1D1D1F; }
  .proj  { font-size:12px; color:${GREY}; margin-top:2px; }
  .overdue  { color:${RED};   font-weight:600; white-space:nowrap; }
  .due-soon { color:${AMBER}; font-weight:600; white-space:nowrap; }
  .ok       { color:${GREEN};               white-space:nowrap; }
  .no-date  { color:${GREY};                white-space:nowrap; }
  .footer   { margin-top:28px; font-size:12px; color:#8A8A8F; text-align:center; }
  @media (max-width:480px) { .wrap { padding:28px 20px; } h1 { font-size:19px; } }`;

function personBlock(name, tasks, todayIso) {
  if (!tasks.length) {
    return `<div class="person-head">${escapeHtml(name)}</div>` +
      `<p class="person-count" style="color:${GREEN}">No open tasks</p>`;
  }
  const sorted = [...tasks].sort((a, b) => {
    const s = { overdue: 0, 'due-soon': 1, ok: 2, 'no-date': 3 };
    const sa = s[taskStatus(a.due_on, todayIso)], sb = s[taskStatus(b.due_on, todayIso)];
    if (sa !== sb) return sa - sb;
    return (a.due_on || 'zzz').localeCompare(b.due_on || 'zzz');
  });
  const rows = sorted.map(t => {
    const st = taskStatus(t.due_on, todayIso);
    const dueCell = st === 'overdue'
      ? `<span class="overdue">Overdue · ${fmtDate(t.due_on)}</span>`
      : st === 'due-soon'
      ? `<span class="due-soon">Due · ${fmtDate(t.due_on)}</span>`
      : t.due_on
      ? `<span class="ok">${fmtDate(t.due_on)}</span>`
      : `<span class="no-date">No date</span>`;
    const projects = (t.projects || []).map(p => p.name).filter(Boolean).join(', ');
    return `<tr>
      <td><div class="task">${escapeHtml(t.name)}</div>` +
      (projects ? `<div class="proj">${escapeHtml(projects)}</div>` : '') +
      `</td><td style="width:140px">${dueCell}</td></tr>`;
  }).join('');
  return `<div class="person-head">${escapeHtml(name)}</div>` +
    `<p class="person-count">${tasks.length} open task${tasks.length === 1 ? '' : 's'}</p>` +
    `<table><tr><th>Task</th><th style="width:140px">Due</th></tr>${rows}</table>`;
}

function buildHtml(podLead, members, tasksByGid, todayIso, fullDate) {
  const totals = Object.values(tasksByGid).reduce((s, t) => s + t.length, 0);
  const blocks = members
    .filter(m => m)
    .map(m => personBlock(m.name, tasksByGid[m.gid] || [], todayIso))
    .join('<hr class="divider">');

  return `<!doctype html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pod Task Overview</title><style>${STYLE}</style></head><body>
<div class="wrap">
  <h1>${escapeHtml(podLead)}'s Pod — Task Overview</h1>
  <p class="sub">${fullDate} &nbsp;·&nbsp; ${totals} open task${totals === 1 ? '' : 's'} across the team</p>
  <hr class="divider">
  ${blocks}
  <hr class="divider">
  <p class="footer">Pulled from all Asana projects in the workspace. Reply to this email if a task is stale or misfiled.</p>
</div></body></html>`;
}

// ── Send email ────────────────────────────────────────────────────────────────

async function sendEmail(to, cc, subject, html) {
  const r = await fetch(process.env.ZEPTOMAIL_URL || 'https://api.zeptomail.in/v1.1/email', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: process.env.ZEPTOMAIL_TOKEN || '',
    },
    body: JSON.stringify({
      from: { address: process.env.ZEPTOMAIL_SENDER || '', name: 'CS KPI — Pod Digest' },
      to:  to.map(a => ({ email_address: { address: a } })),
      cc: cc.map(a => ({ email_address: { address: a } })),
      subject,
      htmlbody: html,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`ZeptoMail ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

// ── Handler ───────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  const authHeader = req.headers.authorization || '';
  const okCron    = process.env.CRON_SECRET    && authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const okInspect = process.env.INSPECT_SECRET && authHeader === `Bearer ${process.env.INSPECT_SECRET}`;
  if (!okCron && !okInspect) return res.status(404).end();

  const testParam = (req.query && (Array.isArray(req.query.test) ? req.query.test[0] : req.query.test));
  const testTo = typeof testParam === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testParam)
    ? testParam : null;

  const ccList = testTo ? []
    : (process.env.MANAGER_DIGEST_CC || '').split(',').map(s => s.trim()).filter(Boolean);

  const todayIso = today();
  const fullDate = new Date().toLocaleDateString('en-GB',
    { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  try {
    const token = await getAsanaToken();
    const results = [];

    for (const pod of PODS) {
      // Resolve all member names against workspace users (includes lead).
      const resolved = await resolveUsers(pod.members, token);
      const members  = resolved.filter(Boolean);

      if (!members.length) {
        results.push({ pod: pod.lead, error: 'No members resolved from Asana' });
        continue;
      }

      // Fetch each member's open tasks in parallel.
      const tasksByGid = {};
      await Promise.all(members.map(async m => {
        tasksByGid[m.gid] = await userTasks(m.gid, token);
      }));

      const html = buildHtml(pod.lead, members, tasksByGid, todayIso, fullDate);
      const total = Object.values(tasksByGid).reduce((s, t) => s + t.length, 0);

      // TO: all resolved members (email from Asana profile)
      const to = testTo
        ? [testTo]
        : members.map(m => m.email).filter(Boolean);

      if (!to.length) {
        results.push({ pod: pod.lead, error: 'No email addresses found' }); continue;
      }

      const subject = `Pod Task Overview — ${pod.lead.split(' ')[0]}'s team (${total} open)`;
      await sendEmail(to, testTo ? [] : ccList, subject, html);
      results.push({ pod: pod.lead, members: members.map(m => m.name), tasks: total, to });
    }

    return res.status(200).json({ ok: true, results, testTo: testTo || undefined });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
};
