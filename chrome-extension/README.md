# CVC Source Verification — Chrome Extension

Proprietary. Internal use only.

## Install

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select this `chrome-extension/` folder

## Configure

Click the ⬡ CVC icon in the Chrome toolbar:
- **Server URL**: `http://100.83.104.117:8001`
- **Username**: `nate`
- **Password**: your assigned platform password
- Click **Save Settings**

## How it works

1. Open the Human Review tab in CVC Intelligence
2. Click any source URL — it opens in a new tab
3. The extension detects the URL, checks for a pending review match, and injects the floating toolbar
4. Review the page, then click **Approve**, **Reject**, or **Edit**
5. On Approve or Reject: a screenshot is automatically taken server-side and stored as evidence

## Evidence

All decisions + screenshots are stored in `cvc.verification_evidence`.
View via: `GET /review/evidence` or `GET /review/evidence/{id}/screenshot`
