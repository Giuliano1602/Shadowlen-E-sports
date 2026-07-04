const { Events } = require("discord.js");
const { startScheduler } = require("../services/scheduler");

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(readyClient) {
    console.log(`Ready! Logged in as ${readyClient.user.tag}`);
    startScheduler(readyClient);
  }
};
