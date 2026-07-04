require("dotenv").config();

const fs = require("node:fs");
const path = require("node:path");
const { REST, Routes } = require("discord.js");

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID || !process.env.GUILD_ID) {
  console.error("Missing DISCORD_TOKEN, CLIENT_ID or GUILD_ID in .env");
  process.exit(1);
}

const deployGlobal = process.env.DEPLOY_GLOBAL === "true";
const excludedCommands = new Set(["shop", "setchannel"]);

const commands = [];
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter((file) => file.endsWith(".js"));

for (const file of commandFiles) {
  const filePath = path.join(commandsPath, file);
  
  // Clear require cache
  delete require.cache[require.resolve(filePath)];
  
  try {
    const command = require(filePath);
    if (command.data && command.execute) {
      if (excludedCommands.has(command.data.name)) {
        console.log(`- Excluded: ${file} (${command.data.name})`);
        continue;
      }

      commands.push(command.data.toJSON());
      console.log(`✓ Loaded: ${file} (${command.data.name})`);
    } else {
      console.log(`✗ Skipped: ${file} (missing data or execute)`);
    }
  } catch (error) {
    console.error(`✗ Error loading ${file}:`, error.message);
  }
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Started refreshing ${commands.length} application (/) commands.`);

    // Deploy to guild (schneller, sofort sichtbar)
    const guildData = await rest.put(
      Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
      { body: commands }
    );

    console.log(`✅ Successfully reloaded ${guildData.length} guild commands in ${process.env.GUILD_ID}.`);

    if (deployGlobal) {
      // Optional global deploy (kann bis zu 1h für Propagation brauchen)
      const globalData = await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands }
      );

      console.log(`✅ Successfully reloaded ${globalData.length} application (/) commands globally.`);
    } else {
      // Remove global commands to avoid duplicates with guild commands.
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: [] }
      );

      console.log("✅ Cleared global application commands (guild-only mode).");
      console.log("ℹ️ Set DEPLOY_GLOBAL=true in .env if you want global command registration.");
    }
  } catch (error) {
    console.error("❌ Deploy error:", error);
  }
})();
