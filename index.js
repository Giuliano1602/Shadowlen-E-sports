const { Client, GatewayIntentBits, Collection } = require("discord.js");
const fs = require("fs");
const path = require("path");
const { startScheduler } = require("./services/scheduler");
const { initHealthMonitor } = require("./services/healthMonitor");
require("dotenv").config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.commands = new Collection();
initHealthMonitor(client);
const excludedCommands = new Set(["shop", "setchannel"]);

// Load commands
const commandsPath = path.join(__dirname, "commands");
for (const file of fs.readdirSync(commandsPath).filter((entry) => entry.endsWith(".js"))) {
  const command = require(`./commands/${file}`);
  if (excludedCommands.has(command.data.name)) {
    continue;
  }
  client.commands.set(command.data.name, command);
}

client.once("clientReady", () => {
  console.log(`Logged in as ${client.user.tag}`);
  startScheduler(client);
});

function isInteractionResponseError(err) {
  return err && (err.code === 10062 || err.code === 40060);
}

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = client.commands.get(interaction.commandName);
  if (!command) {
    console.warn(`No command handler found for /${interaction.commandName}.`);
    try {
      await interaction.reply({
        content: "Dieser Command ist gerade nicht verfuegbar. Bitte in ein paar Sekunden erneut versuchen.",
        flags: 64
      });
    } catch (replyErr) {
      if (!isInteractionResponseError(replyErr)) {
        console.error("Could not reply for missing command handler:", replyErr.message);
      }
    }
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(err);

    if (isInteractionResponseError(err)) {
      console.warn("Interaction konnte nicht mehr beantwortet werden (abgelaufen/acknowledged).");
      return;
    }
    
    try {
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({
          content: "Fehler beim Ausführen des Commands.",
          flags: 64
        });
      } else {
        await interaction.reply({
          content: "Fehler beim Ausführen des Commands.",
          flags: 64
        });
      }
    } catch (replyErr) {
      if (!isInteractionResponseError(replyErr)) {
        console.error("Could not reply to interaction:", replyErr.message);
      }
    }
  }
});

client.on("error", (err) => {
  console.error("Client error:", err);
});

client.on("warn", (info) => {
  console.warn("Client warning:", info);
});

client.login(process.env.DISCORD_TOKEN);
