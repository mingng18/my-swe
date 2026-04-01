const fs = require('fs');
let content = fs.readFileSync('src/utils/github/github-comments.ts', 'utf8');

content = content.replace(
  'const cacheKey = JSON.stringify({ method: options.method, url: options.url, ...options });',
  'const cacheKey = JSON.stringify(options);'
);

// We need to pass the same token to localOctokit! But octokit.options.auth is not publicly available on octokit instances in Octokit v3+
// Let's modify the way we cache. We can just use the provided octokit instance and its hook system directly.
// WAIT! If we use octokit.hook.wrap, we'll modify the global instance passed in.
// That's fine if the instance is created per-request. Looking at \`fetchPrCommentsSinceLastTag\` and \`fetchIssueComments\`,
// they do: \`const octokit = new Octokit({ auth: token });\` inside the function!
// So it is already created per-request.

content = content.replace(
  'const localOctokit = new Octokit({',
  '/* const localOctokit = new Octokit({'
).replace(
  'auth: (octokit as any).options?.auth,',
  'auth: (octokit as any).options?.auth,'
).replace(
  '});',
  '}); */\n  const localOctokit = octokit;'
);

fs.writeFileSync('src/utils/github/github-comments.ts', content);
