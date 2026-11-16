// "Your first support shift": five customers, three first moves each, a consequence for each, a score.
// Every lesson is tied to a real sentence on a Blotato help page (source.quote, checked against the cached page by
// test/plumbing.test.mjs). Where that sentence is written for developers, source.plain says it in plain words.
// The words are written for a beginner: short, warm, full sentences. The right first move is always the documented one.
// Each round keeps its three choices in one fixed order.
const D = 'https://help.blotato.com';

export const PRACTICE = {
  title: 'Your first support shift',
  intro: 'Five customers write in. For each one, pick your first move. You will see what happens next, and what Blotato\'s help page says.',
  decisions: [
    {
      entry: 'in-progress',
      ticket: 'My post has said "in-progress" for an hour. Is it stuck? Should I send it again?',
      choices: [
        { text: 'Yes, an hour is a long time. Send it again.', right: false, consequence: 'Oh no. The first one finishes later after all, and now their followers see the same post twice.' },
        { text: 'Look at the ID number they are checking. Make sure it is the one Blotato gave back when they first sent the post.', right: true, consequence: 'Good thinking. Blotato also says "in-progress" when it cannot find an ID at all. So a wrong ID can look just like a slow post, and checking the ID tells you which one this is.' },
        { text: 'Tell them it is still working and to wait another hour.', right: false, consequence: 'You promised something you had not checked. If the ID was wrong, they would wait for a post that does not exist.' },
      ],
      source: {
        url: `${D}/rest-api-reference/publish-post/get-post`,
        quote: 'Verify the ID came from the original create response.',
        plain: 'In plain words: the "create response" is the answer Blotato sends back when a post is first sent. The ID in it is the right one to check.',
      },
      firstCheck: 'Check that the ID is the one Blotato gave back when the post was first sent.',
    },
    {
      entry: 'unknown-outcome-resend',
      ticket: 'I sent a post to Blotato, and my request timed out with a 504 error. Should I send it again?',
      choices: [
        { text: 'Yes, send it again right away.', right: false, consequence: 'Oh no. The first try had actually gone through, so now they have two copies scheduled.' },
        { text: 'Tell them a 504 (the "took too long" error) means the post failed.', right: false, consequence: 'That is not true. A timeout does not tell you whether the post was made. They send it again, and it posts twice.' },
        { text: 'First look through their scheduled, published and failed posts to see if it is already there.', right: true, consequence: 'Good. You found it in their scheduled posts, so nothing needs to be sent again.' },
      ],
      source: {
        url: `${D}/api-and-mcp-concepts/post-lifecycle`,
        quote: 'A retry after an uncertain network result starts with looking up existing work. Repeating create-post risks a duplicate.',
        plain: 'In plain words: when you are not sure whether a send worked, look for the post first. Sending again can make a copy.',
      },
      firstCheck: 'Look for the post in their scheduled, published and failed lists before anything is sent again.',
    },
    {
      entry: 'mcp-invalid-grant',
      ticket: 'My AI assistant (Claude) stopped working with Blotato. It shows an error that says invalid_grant. What do I do?',
      choices: [
        { text: 'Take the Blotato connector (the link to Blotato inside Claude) out of Claude, then add it back.', right: true, consequence: 'Good. The sign-in link between Claude and Blotato had run out. Adding the connector back makes a fresh one.' },
        { text: 'Reconnect their Instagram account in Accounts.', right: false, consequence: 'Their Instagram was fine. The error is about the link between Claude and Blotato, so nothing changes.' },
        { text: 'Send them to the Fix My Automation button in Logs.', right: false, consequence: 'That button only works for n8n, a different automation tool. They click it, nothing happens, and they write back more frustrated.' },
      ],
      source: {
        url: `${D}/support/errors`,
        quote: 'Your Blotato MCP OAuth connection expired. In Claude, open Customize > Connectors, remove and re-add the Blotato custom connector, and re-approve access via OAuth.',
        plain: 'In plain words: the sign-in link between Claude and Blotato ran out. Removing the connector and adding it again makes a new one.',
      },
      firstCheck: 'Remove the Blotato connector from Claude and add it back.',
    },
    {
      entry: 'published-not-visible',
      ticket: 'Blotato says my post went out, but I cannot find it on my Instagram! Help!',
      choices: [
        { text: 'Tell them to post it again.', right: false, consequence: 'It had gone to a different account they run. Now that account has the same post twice.' },
        { text: 'Open Posts, then Published, and check which account it went to. Then open the post\'s link.', right: true, consequence: 'Good. It went to their second account. One look, one answer.' },
        { text: 'Tell them Instagram is probably hiding their account.', right: false, consequence: 'That is only a guess, and it scares them. Blotato\'s help page says a missing post alone does not prove that.' },
      ],
      source: {
        url: `${D}/support/faqs`,
        quote: 'Open Posts > Published and confirm the intended destination.',
        plain: 'In plain words: the "destination" is the account the post was sent to. Check that it is the one the customer meant.',
      },
      firstCheck: 'Check which account the post went to, under Posts, then Published.',
    },
    {
      entry: 'trial-api-key-charge',
      ticket: 'I was on the free trial. I made an API key to try something out, and now I have been charged. Why?',
      choices: [
        { text: 'Promise them a refund so they stay happy.', right: false, consequence: 'You promised money you cannot give. A person on the team has to decide about charges, so now someone has to take your promise back.' },
        { text: 'Tell them it is their own fault for making a key.', right: false, consequence: 'That may be true, but it is unkind. They leave feeling blamed, and their question about the charge is still not answered.' },
        { text: 'Tell them what happened, using the help page\'s words. Then pass the charge to a person on the team, with what you found.', right: true, consequence: 'Good. They understand why it happened, and the right person has what they need to decide about the charge.' },
      ],
      source: {
        url: `${D}/settings/billing-and-credits`,
        quote: 'If you go to Settings > API and generate an API key, your free trial ends at that moment and your paid subscription begins.',
        plain: 'In plain words: making an API key ends the free trial right away, and the paid plan starts.',
      },
      firstCheck: 'Explain why the charge happened, then pass the charge to a person on the team.',
    },
  ],
};
