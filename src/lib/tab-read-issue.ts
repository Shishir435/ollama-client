/**
 * Why a tab's text did not reach the chat, in terms a person can act on.
 *
 * The model-facing failure text ("Do not retry this same tab...") is written
 * for a tool loop and is wrong to show a user. The issue is the structured
 * reason beside it: the panel turns it into a message in the user's language,
 * and the model text stays exactly as it was.
 */
export type TabReadIssue =
  | "restricted"
  | "tab_reload"
  | "pdf_file_access"
  | "pdf_no_text"
  | "pdf_password"
  | "pdf_timeout"
  | "pdf_corrupt"
  | "pdf_too_large"
  | "pdf_unreachable"
  | "transcript_no_captions"
  | "transcript_failed"

/**
 * The locale key that says an issue, reusing the upload errors for the PDF
 * reasons both surfaces share so one sentence is translated once.
 */
export const tabReadIssueMessageKey = (issue: TabReadIssue): string =>
  issue === "pdf_no_text" ||
  issue === "pdf_password" ||
  issue === "pdf_timeout" ||
  issue === "pdf_corrupt"
    ? `file_upload.errors.${issue}`
    : `tabs.read_issue.${issue}`
