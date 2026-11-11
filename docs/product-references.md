# Product references reviewed on 2026-11-02

Only public marketing pages and the user-provided screenshot were reviewed. No paid account, private dashboard, vendor binary, or account-safety claim was independently tested. No third-party product source code or branding was copied.

| Reference                               | Observed                                                                                                                                       | Applied in Nhip Dang                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| https://orbitama.com/                   | Advertises cloud agents, multiple Facebook accounts, workspaces, task history, and lead discovery.                                             | Workspace isolation, account-specific work queues, durable reminder worker, visible status and progress.                               |
| https://maxmorus.com/                   | Describes leads, task dashboard, group posting, exports, and a connected Desktop application requirement for Facebook Desktop tasks.           | Explicit distinction between the web control panel and the browser that holds the Facebook session; searchable history and CSV export. |
| User screenshot of Jx2 AI Auto Post Pro | Personal/Page/Group navigation, Page token panel, aggregate states, spreadsheet-based operation, and posting history. The visible tab is Page. | Personal/group destination filters, real aggregate counts, explicit queue controls, bulk cancellation confirmation, and history.       |

Cloud browser automation, lead scraping, messaging, AI lead scoring, Page tokens, activation keys, and billing are outside this implementation. A subsequent update adds a paired local desktop process for user-scheduled text/image publishing, with identity confirmation, final server authorization and conservative outcome verification. Reviewed interactions remain manual. See [desktop workflow](desktop.md); actual Facebook publishing has not yet been tested with the user's accounts.

Meta Groups API removal: https://developers.facebook.com/docs/graph-api/changelog/version19.0/

Official Page publishing: https://developers.facebook.com/docs/pages-api/posts/
