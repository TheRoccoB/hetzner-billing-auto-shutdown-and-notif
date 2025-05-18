const axios = require('axios');
const Table = require('cli-table3');
const { IncomingWebhook } = require('@slack/webhook');

// Configuration
const API_TOKEN = process.env.HETZNER_API_TOKEN;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL; // Set this as an environment variable

const THRESHOLD_PERCENT_NOTIF = parseInt(process.env.THRESHOLD_PERCENT_NOTIF || '50', 10); // Percentage threshold for alerts
const THRESHOLD_PERCENT_KILL = parseInt(process.env.THRESHOLD_PERCENT_KILL || '90', 10); // Percentage threshold for killing servers
const SEND_USAGE_NOTIF_ALWAYS = process.env.SEND_USAGE_NOTIF_ALWAYS === 'true'; // Set to 'true' to always send to Slack

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

async function stopServer(serverId) {
    try {
        await axios.post(`https://api.hetzner.cloud/v1/servers/${serverId}/actions/shutdown`, {}, {
            headers: { Authorization: `Bearer ${API_TOKEN}` }
        });
        console.log(`Server ${serverId} has been shut down due to exceeding bandwidth threshold.`);
        return true;
    } catch (error) {
        console.error(`Failed to shut down server ${serverId}:`, error.message);
        return false;
    }
}

function bytesToTB(bytes, precision = 4) {
    return (bytes / 1024 ** 4).toFixed(precision);
}

function calculatePercentage(used, total) {
    if (!total) return '0.0000%';
    return ((used / total) * 100).toFixed(4) + '%';
}

async function sendSlackAlert(serversData, allServersData, killedServers = [], isDebug = false) {
    if (!slackWebhook || (!isDebug && serversData.length === 0 && killedServers.length === 0)) return;

    // If in debug mode and no servers exceed threshold, send all servers
    const serversToReport = isDebug && serversData.length === 0 && killedServers.length === 0 ?
        allServersData : serversData;

    let headerText, subheaderText;

    if (killedServers.length > 0) {
        headerText = "🚨 Server Bandwidth Alert - Servers Killed 🚨";
        subheaderText = `*${killedServers.length} server(s)* have been shut down for exceeding ${THRESHOLD_PERCENT_KILL}% bandwidth usage.\n` +
            `*${serversToReport.length} server(s)* have exceeded ${THRESHOLD_PERCENT_NOTIF}% bandwidth usage:`;
    } else if (isDebug && serversData.length === 0) {
        headerText = "🔍 Debug: Server Bandwidth Report";
        subheaderText = `*Debug Mode*: Showing all ${serversToReport.length} server(s)`;
    } else {
        headerText = "⚠️ Server Bandwidth Alert ⚠️";
        subheaderText = `*${serversToReport.length} server(s)* have exceeded ${THRESHOLD_PERCENT_NOTIF}% bandwidth usage:`;
    }

    const blocks = [
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
        }
    ];

    // Add killed servers first if any
    if (killedServers.length > 0) {
        blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: "*Servers that were shut down:*"
            }
        });

        killedServers.forEach(server => {
            blocks.push({
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*${server.name}* (was ${server.status}): ${server.usagePercentage} used (${server.outgoingTB} TB of ${server.limitTB} TB) - *SHUT DOWN*`
                }
            });
        });

        // Add a divider if we have both killed servers and notification servers
        if (serversToReport.length > 0) {
            blocks.push({
                type: "divider"
            });
        }
    }

    // Add notification servers
    if (serversToReport.length > 0) {
        serversToReport.forEach(server => {
            blocks.push({
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*${server.name}* (${server.status}): ${server.usagePercentage} used (${server.outgoingTB} TB of ${server.limitTB} TB)`
                }
            });
        });
    }

    const message = { blocks };

    try {
        await slackWebhook.send(message);
        console.log(`Slack ${isDebug ? 'debug report' : 'alert'} sent for ${serversToReport.length} server(s)${killedServers.length > 0 ? ` and ${killedServers.length} killed server(s)` : ''}`);
    } catch (error) {
        console.error('Error sending Slack message:', error.message);
    }
}

(async () => {
    const servers = await fetchServers();

    // Create a new table with headers
    const table = new Table({
        head: ['Name', 'Status', 'Outgoing (TB)', 'Limit (TB)', 'Usage %', 'Action'],
        style: {
            head: ['cyan'],
            border: ['gray']
        },
        colAligns: ['left', 'left', 'right', 'right', 'right', 'left']
    });

    // Track servers with high usage
    const highUsageServers = [];
    // Track servers that need to be killed
    const serversToKill = [];
    // Track all servers data for debug mode
    const allServersData = [];
    // Track servers that were killed
    const killedServers = [];

    // Add rows to the table
    for (const s of servers) {
        const outgoingTB = bytesToTB(s.outgoing_traffic || 0);
        const limitTB = bytesToTB(s.included_traffic || 0);
        const usagePercentage = calculatePercentage(
            s.outgoing_traffic || 0,
            s.included_traffic || 0
        );

        // Calculate raw percentage for comparison
        const rawPercentage = s.included_traffic ?
            ((s.outgoing_traffic || 0) / s.included_traffic) * 100 : 0;

        let action = 'None';

        const serverData = {
            id: s.id,
            name: s.name,
            status: s.status,
            outgoingTB,
            limitTB,
            usagePercentage,
            rawPercentage
        };

        // Add to all servers data for debug mode
        allServersData.push(serverData);

        // Check if usage exceeds kill threshold
        if (rawPercentage >= THRESHOLD_PERCENT_KILL) {
            serversToKill.push(serverData);
            action = 'KILL';
        }
        // Check if usage exceeds notification threshold
        else if (rawPercentage >= THRESHOLD_PERCENT_NOTIF) {
            highUsageServers.push(serverData);
            action = 'NOTIFY';
        }

        table.push([
            s.name,
            s.status,
            outgoingTB,
            limitTB,
            usagePercentage,
            action
        ]);
    }

    // Print the table
    console.log(table.toString());

    // Kill servers that exceed the kill threshold
    for (const server of serversToKill) {
        console.log(`Server ${server.name} (${server.id}) exceeds kill threshold with ${server.usagePercentage} usage. Shutting down...`);
        const success = await stopServer(server.id);
        if (success) {
            killedServers.push(server);
        }
    }

    // Send Slack alert if there are servers with high usage, killed servers, or in debug mode
    if (slackWebhook) {
        await sendSlackAlert(highUsageServers, allServersData, killedServers, SEND_USAGE_NOTIF_ALWAYS);
    } else if (highUsageServers.length > 0 || killedServers.length > 0 || SEND_USAGE_NOTIF_ALWAYS) {
        if (SEND_USAGE_NOTIF_ALWAYS) {
            console.log('\nDEBUG MODE: Would have sent all server data to Slack.');
        } else {
            console.log(`\nWARNING: ${highUsageServers.length} server(s) exceed ${THRESHOLD_PERCENT_NOTIF}% usage threshold.`);
            if (killedServers.length > 0) {
                console.log(`ALERT: ${killedServers.length} server(s) were shut down for exceeding ${THRESHOLD_PERCENT_KILL}% usage threshold.`);
            }
        }
        console.log('Set SLACK_WEBHOOK_URL environment variable to receive Slack alerts.');
    }
})();
