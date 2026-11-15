// "Your first support shift": five tickets, three choices each, a consequence for each, a score.
// Built from the same playbook the desk uses, so the right answer is always the documented first check.
import { PLAYBOOK } from './playbook.mjs';

const cite = (entryId, stepIndex) => {
  const s = PLAYBOOK.find(e => e.id === entryId).steps[stepIndex];
  return { url: s.cite.url, quote: s.cite.quote };
};

export const PRACTICE = {
  title: 'Your first support shift',
  intro: 'Five customers write in. For each one, pick your first move. You will see what happens next, and what Blotato\'s docs say.',
  decisions: [
    {
      entry: 'in-progress',
      ticket: 'Submission c3a9... has said in-progress for an hour. Should I post it again?',
      choices: [
        { text: 'Yes, an hour is too long. Post it again.', right: false, consequence: 'The first one goes out later after all. Now their followers see the same post twice.' },
        { text: 'Look up the id, and check it came from the original create response.', right: true, consequence: 'Good. In-progress is also what Blotato answers for an id it cannot find, so the id check tells you which case this is.' },
        { text: 'Tell them it is still processing and to wait another hour.', right: false, consequence: 'You promised something you did not check. If the id was wrong, they wait for a post that does not exist.' },
      ],
      source: cite('in-progress', 1),
      firstCheck: 'Look up the submission id and confirm it came from the create response.',
    },
    {
      entry: 'unknown-outcome-resend',
      ticket: 'My create-post call timed out with a 504. Should I send it again?',
      choices: [
        { text: 'Send it again right away.', right: false, consequence: 'The first request had gone through. They now have two copies scheduled.' },
        { text: 'Tell them a 504 means it failed.', right: false, consequence: 'Not true. A timeout does not say whether the post was created. They resend, and it posts twice.' },
        { text: 'Check their scheduled and published posts for it first.', right: true, consequence: 'Good. You found it in the queue, so nothing needs to be sent again.' },
      ],
      source: cite('unknown-outcome-resend', 0),
      firstCheck: 'Check the queue for the post before anything is sent again.',
    },
    {
      entry: 'mcp-invalid-grant',
      ticket: 'The Blotato connector in Claude says invalid_grant. What do I do?',
      choices: [
        { text: 'Remove and re-add the Blotato connector in Claude, logged into Blotato first.', right: true, consequence: 'Good. The connector\'s sign-in had expired. Re-adding it fixes it.' },
        { text: 'Reconnect their Instagram account in Accounts.', right: false, consequence: 'Their Instagram was fine. The error is about the connector\'s own sign-in, so nothing changes.' },
        { text: 'Send them to the Fix My Automation button in Logs.', right: false, consequence: 'That button only works for n8n. They click it, nothing happens, and they write back more frustrated.' },
      ],
      source: cite('mcp-invalid-grant', 1),
      firstCheck: 'Treat it as the connector\'s sign-in: remove and re-add the connector.',
    },
    {
      entry: 'published-not-visible',
      ticket: 'Blotato says my post is published, but it is not on my Instagram. Help!',
      choices: [
        { text: 'Tell them to publish it again.', right: false, consequence: 'It was on a different account they manage. Now that account has it twice.' },
        { text: 'Open Posts > Published and check where it went, then open the post link.', right: true, consequence: 'Good. It went to their second account. One check, one answer.' },
        { text: 'Tell them Instagram is probably hiding their account.', right: false, consequence: 'A guess that worries them. Blotato\'s docs say a missing post alone does not prove that.' },
      ],
      source: cite('published-not-visible', 2),
      firstCheck: 'Check the destination in Posts > Published before anything else.',
    },
    {
      entry: 'trial-api-key-charge',
      ticket: 'I was on the free trial, made an API key, and got charged. Why?',
      choices: [
        { text: 'Promise a refund so they stay happy.', right: false, consequence: 'You promised money you cannot give. A person has to decide charges, and now they have to walk it back.' },
        { text: 'Tell them it is their own fault for making a key.', right: false, consequence: 'True, but unkind. They leave feeling blamed, and the charge question is still open.' },
        { text: 'Explain the documented cause, and hand the charge to a person with the evidence.', right: true, consequence: 'Good. They understand what happened, and the right person has what they need to decide.' },
      ],
      source: cite('trial-api-key-charge', 0),
      firstCheck: 'Explain the documented cause, then escalate the charge to a person.',
    },
  ],
};
