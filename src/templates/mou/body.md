# MEMORANDUM OF UNDERSTANDING

{{#if number}}
Reference: {{number}}
{{/if}}

This Memorandum of Understanding (the "MoU") is entered into on {{print.date}}.

## BETWEEN

**{{print.companyUpper}}**, {{#if print.companyRegistration}}bearing {{print.companyRegistration}}, {{/if}}with its registered office at {{print.companyAddress}}, hereinafter referred to as the **"First Party"**, which expression shall include its successors and permitted assigns;

**AND**

**{{print.partnerUpper}}**, {{partnerKind}}{{#if partnerRegistration}} bearing registration number {{partnerRegistration}}{{/if}}, with its office at {{print.partnerAddress}}, acting through its authorised representative, hereinafter referred to as the **"Second Party"** or the **"Organisation"**, which expression shall include its successors and permitted assigns.

The First Party and the Second Party are each referred to as a **"Party"** and together as the **"Parties"**.

---

# 1. PURPOSE

This MoU records the terms on which the First Party will make **{{service}}** (the "Service") available to the Organisation for the events it organises during the term of this MoU.

For the purposes of this MoU:

- **"Event"** means any programme, conference, workshop, competition or other activity organised by or under the Organisation and set up on the Service during the term.
- **"Paid Event"** means an Event for which at least one paid registration or ticket is offered.
- **"Free Event"** means an Event for which every registration is free of charge.

This MoU is a non-exclusive framework covering every Event during the term; a separate MoU is not required for each Event. It does not create a partnership, joint venture, employment or agency relationship between the Parties.

---

# 2. SCOPE OF SERVICES

The First Party shall provide the following for each Event:

- **Event set-up** — creation and configuration of event pages, registration forms and ticket categories.
- **Registrations and ticketing** — collection of registrations and payments, and delivery of confirmations to attendees.
- **Entry management** — tools for checking attendees in at the venue.
- **Reports** — access to registration, attendance and collection reports for the Organisation's authorised users.
- **Support** — reasonable assistance during set-up and on the days of the Event through the First Party's usual support channels.

## 2.1 Responsibilities of the Organisation

- Provide accurate event details, pricing and content, and obtain any permissions the Event requires.
- Conduct the Event, including venue, programme, safety and attendee communication, at its own cost and responsibility.
- Acknowledge the Service on event pages and promotional material in the form agreed between the Parties.

---

# 3. EXCLUSIONS

The First Party is a service provider only. It is not responsible for the conduct, quality, safety, cancellation or postponement of any Event, for venue or on-site arrangements, or for any commitment the Organisation makes to attendees, sponsors or third parties.

---

# 4. FEES & COMMERCIAL TERMS

## 4.1 Service Fee

Free Events may be hosted without a service fee. For Paid Events, a service fee of **{{print.feePercent}}%** of the ticket price applies to every paid registration, together with GST at **{{print.gstPercent}}%** on the service fee. Payment gateway charges, where applicable, are charged at the rates in force at the time of the transaction.

## 4.2 Illustration

The table below illustrates the fee for one ticket where the fee is paid by the attendee.

| Description | Amount |
| :--- | :--- |
| Ticket price | {{print.example.price}} |
| Service fee ({{print.feePercent}}%) | {{print.example.fee}} |
| GST on service fee ({{print.gstPercent}}%) | {{print.example.gst}} |
| **Final amount paid by the attendee** | **{{print.example.total}}** |
| **Amount received by the Organisation** | **{{print.example.received}}** |

## 4.3 Revision of Fees

The First Party may revise the service fee for Events created after giving the Organisation at least {{noticeDays}} days' written notice. Events already published continue on the fee in force when they were published.

---

# 5. SETTLEMENT & PAYOUT

Amounts collected for an Event, less the service fee, GST and gateway charges, shall be paid to the Organisation's designated bank account within **{{payoutDays}} working days** after the Event ends, together with a settlement statement. Refunds to attendees are made only as the Organisation instructs and in line with its published refund policy.

---

# 6. INTELLECTUAL PROPERTY

Each Party keeps all rights in its own names, logos, content and technology. The Organisation receives a limited, non-transferable right to use the Service for its Events during the term. Neither Party may use the other's marks except as this MoU allows or as agreed in writing.

---

# 7. DATA & PLATFORM USE

Attendee information collected through the Service is processed only to deliver the Service and the Events, in accordance with applicable data protection law. The Organisation is responsible for the content it publishes and for using attendee information only for its Events. Neither Party shall sell or disclose attendee information to third parties except as required by law.

---

# 8. CONFIDENTIALITY

Each Party shall keep confidential any non-public information received from the other Party under this MoU and use it only for the purposes of this MoU. This obligation continues for two (2) years after this MoU ends.

---

# 9. INDEMNITY & LIABILITY

Each Party shall indemnify the other against claims arising from its own breach of this MoU, negligence or wilful misconduct. Neither Party is liable for indirect or consequential loss. The First Party's total liability under this MoU is limited to the service fees it received in the three (3) months before the claim.

---

# 10. FORCE MAJEURE

Neither Party is liable for a delay or failure caused by events beyond its reasonable control, provided it notifies the other Party promptly and makes reasonable efforts to resume performance.

---

# 11. TERM & TERMINATION

This MoU takes effect on the date above and remains in force for {{term}}, unless terminated earlier. Either Party may terminate it by giving {{noticeDays}} days' written notice. Termination does not affect Events already published or amounts already due.

---

# 12. GOVERNING LAW & DISPUTES

This MoU is governed by the laws of {{governingLaw}}. The Parties shall first try to resolve any dispute amicably through discussion{{#if jurisdiction}}; failing that, the courts at {{jurisdiction}} shall have exclusive jurisdiction{{/if}}.

---

# 13. GENERAL

- Any change to this MoU is valid only if made in writing and signed by both Parties.
- If any provision is held invalid, the remaining provisions remain in force.
- This MoU is the complete understanding between the Parties on its subject.

# ORGANISATION DETAILS (FOR REFERENCE)

- **Organisation:** {{partnerName}}
- **Registered address:** {{print.partnerAddress}}
- **Registration no.:** {{partnerRegistration}}
- **Contact person:** {{partnerContact}}
- **Phone:** {{partnerPhone}}
- **Email:** {{partnerEmail}}

# IN WITNESS WHEREOF

The Parties have signed this Memorandum of Understanding through their authorised representatives on the date first written above.

## For {{print.companyUpper}}

Authorized Signatory

Name: {{signatory.name}}

Designation: {{signatory.title}}

Date: {{print.date}}

Seal:

## For {{print.partnerUpper}}

Authorized Signatory

Name: {{partnerSignatory.name}}

Designation: {{partnerSignatory.designation}}

Date:

Seal:
