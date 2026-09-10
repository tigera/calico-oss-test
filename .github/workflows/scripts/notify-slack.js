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

  const note = env.OUTCOME === 'conflict'
    ? ' (conflicts were AI-resolved -- please review the resolution)'
    : '';
  const target = `${env.TARGET_LABEL || 'Enterprise'} ${env.TARGET_BRANCH || ''}`.trim();
  // Slack mrkdwn links: <url|text>. #<n> -> source PR; target label -> pick PR.
  const text = `:cherries: Your OSS PR <${env.SRC_URL}|#${env.SRC_PR}> (${env.SRC_TITLE}) `
    + `was auto-cherry-picked to <${env.EE_PR_URL}|${target}>${note}`;

  let data;
  try {
    const resp = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ channel: slackId, text, unfurl_links: false }),
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
