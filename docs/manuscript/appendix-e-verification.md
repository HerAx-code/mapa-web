# Appendix E — Verification against the shipped UI (Task E)

Each of the five role guides in Appendix E was walked against the actual pages
and navigation labels in the deployed build. The guides are accurate in
substance; the mismatches below are **label / page-name** differences only —
places where the guide names a destination differently from the button the
user actually sees. Reported, not rewritten (per the brief).

| # | Guide (Appendix E) says | Actual UI label | Where | Suggested fix |
|---|-------------------------|-----------------|-------|---------------|
| 1 | **E.1 Patient** — "Track your request … from **My Application**" | The tab is **Status** (routes to `/patient/status`) | Patient bottom tab bar (`patient.tab.status`) | Rename "My Application" → "Status" in the guide |
| 2 | **E.2 Coordinator** — "Open the **Funding Inbox**" | **Application Inbox** (sidebar) / **Inbox** (mobile) | `/agency/inbox` | Use "Application Inbox" (or "Inbox") |
| 3 | **E.3 Agency Admin** — "Set your agency's budget from **Allocation**" | **Budget Allocation** (sidebar); "Allocation" only on the mobile bottom nav | `/agency/allocation` | Use "Budget Allocation" |
| 4 | **E.4 Staff Admin** — "Issue Patient Access Codes from **Hospital IDs**" | **Access Codes** | `/admin/hospitalids` (sidebar label "Access Codes") | Rename "Hospital IDs" → "Access Codes" |

**Verified correct (no change needed):** E.3 "Team" (matches `/agency/team`
label), E.5 "Admin Accounts", "Agencies", and "Patients" all match their nav
labels; the Patient guide's "Find Programs", "Request Assistance", "Interviews",
"Messages", and "Proceed" all match; the Staff guide's "Requests" workspace and
its four-step stepper match.

**Note:** items 2–4 are the guide describing a destination by its *function*
rather than its exact on-screen label. They won't mislead a user badly, but a
panel clicking through will notice the wording differs — worth a one-word fix
each. Item 1 ("My Application" → "Status") is the one most worth changing, since
"My Application" is not a label that appears anywhere in the current build.
