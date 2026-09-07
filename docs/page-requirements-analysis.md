# MAPA — Page-by-Page Requirements Analysis (UI Interaction Spec)

A functional walkthrough of every page in the MAPA web portal: for each page,
its route, who may reach it, its purpose, and **every interactive control with
what happens when the user activates it** (navigation, Firestore write, Cloud
Function call, modal, validation, notification).

Derived by reading the shipped source under `src/pages/**` and the shared shell
components. Where a control runs a Firestore transaction or Cloud Function, the
effect is named so the behaviour can be traced to the data model.

**How to read the tables**
- *Control* — the button, link, field, tab, or gesture on the page.
- *Action → Result* — what firing it does, ending in the observable outcome
  (a navigation, a saved document, a toast, a modal).
- "notify()" = writes an in-app notification (+ email, + optional SMS).
- "logAudit()" = appends an immutable `auditLog` entry.
- Guards: **P** patient · **A** agency coordinator · **AA** agency administrator
  · **SA** staff admin · **SU** super admin. A page's guard is stated in its heading.

---

## 0. Global shell (present on every signed-in page)

The `Layout` shell wraps every patient/agency/admin page. These controls are
documented once here and not repeated per page.

| Control | Action → Result |
|---|---|
| Sidebar / bottom-tab nav item | Navigates to that section's route. Patient uses a 5-item bottom tab bar (Dashboard · Status · Request · Messages · More); agency/admin use a left sidebar. The active route is highlighted. |
| Logo / brand (top-left) | Returns to the role's home dashboard. |
| Notifications bell | Opens `/notifications`; a badge shows the unread count (live). |
| Language toggle (patient/public only) | Switches Filipino ⇄ English via i18next; staff surfaces are English-only. |
| User menu → **Report a Problem** | Opens a report composer; submit writes a `reports` document for admins. |
| User menu → **Log out** | Signs out of Firebase Auth, clears the session, navigates to `/login`, toast "Logged out". |
| Breadcrumb | Static label of the current page (some link back to the parent list). |
| Offline banner | Auto-appears when the browser goes offline; no control. |
| Announcement banner | Shows an active `announcements` entry targeted at the role; dismiss hides it locally. |

### Notifications (`/notifications` — all roles)

| Control | Action → Result |
|---|---|
| Notification row | Marks it read and navigates to the linked item (request, application, interview, message). |
| Mark all read | Batch-updates every unread item to read. |

---

## 1. Public / Authentication

### 1.1 Landing (`/` — public)

Marketing home. If MAPA is running as an installed PWA, the mount effect skips
this page (redirects to the role dashboard, or `/login` if signed out).

| Control | Action → Result |
|---|---|
| **Get Started** / main CTA | If signed in → role dashboard; else → `/register`. |
| **Install app** | Navigates to `/install`. |
| **Sign in** (header) | If signed in → dashboard; else → `/login`. |
| **Learn more** | Smooth-scrolls to the features section. |
| Secondary "Register" CTAs (hero, mid-page, footer) | Navigate to `/register`. |
| **Privacy** link (footer) | Opens the Data Privacy modal (RA 10173 summary). |
| Privacy modal → **Close** / backdrop | Closes the modal. |

### 1.2 Login (`/login` — public)

| Control | Action → Result |
|---|---|
| **Email** / **Password** fields | Credentials; clear the error highlight on change. |
| **Show/hide password** (eye) | Toggles password visibility. |
| **Sign in** | Validates non-empty → `login()`. Success → toast "Welcome back, {name}" → role dashboard. Wrong credentials → red fields + friendly error toast. Enrolled staff → switches to the **MFA step** instead of erroring. |
| **6-digit code** field (MFA step) | Accepts digits only; enables Verify at length 6. |
| **Verify** (MFA step) | `resolveTotpSignIn()`; success → auth completes → dashboard. Bad code → inline "code did not match". |
| **Back to sign in** (MFA step) | Cancels the second factor, returns to the password form. |
| **Forgot password?** | Opens the reset modal (pre-filled with the typed email). |
| Reset modal → **Send** | Validates email format → `sendPasswordResetEmail()` → toast "Reset link sent", closes modal. |
| Reset modal → **Cancel** / backdrop / ✕ | Closes without sending. |
| **Register here** | Navigates to `/register`. |
| Demo-account buttons (dev builds only) | Autofill the email+password of that seeded role. Hidden in production. |
| **Back to Home** | Navigates to `/` (hidden when running as an installed PWA). |

### 1.3 Register (`/register` — public)

A multi-step wizard gated by a Patient Access Code (`CRMC-YYYY-NNNNN`).

| Control | Action → Result |
|---|---|
| Step indicator | Shows progress; a completed step is clickable to jump back. |
| **Access Code** field | Formats/validates the code as typed. |
| **Verify code** | Calls the `verifyAccessCode` Cloud Function (falls back to a direct read). Valid & unused → toast "Code verified", unlocks the account step. Already-registered code → toast + routes to `/login`. Invalid → error toast. |
| Name / email / password / confirm fields | Account details; inline validation. |
| **Show/hide password** (both) | Toggle visibility. |
| **Privacy policy** link | Opens the Data Privacy modal (blocks default nav). |
| Consent checkbox | Required to enable submit. |
| **Back** | Previous step. |
| **Next** (`type=submit`) | Validates the step; advances. |
| **Create account** (final, `type=submit`) | `createUserWithEmailAndPassword` → `setDoc(users/{uid})` with role=patient + access-code binding. Success → toast "Welcome, {name}" → `/patient/request`. Rolls back the auth user if the profile write fails. |
| **Sign in** link | Navigates to `/login`. |
| **Back to Home** | Navigates to `/`. |

### 1.4 Install App (`/install` — public)

| Control | Action → Result |
|---|---|
| Platform tabs (Android / iOS / Desktop) | Switch the shown install instructions. |
| **Install** button | Fires the captured `beforeinstallprompt` (`prompt()`); if unavailable, shows manual steps. |
| **Copy link** | Copies the portal URL to the clipboard; toast confirms. |
| **Back to Home** | Navigates to `/`. |

---

## 2. Patient portal (guard: **P**)

### 2.1 Dashboard (`/patient/dashboard`)

Home base — status hero, 5-step journey, quick actions.

| Control | Action → Result |
|---|---|
| **New / Continue Request** | Navigates to `/patient/request`. |
| **Messages** button | Navigates to `/patient/messages`. |
| Quick action: Request / Status / Interviews | Navigate to the matching route (Interviews shown only when an interview is relevant). |
| Journey step card | If reached, navigates to that step's route (request, status, interviews…). |
| **Expand/collapse steps** | Toggles the 5-step journey list open/closed. |
| **Find Programs** | Navigates to `/patient/programs`. |
| **User Guide** | Navigates to `/patient/guide`. |
| Welcome card → **Dismiss** | Hides the first-run welcome card (persisted). |
| Welcome card → **Start a request** / **Read the guide** | Navigate to request / guide. |
| Document status chips | Live counts of verified/pending uploaded documents (read-only). |

### 2.2 Request Assistance (`/patient/request`)

Dual-mode: a **creation wizard** when there is no active request, or an
**active-request panel** when one exists.

| Control (wizard) | Action → Result |
|---|---|
| **Assistance type** select | Sets the request type; required to advance. |
| **Bill amount** / **PhilHealth** / **other payments** fields | Recompute *amount needed* = bill − PhilHealth − other (Order of Charging), live. |
| **Next** | Validates the step (type set, amount > 0, required docs attached, representative fields if any) → advances. |
| **Back** | Previous step. |
| Document **Upload** (per required type) | Attaches a file; on-device OCR reads the ID name as an advisory check. |
| **Retake selfie** / selfie capture | Opens the camera-only live selfie capture. |
| **Retry OCR** | Re-runs OCR on the attached ID. |
| **Remove** (per doc) | Detaches that upload. |
| Declaration checkbox | Required to enable Submit. |
| **Submit request** | Validates everything → `setDoc(requests/{id})` status=submitted + uploads documents + notify() CRMC. Success screen with the new request. |

| Control (active-request panel) | Action → Result |
|---|---|
| **View status** | Navigates to `/patient/status`. |
| **Copy request ID** | Copies the ID; toast "Request ID copied". |
| **Complete household intake** | Navigates to `/patient/request/:id/intake`. |
| **Proceed** (on an endorsed slice) | `updateDoc(applications/{id})` to advance the slice to reviewing ("For Funding"); notify(); toast. |
| **Re-upload** (flagged doc) | Replaces a rejected document; toast. |
| **Withdraw request** | Opens confirm → on confirm `updateDoc(requests/{id})` status=withdrawn; toast. |

### 2.3 Household Intake Wizard (`/patient/request/:id/intake`)

| Control | Action → Result |
|---|---|
| **Back to request** | Navigates to `/patient/request`. |
| Section fields (household, income, etc.) | Edit the intake payload; auto-persisted. |
| **Add member** | Appends a household-member row. |
| **Remove member** (per row) | Deletes that row. |
| Section jump buttons | Scroll/switch to that step. |
| **Back** / **Next** | Step navigation. |
| **Save & exit** | `updateDoc(requests/{id}, {intakeSheet})` → toast "Saved. You can finish later." → `/patient/request`. |
| **Finish** | Persists + marks intake submitted → toast → `/patient/request`. |

### 2.4 Track Status (`/patient/status`)

| Control | Action → Result |
|---|---|
| **Active** / **Past** tabs | Switch the request/slice list. |
| Journey stage chip | Navigates to that stage's route. |
| **Start a request** | Navigates to `/patient/request`. |
| **Proceed** (endorsed slice) | `updateDoc(applications/{id})` advances to reviewing; notify(); toast. |
| **Book interview** | Navigates to `/patient/interviews`. |
| **Withdraw** (per slice) | Confirm → `updateDoc` status=withdrawn, and a `runTransaction` releases any held interview/agency slot; toast. |
| **Expand stages** (per request) | Toggles the timeline detail. |
| **Download Guarantee Letter** | Reads the `certificates` doc; if ready, downloads the GL; else toast "not ready yet". |

### 2.5 Interviews (`/patient/interviews`)

| Control | Action → Result |
|---|---|
| Day selector | Picks the day; resets the selected slot. |
| Slot chip | Selects an open slot. |
| **Book** | `updateDoc(interviewSlots/{id})` **compare-and-set** (status open→booked, stamps patient). Success → toast "Booked". If another patient took it first → permission-denied → toast "slot taken". |
| **Reschedule** | Frees the current booked slot and books the newly selected one; toast. |
| **Prep checklist** toggle | Expands the "what to bring" list. |
| **Message CRMC** | Navigates to `/patient/messages`. |
| **View status** / **Start a request** | Navigate to status / request. |

### 2.6 Find Programs (`/patient/programs`)

| Control | Action → Result |
|---|---|
| **Search** field / **Clear** | Filters agencies/programs by text. |
| Type filter chips | Filter by assistance type; re-tap or **Clear filter** resets. |
| Agency card **Expand** | Shows that agency's program detail. |
| **Start a request** | Navigates to `/patient/request`. |

### 2.7 More (`/patient/more`)

| Control | Action → Result |
|---|---|
| **Account** row | Opens the account-detail modal. |
| Menu rows (Guide, Access log, Programs, …) | Navigate to the row's route. |
| **Replay tour** | Resets the onboarding flag; toast; returns to dashboard to re-run the tour. |
| **Log out** | Signs out → `/login`; toast. |

### 2.8 Access Log (`/patient/access-log`)

| Control | Action → Result |
|---|---|
| (List) | Renders `PatientAccessLog` — the `auditLog` entries scoped to this patient ("who has accessed your record", RA 10173 §16(f)). Read-only. |

### 2.9 User Guide (`/patient/guide`)

| Control | Action → Result |
|---|---|
| **Search** / **Clear** | Filters guide entries. |
| Section header | Expands/collapses that accordion section. |
| Quick-link button | Navigates to the referenced page. |

---

## 3. Agency portal (guard: **A**, unless marked **AA** = administrator only)

### 3.1 Dashboard (`/agency/dashboard`)

| Control | Action → Result |
|---|---|
| (on load) | Runs a GL-expiry sweep: expired reservations are released via `runTransaction` (re-syncs request financials) + logAudit(). |
| **Request top-up** | Opens the budget top-up modal. |
| Top-up modal → **Submit** | Validates amount>0 + reason → `addDoc(reports)` (a top-up request to the agency admin) + notify(); toast. |
| Top-up modal → **Cancel** / ✕ / backdrop | Closes. |
| Quick action cards | Navigate to inbox / slots / allocation etc. |
| **Go to Inbox** | Navigates to `/agency/inbox`. |
| Recent application row | Navigates to `/agency/applications/:id?queue=pending`. |

### 3.2 Inbox (`/agency/inbox`)

| Control | Action → Result |
|---|---|
| Status filter chips (For Funding / Reviewing / Needs Info / …) | Filter the queue; re-tap resets to all. |
| **Search** / **Clear** | Text filter over applicants. |
| **Sort** toggle | Newest ⇄ oldest. |
| Row click | Navigates to `/agency/applications/:id?queue=<filter>`. |
| **Message** (row) | Opens/creates the patient conversation → `/agency/messages?conv=<id>`. |
| **Open** (row) | Same as row click. |
| Empty-state **Clear filters** | Resets search + status filter. |

### 3.3 Application Detail (`/agency/applications/:id`)

The agency's funding decision surface (co-funding slice).

| Control | Action → Result |
|---|---|
| **Prev / Next** | Navigate to the adjacent application in the current queue. |
| **Start review** | `updateDoc` status → reviewing; logAudit(); toast "moved to Reviewing". |
| **Request more info** | Modal → message → status needs_info, pauses from the urgent queue, notify() patient; toast. |
| **Resume** (from awaiting) | Returns the slice to the active queue; toast. |
| **Approve** | Opens the approval modal → on confirm a `runTransaction`: re-checks the approval **cooldown**, caps `amountApproved ≤ endorsed amountRequested`, verifies remaining **budget**, increments agency committed budget, advances the parent request (partially/fully funded), stamps a **Hospital ID**, issues the **Guarantee Letter** (certificate), notify() patient, logAudit(). Guarded errors surface as toasts (BUDGET_INSUFFICIENT, cooldown, concurrent approval). |
| **Reject** | Modal → reason → `runTransaction` reverts any holds, status=rejected, notify(); toast. |
| **Open Intake Sheet** | Navigates to `/agency/applications/:id/intake` (read-only CRMC assessment). |
| **View / Print GL** | Navigates to `/agency/applications/:id/gl`. |
| **Message patient** | Opens the conversation in Messages. |

### 3.4 Intake Sheet (`/agency/applications/:id/intake`) — also `/admin/requests/:id/intake`

The Unified Intake Sheet. Editable for CRMC (request mode); read-mostly for agency.

| Control | Action → Result |
|---|---|
| Section fields | Edit assessment data; **auto-saves** (debounced `updateDoc`). |
| **Save** (manual) | Forces a save; toast "Assessment saved". |
| **Add / Remove member** | Edit the household roster. |
| Section nav buttons | Scroll to that section. |
| **Print Intake Sheet** | Renders the formal sheet in a new window for printing (`window.open`); asks to allow pop-ups if blocked. |

### 3.5 Guarantee Letter Viewer (`/agency/applications/:id/gl`)

| Control | Action → Result |
|---|---|
| **Print** | Opens the browser print dialog (`window.print()`). |
| **Mark as Issued** | Confirm modal → `updateDoc(applications/{id})` GL status=issued, notify() patient; toast. |
| **Upload signed copy** | Opens the signed-scan upload modal. |
| Confirm modal → **Cancel** / backdrop | Closes without marking. |

### 3.6 Slot Management (`/agency/slots`)

| Control | Action → Result |
|---|---|
| **Adjust** −/+ steppers | Set how many slots to add/deduct (1…max). |
| **Add slots** | `runTransaction` increases available slots (≤ total capacity) + logAudit(); toast. Over capacity → error toast. |
| **Deduct slots** | `runTransaction` decreases available (≥ 0) + logAudit(); toast. |
| **Edit total capacity** | Reveals the capacity field. |
| **Save** capacity | Validates 1…MAX and ≥ used → `runTransaction` sets `slots.total` + logAudit(); toast. Concurrent conflict → retry toast. |
| **Cancel** | Discards the capacity edit. |
| **Back to dashboard** | Navigates to `/agency/dashboard`. |

### 3.7 Budget Allocation (`/agency/allocation`) — **AA**

| Control | Action → Result |
|---|---|
| **Edit** | Reveals allocation + fund-source fields. |
| **Save allocation** | Validates amount ≥ 0, ≥ already-committed, fund source named → `updateDoc(agencies/{id})` + logAudit(); toast. |
| **Reset budget period** | Confirm → `updateDoc` starts a new period (archives the prior) + logAudit(); toast. |
| **View audit** | Navigates to `/agency/audit`. |
| **Back to dashboard** | Navigates to `/agency/dashboard`. |

### 3.8 Agency Audit Log (`/agency/audit`) — **AA**

| Control | Action → Result |
|---|---|
| Date / category filter chips | Filter the entries. |
| **Clear filters** | Resets filters. |
| **Export CSV** | Downloads the filtered log as CSV. |
| **Load more** | Pages the next batch. |
| Entry row | Expands the detail. |

### 3.9 Funds (`/agency/funds`)

| Control | Action → Result |
|---|---|
| Type filter chips / **Clear** | Filter fund movements. |
| Movement row | Navigates to `/agency/applications/:appId`. |
| **Prev / Next** page | Paginate. |
| **View audit** | Navigates to `/agency/audit`. |

### 3.10 Impact (`/agency/impact`)

| Control | Action → Result |
|---|---|
| **Export summary** | Downloads the impact summary (CSV/print). |

### 3.11 Team (`/agency/team`) — **AA**

| Control | Action → Result |
|---|---|
| **Add coordinator** | Opens the create modal. |
| Create modal → **Save** | Validates name/email/password → creates the auth user + `setDoc(users/{uid})` role=agency, agencyId bound, + logAudit(); optional reset email; toast. |
| **Regenerate password** | Generates a new temporary password. |
| **Copy password** | Copies to clipboard; toast. |
| **Show/hide password** | Toggle visibility. |
| Coordinator row **Edit** | Opens the edit modal → **Save** `updateDoc(users/{uid})` + logAudit(); toast. |
| Modal **Cancel** / ✕ / backdrop | Closes. |

### 3.12 Announcements (`/agency/announcements`) — **AA**

| Control | Action → Result |
|---|---|
| **New / Edit** | Opens the promotion composer. |
| Composer **Save** | Create → `addDoc(announcements)` (feed surface, targets patients) or edit → `updateDoc`; logAudit(); toast. |
| **Activate / Deactivate** toggle | Flips `active` + logAudit(); toast. |
| **Delete** → confirm | `deleteDoc(announcements/{id})` + logAudit(); toast. |
| Confirm/composer **Cancel** | Closes. |

### 3.13 Certificate Generator (`/agency/generator`)

| Control | Action → Result |
|---|---|
| **Search** / **Clear** | Filter approved applications. |
| **Print** (row) | Navigates to `/agency/applications/:id/gl` (the GL print surface). |
| **Upload signed** (row) | Opens the signed-copy upload modal. |

### 3.14 Upload Certificates (`/agency/certificates`)

| Control | Action → Result |
|---|---|
| (on load) | Redirects to `/agency/generator` (legacy route). |

### 3.15 Program (`/agency/program`)

| Control | Action → Result |
|---|---|
| Field **Edit** (per inline field) | Reveals the editor. |
| **Save** (per field) | `updateDoc(agencies/{id})` for that field + logAudit(); toast. |
| **Cancel** | Discards the edit. |
| **Slot Management** link | Navigates to `/agency/slots`. |

### 3.16 Logs (`/agency/logs`)

| Control | Action → Result |
|---|---|
| Category / date filter chips | Filter the activity log. |
| **Clear filters** | Resets filters. |
| **Export CSV** | Downloads the filtered logs. |

### 3.17 Guide (`/agency/guide`)

| Control | Action → Result |
|---|---|
| Section header | Expand/collapse. |
| **Expand/collapse all** | Toggles every section. |
| Quick-link button | Navigates to the referenced page. |

---

## 4. Admin portal (guard: **SA/SU**, unless marked **SU** = super admin only)

### 4.1 Dashboard (`/admin/dashboard`)

| Control | Action → Result |
|---|---|
| Metric cards | Navigate to the matching section. |
| Quick-action buttons | Navigate to their routes. |
| **Pipeline funnel** stage | Navigates to `/admin/requests` (that queue). |
| Recent-activity row | Navigates to the item's route (request, application, report…). |
| **View logs** | Navigates to `/admin/logs`. |
| **Replay tour** | Resets the tour flag + reloads. |

### 4.2 Analytics (`/admin/analytics`)

| Control | Action → Result |
|---|---|
| Range toggle (7/30/90 days) | Re-queries the charts for that window. |
| **Export summary** | Downloads the analytics summary. |
| **Pipeline funnel** stage | Navigates to `/admin/requests`. |

### 4.3 Requests (`/admin/requests`)

The CRMC intake/verification/endorsement workspace.

| Control | Action → Result |
|---|---|
| Request row / open | Opens the request's guided stepper (verify → intake → endorse). |
| Document **Verify / Reject** | `updateDoc(documents/{id})` status + `updateDoc(requests/{id})`; notify() on reject; toast. |
| **Message patient** | Opens/creates the conversation → `/admin/messages?conv=<id>`. |
| **Open Intake Sheet** | Navigates to `/admin/requests/:id/intake`. |
| **Endorse** | Opens the endorse modal: pick agencies + per-agency slice amounts. |
| Endorse modal → agency toggle | Selects/deselects a funder (blocked if it has no free slots). |
| Endorse modal → **Clear** | Deselects all. |
| Endorse modal → **Endorse** | `runTransaction`: creates child `applications` slices, decrements each agency's slots, stamps `documents.agencyIds[]`, advances the request to endorsed, notify() patient. Slot race → toast "agency ran out of slots". |
| Endorse modal → **Cancel** / ✕ | Closes. |

### 4.4 Interviews (`/admin/interviews`)

| Control | Action → Result |
|---|---|
| Generate-mode chips (in-person / online) | Set the mode for generated slots. |
| **Generate** | Builds a slot preview (not yet saved). |
| **Publish** | `writeBatch` writes the previewed `interviewSlots`; toast "Published N slots". |
| **Cancel** (preview) | Discards the preview. |
| **Flip day mode** (per day) | `writeBatch` switches that day's open slots in-person ⇄ online; toast. |
| **Flip ALL to online / in-person** | Confirm → `writeBatch` switches every upcoming open slot; toast. |
| **Remove slot** (per slot) | `deleteDoc(interviewSlots/{id})`; toast. |

### 4.5 Patients (`/admin/patients`)

| Control | Action → Result |
|---|---|
| Patient row | Opens the profile modal (doc summary, status). |
| **Message** | Opens/creates the conversation → `/admin/messages`; toast. |
| **Apply/remove holding period** | `updateDoc(users/{uid}, {cooldown})`; toast. |
| **Mark for deletion / restore** | `updateDoc(users/{uid}, {deletion})`; toast. |
| **Delete account** | Confirm → `writeBatch` removes the patient's docs + storage, then the `deleteAuthUser` Cloud Function removes the auth user; toast. |
| Modal **Close** | Closes the profile. |

### 4.6 Hospital IDs / Access Codes (`/admin/hospitalids`)

| Control | Action → Result |
|---|---|
| **Add batch** | Modal → count (1–100) → `writeBatch` creates that many `hospitalIds`; toast. |
| **Add one** | `setDoc(hospitalIds/{newId})`; toast. |
| **Revoke / reset** (per ID) | `writeBatch` resets the ID to Available (clears its binding); toast. |
| **Print available** | Opens a print window (`window.open`) listing available codes; needs pop-ups allowed. |
| **Delete** (per ID) | Confirm → `deleteDoc(hospitalIds/{id})`; toast. |
| Filter chips / search | Filter the list (All / Available / Assigned). |

### 4.7 Agencies (`/admin/agencies`)

| Control | Action → Result |
|---|---|
| **Add agency** | Opens the create/edit modal. |
| Modal → **Save** | Validates name/initials/province/city/slots → `addDoc`/`updateDoc(agencies)`; toast. |
| Color / logo pickers | Set brand fields in the modal. |
| **Enable / Disable** toggle (row) | `updateDoc(agencies/{id}, {enabled})`; toast. |
| **Edit slots** inline → **Save** | `updateDoc(agencies/{id}, {'slots.total'})`; toast. |
| Row → open | Navigates to `/admin/agencies/:id`. |
| **New agency** (SU) | Navigates to `/admin/agencies/new`. |

### 4.8 Add Agency (`/admin/agencies/new`) — **SU**

| Control | Action → Result |
|---|---|
| Agency + administrator fields | Details for the new agency and its first admin. |
| **Copy password** | Copies the temp password; toast. |
| **Create** | Validates all → creates the admin auth user, `setDoc(users/{uid})` role=agency_admin, `addDoc(agencies)`, binds `agencyId`. On any failure rolls back (deletes the auth user / agency). Success → toast → `/admin/agencies`. |
| **Cancel** | Returns to the agency list. |

### 4.9 Agency Detail (`/admin/agencies/:id`)

| Control | Action → Result |
|---|---|
| Agency fields **Save** | `updateDoc(agencies/{id})`; toast. |
| Coordinator **Edit** → **Save** | `updateDoc(users/{uid})`; toast. |
| **Re-enable** | `updateDoc(agencies/{id}, {enabled:true})`; toast. |
| **Disable** | Modal (choose cascade) → `updateDoc enabled:false`, optional `writeBatch` cascade over in-flight applications; toast. |
| **Save slots** | `updateDoc(agencies/{id}, slots)`; toast. |

### 4.10 Accounts (`/admin/accounts`) — **SU**

| Control | Action → Result |
|---|---|
| **New account** | Opens the create/edit modal. |
| Modal → **Save** | Create → new auth user + `setDoc(users/{uid})` with the chosen staff role (+ optional reset email); edit → `updateDoc(users/{uid})`; toast. Duplicate email → error toast. |
| **Show/hide password** | Toggle visibility. |
| **Activate / Deactivate** (row) | `updateDoc(users/{uid}, {active})`; a deactivated user is signed out on their next auth check; toast. |
| **Reset password** (row) | Sends a reset email; toast. |

### 4.11 Document Types (`/admin/doctypes`)

| Control | Action → Result |
|---|---|
| **Add** | Modal → **Save** → `addDoc(documentTypes)` (dup-name guarded); toast. |
| Row **Edit** → **Save** | `updateDoc(documentTypes/{id})`; toast. |
| **Move up/down** | `writeBatch` reorders; persists the order. |
| **Delete** (row) | `deleteDoc`; toast (shows how many requests use it). |
| **Bulk delete** | `writeBatch` deletes the selected types; toast. |

### 4.12 Assistance Types (`/admin/assistance`)

| Control | Action → Result |
|---|---|
| **Add** / row **Edit** → **Save** | `addDoc`/`updateDoc(assistanceTypes)` (dup-name guarded); toast. |
| **Move up/down** | `writeBatch` reorders. |
| **Delete** / **Bulk delete** | `deleteDoc` / `writeBatch`; toast. |
| **Remove duplicates** | Scans and batch-deletes duplicate names; toast. |

### 4.13 Application Logs (`/admin/logs`)

| Control | Action → Result |
|---|---|
| Status / date filter chips | Filter the application activity. |
| **Clear filters** | Resets. |
| **Refresh** | Reloads the first page. |
| **Load more** | Pages the next batch. |

### 4.14 Export (`/admin/export`)

| Control | Action → Result |
|---|---|
| Dataset category card | Navigates to `/admin/export/:type` (preview). |

### 4.15 Export Preview (`/admin/export/:type`)

| Control | Action → Result |
|---|---|
| Dataset tabs | Switch the previewed dataset. |
| **Reload** | Re-fetches the rows. |
| Client filter chips | Filter rows in-page. |
| **Date filter** → apply / **Clear** | Restrict by date range. |
| **Search** | Text filter. |
| Row checkbox / row click | Select rows for a partial export. |
| **Clear selection** | Deselects all. |
| **Download all** | Exports the full dataset to CSV. |
| **Download selected** | Exports the checked rows to CSV. |
| **Print all / Print selected** | Opens a print tab of the rows. |
| **Back** | Returns to `/admin/export`. |

### 4.16 Reports (`/admin/reports`)

Problem reports + budget top-up requests.

| Control | Action → Result |
|---|---|
| Status / category / role filter chips | Filter the report list. |
| **Clear filters** | Resets. |
| **Start / In progress** | `updateDoc(reports/{id}, status:in_progress)`; toast. |
| **Resolve** | Action panel → note → `updateDoc(status:resolved, resolutionNote)`; toast. |
| **Re-open** | `updateDoc(status:open)`; toast. |
| **Delete** | Confirm → `deleteDoc(reports/{id})`; toast. |
| **Cancel** (action panel) | Closes without change. |

### 4.17 Audit Log (`/admin/auditlog`) — **SU**

| Control | Action → Result |
|---|---|
| Date / category filter chips | Filter the immutable audit trail. |
| **Clear filters** | Resets. |
| **Export CSV** | Downloads the filtered trail. |
| **Refresh** | Reloads the first page. |
| **Load more** | Pages the next batch. |
| Entry row | Expands the actor/target/detail. |

### 4.18 Announcements (`/admin/announcements`)

| Control | Action → Result |
|---|---|
| **New / Edit** | Opens the composer (type, audience roles, surface, start/end window). |
| Composer **Save** | Create → `addDoc(announcements)` + notify() targeted users; edit → `updateDoc`; toast. Validates title, message, window, ≥1 audience. |
| Type / surface / role toggles | Set the announcement's targeting. |
| **Activate / Deactivate** | `updateDoc(announcements/{id}, {active})`; toast. |
| **Delete** → confirm | `deleteDoc(announcements/{id})`; toast. |

### 4.19 Messages (`/admin/messages`, `/agency/messages`, `/patient/messages`)

Shared conversation surface (role-scoped).

| Control | Action → Result |
|---|---|
| Conversation row | Opens that thread (patients auto-select; staff select by id). |
| **Compose / New message** | Opens the composer (staff pick a recipient). |
| **Send** | Appends the message + `updateDoc` the conversation (unread flags, last message). |
| Select checkbox (staff) | Marks conversations for a bulk action. |
| **Mark read** (bulk) | `writeBatch` clears unread on the selected threads. |
| **Delete** (bulk) → confirm | `writeBatch` deletes the selected conversations; toast. |
| **Search** / **Clear** | Filter conversations. |
| Discard-draft confirm | Warns before navigating away from an unsent draft. |

---

## 5. Notes for the manuscript

- **Transactional integrity.** Every money- or capacity-affecting control runs
  inside a Firestore `runTransaction` or `writeBatch` so concurrent operators
  cannot double-book a slot, over-commit a budget, or over-fund a request:
  interview booking (compare-and-set), slot add/deduct/capacity, endorsement,
  approval, agency-disable cascade, GL-expiry sweep.
- **Auditability.** Staff mutations call `logAudit()`; patients get a mirror of
  the entries about them at `/patient/access-log`.
- **Role guards** are enforced at the route (`PrivateRoute allowedRoles`) *and*
  in `firestore.rules`; the AA/SU annotations above match the route guards in
  `src/App.jsx`.
- **Dropdowns.** Every control labelled "select" above is the shared
  `SearchableSelect` combobox (`src/components/ui/SearchableSelect.jsx`), not a
  native `<select>` — type-to-filter on long lists, keyboard-navigable, styled
  to match the app (R42, see `docs/revision-list.md §B.27`). The selected value
  and behaviour are unchanged; only the widget differs.
- This document reflects the code as read on 2026-09-07 and should be
  regenerated if the pages change.
