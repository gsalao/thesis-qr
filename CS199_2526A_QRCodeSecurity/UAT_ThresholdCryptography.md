**USER ACCEPTANCE TESTING (UAT)**

**Threshold Signature Protocol for Securing QR Code Transactions**

| Welcome and Thank You\! We appreciate your time and participation in this study. This test evaluates a joint payment application that uses threshold cryptography: a security method that splits authorization across multiple phones to protect group transactions. *Your honest feedback directly improves our system. There are no right or wrong answers.* |
| ----- |

# **How the App Works**

Think of this app like a digital joint bank account for a group of 5 people. The account is preloaded with a simulated balance of ₱1,000,000. There are two rules:

* Small purchases (under ₱1,000): The Shopper can pay instantly — no group approval needed.

* Large purchases (₱1,000 and above): A minimum of 2 Approvers must authorize before a payment QR code is generated.

**Phone Roles for This Test**

| Phone | Role | Description |
| :---- | :---- | :---- |
| **Phone 1** | The Shopper | Initiates all payment requests in the test scenarios. |
| **Phones 2, 3, 4** | The Approvers | Receive approval notifications and vote to approve or reject large purchases. |
| **Phone 5** | The Cashier | Scans the generated QR codes to complete transactions. Not part of the joint account. |

# **Section 1 — Participant Demographics**

Name: 

Age: 

**Monthly Household Income**

- [ ] At least ₱219,140 (Upper Class)  
- [ ] ₱131,484 – ₱219,140 (Upper Middle Class)  
- [ ] ₱76,669 – ₱131,484 (Middle Class)  
- [ ] ₱43,828 – ₱76,669 (Lower Middle Class)  
- [ ] ₱21,194 – ₱43,828 (Lower Class)  
- [ ] ₱10,957 – ₱21,194 (Poor)  
- [ ] Below ₱10,957 (Subsistence)  
- [ ] Prefer not to say

**Mobile Wallet Usage**

How frequently do you use mobile wallets (GCash, Maya, etc.)?

- [ ] Daily  
- [ ] Weekly  
- [ ] Monthly  
- [ ] Rarely / Never

**Joint Account Experience**

Have you ever used a joint bank account or shared wallet?

- [ ] Yes  
- [ ] No

If yes, were transactions on that account required to get approval from other account holders?

- [ ] Yes  
- [ ] No

**Approval Threshold Preference**

At what transaction amount would you start feeling a need for group approval from joint account partners?

- [ ] ₱1.00 – ₱1,000  
- [ ] ₱1,001 – ₱5,000  
- [ ] ₱5,001 – ₱20,000  
- [ ] ₱20,001 – ₱50,000  
- [ ] ₱100,000 and above

# **Section 2 — Test Scenarios**

*Instructions: The test facilitator will guide you through each scenario below. After each test, the observer will record whether the system responded as expected. Please speak your thoughts aloud as you go through the scenarios.*

| \# | Scenario | Expected Result | Result | Remarks / Notes |
| :---: | :---- | :---- | :---: | :---- |
| **1** | **Small Purchase (Below Threshold)** Shopper enters ₱500 and taps Pay. | QR code generated instantly without notifying approvers. Cashier scans successfully. Balance drops to ₱999,500. | Pass Fail |  |
| **2** | **Large Purchase (Threshold Approval)** Shopper enters ₱5,000. Phone 4 rejects; Phones 2 & 3 approve. | System waits for 2 approvals. QR code generated after 2 approvals despite 1 rejection. Cashier scan succeeds. | Pass Fail |  |
| **3** | **Insufficient Funds** Shopper attempts to spend ₱2,000,000. | App immediately shows Insufficient Funds. No approval request sent to Approvers. | Pass Fail |  |
| **4** | **Concurrent Approvals (Race Condition)** All 3 Approvers tap Approve simultaneously for a ₱2,000 request. | System accepts the first 2 valid approvals and generates QR code. The 3rd concurrent tap is ignored gracefully. | Pass Fail |  |
| **5** | **Double-Scan Prevention** Cashier scans a completed ₱500 QR code a second time. | System rejects 2nd scan with Transaction Already Completed or Invalid error. No duplicate charge. | Pass Fail |  |
| **6** | **Expired QR Code** QR code generated for ₱500. Scanned after a 2-minute wait. | Cashier app rejects it with Expired message. Transaction is not processed. | Pass Fail | just need to open the QR agad |
| **7** | **Fake / External QR Code** Cashier scans an unrelated QR (e.g., GCash sticker, restaurant menu). | App detects it is not from the system and shows Invalid QR error. | Pass Fail |  |
| **8** | **Majority Rejection** Shopper requests ₱10,000. Phone 4 approves; Phones 2 & 3 reject. | Shopper’s screen shows transaction denied. No QR code is generated. | Pass Fail |  |
| **9** | **Timeout / No Response** Shopper requests ₱5,000. Approvers do not respond. | After 2 minutes, Shopper’s screen shows request expired. No QR code is generated. | Pass Fail |  |
| **10** | **Shopper Cancellation** Shopper requests ₱3,000 and taps Cancel while waiting for approval. | Approval pop-ups on all Approver phones disappear instantly. Transaction is void. | Pass Fail |  |

| Observer Notes (for facilitator use):  |
| :---- |

# 

# 

# **Section 3 — System Usability Scale (SUS)**

Rate each statement on a scale of 1 to 5, where:

* 1 \= Strongly Disagree

* 5 \= Strongly Agree

| Statement | 1 | 2 | 3 | 4 | 5 |
| :---- | ----- | ----- | ----- | ----- | ----- |
| 1\. I think that I would like to use this system frequently. |  |  |  |  |  |
| 2\. I thought the system was easy to use. |  |  |  |  |  |
| 3\. I think that I would need the support of a technical person to use this system. |  |  |  |  |  |
| 4\. The various functions in this system were well integrated. |  |  |  |  |  |
| 5\. Most people would learn to use this system very quickly. |  |  |  |  |  |
| 6\. I felt very confident and secure using the system. |  |  |  |  |  |

# 

# 

# **Section 4 — Latency & Performance**

**4.1  Approval Speed**

How would you rate the speed of the approval process (waiting for others to approve)?

- [ ] Instant / Seamless  
- [ ] Acceptable delay  
- [ ] Noticeably slow  
- [ ] Frustratingly slow

**4.2  QR Code Recognition**

Did the Cashier’s scanner recognize the dynamic QR code on the first attempt?

- [ ] Yes, immediately  
- [ ] Took 2–3 seconds to focus  
- [ ] Failed / required a refresh or retry

**4.3  Perceived Friction**

Compared to a standard single-user payment (e.g., scanning a personal GCash QR), how much extra effort did this system require?

- [ ] No extra effort  
- [ ] A little extra effort, but worth it for the added security  
- [ ] Too much effort for daily use

# 

# 

# 

# **Section 5 — Perceived Security**

**5.1  Multi-Party Approval**

Did knowing that multiple people had to approve the transaction make you feel safer against unauthorized spending?

- [ ] Yes, significantly safer  
- [ ] Somewhat safer  
- [ ] No difference  
- [ ] No, it felt less secure

# 

# **Section 6 — Usability**

**6.1  QR Code Presentation**

How comfortable were you with holding up your phone screen for the Cashier to scan?

- [ ] Very comfortable — standard practice for me  
- [ ] A bit awkward — I prefer scanning the merchant’s code myself  
- [ ] Difficult — screen timed out, rotation issues, or other problems

**6.2  Time Pressure from Expiring QR Code**

Did the dynamic QR code’s expiration cause any pressure that the transaction might fail if not scanned quickly enough?

- [ ] No pressure  
- [ ] Slight pressure  
- [ ] High pressure — I felt rushed

# 

# 

# **Section 7 — Open-Ended Feedback**

**7.1  Feature Suggestions**

What features or changes would you add to make the coordination easier, or to improve the security of the app?

|  |
| :---- |

**7.2  Overall Impressions**

In your own words, would you use or recommend this system for a real joint account? Why or why not?

|  |
| :---- |

| Thank you for your participation\! *Your feedback is invaluable to the improvement of this research. All responses are kept strictly confidential and used for academic purposes only.* |
| :---: |

