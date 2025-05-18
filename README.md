# Hetzner Billing - Slack Alert and Shutdown Tool

A GitHub Actions-based monitoring tool that tracks Hetzner server bandwidth usage, sends Slack alerts when thresholds are exceeded, and can automatically shut down servers to prevent excessive bandwidth charges.

## Overview

This tool monitors your Hetzner Cloud servers' bandwidth usage and:
- Sends Slack notifications when servers exceed a configurable bandwidth threshold
- Automatically shuts down servers that exceed a critical bandwidth threshold
- Provides detailed usage reports via CLI and Slack

## Environment Variables

The script uses the following environment variables:

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `HETZNER_API_TOKEN` | Your Hetzner Cloud API token | - | Yes |
| `SLACK_WEBHOOK_URL` | Slack webhook URL for notifications | - | No |
| `THRESHOLD_PERCENT_NOTIF` | Percentage threshold for alerts | 50 | No |
| `THRESHOLD_PERCENT_KILL` | Percentage threshold for killing servers | 90 | No |
| `SEND_USAGE_NOTIF_ALWAYS` | Send usage notifications even if no thresholds are exceeded | false | No |

## Setup Instructions

### 1. Create a Hetzner API Token

1. Log in to your [Hetzner Cloud Console](https://console.hetzner.cloud/)
2. Navigate to Security → API Tokens
3. Create a new API token with read and write permissions
4. Copy the token (you'll need it for GitHub secrets)

### 2. Create a Slack Webhook (Optional)

1. Create a new Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable Incoming Webhooks
3. Create a new webhook URL for your workspace
4. Copy the webhook URL (you'll need it for GitHub secrets)

### 3. Set Up GitHub Repository Secrets

1. Go to your repository's Settings → Secrets and variables → Actions
2. Add the following repository secrets:
   - `HETZNER_API_TOKEN`: Your Hetzner API token
   - `SLACK_WEBHOOK_URL`: Your Slack webhook URL (optional)

The repository already includes a GitHub Actions workflow file (`.github/workflows/monitor.yml`) that runs the monitoring script every 20 minutes.

## Customizing Thresholds

You can customize the monitoring thresholds by adding the following environment variables to your GitHub workflow file:

- `THRESHOLD_PERCENT_NOTIF`: Percentage of bandwidth usage that triggers a notification (default: 50)
- `THRESHOLD_PERCENT_KILL`: Percentage of bandwidth usage that triggers server shutdown (default: 90)
- `SEND_USAGE_NOTIF_ALWAYS`: Set to 'true' to always send usage reports to Slack (default: false)

Example of adding these to your workflow:

```yaml
- name: Run traffic stats
  env:
    HETZNER_API_TOKEN: ${{ secrets.HETZNER_API_TOKEN }}
    SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
    THRESHOLD_PERCENT_NOTIF: '60'
    THRESHOLD_PERCENT_KILL: '95'
    SEND_USAGE_NOTIF_ALWAYS: 'true'
  run: node scripts/monitor.js
```

## Usage

### Automatic Monitoring

The GitHub Action runs automatically according to the schedule defined in the workflow (monitor.yml) file (every 20 minutes).

### Manual Monitoring

You can also trigger the workflow manually:
1. Go to the Actions tab in your GitHub repository
2. Select the "Hetzner Traffic Stats" workflow
3. Click "Run workflow"

## Running Locally

To run the script locally:

1. Clone the repository
2. Install dependencies: `npm install axios cli-table3 @slack/webhook`
3. Set environment variables:
   ```bash
   export HETZNER_API_TOKEN="your_token_here"
   export SLACK_WEBHOOK_URL="your_webhook_url_here"
   export THRESHOLD_PERCENT_NOTIF="50"
   export THRESHOLD_PERCENT_KILL="90"
   ```
4. Run the script:
   ```bash
   node scripts/monitor.js
   ```

## License

[MIT License](LICENSE)
