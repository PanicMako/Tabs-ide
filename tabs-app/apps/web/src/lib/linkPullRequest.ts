import { normalizeThreadPullRequestKey } from "@tabs/shared/threadPullRequests";
import { parseChangeRequestUrl } from "@tabs/shared/changeRequestUrl";

export type LinkPullRequestInput =
  | {
      readonly ok: true;
      readonly host: string;
      readonly repository: string;
      readonly number: number;
      readonly url: string;
    }
  | { readonly ok: false; readonly message: string };

/** Turns what the user pasted into the key the server links a thread to, or says what is wrong. */
export function linkPullRequestFromText(text: string): LinkPullRequestInput {
  const url = text.trim();
  if (url.length === 0) {
    return { ok: false, message: "Paste the link to a pull request." };
  }
  const parsed = parseChangeRequestUrl(url);
  if (parsed === null) {
    return {
      ok: false,
      message:
        "That does not look like a pull request link. Open the pull request in your browser and copy its address.",
    };
  }
  const key = normalizeThreadPullRequestKey({ ...parsed, url });
  return { ok: true, host: key.host, repository: key.repository, number: key.number, url };
}
