// Temporary read-only helper for exploring a new Asana project before wiring
// it into api/data.js properly — returns the project's own metadata, its
// sections, and a handful of sample tasks with every field Asana will give
// us, so the real integration can be designed from what's actually there
// instead of guessing. Delete this file once that integration is built.
//
// Same auth as daily-digest.js: refuses to run without CRON_SECRET, so this
// doesn't become an unauthenticated way to read arbitrary Asana data.

async function getAsanaAccessToken() {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.ASANA_CLIENT_ID || '',
    client_secret: process.env.ASANA_CLIENT_SECRET || '',
    refresh_token: process.env.ASANA_REFRESH_TOKEN || '',
  });
  const r = await fetch('https://app.asana.com/-/oauth_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json.error_description || json.error || `HTTP ${r.status}`);
  return json.access_token;
}

module.exports = async (req, res) => {
  const auth = req.headers.authorization || '';
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(404).end();
  }

  const projectGid = req.query.project;
  if (!projectGid) return res.status(400).json({ error: 'pass ?project=<gid>' });

  try {
    const token = await getAsanaAccessToken();
    const headers = { Authorization: `Bearer ${token}` };

    const projectRes = await fetch(
      `https://app.asana.com/api/1.0/projects/${projectGid}?opt_fields=name,notes,color,custom_field_settings.custom_field.name,custom_field_settings.custom_field.type,custom_field_settings.custom_field.enum_options.name`,
      { headers });
    const project = await projectRes.json();
    if (!projectRes.ok) return res.status(projectRes.status).json({ step: 'project', error: project });

    const sectionsRes = await fetch(
      `https://app.asana.com/api/1.0/projects/${projectGid}/sections?opt_fields=name`, { headers });
    const sections = await sectionsRes.json();

    const tasksRes = await fetch(
      `https://app.asana.com/api/1.0/projects/${projectGid}/tasks?limit=10&opt_fields=` +
      'name,due_on,due_at,created_at,completed,completed_at,assignee.name,assignee.email,' +
      'memberships.section.name,custom_fields.name,custom_fields.display_value,tags.name,notes',
      { headers });
    const tasks = await tasksRes.json();
    if (!tasksRes.ok) return res.status(tasksRes.status).json({ step: 'tasks', error: tasks });

    return res.status(200).json({
      project: project.data,
      sections: sections.data,
      sampleTasks: tasks.data,
      totalSampled: (tasks.data || []).length,
    });
  } catch (e) {
    return res.status(502).json({ error: String((e && e.message) || e) });
  }
};
