const brain = require("brain.js");
const cluster = require("cluster");
const fs = require("fs");
const WebSocket = require("ws");
const ws = new WebSocket("wss://gateway.discord.gg/?encoding=json&v=9");

const token = "";

if (cluster.isPrimary) {
    var gameResults = JSON.parse(fs.existsSync("gameResults.json") ? fs.readFileSync("gameResults.json").toString() || "{}" : "{}");

    cluster.on("online", function(worker) {
        console.log("[INFO] Worker Running!");
        worker.send({"op": 0, gameResults});
    });

    ws.once("open", function() {
        console.log("[INFO] WebSocket Connected!");
        ws.send(JSON.stringify({"op": 2, "d": {"token": token, "capabilities": 1021, "properties": {"os": "Windows", "browser": "Chrome", "device": "", "system_locale": "en-US", "browser_user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36", "browser_version": "105.0.0.0", "os_version": "10", "referrer": "", "referring_domain": "", "referrer_current": "", "referring_domain_current": "", "release_channel": "stable", "client_build_number": 148303, "client_event_source": null}, "presence": {"status": "online", "since": 0, "activities": [], "afk": false}, "compress": false, "client_state": {"guild_hashes": {}, "highest_last_message_id": "0", "read_state_version": 0, "user_guild_settings_version": -1, "user_settings_version": -1}}}));
    });

    var seq = null;
    ws.on("message", async function(event) {
        const data = JSON.parse(event.toString());
        const d = data.d;
        seq = data.s;

        switch(data.op) {
            case 0:
                switch(data.t) {
                    case "READY":
                        console.log(`[READY] ${d.user.username}#${d.user.discriminator}`);
                        break;
                    case "MESSAGE_CREATE":
                    case "MESSAGE_UPDATE":
                        if (d.channel_id !== "1021714944712003615") return;
                        if (d.author.id !== "687467109243945121") return;

                        const formattedContent = d.content.split("\n\n");
                        formattedContent.shift(0);

                        const currentResults = Object.fromEntries(formattedContent.map(result => [
                            result.match(/`(\d+)회차`/)[1],
                            result.match(/\*\*([홀짝]) :(one|two): \*\*/)[1]
                        ]));

                        const oldResultsCount = Object.keys(gameResults).length;
                        gameResults = {
                            ...gameResults,
                            ...currentResults
                        };

                        console.log(`[INFO] Updated Game Results! (${oldResultsCount} -> ${Object.keys(gameResults).length})`);
                        fs.writeFileSync("gameResults.json", JSON.stringify(gameResults));
                        cluster.fork();
                        break;
                }
                break;
            case 10:
                const heartbeatInterval = d.heartbeat_interval;
                setTimeout(function() {
                    sendHeartbeat();
                    setInterval(sendHeartbeat, heartbeatInterval);
                }, heartbeatInterval * Math.random());
                break;
            case 11:
                console.log("[INFO] Received Heartbeat!");
                break;
        }
    });

    function sendHeartbeat() {
        ws.send(JSON.stringify({"op": 1, "d": seq}));
        console.log("[INFO] Sent Heartbeat!");
    }
}
else if (cluster.isWorker) {
    const net = fs.existsSync("trainData.json")
        ? new brain.recurrent.LSTMTimeStep()
            .fromJSON(JSON.parse(fs.readFileSync("trainData.json").toString()))
        : new brain.recurrent.LSTMTimeStep({
            "inputSize": 1,
            "outputSize": 1,
            "hiddenLayers": [128]
        }
    );

    process.on("message", async function(message) {
        switch(message.op) {
            case 0:
                console.log("[INFO] Worker Connected!");

                setTimeout(() => process.exit(1), 60000);

                const trainCases = Object.keys(message.gameResults).length;
                const lastCaseIndex = Number(Object.keys(message.gameResults)[trainCases - 1]);
                console.log(`[INFO] Train Started with ${Math.min(trainCases, 100)}/${trainCases} Cases!`);

                const trainData = Object.values(message.gameResults).map(result => Number(result === "짝"));
                net.train([trainData.slice(-100)], {
                    "iterations": 300,
                    "callback": trainCallback,
                    "callbackPeriod": 100
                });

                const forecast = net.forecast(trainData.slice(-30), 5);

                console.log("[TRAIN] Predictions:", [...forecast].map((prediction, index) => `${lastCaseIndex + index + 1} ${prediction > 0.5 ? "짝" : "홀"}`).join(" | "));
                
                process.exit(0);
        }
    });

    function trainCallback(data) {
        console.log(`[TRAIN] Accuracy: ${Math.max(0, Math.round(100 - (data.error * 100)))}% | Iterations: ${data.iterations}`);
        fs.writeFileSync("trainData.json", JSON.stringify(net.toJSON()));
    }
}