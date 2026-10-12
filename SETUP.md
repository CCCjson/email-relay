# Go-live runbook

Work through it in order. **Steps 1 and 2 are the critical path** because DNS takes time to
propagate, so start them first; the rest can run in parallel.

The code is ready. Everything below is accounts and DNS.

---

## Step 0: see it work (0 accounts, 5 minutes)

No domain, no sign-ups. Confirm the thing runs before wrestling with accounts.

```bash
cd ~/Desktop/Upwork/project2

# 1. A local Postgres
docker run -d --name relay-pg \
  -e POSTGRES_PASSWORD=relay -e POSTGRES_USER=relay -e POSTGRES_DB=relay \
  -p 55432:5432 postgres:16-alpine

# 2. Dependencies and tables
npm install
cp .env.local.example .env
npx prisma db push
```

Then open **three terminals**:

```bash
node scripts/mock-resend.mjs   # terminal 1: mock Resend send/receive + Slack
npm run dev                    # terminal 2: the app
node scripts/demo.mjs          # terminal 3: run the whole scenario once
```

In a browser:
- <http://localhost:3000> - the sender view
- <http://localhost:3000/admin> - the admin view, password `local-admin-token`

Compare the two: the admin view shows a filtered message highlighted in yellow, and the
sender view **does not contain it at all**.

---

## Step 1: sign up for Resend and add the domain (10 minutes)

> The output of this step is **a set of DNS records** that step 2 needs.

1. Sign up at <https://resend.com> (free tier, no credit card)
2. **Domains** in the sidebar > **Add Domain**
3. Enter your domain, e.g. `yourdomain.com` (the root domain, not `send.yourdomain.com`)
4. Pick a region close to your users, e.g. `us-east-1`
5. On submit it lists a set of DNS records. **Keep that page open** - step 2 copies them one
   by one

You get three (the page is authoritative; the shapes below are illustrative only):

| Type | Name | Value |
|---|---|---|
| MX | `send` | `feedback-smtp.us-east-1.amazonses.com` (priority 10) |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` |
| TXT | `resend._domainkey` | a long `p=MIGfMA0GCSq...` |

⚠️ The record name is **the subdomain part only** (`send`), not `send.yourdomain.com`.
Cloudflare appends the zone itself, and entering the full name produces
`send.yourdomain.com.yourdomain.com`.

---

## Step 2: add the DNS records in Cloudflare (10 minutes plus propagation)

1. Log in to Cloudflare > select your domain > **DNS** > **Records**
2. **Add record** for each of the three records from step 1
3. Then add two more:

| Type | Name | Value | Notes |
|---|---|---|---|
| TXT | `_dmarc` | `v=DMARC1; p=none; rua=mailto:you@gmail.com` | Needed for deliverability. `p=none` observes without enforcing, which is right for a new domain |
| MX | **root domain** (`@`, or leave the name blank) | **get it from the Resend dashboard** (see step 5) | Receiving. You can leave this until step 5 |

⚠️ **The receiving MX goes on the root domain, not on an `inbound.` subdomain.** Once
Receiving is enabled, the record name Resend gives you is empty, i.e. the zone apex. That is
also why `INBOUND_DOMAIN` is the root domain in step 4 - setting it to
`inbound.yourdomain.com` means no reply is ever received.

⚠️ **Proxy status must be "DNS only" (grey cloud) on every one of these records, never the
orange cloud.** Cloudflare's proxy only handles HTTP and breaks MX/TXT records outright.

When they are all in, go back to the Domains page in Resend and click **Verify**. It usually
turns green within a few minutes; Cloudflare DNS is normally fast, but the worst case is tens
of minutes.

---

## Step 3: the other three accounts (15 minutes, can run alongside step 2)

### 3.1 Neon (database, free)

1. Sign up at <https://neon.tech> > **Create project**
2. Any region close to you
3. Copy the `postgresql://...` string from **Connection string**
   - Choose **Pooled connection** (the one containing `-pooler`)
   - Make sure it ends with `?sslmode=require`

-> this is `DATABASE_URL`

### 3.2 Slack incoming webhook (free)

1. <https://api.slack.com/apps> > **Create New App** > **From scratch**
2. Any name, and pick one of your workspaces
3. **Incoming Webhooks** in the sidebar > turn it on > **Add New Webhook to Workspace**
4. Pick a channel (a dedicated `#email-relay` channel is a good idea)
5. Copy the `https://hooks.slack.com/services/...` URL

-> this is `SLACK_WEBHOOK_URL`

### 3.3 OpenAI API key

1. <https://platform.openai.com/api-keys> > **Create new secret key**
2. Copy it (**shown only once**)

-> this is `OPENAI_API_KEY`

> At demo volumes this costs a few cents. You can set a spending cap in the dashboard; $5 is
> a sensible one.

### 3.4 Line up three mailboxes

- **Notification mailbox**: an address different from both the sender and the receiver, e.g.
  a second Gmail -> `DEFAULT_NOTIFY_EMAIL`. The app rejects a send when this address matches
  the sender or the receiver, so it really does have to be a third mailbox.
- **Test recipient A**: a Gmail account
- **Test recipient B**: an Outlook / Hotmail account, to exercise HTML-only reply parsing

---

## Step 4: deploy to Vercel (10 minutes)

> Deploy first: the webhook in step 5 needs a public HTTPS URL.

```bash
cd ~/Desktop/Upwork/project2
npx vercel
```

The first run asks a few questions; the defaults are fine (it detects Next.js).

You end up with a URL like `https://email-relay-xxxx.vercel.app`.

Then set the environment variables: open the project at <https://vercel.com> >
**Settings** > **Environment Variables** and add them one by one:

```
DATABASE_URL          <- the Neon connection string from 3.1
RESEND_API_KEY        <- create one under API Keys in the Resend dashboard
RESEND_WEBHOOK_SECRET <- only exists after step 5; leave it empty and come back
MAIL_FROM             relay@yourdomain.com
MAIL_FROM_NAME        Relay
INBOUND_DOMAIN        yourdomain.com          <- the ROOT domain, see step 5
SLACK_WEBHOOK_URL     <- from 3.2
DEFAULT_NOTIFY_EMAIL  <- the notification mailbox from 3.4
OPENAI_API_KEY        <- from 3.3
FILTER_STAGE2_ENABLED true
FILTER_FAIL_OPEN      true
ADMIN_TOKEN           <- invent a long random string
APP_URL               https://your-deployment.vercel.app
```

⚠️ **Do not** set `RESEND_BASE_URL`. It exists for the local mock only, and setting it points
production traffic at an address that does not exist.

Create the tables (using the Neon connection string):

```bash
DATABASE_URL="your Neon connection string" npx prisma db push
```

Environment variable changes need a redeploy to take effect: `npx vercel --prod`

---

## Step 5: enable receiving and create the webhook (10 minutes)

### 5.1 Enable Receiving

1. Resend dashboard > **Emails** > the **Receiving** tab
2. Select your verified domain and enable receiving
3. It gives you an **MX record** with a value like `inbound-smtp.<region>.amazonaws.com`,
   priority 10
4. ⚠️ **The record name is empty - it goes on the root domain, not an `inbound.` subdomain.**
   In Cloudflare enter `@` in the name field (or leave it blank; it fills in the zone apex)
5. Grey cloud, **DNS only**, again

Once that is in, mail sent to `anything@yourdomain.com` goes to Resend. That is how the reply
address `reply+<token>@yourdomain.com` is received, which is why `INBOUND_DOMAIN` is the
**root domain**.

⚠️ With the root MX pointing at Resend, **every** message sent to that domain goes to Resend.
Do not also use the domain as a day-to-day mailbox.

⚠️ The MX record takes a few minutes to move from `pending` to `verified` on Resend's side,
and **mail sent before it turns verified is dropped** (seen in practice). Confirm with the
API first:

```bash
curl -s https://api.resend.com/domains -H "Authorization: Bearer $RESEND_API_KEY" \
  | python3 -c "import sys,json;[print(d['name'], d['capabilities']) for d in json.load(sys.stdin)['data']]"
```

Wait for `{'sending': 'enabled', 'receiving': 'enabled'}` and a verified record before going on.

### 5.2 Create the webhook

1. Resend dashboard > **Webhooks** > **Add Webhook**
2. URL: `https://your-deployment.vercel.app/api/inbound`
3. Tick `email.received` and **nothing else**
4. Open the created webhook and copy the **Signing Secret** (starts with `whsec_`)
5. Put it into `RESEND_WEBHOOK_SECRET` on Vercel and redeploy with `npx vercel --prod`

---

## Step 6: end-to-end testing (30 minutes)

Open `https://your-deployment.vercel.app` and work through this checklist:

### Delivery

- [ ] Send one to your Gmail from the UI - **inbox or spam?**
  - Spam is new-domain reputation, not an application bug. Mark it "not spam", exchange a few
    more messages to warm the domain up, and it usually improves within a day or two.
- [ ] Send one to Outlook
- [ ] Get a test address from <https://www.mail-tester.com>, send to it, aim for >= 8/10

### Thread matching

- [ ] Reply straight from Gmail on the web -> appears in the UI within 30 seconds, with a
      clean body (no `> Hi Alex...` quoting)
- [ ] Reply from Outlook on the web (it sends HTML by default) -> also lands in the UI with a
      clean body
- [ ] Reply from the iPhone Mail app -> lands in the UI with `Sent from my iPhone` stripped
- [ ] Reply twice in the same thread -> correct ordering
- [ ] If nothing arrives -> open `/admin` and click **"Unmatched inbound"** at the top right;
      it says which layer it stalled at

### Filtering

- [ ] Reply with plain profanity -> **invisible** in the sender view, visible and highlighted
      in `/admin`
- [ ] Reply with `f*ck this` / `sh1t` -> also blocked
- [ ] Reply with **`this is late, I'm not happy, I want a refund`** -> **must be visible**
      (the most important line on this list: hiding legitimate negative feedback is far worse
      than letting one swear word through)
- [ ] Reply with `the assessment and analysis look classic` -> must be visible (Scunthorpe check)

### Notifications

- [ ] Every reply produces a message in the Slack channel
- [ ] The filtered one shows as ⚠️ Filtered in Slack **with no abusive text visible**
- [ ] The notification mailbox receives an email, at an address that is neither the sender nor
      the receiver
- [ ] Try setting the notification address equal to the receiver -> the send is rejected with
      an explanatory error, which is the requirement being enforced

---

## What to send back

To get help debugging, send along (**paste API keys and other secrets privately, never
anywhere public**):

1. Your domain
2. The Vercel deployment URL
3. Which items in step 6 **failed**, and what you saw
4. If a reply never reached the UI: the text of the row under `/admin` > "Unmatched inbound"

---

## Common sticking points

| Symptom | Cause / fix |
|---|---|
| The Resend domain never verifies | The record name in Cloudflare was entered in full (`send.yourdomain.com` instead of `send`), or the orange proxy cloud is on |
| Outgoing mail lands in spam | New-domain reputation, not a code problem. Warm it up over a few days and confirm the DMARC record is present |
| Replies never arrive | The receiving MX is missing or has not propagated. Check with `dig MX yourdomain.com` - on the ROOT domain, not an `inbound.` subdomain |
| Replies arrive but never reach the UI | Check "Unmatched inbound" in `/admin`; it reports what each of the three layers parsed (token / message-id / subject tag) |
| The Vercel deployment reports a database error | `DATABASE_URL` is not the pooled connection string, or `prisma db push` was never run |
| A send is rejected with "notification email must differ" | The notification address equals the sender or the receiver. Either fill in a third address in the form or change `DEFAULT_NOTIFY_EMAIL` |
| Legitimate negative feedback was filtered | Send the text over and the prompt in `lib/filter/stage2.ts` can be tuned. This is the one genuine risk in the feature |
