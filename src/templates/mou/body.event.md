# MEMORANDUM OF UNDERSTANDING

{{#if number}}
Reference: {{number}}
{{/if}}

This Memorandum of Understanding (the "MoU") is entered into on {{print.date}}.

## BETWEEN

**{{print.companyUpper}}**, {{#if print.companyRegistration}}bearing {{print.companyRegistration}}, {{/if}}with its registered office at {{print.companyAddress}}, hereinafter referred to as the **"First Party"**, which expression shall include its successors and permitted assigns;

## AND

**{{print.partnerUpper}}**, with its office at {{print.partnerAddress}}, hereinafter referred to as the **"Second Party"** or the **"Event Organiser"**.

The First Party and the Second Party are each referred to as a **"Party"** and together as the **"Parties"**.

---

# 1. PURPOSE

This MoU sets out the terms on which the First Party will provide **{{service}}** (the "Service") to the Event Organiser for **{{event.name}}** (the "Event"){{#if event.dates}}, scheduled for {{event.dates}}{{/if}}{{#if event.venue}} at {{event.venue}}{{/if}}.

The engagement covers both free and paid registrations for the Event. This MoU applies to the Event only and does not create a partnership, joint venture, employment or agency relationship between the Parties.

# 2. SCOPE OF SERVICES

- **Event set-up** — event page, registration form and ticket categories for the Event.
- **Registrations and ticketing** — collection of registrations and payments, and confirmations to attendees.
- **Entry management** — tools for checking attendees in at the venue.
- **Reports** — registration, attendance and collection reports for the Event Organiser.

# 3. FEES & COMMERCIAL TERMS

## 3.1 Free Registrations

Free registrations are processed without a service fee.

## 3.2 Paid Registrations

A service fee of **{{print.feePercent}}%** of the ticket price applies to every paid registration, with GST at **{{print.gstPercent}}%** on the service fee, paid by the attendee in addition to the ticket price.

| Description | Amount |
| :--- | :--- |
| Ticket price | {{print.example.price}} |
| Service fee ({{print.feePercent}}%) | {{print.example.fee}} |
| GST on service fee ({{print.gstPercent}}%) | {{print.example.gst}} |
| **Final amount paid by the attendee** | **{{print.example.total}}** |
| **Amount received by the Event Organiser** | **{{print.example.received}}** |

# 4. SETTLEMENT & PAYOUT

Amounts collected for the Event, less the service fee, GST and gateway charges, shall be paid to the Event Organiser's designated bank account within **{{payoutDays}} working days** after the Event ends, together with a settlement statement.

# 5. RESPONSIBILITIES

- The Event Organiser is responsible for the Event itself: venue, programme, permissions, safety, refunds policy and communication with attendees.
- The First Party is responsible for the availability and correct operation of the Service.
- The Event Organiser shall acknowledge the Service on the event page and promotional material in the form agreed between the Parties.

# 6. DATA & PLATFORM USE

Attendee information collected through the Service is processed only to deliver the Service and the Event, in accordance with applicable data protection law, and shall not be sold or disclosed to third parties except as required by law.

# 7. CONFIDENTIALITY & INTELLECTUAL PROPERTY

Each Party keeps all rights in its own names, logos, content and technology, and shall keep confidential any non-public information received from the other Party under this MoU.

# 8. LIABILITY

Neither Party is liable for indirect or consequential loss, or for delays caused by events beyond its reasonable control. The First Party is not responsible for the conduct, cancellation or postponement of the Event.

# 9. TERM & TERMINATION

This MoU takes effect on the date above and ends when the settlement for the Event is complete. Either Party may terminate it earlier by {{noticeDays}} days' written notice; amounts already due remain payable.

# 10. GOVERNING LAW

This MoU is governed by the laws of {{governingLaw}}{{#if jurisdiction}}, and the courts at {{jurisdiction}} shall have exclusive jurisdiction{{/if}}.

# EVENT DETAILS

| Particular | Details |
| :--- | :--- |
| Event | {{event.name}} |
| Event type | {{event.type}} |
| Dates | {{event.dates}} |
| Venue | {{event.venue}} |
| Event Organiser | {{partnerName}} |
| Service | {{service}} — {{print.company}} |

# IN WITNESS WHEREOF

The Parties have signed this Memorandum of Understanding through their authorised representatives on the date first written above.

## For {{print.companyUpper}}

Authorized Signatory

Name: {{signatory.name}}

Designation: {{signatory.title}}

Contact: {{signatory.phone}}

Date: {{print.date}}

Seal:

## For {{print.partnerUpper}}

Authorized Signatory

Name: {{partnerSignatory.name}}

Designation: {{partnerSignatory.designation}}

Contact: {{partnerSignatory.contact}}

Date:

Seal:
