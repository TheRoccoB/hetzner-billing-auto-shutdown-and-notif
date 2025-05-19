const axios = require('axios');
const Table = require('cli-table3');
const { IncomingWebhook } = require('@slack/webhook');

console.log("hetzner-billing-auto-shutdown-and-notif v0.0.1\n");
console.log('Environment Variables:');
console.log('HETZNER_API_TOKEN:', process.env.HETZNER_API_TOKEN ? '<found, but not printing>' : '<not found>');
console.log('SLACK_WEBHOOK_URL:', process.env.SLACK_WEBHOOK_URL ? '<found, but not printing>' : '<not found>');
console.log('THRESHOLD_PERCENT_NOTIF:', process.env.THRESHOLD_PERCENT_NOTIF || '50 (default)');
console.log('THRESHOLD_PERCENT_KILL:', process.env.THRESHOLD_PERCENT_KILL || '90 (default)');
console.log('SEND_USAGE_NOTIF_ALWAYS:', process.env.SEND_USAGE_NOTIF_ALWAYS || 'false (default)');
console.log('-----------------------------------');

// Configuration
const API_TOKEN = process.env.HETZNER_API_TOKEN;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL; // Set this as an environment variable

const THRESHOLD_PERCENT_NOTIF = parseFloat(process.env.THRESHOLD_PERCENT_NOTIF || '50'); // Percentage threshold for alerts
const THRESHOLD_PERCENT_KILL = parseFloat(process.env.THRESHOLD_PERCENT_KILL || '90'); // Percentage threshold for killing servers
const SEND_USAGE_NOTIF_ALWAYS = process.env.SEND_USAGE_NOTIF_ALWAYS === 'true'; // Set to 'true' to always send to Slack

if (!API_TOKEN) {
    console.error('Set HETZNER_API_TOKEN first.');
    process.exit(1);
}

// Initialize Slack webhook if URL is provided
const slackWebhook = SLACK_WEBHOOK_URL ? new IncomingWebhook(SLACK_WEBHOOK_URL) : null;

async function fetchServers() {
    try {
        const res = await axios.get('https://api.hetzner.cloud/v1/servers', {
            headers: { Authorization: `Bearer ${API_TOKEN}` }
        });
        return res.data.servers;
    } catch (err) {
        const msg = `:warning: Error fetching Hetzner servers: ${err.message}`;
        console.error(msg);
        if (slackWebhook) {
            try {
                await slackWebhook.send({ text: msg });
            } catch (slackErr) {
                console.error(`Failed to send Slack alert: ${slackErr.message}`);
            }
        }
        // decide whether to exit or return an empty list
        process.exit(1);
    }
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

async function sendSlackAlert(serversData, allServersData, killedServers = [], sendAlways = false) {
    // Don't send anything if there's nothing to report and we're not in sendAlways mode
    if (!sendAlways && serversData.length === 0 && killedServers.length === 0) return;

    let headerText, subheaderText;
    let serversToReport = serversData;

    // Priority logic:
    // 1. If servers were killed, that's highest priority
    // 2. If servers exceeded notification threshold, that's next priority
    // 3. If in sendAlways mode and nothing else to report, show all servers

    if (killedServers.length > 0) {
        // Highest priority: Servers were killed
        headerText = "🚨 Server Bandwidth Alert - Servers Killed 🚨";
        subheaderText = `*${killedServers.length} server(s)* have been shut down for exceeding ${THRESHOLD_PERCENT_KILL}% bandwidth usage.\n` +
            `*${serversToReport.length} server(s)* have exceeded ${THRESHOLD_PERCENT_NOTIF}% notification bandwidth usage:` +
            `\n\nTo re-enable servers, go to https://console.hetzner.cloud/` +
            `\n\nIMPORTANT: The next time this script runs on cron, it will disable the servers again. To prevent this adjust THRESHOLD_PERCENT_KILL in Repository settings -> Actions -> Variables.`;

        // If there are also servers above notification threshold, mention them
        if (serversData.length > 0) {
            subheaderText += `\n*${serversData.length} additional server(s)* have exceeded ${THRESHOLD_PERCENT_NOTIF}% bandwidth usage:`;
        }
    } else if (serversData.length > 0) {
        // Second priority: Servers exceeded notification threshold
        headerText = "⚠️ Server Bandwidth Alert ⚠️";
        subheaderText = `*${serversData.length} server(s)* have exceeded ${THRESHOLD_PERCENT_NOTIF}% bandwidth usage:`;
    } else if (sendAlways) {
        // Lowest priority: Send always mode with no alerts
        headerText = "🔍 Server Bandwidth Report";
        subheaderText = `Showing all ${allServersData.length} server(s)`;
        serversToReport = allServersData; // Use all servers for sendAlways report
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

    // Add notification servers or all servers (in sendAlways mode)
    if (serversToReport.length > 0) {
        if (killedServers.length > 0) {
            blocks.push({
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: "*Other servers with high usage:*"
                }
            });
        }

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

    // Always print to console
    console.log('\n--- Alert Message ---');
    console.log(headerText);
    console.log(subheaderText);

    if (killedServers.length > 0) {
        console.log('\nServers that were shut down:');
        killedServers.forEach(server => {
            console.log(`${server.name} (was ${server.status}): ${server.usagePercentage} used (${server.outgoingTB} TB of ${server.limitTB} TB) - SHUT DOWN`);
        });
    }

    if (serversToReport.length > 0) {
        console.log('\nServers with high usage:');
        serversToReport.forEach(server => {
            console.log(`${server.name} (${server.status}): ${server.usagePercentage} used (${server.outgoingTB} TB of ${server.limitTB} TB)`);
        });
    }
    console.log('--------------------\n');

    // Send to Slack if webhook is available
    if (slackWebhook) {
        try {
            await slackWebhook.send(message);
            console.log(`Slack ${sendAlways && serversData.length === 0 && killedServers.length === 0 ? 'report' : 'alert'} sent for ${serversToReport.length} server(s)${killedServers.length > 0 ? ` and ${killedServers.length} killed server(s)` : ''}`);
        } catch (error) {
            console.error('Error sending Slack message:', error.message);
        }
    } else {
        console.log('Slack webhook not configured. Alert message only printed to console.');
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
    // Track all servers data for sendAlways mode
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

        // Calculate raw percentage for comparison (as decimal, not percentage)
        const rawPercentage = s.included_traffic ?
            (s.outgoing_traffic || 0) / s.included_traffic : 0;


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

        // Add to all servers data for sendAlways mode
        allServersData.push(serverData);

        // Check if usage exceeds kill threshold (convert threshold from percentage to decimal)
        if (rawPercentage >= THRESHOLD_PERCENT_KILL / 100) {
            serversToKill.push(serverData);
            action = 'KILL';
        }
        // Check if usage exceeds notification threshold (convert threshold from percentage to decimal)
        else if (rawPercentage >= THRESHOLD_PERCENT_NOTIF / 100) {
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

    // Always send alert (to Slack if configured, otherwise just to console)
    await sendSlackAlert(highUsageServers, allServersData, killedServers, SEND_USAGE_NOTIF_ALWAYS);
})();

