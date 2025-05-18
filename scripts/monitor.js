const axios = require('axios');
const Table = require('cli-table3');
const { IncomingWebhook } = require('@slack/webhook');

// Configuration
const API_TOKEN = process.env.HETZNER_API_TOKEN;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL; // Set this as an environment variable
const USAGE_THRESHOLD = 10; // Percentage threshold for alerts
const DEBUG_ALWAYS_SEND = process.env.DEBUG_ALWAYS_SEND === 'true'; // Set to 'true' to always send to Slack

if (!API_TOKEN) {
    console.error('Set HETZNER_API_TOKEN first.');
    process.exit(1);
}

// Initialize Slack webhook if URL is provided
const slackWebhook = SLACK_WEBHOOK_URL ? new IncomingWebhook(SLACK_WEBHOOK_URL) : null;

async function fetchServers() {
    const res = await axios.get('https://api.hetzner.cloud/v1/servers', {
        headers: { Authorization: `Bearer ${API_TOKEN}` }
    });
    return res.data.servers;
}

function bytesToTB(bytes, precision = 4) {
    return (bytes / 1024 ** 4).toFixed(precision);
}

function calculatePercentage(used, total) {
    if (!total) return '0.0000%';
    return ((used / total) * 100).toFixed(4) + '%';
}

async function sendSlackAlert(serversData, allServersData, isDebug = false) {
    if (!slackWebhook || (!isDebug && serversData.length === 0)) return;

    // If in debug mode and no servers exceed threshold, send all servers
    const serversToReport = isDebug && serversData.length === 0 ?
        allServersData : serversData;

    const headerText = isDebug && serversData.length === 0 ?
        "🔍 Debug: Server Bandwidth Report" :
        "⚠️ Server Bandwidth Alert ⚠️";

    const subheaderText = isDebug && serversData.length === 0 ?
        `*Debug Mode*: Showing all ${serversToReport.length} server(s)` :
        `*${serversToReport.length} server(s)* have exceeded ${USAGE_THRESHOLD}% bandwidth usage:`;

    const message = {
        blocks: [
            {
                type: "header",
                text: {
                    type: "plain_text",
                    text: headerText,
                    emoji: true
                }
            },
            {
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: subheaderText
                }
            },
            ...serversToReport.map(server => ({
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*${server.name}* (${server.status}): ${server.usagePercentage} used (${server.outgoingTB} TB of ${server.limitTB} TB)`
                }
            }))
        ]
    };

    try {
        await slackWebhook.send(message);
        console.log(`Slack ${isDebug ? 'debug report' : 'alert'} sent for ${serversToReport.length} server(s)`);
    } catch (error) {
        console.error('Error sending Slack message:', error.message);
    }
}

(async () => {
    const servers = await fetchServers();

    // Create a new table with headers
    const table = new Table({
        head: ['Name', 'Status', 'Outgoing (TB)', 'Limit (TB)', 'Usage %'],
        style: {
            head: ['cyan'],
            border: ['gray']
        },
        colAligns: ['left', 'left', 'right', 'right', 'right']
    });

    // Track servers with high usage
    const highUsageServers = [];
    // Track all servers data for debug mode
    const allServersData = [];

    // Add rows to the table
    servers.forEach(s => {
        const outgoingTB = bytesToTB(s.outgoing_traffic || 0);
        const limitTB = bytesToTB(s.included_traffic || 0);
        const usagePercentage = calculatePercentage(
            s.outgoing_traffic || 0,
            s.included_traffic || 0
        );

        // Calculate raw percentage for comparison
        const rawPercentage = s.included_traffic ?
            ((s.outgoing_traffic || 0) / s.included_traffic) * 100 : 0;

        const serverData = {
            name: s.name,
            status: s.status,
            outgoingTB,
            limitTB,
            usagePercentage,
            rawPercentage
        };

        // Add to all servers data for debug mode
        allServersData.push(serverData);

        // Check if usage exceeds threshold
        if (rawPercentage >= USAGE_THRESHOLD) {
            highUsageServers.push(serverData);
        }

        table.push([
            s.name,
            s.status,
            outgoingTB,
            limitTB,
            usagePercentage
        ]);
    });

    // Print the table
    console.log(table.toString());

    // Send Slack alert if there are servers with high usage or in debug mode
    if (slackWebhook) {
        await sendSlackAlert(highUsageServers, allServersData, DEBUG_ALWAYS_SEND);
    } else if (highUsageServers.length > 0 || DEBUG_ALWAYS_SEND) {
        if (DEBUG_ALWAYS_SEND) {
            console.log('\nDEBUG MODE: Would have sent all server data to Slack.');
        } else {
            console.log(`\nWARNING: ${highUsageServers.length} server(s) exceed ${USAGE_THRESHOLD}% usage threshold.`);
        }
        console.log('Set SLACK_WEBHOOK_URL environment variable to receive Slack alerts.');
    }
})();
