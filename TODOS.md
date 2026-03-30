# TODOS

Open items flagged during engineering review (2026-03-30). These are not blocking V1 but must be resolved before or during V1.5.

---

## TODO 1 — V1.5: MIME reconstruction gap

**What:** `postal-mime` parses MIME emails into structured parts but does not reassemble them into a new MIME message. For footer injection (free tier), you need to modify `text/plain` and `text/html` parts and then reconstruct a valid MIME email to pass to Resend.

**Why it matters:** Without a MIME builder, the V1.5 forwarding worker cannot inject the viral footer into emails that have attachments or multipart structure. Plain-text-only emails are straightforward; anything with an HTML part or attachments needs reconstruction.

**Options to evaluate:**
- `emailjs/emailjs-mime-builder` — actively maintained, works in Workers
- `nodemailer` — heavier, may not tree-shake cleanly for Workers
- Roll a minimal builder for text/plain + text/html only (skip attachment passthrough for V1.5)

**Gate:** Resolve before implementing the V1.5 email worker. Spike with a multipart test email to confirm the chosen library works in `@cloudflare/vitest-pool-workers`.

---

## TODO 2 — V1.5: Reply-To decision

**What:** When Famio forwards a broadcast email to all family members, what happens when a member hits Reply?

**Option A — Reply to sender only:** Set `Reply-To: original-sender@gmail.com`. Reply goes to the person who sent the email, not the group. Familiar, private.

**Option B — Reply to group:** Set `Reply-To: smiths@famio.org`. Reply re-enters the broadcast and goes to all confirmed members. Group thread behaviour, like a mailing list.

**Why it matters:** This is a product decision that affects the email schema (`addresses` table may need a `reply_to_mode` column), the V1.5 worker logic, and how you describe the product to users on the landing page.

**Gate:** Decide before implementing V1.5 fan-out. Update design doc with the chosen behaviour and add it to the manage page UI if per-family configurability is wanted.

---

## TODO 3 — V1 pre-launch gate: PurelyMail deliverability smoke test

**What:** Before onboarding any real families, manually verify that emails forwarded via PurelyMail land in the inbox (not spam) for Outlook and iCloud Mail recipients.

**Why it matters:** PurelyMail is an established provider but forwarding to Microsoft and Apple mail servers is historically the hardest deliverability case. If PurelyMail fails this test, the V1 architecture (PurelyMail for forwarding) needs to change before launch. Better to find out with a test address than with real families.

**How to test:**
1. Create a test family address (e.g. `testfamily@famio.org`) via PurelyMail API
2. Add one Outlook address and one iCloud address as confirmed members
3. Send a test email to `testfamily@famio.org` from a Gmail address
4. Verify delivery to both Outlook and iCloud inboxes — check spam folder
5. Check headers: confirm SPF/DKIM pass, note ARC chain

**Gate:** Must pass before announcing V1 to any real users. If it fails, escalate to the "migrate to Cloudflare Email Routing + Resend" path early.
