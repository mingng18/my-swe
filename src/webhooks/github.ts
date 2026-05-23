import { createLogger } from "../utils/logger";
import {
  extractPrContext,
  fetchPrCommentsSinceLastTag,
  buildPrPrompt,
  reactToGithubComment,
  getThreadIdFromBranch,
  getGithubAppInstallationToken,
  storeGithubTokenInThread,
  postGithubComment,
  getGithubToken,
} from "../utils/github";
import { getEmailForIdentity } from "../utils/identity";
import { runCodeagentTurn } from "../server";

const log = createLogger("webhooks/github");

/**
 * Handle a GitHub webhook event.
 *
 * Processes pull_request, issues, and push events asynchronously.
 * Returns immediately — work runs in the background.
 */
export function handleGithubWebhook(
  payload: any,
  githubEvent: string,
): void {
  switch (githubEvent) {
    case "ping":
      break;

    case "pull_request":
    case "pull_request_review":
    case "pull_request_review_comment":
    case "issue_comment":
      handlePrEvent(payload, githubEvent);
      break;

    case "issues":
      handleIssuesEvent(payload);
      break;

    case "push":
      handlePushEvent(payload);
      break;

    default:
      log.info({ event: githubEvent }, "[github] Unhandled event");
  }
}

function handlePrEvent(payload: any, githubEvent: string): void {
  log.info(
    {
      action: payload.action,
      event: githubEvent,
      repository: payload.repository?.full_name,
    },
    "[github] PR event received",
  );

  void (async () => {
    try {
      if (githubEvent === "issue_comment" && !payload.issue?.pull_request) {
        return;
      }

      const [
        repoConfig,
        prNumber,
        branchName,
        githubLogin,
        prUrl,
        commentId,
        nodeId,
      ] = await extractPrContext(payload, githubEvent);

      if (!prNumber) {
        return;
      }

      const token =
        (await getGithubAppInstallationToken()) ||
        process.env.GITHUB_TOKEN?.trim() ||
        "";

      if (!token) {
        log.error(
          "[github] No GitHub token available to process PR event",
        );
        return;
      }

      const threadId = branchName
        ? await getThreadIdFromBranch(branchName)
        : null;
      if (threadId) {
        await storeGithubTokenInThread(threadId, token);
      }

      const comments = await fetchPrCommentsSinceLastTag(
        repoConfig,
        prNumber,
        token,
      );

      if (comments.length === 0) {
        return;
      }

      if (commentId) {
        await reactToGithubComment(
          repoConfig,
          commentId,
          githubEvent,
          token,
          prNumber,
          nodeId ?? undefined,
        );
      }

      const prompt = buildPrPrompt(comments, prUrl);

      const email =
        getEmailForIdentity("github", githubLogin) ||
        "No email found in identity map";

      const finalMessage = `[System Context: Webhook event ${githubEvent} from GitHub user @${githubLogin} (Email: ${email})]\n\n${prompt}`;

      await runCodeagentTurn(finalMessage, undefined, undefined, "github");
    } catch (err) {
      log.error({ err }, "[github] Background PR processing failed");
    }
  })();
}

function handleIssuesEvent(payload: any): void {
  const action = payload.action;
  const issue = payload.issue;
  const repository = payload.repository;

  log.info(
    {
      action,
      number: issue?.number,
      title: issue?.title,
    },
    "[github] Issue event",
  );

  if (action === "opened" && issue && repository) {
    const issueTitle = issue.title || "";
    const issueBody = issue.body || "";
    const repoOwner = repository.owner?.login;
    const repoName = repository.name;
    const issueNumber = issue.number;

    if (repoOwner && repoName && issueNumber) {
      void (async () => {
        try {
          const prompt = `New issue opened in ${repoOwner}/${repoName}#${issueNumber}:\nTitle: ${issueTitle}\n\n${issueBody}\n\nPlease analyze this issue and provide a helpful response.`;
          const reply = await runCodeagentTurn(
            prompt,
            undefined,
            undefined,
            "github",
          );

          const token =
            getGithubToken() || (await getGithubAppInstallationToken());
          if (token) {
            await postGithubComment(
              { owner: repoOwner, name: repoName },
              issueNumber,
              reply,
              token,
            );
            log.info({ issueNumber }, "[github] Posted reply to issue");
          } else {
            log.warn(
              "[github] No GitHub token available to post issue comment",
            );
          }
        } catch (err) {
          log.error({ err }, "[github] Error processing issue event");
        }
      })();
    }
  }
}

function handlePushEvent(payload: any): void {
  const repoName = payload.repository?.full_name || "unknown repository";
  const ref = payload.ref || "unknown ref";
  const commitsCount =
    payload.commits?.length || payload.push?.commits?.length || 0;

  log.info(
    {
      ref: payload.ref,
      commits: commitsCount,
    },
    "[github] Push event",
  );

  const input = `A push event was received on repository ${repoName} for ref ${ref} with ${commitsCount} commits.`;

  void (async () => {
    try {
      await runCodeagentTurn(input, undefined, undefined, "github");
    } catch (err) {
      log.error({ error: err }, "[github] Error running agent on push event");
    }
  })();
}