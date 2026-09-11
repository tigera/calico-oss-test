// Slack DM notifier for the auto-pick workflow. Reusable across flows: the
// caller passes everything via env. DMs the original PR author that their
// change was cherry-picked. Soft-fail by design: it never throws fatally, so a
// Slack hiccup or an unmapped author can't fail the job.
//
// Env:
//   SLACK_BOT_TOKEN  Slack bot token (needs chat:write). DM is sent by posting
//                    chat.postMessage with channel=<user-id> directly, like the
//                    merge-queue-bot (no conversations.open / im:write needed).
//   PICK_NOTIFY_MAP  "login:slack-id,login:slack-id,..." opt-in map.
//   AUTHOR_LOGIN     GitHub login of the original PR author.
//   SRC_PR, SRC_URL, SRC_TITLE   The source PR number, URL, title.
//   EE_PR_URL        The created cherry-pick PR URL.
//   OUTCOME          'clean' | 'conflict' (drives the review note).
//   CONFLICT_SEVERITY 'light' | 'heavy' (conflict picks; shown in the DM).
//   MODE             'picked' (default) | 'escalated'.
//   ESCALATION_REASON short reason string (escalated mode).
//   RUN_URL          workflow run URL (escalated mode; link for the human).
//   TARGET_LABEL     Human label for the target (e.g. "Enterprise").
//   TARGET_BRANCH    Target branch (e.g. "master").

const env = process.env;

function slackIdFor(login, map) {
  for (const entry of map.split(',')) {
    const s = entry.trim();
    const i = s.indexOf(':');
    if (i < 0) continue;
    if (s.slice(0, i).trim() === login) return s.slice(i + 1).trim();
  }
  return '';
}

async function main() {
  const token = env.SLACK_BOT_TOKEN;
  const map = env.PICK_NOTIFY_MAP;
  if (!token || !map) {
    console.log('::notice::Slack token or PICK_NOTIFY_MAP unset -- skipping');
    return;
  }

  const author = env.AUTHOR_LOGIN || '';
  const slackId = slackIdFor(author, map);
  if (!slackId) {
    console.log(`::notice::author ${author} not in PICK_NOTIFY_MAP -- skipping`);
    return;
  }

  const target = `${env.TARGET_LABEL || 'Enterprise'} ${env.TARGET_BRANCH || ''}`.trim();
  const title = (env.SRC_TITLE || '').replace(/[<>|*]/g, '').trim();
  // Keep the PR number and its title together so the title is never orphaned.
  const prRef = `<${env.SRC_URL}|#${env.SRC_PR}>${title ? ` *${title}*` : ''}`;

  // Slack mrkdwn: '\n' is a line break; keep each message a short headline plus
  // one or two detail lines rather than a run-on sentence.
  let text;
  if (env.MODE === 'escalated') {
    const reason = (env.ESCALATION_REASON || 'needs manual resolution').replace(/[<>|*]/g, '').trim();
    const lines = [
      `:warning:  *Auto cherry-pick needs a human*`,
      `OSS PR ${prRef} could not be picked to *${target}*.`,
      `*Reason:*  ${reason}`,
    ];
    if (env.RUN_URL) lines.push(`<${env.RUN_URL}|See the run and finish it manually>`);
    text = lines.join('\n');
  } else {
    const lines = [
      `:cherries:  Your OSS PR ${prRef} was auto-cherry-picked to <${env.EE_PR_URL}|*${target}*>.`,
    ];
    if (env.OUTCOME === 'conflict') {
      const sev = (env.CONFLICT_SEVERITY || '').toLowerCase();
      if (sev === 'heavy') lines.push(`:warning:  *Heavy conflict*, AI-resolved. Please review closely.`);
      else if (sev === 'light') lines.push(`:eyes:  *Light conflict*, AI-resolved. Please review.`);
      else lines.push(`:eyes:  *Conflict*, AI-resolved. Please review.`);
    }
    text = lines.join('\n');
  }

  let data;
  try {
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel: slackId, text, unfurl_links: false }),
      signal: AbortSignal.timeout(30000),
    });
    data = await resp.json();
  } catch (err) {
    console.log(`::warning::Slack request failed: ${err.message}`);
    return;
  }

  if (data && data.ok) {
    console.log(`DM sent to ${author} (${slackId})`);
  } else {
    console.log(`::warning::Slack DM failed: ${(data && data.error) || 'unknown'}`);
  }
}

main().catch((err) => {
  // Never fail the job on a notifier bug.
  console.log(`::warning::notify-slack error: ${err.message}`);
});
