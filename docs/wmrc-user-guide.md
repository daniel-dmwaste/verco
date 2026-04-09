# Verco V2 — WMRC User Guide

**Version:** 1.0  
**Date:** 2026-04-09  
**Audience:** WMRC staff (customer service operators, back-office, managers)  
**Last Updated:** 2026-04-09  

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Admin Dashboard Overview](#admin-dashboard-overview)
3. [Core Workflows](#core-workflows)
   - [Booking Lookup](#booking-lookup)
   - [Contact Lookup](#contact-lookup)
   - [Ticket Triage](#ticket-triage)
   - [Non-Conformance (NCN) Resolution](#non-conformance-ncn-resolution)
   - [Nothing Presented (NP) Resolution](#nothing-presented-np-resolution)
   - [Property Allocation Override](#property-allocation-override)
4. [Screen-by-Screen Guide](#screen-by-screen-guide)
5. [Common Tasks](#common-tasks)
6. [Troubleshooting](#troubleshooting)

---

## Getting Started

### What is Verco?

Verco is the online booking system for managing residential bulk verge collection in your area. It lets residents book collection services, allows WMRC staff to manage bookings and resolve issues, and helps track collection operations.

### Logging In

1. Navigate to your council's Verco portal (e.g., `https://verco.example.com`)
2. Click **Log In** in the top-right corner
3. Enter your email address and password
4. You'll land on the **Admin Dashboard**

### Your Role

As a WMRC staff member, you have one of two roles:

- **`client-staff`** — Can view bookings, manage tickets, and issue refunds (limited write access)
- **`client-admin`** — Can do everything client-staff can do, plus manage users, allocation overrides, and allocation rules (full admin access)

If you're unsure which role you have, check the **Users** page (`/admin/users`) and find your name in the list.

---

## Admin Dashboard Overview

When you log in, you'll see the **Admin Dashboard** (`/admin`). This is your home base for managing bookings and resolving issues.

### Key Metrics (Top Row)

The dashboard displays four metric cards:

| Card | What It Shows |
|------|---------------|
| **This Week** | Bookings created in the current calendar week (Mon–Sun) |
| **Total Completed** | All bookings marked as Completed (cumulative) |
| **Total NCN** | All bookings marked as Non-Conformance (cumulative) |
| **Total NP** | All bookings marked as Nothing Presented (cumulative) |

### Weekly Breakdown

Below the metric cards, you'll see a **Weekly Breakdown** grid showing:

- **Submitted** — Bookings created this week
- **Confirmed** — Bookings confirmed this week
- **Completed** — Bookings completed this week (during operation)
- **Cancelled** — Bookings cancelled this week
- **NCN** — Non-Conformance issues raised this week
- **NP** — Nothing Presented issues raised this week

### Upcoming Collection Dates

The dashboard lists the **next 5 open collection dates**, sorted by date. Each shows:

- Date and collection area
- Bulk and ANC capacity (e.g., `Bulk: 120/150 units`)
- Whether the date is still open for bookings

Click on a date to view or edit capacity rules.

### Recent Open Tickets

The **Recent Open Tickets** section shows the 5 most recent service tickets that are still `open` or `in_progress`, with:

- Ticket ID
- Subject line
- Status badge
- Priority (if set)
- Who created it

Click on a ticket ID to open it for triage.

---

## Core Workflows

### Booking Lookup

**Why:** You need to find a booking to view details, check payment status, or make changes.

#### Steps

1. From the Admin Dashboard, click **Bookings** in the top navigation
2. You'll see a table of all bookings with columns:
   - **Ref** — Booking reference (e.g., `WRC-2026-0001`)
   - **Contact** — Resident's name (if available)
   - **Address** — Property address
   - **Type** — Residential, MUD, or Illegal Dumping
   - **Status** — Current status (Submitted, Confirmed, Completed, Cancelled, etc.)
   - **Booked** — Date the booking was created
   - **Collection Date** — Scheduled collection date

3. **To search:**
   - Use the **Search** field at the top to find by:
     - Booking reference (e.g., `WRC-0001`)
     - Resident name (e.g., `John Smith`)
     - Address (e.g., `123 Main Street`)

4. **To filter:**
   - Use the **Status** dropdown to show only bookings with a specific status (e.g., only Submitted or only Completed)

5. **To view details:**
   - Click the booking reference or row to open the **Booking Detail** page

#### Booking Detail Page

Once you've opened a booking, you'll see:

**Header Section:**
- Booking reference and type (Residential, MUD, Illegal Dumping)
- Status badge
- Resident name, email, and phone number
- Property address with a link to Google Maps

**Booking Details:**
- **Collection Date** — When collection is scheduled
- **Services** — What will be collected (e.g., Garden Waste × 2, Bulky Items × 1)
- **Service Cost** — Price breakdown for each service
- **Total Cost** — Total amount due (if any)

**Payment Section (if applicable):**
- **Payment Status** — Confirmed, Pending Payment, etc.
- **Amount** — How much is due
- **Pay Now** button (if payment is overdue)

**Additional Notes:**
- **Notes** — Any special instructions or flags added by the resident or previous staff

**Action Buttons:**
- **Rebook** — Allow the resident to change the collection date (if still within edit window)
- **Edit** — Modify booking details (if still editable)
- **Cancel** — Cancel the booking and optionally create a refund

---

### Contact Lookup

**Why:** You need to find a resident's email or phone number to contact them about a booking, refund, or issue.

#### Steps

1. From the Admin Dashboard, go to **Bookings** (`/admin/bookings`)
2. Search or filter to find the booking associated with the contact
3. Open the booking detail page
4. The resident's **name**, **email**, and **phone number** are displayed in the header

> **Note:** If you need to contact field staff or a ranger about a booking, escalate via email or phone — they don't have access to resident contact details.

---

### Ticket Triage

**Why:** Residents and staff submit support tickets when they have questions or issues. You need to assess them, prioritize, and route to the right team.

#### Steps

1. From the Admin Dashboard, click **Service Tickets** in the top navigation
2. You'll see a table of all tickets with:
   - **Ticket ID** — Unique ticket reference (e.g., `TKT-001`)
   - **Subject** — Issue summary
   - **Status** — `open`, `in_progress`, or `closed`
   - **Priority** — `low`, `medium`, `high`, or blank (unset)
   - **Created** — When the ticket was created
   - **Contact** — Who submitted it

3. **To open a ticket:**
   - Click the ticket ID to open the detail page

#### Ticket Detail Page

**Header:**
- Ticket ID and subject
- Status and priority badges
- Who submitted it and when
- Linked booking (if the ticket is about a specific booking)

**Conversation Thread:**
- Original issue description (from the resident or staff member)
- Any replies already posted
- Each message shows the author, timestamp, and message body

**Action Buttons:**
- **Reply** — Add a message to the conversation
- **Set Priority** — Mark the ticket as `low`, `medium`, or `high`
- **Mark In Progress** — Move the ticket from `open` to `in_progress` (shows you're actively working on it)
- **Close Ticket** — Mark the ticket as `closed` once resolved

#### Common Ticket Types

| Issue | Next Step |
|-------|-----------|
| "I can't book a date" | Check if collection dates are open. If closed, explain when they reopen. |
| "I have a refund question" | Check the booking detail page for payment status. Link to the refund if one exists. |
| "I got an NCN but I wasn't home" | Escalate to the council manager. NCN resolution may require dispute investigation. |
| "Why wasn't my collection done?" | Check if there's a linked NP (Nothing Presented) record. See **NP Resolution** below. |
| "I want to reschedule" | Direct the resident to the Rebook button on their booking, or offer to rebook on their behalf. |

---

### Non-Conformance (NCN) Resolution

**Why:** A Non-Conformance is raised when the contractor finds that waste at a property doesn't meet collection criteria (e.g., oversized items, contamination). You need to investigate and resolve it.

#### Understanding NCN Status

NCN records flow through these statuses:

1. **Issued** — Field staff marked the booking as NCN during collection
2. **Disputed** — Resident or staff has disputed the NCN (claiming it's incorrect)
3. **Investigated** — A manager has reviewed the dispute and decided to uphold or overturn the NCN
4. **Closed** — The NCN is resolved

> **Auto-close:** NCNs automatically move from `Issued` to `Closed` after 14 days if not disputed.

#### Steps to Resolve an NCN

1. From the Admin Dashboard, click **Non-Conformance** in the top navigation
2. You'll see a table of all NCNs. Filter by **Status** to see only `Issued` or `Disputed` NCNs that need action
3. Click the NCN ID to open the detail page

**On the NCN Detail Page:**

**Header:**
- NCN ID and booking reference
- Status badge
- Resident name and contact info
- Why it was marked NCN (e.g., "Oversized items", "Contamination")

**Details:**
- Linked booking (click to view the full booking)
- Notes from field staff explaining the issue
- Dispute notes (if resident has disputed it)

**Resolution Workflow:**

**If status is `Issued` (resident hasn't disputed yet):**
- Wait for resident to dispute (via portal or phone call), or
- After 14 days, it will auto-close

**If status is `Disputed` (resident claims the NCN is wrong):**
- Click **Investigate Dispute** to move the NCN to `Investigating`
- Review the notes and photos (if available) from field staff
- Decide: Is the NCN valid?
  - **Yes, overturn dispute** — Mark as `Investigated` and add notes explaining the decision. Optionally create a refund.
  - **No, uphold NCN** — Mark as `Investigated` and explain why the NCN stands.

**Available Actions:**
- **Investigate Dispute** — Move to active investigation mode
- **Issue Refund** — If you decide the NCN is invalid, click to create a refund for the resident
- **Add Note** — Document your decision and reasoning
- **Close NCN** — Manually close if you've resolved it (normally auto-closes after 14 days)

---

### Nothing Presented (NP) Resolution

**Why:** A Nothing Presented is raised when a resident scheduled a collection but no waste was found at the property during collection. You need to investigate and resolve it.

#### Understanding NP Status

NP records flow through the same statuses as NCN:

1. **Issued** — Field staff found no waste at the property
2. **Disputed** — Resident or staff has disputed the NP
3. **Investigated** — A manager has reviewed the dispute
4. **Closed** — Resolved

#### Steps to Resolve an NP

1. From the Admin Dashboard, click **Nothing Presented** in the top navigation
2. Click the NP ID to open the detail page
3. Follow the same workflow as **Non-Conformance Resolution** above

**Common NP Scenarios:**

| Scenario | Action |
|----------|--------|
| Resident scheduled but forgot to put waste out | No action needed. NP stands. |
| Field staff came on wrong day | Overturn NP, offer to rebook. |
| Resident wasn't home and couldn't place waste out | Consider overturning if reasonable. Offer rebook. |
| Resident disputes and provides evidence (photo, etc.) | Review evidence. If valid, overturn and refund. |

---

### Property Allocation Override

**Why:** Properties have standard allocation limits (e.g., Bulk: 150 units per year). Sometimes you need to increase or adjust these limits for specific properties (e.g., a property doing renovations needs extra allowance).

#### Accessing Property Management

1. From the Admin Dashboard, click **Properties** in the top navigation
2. You'll see a table of eligible properties with:
   - **Address** — Property address
   - **Status** — Eligible or Ineligible
   - **Services** — What services are available at this property
   - **Allocations** — Current unit allocation for each service
   - **...** (menu) — Actions menu for this property

#### Property Detail Page

**To view or adjust allocations:**

1. Click on a property address to open its **Detail** page
2. You'll see:
   - **Property Header** — Address, formatted address, collection area
   - **Stats Cards** — Current allocation usage
   - **Allocation Summary** — Table showing:
     - Service name (e.g., Bulk, Garden Waste)
     - Max units allowed
     - Units already booked/used
     - Remaining units

3. **To add an override allocation:**
   - Click **Add Allocations** (top menu)
   - Select the **Service** (e.g., Bulk)
   - Enter **Additional Units** to allocate above the standard max
   - Enter **Reason** (e.g., "Renovation project")
   - Click **Save**

4. The override appears in the **Allocation Summary** table as an "extra" allowance

#### Allocation Rules

- **Base Allocation** — Set at the service level, applies to all properties in the area
- **Extra Allocation** — Temporary override for a specific property
- **Total Allowed** — Base + Extra
- Once a resident books against an extra allocation, it's counted immediately against both the service's total AND the property's total

---

## Screen-by-Screen Guide

### 1. Admin Dashboard (`/admin`)

**Purpose:** Overview of current week's bookings, upcoming collection dates, and open tickets.

**Key Actions:**
- Click **Bookings**, **Non-Conformance**, **Nothing Presented**, or **Service Tickets** to navigate
- Click on a collection date to view or edit capacity limits
- Click on a ticket ID to open for triage

---

### 2. Bookings Table (`/admin/bookings`)

**Purpose:** Browse all bookings with search and filter.

**Key Actions:**
- **Search bar:** Find by booking ref, resident name, or address
- **Status dropdown:** Filter by Submitted, Confirmed, Completed, Cancelled, NCN, NP, etc.
- Click row to open booking detail

**Columns:**
- Ref, Contact, Address, Type, Status, Booked, Collection Date

---

### 3. Booking Detail (`/admin/bookings/[id]`)

**Purpose:** View full booking details and manage (edit, cancel, rebook).

**Key Sections:**
1. **Header** — Ref, Type, Status, Resident info, Address
2. **Booking Details** — Collection date, services, cost breakdown
3. **Payment** — Status and "Pay Now" button (if needed)
4. **Notes** — Resident or staff notes
5. **Actions** — Rebook, Edit, Cancel buttons

**What You Can Do Here:**
- Rebook a booking to a different date (if within edit window)
- Edit booking details (if booking is still editable)
- Cancel a booking and optionally create a refund
- View linked NCN or NP records

---

### 4. Non-Conformance Table (`/admin/non-conformance`)

**Purpose:** View all NCN records, filter by status, identify actions needed.

**Key Actions:**
- **Status dropdown:** Filter by Issued, Disputed, Investigated, or Closed
- Click NCN ID to open detail page
- Check creation date to see if 14-day auto-close is approaching

---

### 5. NCN Detail (`/admin/non-conformance/[id]`)

**Purpose:** Investigate and resolve a specific NCN.

**Key Sections:**
1. **Header** — NCN ID, Booking Ref, Status, Resident
2. **Reason** — Why the NCN was raised
3. **Linked Booking** — Click to view full booking context
4. **Field Notes** — What the contractor observed
5. **Dispute Notes** — If resident has disputed
6. **Actions** — Investigate, Issue Refund, Close NCN buttons

**Workflow:**
- If `Issued` → Wait for resident to dispute or let it auto-close
- If `Disputed` → Click **Investigate**, review evidence, and decide:
  - **Overturn:** Issue refund and note why
  - **Uphold:** Document decision, close

---

### 6. Nothing Presented Table (`/admin/nothing-presented`)

**Purpose:** Same as NCN table, but for NP records.

**Key Actions:**
- Filter by status
- Click NP ID to investigate and resolve

---

### 7. Service Tickets Table (`/admin/service-tickets`)

**Purpose:** Triage incoming resident and staff support requests.

**Columns:**
- Ticket ID, Subject, Status, Priority, Created, Contact

**Key Actions:**
- Click ticket ID to open detail page and view conversation
- Filter by status (Open, In Progress, Closed) or priority

---

### 8. Ticket Detail (`/admin/service-tickets/[id]`)

**Purpose:** Read ticket conversation, add replies, triage, and close.

**Key Sections:**
1. **Header** — Ticket ID, Subject, Status, Priority, Contact
2. **Linked Booking** — If this ticket is about a specific booking
3. **Conversation Thread** — All messages in chronological order
4. **Reply Box** — Compose and send your response

**Key Actions:**
- **Reply** — Add a message to the conversation (visible to the resident)
- **Set Priority** — Mark as low, medium, or high
- **Mark In Progress** — Show that you're actively working on it
- **Close Ticket** — Mark as closed once resolved

---

### 9. Properties Table (`/admin/properties`)

**Purpose:** View all eligible properties and manage allocations.

**Columns:**
- Address, Status, Services, Allocations, Menu (...)

**Key Actions:**
- Click address to open property detail page
- Use menu (...) to Add Allocations, Set MUD, or Mark Ineligible

---

### 10. Property Detail (`/admin/properties/[id]`)

**Purpose:** View detailed allocation usage and override limits for a specific property.

**Key Sections:**
1. **Property Header** — Address, collection area
2. **Stats Cards** — Quick overview of allocation usage
3. **Allocation Summary** — Table with current usage and overrides
4. **Bookings** — Recent bookings for this property
5. **NCN/NP Records** — Any non-conformance or nothing-presented issues

**Key Actions:**
- **Add Allocations** — Create an extra allocation override for this property
- Click **Manage Overrides** to view all overrides and their reasons

---

## Common Tasks

### Task: Refund a Resident

**Scenario:** Resident cancelled and is owed a refund, or an NCN was overturned and they should get their money back.

**Steps:**

1. Open the **Booking Detail** page for the booking
2. Scroll to the **Payment** section
3. Click **Cancel** (to cancel the booking) or navigate to the **NCN Detail** page
4. Click **Issue Refund**
5. A refund request is created and sent to the refund processor
6. Resident will receive the refund within 1–3 business days

---

### Task: Set Priority for a Ticket

**Scenario:** A ticket comes in that's urgent and needs immediate attention.

**Steps:**

1. Open the **Ticket Detail** page
2. Click **Set Priority**
3. Select `low`, `medium`, or `high`
4. The ticket will be highlighted in the dashboard and sorted by priority

---

### Task: Reopen a Collection Date

**Scenario:** A collection date is closed but you need to accept more bookings for it.

**Steps:**

1. From the Admin Dashboard, find the collection date in the **Upcoming Collection Dates** section
2. Click on the date row to open the **Collection Date Detail** page
3. Toggle **Open for Bookings** to on/enabled
4. Save changes

**Note:** If you're concerned about exceeding capacity, click **Edit Capacity** and increase the limits first.

---

### Task: Manage Collection Area Allocations

**Scenario:** You need to set or adjust the annual allocation limits for an entire service in your collection area (e.g., increase Bulk allocation from 150 to 200 units per property).

**Steps:**

1. From the Admin Dashboard, click **Allocations** in the top navigation
2. You'll see a table of all services and their area-wide allocation rules
3. Click a service row to open its detail page
4. Modify the **Max Units** field
5. Save changes

**Note:** This affects all properties in the area unless they have an individual property override.

---

## Troubleshooting

### "I can't find a booking"

**Possible Causes:**
1. The booking reference is incorrect — double-check the spelling
2. The resident's name is spelled differently in the system — try searching by address or date
3. The booking is from a different council — Verco is scoped per council; you can only see your council's bookings

**Solution:** Use the search bar with partial matches (e.g., search for "Smith" if you only remember the last name).

---

### "The property isn't in the system"

**Possible Causes:**
1. The property is outside the eligible area for your collection zone
2. The property has been marked as ineligible (e.g., not residential, no street access)
3. The address is in a different council area

**Solution:**
1. Check the **Properties** page to see if it's listed
2. If listed but marked ineligible, click the property and check the reason
3. If not listed, it may be outside your collection area. Check with your manager.

---

### "A resident says they never got their refund"

**Possible Causes:**
1. The refund was issued but is still processing (1–3 business days)
2. The refund was issued to the wrong payment method (e.g., a different card)
3. The resident's bank account details have changed

**Solution:**
1. Open the **Booking Detail** page and check the **Payment** section for refund status
2. If a refund was issued, note the date and reference number
3. Tell the resident to check their bank statement after 1–3 business days
4. If they still don't see it, escalate to a manager for investigation

---

### "A ticket says 'No reply' but I added one"

**Possible Cause:**
The reply was saved to the ticket, but the system is showing an older cached version.

**Solution:**
Refresh the page in your browser (Cmd+R on Mac, Ctrl+R on Windows/Linux). The reply should appear.

---

### "I need to cancel a booking but the Cancel button is grayed out"

**Possible Causes:**
1. The booking is already Cancelled or Completed (no further action possible)
2. The booking is outside the edit window (cannot be modified or cancelled)

**Solution:**
1. Check the **Status** badge — if it's already Cancelled or Completed, no action is needed
2. If the booking is Submitted or Confirmed but the button is still disabled, check the **Collection Date** — if the collection has already happened, the booking can't be cancelled
3. Escalate to a manager if the cancellation is urgent and the booking is outside normal edit windows

---

## Frequently Asked Questions

### Q: Can residents edit their own bookings?

**A:** Yes, residents can edit their bookings (change address, services, collection date) up until a set cutoff time before collection (usually 24 hours). After the cutoff, they need to contact WMRC or use the Rebook button on their booking detail page.

---

### Q: What's the difference between NCN and NP?

**A:** 
- **NCN (Non-Conformance):** The waste at the property didn't meet criteria (too big, contaminated, not in bins). Contractor refused to take it.
- **NP (Nothing Presented):** The resident booked but there was no waste at the property when the contractor arrived. No collection happened.

---

### Q: Can I edit a resident's contact details?

**A:** Not directly in Verco. Contact details are pulled from the resident's user account. If a resident needs to update their phone or email, they can do it themselves via the **Account Settings** page in their resident portal, or you can help them reset their password if they're locked out.

---

### Q: What happens if a resident disputes an NCN?

**A:** The NCN moves to `Disputed` status. It's then your job (or a manager's) to investigate the dispute. You can review notes, photos, and evidence, then decide to:
- **Overturn** the NCN (declare it invalid and optionally issue a refund), or
- **Uphold** the NCN (the contractor was correct).

---

### Q: Who pays for overrides when a resident exceeds their allocation?

**A:** If a resident books but has no allocation remaining, the booking is rejected and they can't proceed. Staff can only override allocations at the property level (e.g., "this property gets +50 extra Bulk units"). Individual booking prices don't change based on allocation — the limits are there to prevent overuse.

---

### Q: Can I see what refunds have been approved and processed?

**A:** Yes. Go to **Refunds** (`/admin/refunds`) to see all refund requests, their statuses (Pending, Processed, Failed), and linked bookings.

---

## Getting Help

**For urgent issues or questions not answered here:**
- Contact your WMRC manager or team lead
- Email support at: [support-email-to-be-added]
- Call the support line: [support-phone-to-be-added]

---

**Document Version:** 1.0  
**Last Updated:** 2026-04-09  
**Next Review:** 2026-05-15  

