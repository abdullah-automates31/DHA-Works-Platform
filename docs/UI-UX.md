# UI / UX

## 1. Status

All three surfaces are designed in Claude Design and exported to `C:\Users\Abdullah Ali\DHA-Works-UI\` (outside this repository): `SPEC.md`, 55 screenshots, screen source files, assets. **The screenshots are the visual source of truth.** The `.dc.html` files use a prototype-only format and are never copied; they are only read for exact text and spacing. Rebuild each screen in the real stack (Expo, Next.js).

| Surface | Status |
| --- | --- |
| Resident app (C) | Designed, 20 screens (green, flat "calm pass" kept) |
| Worker app (W) | Designed, 20 screens |
| Admin portal (A) | Designed, 15 screens (1440 x 960 desktop) |
| Changes needed after later decisions | Listed in section 8 |

## 2. Design principles

1. **Calm and trustworthy.** This is about letting a stranger into your home. Flat surfaces, plenty of white space, one clear action per screen.
2. **Low decoration.** No drop shadows or gradients on mobile; the admin portal uses only very soft card shadows. Hierarchy comes from size, weight, spacing and colour.
3. **Trust signals visible.** Verified badge, rating and jobs done appear wherever a worker appears.
4. **Plain English.** Short labels. All text goes through a translation file so Urdu can follow.
5. **Colour never carries meaning alone.** Status chips keep colour but always have a text label.
6. **Easy to tap.** Targets at least 44 by 44 px.
7. **Safety always reachable.** "Report a problem", "I feel unsafe" and the helpline 1092 button are on every job screen.

## 3. Visual language

| Token | Value | Use |
| --- | --- | --- |
| Green (mobile) | `#0E5A3A` | Primary buttons, selected states |
| Green (admin) | `#0F4F31` | Admin primary |
| Dark green | `#0A3D28` | Hero surfaces, sidebar |
| Gold | `#E0B43A` (`#EBCB62` on dark) | Small accents: active-tab marker, stars |
| Background | `#EEF4F1` | App background |
| Ink / muted | `#10261C` / `#4F6A5C` | Text |
| Line / mint | `#DCE6E0` / `#DCEBE2` | Dividers, soft fills |
| Status: waiting or quoted | `#F6E7B4` on `#5C4300` | Chip |
| Status: scheduled | `#D6E6F7` on `#17406B` | Chip |
| Status: in progress | `#E5DDF5` on `#44297A` | Chip |
| Status: done | `#C9E8D5` on `#0A5530` | Chip |
| Status: declined or unsafe | `#FADCDA` on `#99191A` | Chip |
| Font | Plus Jakarta Sans 400 to 800 (Instrument Serif italic only for one accent word on resident Home) | All text |
| Icons | 24 px stroke icons, 2 px stroke, round caps (Lucide fits) | |
| Logo | `assets/dha-crest.png` | Sign-in screens, admin sidebar |

Mobile: 390 x 844 artboards, card radius 18, button radius 14 (28 pill on sign-in), 78 px bottom tab bar with a gold top marker on the active tab, 44 px round icon buttons. Admin: dark green sidebar (248 px) with a gold left edge on the active item, white top bar. Exact values are in `dw.css`, `dww.css` and `admin.css`.

## 4. Resident app screens

| # | Screen | Purpose |
| --- | --- | --- |
| C01 | Welcome and sign in | Email or Google (planned; customer app not built) |
| C02, C03 | Onboarding | About you; home, CNIC photos and utility bill |
| C04 | Pending review | Waiting for staff |
| C05 | Home | Categories, Emergency now, your jobs |
| C10 | Post a job | Description, voice note, category, address, time, photos, save draft |
| C11 | My jobs | Active, Completed, All |
| C19 | Compare quotes | Sort by lowest price, top rated, soonest |
| C12 | Quote detail | Breakdown; accept or reject |
| C13 | Job status timeline | Posted through review |
| C20 | Confirm cash paid | Same as quote or a different amount |
| C15 | Rate the worker | Three criteria, hire again, comment |
| C14 | Report a problem | Includes "I feel unsafe" |
| C16 | Notifications | |
| C17 | Profile | Details, addresses, documents |
| C21 | Help and support | Helpline 1092, FAQ |
| C06 to C09 | Worker list, worker profile, book a worker, request status | Not in MVP 1 |

## 5. Worker app screens

| # | Screen | Purpose |
| --- | --- | --- |
| W01 | Sign in | Phone + WhatsApp OTP (built 30 Oct; design still shows email) |
| W02, W03, W03b | Onboarding | About you; documents; your work |
| W04 | Application under review | |
| W05 | Choose your areas | Phases 1 to 8 |
| W06 | Home | New jobs, today's jobs |
| W07 | Open jobs | Matching feed |
| W08 | Job detail | Photos, voice note, interested count |
| W10 | Create quote | Labour, materials, other, visit window |
| W11 | My jobs | |
| W12, W12b | Job status | Start, complete; board of every status |
| W13 | Record cash collected | |
| W14 | Report a problem | Includes "I feel unsafe" |
| W15 | Notifications | |
| W16, W16b | Profile and sheets | Categories, areas |
| W17 | Help and support | |
| W09 | Direct requests | Not in MVP 1 |

Workers use the app on site, often one-handed and in poor light: large buttons, high contrast, minimal typing.

## 6. Admin portal screens

A01 staff sign-in; A02 dashboard (later); A03 and A04 worker queue and review; A05 and A06 resident queue and review; A07 and A08 reports and case detail; A09 helpline log (later); A10 and A11 jobs and job detail; A12 and A13 users and user detail; A14 settings; A15 worker reviews (later). Stack: Next.js with Tailwind and shadcn/ui, built after the mobile apps.

## 7. Accessibility checklist

- Text contrast at least 4.5:1 (3:1 for large text).
- Visible focus states; labels on icon-only buttons.
- Respect system text scaling; avoid truncation.
- Respect reduced-motion settings.
- Don't rely on colour alone (status chips also carry text).
- Proper input types (phone, email) to raise the right keyboard.
- Visible labels on every field; errors next to the field with how to fix them.

## 8. Design changes needed (decisions made after the designs)

- Remove "Call, then quote", and Call buttons shown before acceptance (W06, W07, W08, W12 and any status screen): contact details appear only after acceptance.
- Reword the reject-quote copy on C12 ("If you reject it, he can send a new quote" and "send a better quote"): a rejected worker cannot re-quote.
- Categories: eight everywhere. Resident Home adds Welding & Ironwork and General Handyman (replacing "Others"); worker onboarding and profile pickers become multi-select; admin Settings lists all eight.
- Remove the distance sheet ("How far will you travel?"), km labels and the "Nearest" sort on Open jobs (W07).
- Open jobs now expire after 24 hours: add an expired state and a Repost action on C11, and a 20-hour reminder.
- Cash matching: C20 and W13 need a "waiting for the other side" and a "disputed" state.
- Direct booking, saved workers, helpline log, dashboard and the all-reviews screen are out of MVP 1. Quote revision screens (request and approve) do not exist yet and are MVP 2.
- Worker "needs changes" wording should become "Visit HQ" to match the admin.
- **Add Request cancellation screens** (resident C22, worker W18): reason list, optional details, a clear note that the request does not automatically stop work or settle payment, and a "Cancellation requested, under review" banner on job status screens (with Withdraw request).
- **Worker sign-in:** W01 now uses a Pakistani mobile number and a 6-digit WhatsApp code; email sign-in was removed. The design still shows email, so a matching phone/WhatsApp W01 and code screen are needed. Local test OTPs are fixed; production needs a Twilio/Twilio Verify WhatsApp sender.
- **Helpline:** the Call 1092 buttons and FAQ lines stay hidden until DHA confirms the number is correct and authorised. Wording and FAQ answers also need Shariq Bhai's approval.

## 9. Content and tone

Short, friendly, plain English. Say what happens next. Show money as "Rs 3,000". Times in local format.

## 10. Open UI questions

- Helpline 1092 wording and FAQ answers (Shariq).
- App names and icons (pending).

## 10. Design queries from Shariq Bhai (27 Oct, reported 28 Oct)

Screens are in `DHA-Works-UI/` (outside this repo); these are the corrections the design owner must make. Nothing here has been drawn yet.

- **Customer status variations:** make a status-variation screen for the customer app, like the worker app has, one frame per job status.
- **C13 Job status timeline:** the last step "Cash paid and review" is replaced by **"Review pending"** as a single standalone step. Cash collected by the worker shows as its own status on C13. The button "Work finished? Confirm cash paid" and C20 are removed: cash is worker-only (9 Nov).
- **W11 My jobs:** remove all action buttons.
- **Direct requests screen:** remove it (direct booking is out of MVP 1).
- **Worker complete-job screen (W12):** add a mandatory **material bill photo** upload (needed when the quote has materials; the quote form no longer asks for a bill, 3 Nov). Typing a list of materials stays optional.
- **C20 / W13:** drop the "disputed" state added in section 8; a price difference never disputes a job. Pending: whether C20 itself goes.
- **Rating screen:** a rating below 3 files a Poor work report automatically; the resident may be told "staff will review this".
- **"v2 need expiry":** unclear, pending (quote expiry?).
